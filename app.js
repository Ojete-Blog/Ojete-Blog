/* app.js */
(() => {
  "use strict";

  const APP_TAG = "globaleye-trends:final-1.2.0";

  const prev = window.__GLOBAL_EYE_TRENDS__;
  if (prev?.tag === APP_TAG) return;
  if (typeof prev?.cleanup === "function") { try { prev.cleanup(); } catch {} }
  window.__GLOBAL_EYE_TRENDS__ = { tag: APP_TAG, cleanup: null };

  const CFG = {
    profile: "GlobalEye_TV",
    profileUrlX: "https://x.com/GlobalEye_TV",
    profileUrlTW: "https://twitter.com/GlobalEye_TV",
    twWidgets: "https://platform.twitter.com/widgets.js",

    gdeltBase: "https://api.gdeltproject.org/api/v2/doc/doc",
    xSearchBase: "https://x.com/search?q=",

    redditBase: "https://www.reddit.com",
    redditSubs: {
      mix: ["memes", "dankmemes", "me_irl", "wholesomememes", "funny"],
      memes: ["memes"],
      dankmemes: ["dankmemes"],
      meirl: ["me_irl"],
      wholesome: ["wholesomememes"],
      funny: ["funny"]
    },

    proxies: [
      "https://api.allorigins.win/raw?url=",
      "https://api.codetabs.com/v1/proxy?quest="
    ],

    logoPng: "./logo_ojo_png.png",
    logoJpg: "./logo_ojo.jpg",
    toastGif: "./logo_ojo_gif.gif",

    LS_SETTINGS: "ge_trends_settings_final_1",
    LS_FAVS: "ge_trends_favs_final_1",
    LS_RANKS: "ge_trends_ranks_final_1",
    LS_COMPACT: "ge_trends_compact_final_1",

    FETCH_TIMEOUT_MS: 13500,
    MIN_REFRESH_MS: 35000,

    SW_URL: "./sw.js",
    SW_UPDATE_EVERY_MS: 8 * 60_000,
    SS_SW_RELOADED: "ge_sw_reloaded_once_final_1"
  };

  const $ = (id) => document.getElementById(id);

  const elList = $("list");
  const elEmpty = $("empty");
  const elErr = $("err");
  const elLast = $("lastUpdated");
  const elNet = $("netStatus");

  const btnRefresh = $("btnRefresh");
  const btnCompact = $("btnCompact");

  const btnTicker = $("btnTicker");
  const tickerBar = $("tickerBar");
  const tickerTrack = $("tickerTrack");
  const tickerClose = $("tickerClose");

  const btnConfig = $("btnConfig");
  const cfgModal = $("cfgModal");
  const cfgClose = $("cfgClose");
  const cfgSave = $("cfgSave");

  const cfgAuto = $("cfgAuto");
  const cfgEvery = $("cfgEvery");
  const cfgMaxTrends = $("cfgMaxTrends");
  const cfgAlerts = $("cfgAlerts");
  const cfgTicker = $("cfgTicker");
  const cfgTickerSpeed = $("cfgTickerSpeed");
  const cfgMemeMaxPosts = $("cfgMemeMaxPosts");
  const cfgNoThumbs = $("cfgNoThumbs");

  const inpQ = $("q");
  const selLang = $("selLang");
  const selWindow = $("selWindow");
  const selGeo = $("selGeo");

  const selMemeSource = $("selMemeSource");
  const selMemeSort = $("selMemeSort");
  const selMemeRange = $("selMemeRange");

  const trendFilters = $("trendFilters");
  const memeFilters = $("memeFilters");

  const tabsView = $("tabsView");
  const tabsCat = $("tabsCat");

  const timelineMount = $("timelineMount");
  const toastHost = $("toastHost");

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const safeLower = (s) => String(s ?? "").toLowerCase();
  const nowISO = () => new Date().toLocaleString();

  const state = {
    settings: null,
    view: "memes",
    category: "all",

    trends: [],
    filtered: [],
    favs: new Set(),
    ranks: Object.create(null),

    memes: [],
    memesFiltered: [],

    compact: false,

    aborter: null,
    refreshTimer: null,
    swReg: null,
    swTick: null,

    _cleanups: []
  };

  window.__GLOBAL_EYE_TRENDS__.cleanup = () => {
    try { state.aborter?.abort?.(); } catch {}
    try { if (state.refreshTimer) clearTimeout(state.refreshTimer); } catch {}
    try { if (state.swTick) clearInterval(state.swTick); } catch {}
    for (const fn of state._cleanups.splice(0)) { try { fn(); } catch {} }
  };

  function on(target, type, handler, opts){
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler, opts);
    state._cleanups.push(() => target.removeEventListener(type, handler, opts));
  }

  function icon(name, cls=""){
    const c = cls ? `ms ${cls}` : "ms";
    return `<span class="${c}" aria-hidden="true">${name}</span>`;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function decodeHtmlEntities(s){
    const str = String(s ?? "");
    return str
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", "\"")
      .replaceAll("&#039;", "'")
      .replaceAll("&#39;", "'");
  }

  function show(el) { if (el) el.classList.remove("hidden"); }
  function hide(el) { if (el) el.classList.add("hidden"); }

  function setErr(msg) {
    if (!elErr) return;
    if (!msg) { hide(elErr); elErr.textContent = ""; return; }
    elErr.textContent = msg;
    show(elErr);
  }

  function setEmpty(on) {
    if (!elEmpty) return;
    on ? show(elEmpty) : hide(elEmpty);
  }

  function setNet(online) {
    if (!elNet) return;
    elNet.textContent = online ? "Online" : "Offline";
  }

  function toast(title, msg) {
    if (!toastHost) return;
    if (!state.settings?.alertsEnabled) return;

    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `
      <img class="toastImg" src="${CFG.toastGif}" alt="" />
      <div class="toastRow">
        <div class="toastTitle">${escapeHtml(title)}</div>
        <div class="toastMsg">${escapeHtml(msg)}</div>
      </div>
      <button class="toastX" type="button" aria-label="Cerrar">${icon("close")}</button>
    `;

    const kill = () => {
      el.style.transition = "opacity .14s ease, transform .14s ease";
      el.style.opacity = "0";
      el.style.transform = "translateY(10px)";
      setTimeout(() => el.remove(), 170);
    };

    el.querySelector(".toastX")?.addEventListener("click", kill, { once:true });
    toastHost.appendChild(el);
    setTimeout(kill, 3600);
  }

  async function copyToClipboard(text){
    try{
      await navigator.clipboard.writeText(String(text || ""));
      return true;
    }catch{
      try{
        const ta = document.createElement("textarea");
        ta.value = String(text || "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        return true;
      }catch{
        return false;
      }
    }
  }

  function saveSettings(){
    try{
      localStorage.setItem(CFG.LS_SETTINGS, JSON.stringify(state.settings || {}));
    }catch{}
  }

  function loadSettings(){
    const defaults = {
      autoRefresh: true,
      refreshEveryMs: 120_000,
      maxTrends: 35,
      alertsEnabled: true,
      tickerEnabled: false,
      tickerSpeedSec: 28,

      memeMaxPosts: 45,
      noThumbs: false,
      memeRangeHrs: 48,

      view: "memes"
    };

    try{
      const raw = localStorage.getItem(CFG.LS_SETTINGS);
      const obj = raw ? JSON.parse(raw) : null;
      state.settings = { ...defaults, ...(obj || {}) };
    }catch{
      state.settings = { ...defaults };
    }

    state.view = state.settings.view || "memes";
    state.settings.refreshEveryMs = clamp(Number(state.settings.refreshEveryMs || 120_000), CFG.MIN_REFRESH_MS, 900_000);
    state.settings.maxTrends = clamp(Number(state.settings.maxTrends || 35), 10, 80);
    state.settings.tickerSpeedSec = clamp(Number(state.settings.tickerSpeedSec || 28), 12, 120);
    state.settings.memeMaxPosts = clamp(Number(state.settings.memeMaxPosts || 45), 10, 120);
    state.settings.memeRangeHrs = clamp(Number(state.settings.memeRangeHrs || 48), 12, 240);

    try{
      const favRaw = localStorage.getItem(CFG.LS_FAVS);
      const favArr = favRaw ? JSON.parse(favRaw) : [];
      state.favs = new Set(Array.isArray(favArr) ? favArr : []);
    }catch{
      state.favs = new Set();
    }

    try{
      const rkRaw = localStorage.getItem(CFG.LS_RANKS);
      const rk = rkRaw ? JSON.parse(rkRaw) : {};
      state.ranks = (rk && typeof rk === "object") ? rk : Object.create(null);
    }catch{
      state.ranks = Object.create(null);
    }

    try{
      state.compact = localStorage.getItem(CFG.LS_COMPACT) === "1";
    }catch{
      state.compact = false;
    }
  }

  function applySettingsToUI(){
    if (cfgAuto) cfgAuto.checked = !!state.settings.autoRefresh;
    if (cfgEvery) cfgEvery.value = String(Math.round(state.settings.refreshEveryMs / 1000));
    if (cfgMaxTrends) cfgMaxTrends.value = String(state.settings.maxTrends);
    if (cfgAlerts) cfgAlerts.checked = !!state.settings.alertsEnabled;
    if (cfgTicker) cfgTicker.checked = !!state.settings.tickerEnabled;
    if (cfgTickerSpeed) cfgTickerSpeed.value = String(state.settings.tickerSpeedSec);
    if (cfgMemeMaxPosts) cfgMemeMaxPosts.value = String(state.settings.memeMaxPosts);
    if (cfgNoThumbs) cfgNoThumbs.checked = !!state.settings.noThumbs;

    document.documentElement.style.setProperty("--tickerDur", `${state.settings.tickerSpeedSec}s`);
    btnTicker?.setAttribute("aria-pressed", state.settings.tickerEnabled ? "true" : "false");
    setTickerVisible(!!state.settings.tickerEnabled);

    document.body.classList.toggle("compact", !!state.compact);
    btnCompact?.setAttribute("aria-pressed", state.compact ? "true" : "false");
  }

  function openConfig(){ if (cfgModal) show(cfgModal); }
  function closeConfig(){ if (cfgModal) hide(cfgModal); }

  function setTickerVisible(on){
    if (!tickerBar) return;
    on ? show(tickerBar) : hide(tickerBar);
  }

  function setActiveTab(root, attr, value){
    if (!root) return;
    const all = root.querySelectorAll(".tab");
    all.forEach(btn => {
      const v = btn.getAttribute(attr);
      const isOn = (v === value);
      btn.classList.toggle("isActive", isOn);
      btn.setAttribute("aria-selected", isOn ? "true" : "false");
    });
  }

  function setViewMode(mode){
    state.view = mode;
    state.settings.view = mode;
    saveSettings();

    if (mode === "memes"){
      hide(trendFilters);
      show(memeFilters);
      if (tabsCat) hide(tabsCat);
      if (inpQ) inpQ.placeholder = "Buscar memes…";
    }else{
      show(trendFilters);
      hide(memeFilters);
      if (tabsCat) show(tabsCat);
      if (inpQ) inpQ.placeholder = "Buscar…";
    }
  }

  function pickMemeRangeHrs(){
    const v = Number(selMemeRange?.value || 48);
    return clamp(v, 12, 240);
  }

  function fmtNum(n){
    const x = Number(n || 0);
    if (x >= 1_000_000) return `${(x/1_000_000).toFixed(1).replace(/\.0$/,"")}M`;
    if (x >= 1_000) return `${(x/1_000).toFixed(1).replace(/\.0$/,"")}K`;
    return String(Math.round(x));
  }

  function relTimeFromUtcSeconds(sec){
    const ms = Number(sec || 0) * 1000;
    const diff = Date.now() - ms;
    const m = Math.floor(diff / 60000);
    if (m < 1) return "ahora";
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  }

  async function fetchWithTimeout(url, opts={}){
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), CFG.FETCH_TIMEOUT_MS);
    try{
      return await fetch(url, { ...opts, signal: ctrl.signal, cache:"no-store" });
    }finally{
      clearTimeout(t);
    }
  }

  async function fetchJsonSmart(url){
    const tries = [url, ...CFG.proxies.map(p => p + encodeURIComponent(url))];
    let lastErr = null;

    for (const u of tries){
      try{
        const res = await fetchWithTimeout(u, { headers: { "accept":"application/json,text/plain,*/*" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const txt = await res.text();
        try{
          return JSON.parse(txt);
        }catch{
          const fixed = txt.startsWith("\uFEFF") ? txt.slice(1) : txt;
          return JSON.parse(fixed);
        }
      }catch(e){
        lastErr = e;
      }
    }
    throw lastErr || new Error("Fetch failed");
  }

  function clearList(){
    if (elList) elList.innerHTML = "";
  }

  function renderEmpty(msg){
    clearList();
    setErr("");
    elEmpty.textContent = msg || "Sin resultados.";
    setEmpty(true);
  }

  function renderMemes(list){
    clearList();
    setEmpty(false);
    setErr("");

    if (!elList) return;
    const frag = document.createDocumentFragment();

    for (const m of list){
      const el = document.createElement("div");
      el.className = "memeCard";

      const sub = escapeHtml(m.subreddit || "");
      const by = escapeHtml(m.author ? `u/${m.author}` : "");
      const title = escapeHtml(m.title || "");
      const time = escapeHtml(relTimeFromUtcSeconds(m.created_utc || 0));
      const score = escapeHtml(fmtNum(m.score || 0));
      const com = escapeHtml(fmtNum(m.num_comments || 0));
      const url = escapeHtml(m.permalinkUrl || "#");

      const mediaHtml = (state.settings.noThumbs || !m.mediaUrl) ? "" : (
        m.mediaType === "video"
          ? `<div class="memeMedia"><video controls preload="metadata" src="${escapeHtml(m.mediaUrl)}"></video></div>`
          : `<div class="memeMedia"><img loading="lazy" decoding="async" src="${escapeHtml(m.mediaUrl)}" alt="" /></div>`
      );

      el.innerHTML = `
        <div class="memeHead">
          <div class="memeMeta">
            <div class="memeSub">r/${sub}</div>
            <div class="memeBy">${by} · ${time}</div>
          </div>
          <div class="memeBtns">
            <a class="aBtn" href="${url}" target="_blank" rel="noreferrer" title="Abrir">
              ${icon("open_in_new")} <span class="hideSm">Abrir</span>
            </a>
          </div>
        </div>

        <div class="memeTitle">${title}</div>
        ${mediaHtml}

        <div class="memeFoot">
          <div class="memeStats">
            <span class="tagPill">${icon("local_fire_department","sm")} ${score}</span>
            <span class="tagPill">${icon("chat_bubble","sm")} ${com}</span>
            <span class="tagPill">${icon("schedule","sm")} ${time}</span>
          </div>
          <div class="memeBtns">
            <button class="aBtn" type="button" data-copy="${escapeHtml(m.title || "")} ${escapeHtml(m.permalinkUrl || "")}">
              ${icon("content_copy")} Copiar
            </button>
          </div>
        </div>
      `;

      el.querySelector("[data-copy]")?.addEventListener("click", async (e) => {
        const txt = e.currentTarget?.getAttribute("data-copy") || "";
        const ok = await copyToClipboard(txt);
        toast("Copiado", ok ? "Texto copiado al portapapeles." : "No se pudo copiar.");
      });

      frag.appendChild(el);
    }

    elList.appendChild(frag);
  }

  function applyMemeFilter(){
    const q = safeLower(inpQ?.value || "").trim();
    let list = state.memes || [];
    if (q){
      list = list.filter(m => {
        const hay = `${m.title||""} ${m.subreddit||""} ${m.author||""}`.toLowerCase();
        return hay.includes(q);
      });
    }
    state.memesFiltered = list;
    if (!list.length) renderEmpty("No hay memes con estos filtros.");
    else renderMemes(list);
    if (state.settings.tickerEnabled) buildTickerFromCurrent();
  }

  async function fetchSubreddit(sub, sort){
    const s = String(sort || "new");
    const base = `${CFG.redditBase}/r/${encodeURIComponent(sub)}/${encodeURIComponent(s)}.json?raw_json=1&limit=80`;
    const url = (s === "top") ? (base + "&t=day") : base;
    const data = await fetchJsonSmart(url);
    const children = data?.data?.children || [];
    const posts = children.map(c => c?.data).filter(Boolean);
    return posts;
  }

  function pickMemeMedia(p){
    const url = String(p?.url_overridden_by_dest || p?.url || "");
    const low = url.toLowerCase();

    if (p?.is_video && p?.media?.reddit_video?.fallback_url){
      return { type:"video", url: String(p.media.reddit_video.fallback_url) };
    }

    if (/\.(png|jpe?g|gif|webp)$/i.test(low)){
      return { type:"image", url };
    }

    const prev = p?.preview?.images?.[0]?.source?.url;
    if (prev){
      return { type:"image", url: decodeHtmlEntities(prev) };
    }

    return { type:"", url:"" };
  }

  async function refreshMemes(){
    setErr("");
    setEmpty(false);
    clearList();

    state.settings.memeRangeHrs = pickMemeRangeHrs();
    saveSettings();

    const sourceKey = String(selMemeSource?.value || "mix");
    const sort = String(selMemeSort?.value || "new");
    const subs = CFG.redditSubs[sourceKey] || CFG.redditSubs.mix;

    toast("MEMES", `Cargando memes (últimas ${state.settings.memeRangeHrs}h)…`);

    const maxAgeMs = state.settings.memeRangeHrs * 3600_000;
    const cutoff = Date.now() - maxAgeMs;

    const collected = [];
    for (const sub of subs){
      try{
        const posts = await fetchSubreddit(sub, sort);
        for (const p of posts){
          const createdMs = Number(p?.created_utc || 0) * 1000;
          if (!createdMs || createdMs < cutoff) continue;

          const perm = String(p?.permalink || "");
          const permalinkUrl = perm ? (CFG.redditBase + perm) : "";

          const media = pickMemeMedia(p);

          collected.push({
            id: String(p?.id || `${sub}_${createdMs}`),
            subreddit: String(p?.subreddit || sub),
            author: String(p?.author || ""),
            title: decodeHtmlEntities(String(p?.title || "")),
            created_utc: Number(p?.created_utc || 0),
            score: Number(p?.score || 0),
            num_comments: Number(p?.num_comments || 0),
            permalinkUrl,
            mediaType: media.type,
            mediaUrl: media.url
          });
        }
      }catch(e){
        // tolerante: si falla un sub, seguimos con el resto
      }
    }

    const seen = new Set();
    const uniq = [];
    for (const m of collected){
      const k = m.permalinkUrl || m.id;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(m);
    }

    uniq.sort((a,b) => (b.created_utc - a.created_utc));
    state.memes = uniq.slice(0, state.settings.memeMaxPosts);

    if (!state.memes.length) renderEmpty("No hay memes recientes con estos filtros.");
    else applyMemeFilter();

    elLast && (elLast.textContent = nowISO());
    if (state.settings.tickerEnabled) buildTickerFromCurrent();
  }

  function setFav(key, on){
    const k = String(key || "");
    if (!k) return;
    if (on) state.favs.add(k);
    else state.favs.delete(k);
    try{ localStorage.setItem(CFG.LS_FAVS, JSON.stringify([...state.favs])); }catch{}
  }

  function isFav(key){ return state.favs.has(String(key||"")); }

  function renderTrends(list){
    clearList();
    setEmpty(false);
    setErr("");

    if (!elList) return;

    const frag = document.createDocumentFragment();
    let idx = 0;

    for (const t of list){
      idx++;

      const key = String(t.term || "");
      const favOn = isFav(key);

      const el = document.createElement("div");
      el.className = "trend";
      el.innerHTML = `
        <div class="tRank">${escapeHtml(String(idx))}</div>
        <div class="tBody">
          <div class="tTitle">${escapeHtml(t.term || "")}</div>
          <div class="tMeta">
            <span>${escapeHtml(t.categoryLabel || "General")}</span>
            <span>${escapeHtml(fmtNum(t.score || 0))}</span>
          </div>
        </div>
        <div class="tBtns">
          <button class="aBtn star ${favOn ? "on":""}" type="button" data-fav="${escapeHtml(key)}" aria-label="Favorito">
            ${favOn ? icon("star","fill") : icon("star")}
          </button>
          <a class="aBtn" href="${CFG.xSearchBase + encodeURIComponent(key)}" target="_blank" rel="noreferrer" title="Buscar en X">
            ${icon("travel_explore")} X
          </a>
          <button class="aBtn" type="button" data-copy="${escapeHtml(key)}">
            ${icon("content_copy")} Copiar
          </button>
        </div>
      `;

      el.querySelector("[data-fav]")?.addEventListener("click", (e) => {
        const k = e.currentTarget?.getAttribute("data-fav") || "";
        const next = !isFav(k);
        setFav(k, next);
        applyFilter();
      });

      el.querySelector("[data-copy]")?.addEventListener("click", async (e) => {
        const txt = e.currentTarget?.getAttribute("data-copy") || "";
        const ok = await copyToClipboard(txt);
        toast("Copiado", ok ? "Texto copiado al portapapeles." : "No se pudo copiar.");
      });

      frag.appendChild(el);
    }

    elList.appendChild(frag);
  }

  const STOP = new Set([
    "de","la","el","y","en","a","los","las","un","una","por","para","con","sin","del","al","se","su",
    "the","and","for","with","from","that","this","into","over","under","after","before","about","your","you"
  ]);

  function normalizeTerm(s){
    return String(s||"")
      .replace(/\s+/g," ")
      .trim();
  }

  function tokeniseTitle(title){
    const raw = String(title || "")
      .replace(/[“”"()［\]【】{}<>]/g," ")
      .replace(/[’']/g,"'")
      .replace(/[—–·•]/g," ")
      .replace(/[.,:;!?]/g," ")
      .replace(/\s+/g," ")
      .trim();

    if (!raw) return [];
    return raw.split(" ").map(w => w.trim()).filter(Boolean);
  }

  function isGoodWord(w){
    if (!w) return false;
    const low = w.toLowerCase();
    if (STOP.has(low)) return false;
    if (low.length < 3) return false;
    if (/^\d+$/.test(low)) return false;
    if (/^https?:/i.test(low)) return false;
    return true;
  }

  function buildNgrams(words, nMin=2, nMax=4){
    const out = [];
    for (let n=nMin; n<=nMax; n++){
      for (let i=0; i<=words.length-n; i++){
        const chunk = words.slice(i, i+n);
        const joined = chunk.join(" ");
        out.push(joined);
      }
    }
    return out;
  }

  function categoryHeuristic(term){
    const t = safeLower(term);
    if (/(gol|liga|champions|barça|madrid|nba|nfl|mlb|tenis|fútbol|futbol)/i.test(t)) return { key:"sports", label:"Deportes" };
    if (/(elecciones|gobierno|congreso|senado|presidente|ministro|pp|psoe|vox|podemos|trump|biden|putin|zelenski)/i.test(t)) return { key:"politics", label:"Política" };
    if (/(viral|tiktok|meme|stream|influencer|celebridad|famoso)/i.test(t)) return { key:"viral", label:"Viral" };
    return { key:"news", label:"Noticias" };
  }

  async function refreshTrends(){
    setErr("");
    setEmpty(false);
    clearList();

    toast("Tendencias", "Calculando tendencias…");

    const lang = String(selLang?.value || "spanish");
    const windowStr = String(selWindow?.value || "4H");
    const geo = String(selGeo?.value || "ES");

    const langQ =
      (lang === "english") ? "(sourcelang:eng)" :
      (lang === "mixed") ? "(sourcelang:spa OR sourcelang:eng)" :
      "(sourcelang:spa)";

    const geoQ = (geo === "GLOBAL") ? "" : "(sourceCountry:ES)";
    const query = geoQ ? `${langQ} AND ${geoQ}` : `${langQ}`;

    const url = `${CFG.gdeltBase}?query=${encodeURIComponent(query)}&mode=ArtList&format=json&maxrecords=250&sort=HybridRel&timespan=${encodeURIComponent(windowStr)}`;

    let data;
    try{
      data = await fetchJsonSmart(url);
    }catch(e){
      setErr("No se pudo cargar GDELT ahora mismo.");
      renderEmpty("Sin datos.");
      return;
    }

    const arts = Array.isArray(data?.articles) ? data.articles : [];
    const freq = new Map();

    for (const a of arts){
      const title = String(a?.title || "");
      const words = tokeniseTitle(title).filter(isGoodWord);

      // hashtags / mentions
      for (const w of tokeniseTitle(title)){
        if (w.startsWith("#") && w.length >= 3) freq.set(w, (freq.get(w)||0) + 3);
        if (w.startsWith("@") && w.length >= 3) freq.set(w, (freq.get(w)||0) + 2);
      }

      // ngrams (2-4)
      const grams = buildNgrams(words, 2, 4);
      for (const g of grams){
        const term = normalizeTerm(g);
        if (term.length < 8) continue;
        freq.set(term, (freq.get(term)||0) + 1);
      }

      // proper-ish single words
      for (const w of words){
        if (w[0] === w[0]?.toUpperCase() && w.length >= 4){
          freq.set(w, (freq.get(w)||0) + 1);
        }
      }
    }

    const items = [];
    for (const [term, score] of freq.entries()){
      if (score < 3) continue;
      const cat = categoryHeuristic(term);
      items.push({ term, score, category: cat.key, categoryLabel: cat.label });
    }

    items.sort((a,b) => (b.score - a.score));
    state.trends = items.slice(0, state.settings.maxTrends);

    applyFilter();
    elLast && (elLast.textContent = nowISO());
    if (state.settings.tickerEnabled) buildTickerFromCurrent();
  }

  function applyTrendFilter(){
    const q = safeLower(inpQ?.value || "").trim();
    const cat = state.category || "all";
    const view = state.view;

    let list = state.trends || [];

    if (view === "favs"){
      list = list.filter(t => isFav(t.term));
    }

    if (cat !== "all"){
      list = list.filter(t => (t.category === cat));
    }

    if (q){
      list = list.filter(t => safeLower(t.term).includes(q));
    }

    state.filtered = list;

    if (!list.length) renderEmpty("No hay tendencias con estos filtros.");
    else renderTrends(list);

    if (state.settings.tickerEnabled) buildTickerFromCurrent();
  }

  function applyFilter(){
    setErr("");
    setEmpty(false);

    if (state.view === "memes") return applyMemeFilter();
    return applyTrendFilter();
  }

  function buildTickerFromCurrent(){
    if (!tickerTrack) return;

    const items =
      (state.view === "memes")
        ? (state.memesFiltered || state.memes || []).map(m => m.title).filter(Boolean)
        : (state.filtered || state.trends || []).map(t => t.term).filter(Boolean);

    if (!items.length){
      tickerTrack.textContent = "";
      return;
    }

    const clean = items.slice(0, 30).map(s => String(s).replace(/\s+/g," ").trim()).filter(Boolean);
    const doubled = clean.concat(clean);

    tickerTrack.innerHTML = doubled.map(s => `<span>${escapeHtml(s)}</span>`).join("  <span class=\"dot\">•</span>  ");
  }

  function mountTimeline(){
    if (!timelineMount) return;

    timelineMount.innerHTML = `
      <a class="twitter-timeline"
         data-theme="dark"
         data-chrome="noheader nofooter transparent"
         data-dnt="true"
         data-tweet-limit="7"
         href="${CFG.profileUrlTW}">
         ${escapeHtml(CFG.profileUrlTW)}
      </a>
    `;

    try{
      if (window.twttr?.widgets?.load) window.twttr.widgets.load(timelineMount);
    }catch{}

    setTimeout(() => {
      const hasIframe = !!timelineMount.querySelector("iframe");
      if (!hasIframe){
        timelineMount.innerHTML = `
          <div class="hint">
            No se pudo cargar el widget embebido. Abre el perfil directamente:
            <div style="margin-top:10px;">
              <a class="btn ghost" href="${CFG.profileUrlX}" target="_blank" rel="noreferrer">
                ${icon("open_in_new")} Abrir @${escapeHtml(CFG.profile)}
              </a>
            </div>
          </div>
        `;
      }
    }, 1800);
  }

  async function refresh(){
    try { state.aborter?.abort?.(); } catch {}
    state.aborter = new AbortController();

    if (state.view === "memes"){
      await refreshMemes();
    }else{
      await refreshTrends();
    }
  }

  function schedule(){
    try { if (state.refreshTimer) clearTimeout(state.refreshTimer); } catch {}
    state.refreshTimer = null;

    if (!state.settings.autoRefresh) return;

    const ms = clamp(Number(state.settings.refreshEveryMs || 120_000), CFG.MIN_REFRESH_MS, 900_000);
    state.refreshTimer = setTimeout(async () => {
      await refresh();
      schedule();
    }, ms);
  }

  async function initAutoUpdateSW(){
    if (!("serviceWorker" in navigator)) return;

    try{
      const reg = await navigator.serviceWorker.register(CFG.SW_URL, { updateViaCache:"none" });
      state.swReg = reg;

      const tick = async () => {
        try{
          await reg.update();
          const nw = reg.installing || reg.waiting;
          if (nw && nw.state === "installed"){
            const key = CFG.SS_SW_RELOADED;
            const did = sessionStorage.getItem(key) === "1";
            if (!did){
              sessionStorage.setItem(key, "1");
              toast("Actualización", "Aplicando update…");
              setTimeout(() => location.reload(), 450);
            }
          }
        }catch{}
      };

      state.swTick = setInterval(tick, CFG.SW_UPDATE_EVERY_MS);
      setTimeout(tick, 2500);
    }catch{}
  }

  function bindUI(){
    on(btnRefresh, "click", async () => { await refresh(); schedule(); });
    on(btnCompact, "click", () => {
      state.compact = !state.compact;
      try{ localStorage.setItem(CFG.LS_COMPACT, state.compact ? "1" : "0"); }catch{}
      document.body.classList.toggle("compact", !!state.compact);
      btnCompact?.setAttribute("aria-pressed", state.compact ? "true" : "false");
    });

    on(inpQ, "input", () => applyFilter());

    on(selLang, "change", async () => { if (state.view !== "memes") await refreshTrends(); schedule(); });
    on(selWindow, "change", async () => { if (state.view !== "memes") await refreshTrends(); schedule(); });
    on(selGeo, "change", async () => { if (state.view !== "memes") await refreshTrends(); schedule(); });

    on(selMemeSource, "change", async () => { if (state.view === "memes") await refreshMemes(); schedule(); });
    on(selMemeSort, "change", async () => { if (state.view === "memes") await refreshMemes(); schedule(); });
    on(selMemeRange, "change", async () => { state.settings.memeRangeHrs = pickMemeRangeHrs(); saveSettings(); if (state.view === "memes") await refreshMemes(); schedule(); });

    on(tabsView, "click", async (e) => {
      const btn = e.target?.closest?.(".tab");
      if (!btn) return;

      const view = btn.getAttribute("data-view") || "all";
      const next =
        (view === "memes") ? "memes" :
        (view === "favs") ? "favs" : "all";

      setViewMode(next);
      setActiveTab(tabsView, "data-view", next);

      if (next !== "memes" && tabsCat) show(tabsCat);
      applyFilter();

      if (next === "memes" && (!state.memes || state.memes.length === 0)){
        await refreshMemes();
        schedule();
      }
      if (next !== "memes" && (!state.trends || state.trends.length === 0)){
        await refreshTrends();
        schedule();
      }
    });

    on(tabsCat, "click", (e) => {
      const btn = e.target?.closest?.(".tab");
      if (!btn) return;
      state.category = btn.getAttribute("data-cat") || "all";
      setActiveTab(tabsCat, "data-cat", state.category);
      applyFilter();
    });

    on(btnTicker, "click", () => {
      state.settings.tickerEnabled = !state.settings.tickerEnabled;
      btnTicker?.setAttribute("aria-pressed", state.settings.tickerEnabled ? "true" : "false");
      setTickerVisible(state.settings.tickerEnabled);
      saveSettings();
      buildTickerFromCurrent();
    });

    on(tickerClose, "click", () => {
      state.settings.tickerEnabled = false;
      btnTicker?.setAttribute("aria-pressed", "false");
      setTickerVisible(false);
      saveSettings();
    });

    on(btnConfig, "click", openConfig);
    on(cfgClose, "click", closeConfig);
    on(cfgModal, "click", (e) => { if (e.target === cfgModal) closeConfig(); });

    on(cfgSave, "click", async () => {
      const everySec = clamp(Number(cfgEvery?.value || 120), 35, 900);
      const maxT = clamp(Number(cfgMaxTrends?.value || 35), 10, 80);
      const tSpd = clamp(Number(cfgTickerSpeed?.value || 28), 12, 120);
      const memeMax = clamp(Number(cfgMemeMaxPosts?.value || 45), 10, 120);

      state.settings.autoRefresh = !!cfgAuto?.checked;
      state.settings.refreshEveryMs = everySec * 1000;
      state.settings.maxTrends = maxT;
      state.settings.alertsEnabled = !!cfgAlerts?.checked;
      state.settings.tickerEnabled = !!cfgTicker?.checked;
      state.settings.tickerSpeedSec = tSpd;

      state.settings.memeMaxPosts = memeMax;
      state.settings.noThumbs = !!cfgNoThumbs?.checked;

      document.documentElement.style.setProperty("--tickerDur", `${state.settings.tickerSpeedSec}s`);
      setTickerVisible(state.settings.tickerEnabled);
      btnTicker?.setAttribute("aria-pressed", state.settings.tickerEnabled ? "true" : "false");

      saveSettings();
      closeConfig();
      await refresh();
      schedule();
    });

    on(window, "online", () => setNet(true));
    on(window, "offline", () => setNet(false));
  }

  (async function init(){
    loadSettings();
    applySettingsToUI();

    setNet(navigator.onLine);

    setViewMode(state.view || "memes");
    setActiveTab(tabsView, "data-view", state.view || "memes");
    setActiveTab(tabsCat, "data-cat", state.category || "all");

    bindUI();

    mountTimeline();
    initAutoUpdateSW();

    await refresh();
    schedule();
  })();
})();
