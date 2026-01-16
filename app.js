(() => {
  "use strict";

  const APP_TAG = "globaleye-trends:final-1.1.0";

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
    view: "all",
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

  function setNet(ok){
    if (!elNet) return;
    elNet.textContent = ok ? "Online" : "Offline";
  }

  function toast(title, msg){
    if (!toastHost || !state.settings?.alertsEnabled) return;
    const wrap = document.createElement("div");
    wrap.className = "toast";
    wrap.innerHTML = `
      <img class="toastImg" src="${CFG.toastGif}" alt="">
      <div class="toastRow">
        <div class="toastTitle">${escapeHtml(title || "Aviso")}</div>
        <div class="toastMsg">${escapeHtml(msg || "")}</div>
      </div>
      <button class="toastX" type="button" aria-label="Cerrar">✕</button>
    `;
    const btn = wrap.querySelector(".toastX");
    btn?.addEventListener("click", () => { try{ wrap.remove(); }catch{} }, { passive:true });
    toastHost.appendChild(wrap);
    setTimeout(() => { try{ wrap.remove(); }catch{} }, 5200);
  }

  function applyPngLogoIfAvailable(){
    const png = CFG.logoPng;
    const jpg = CFG.logoJpg;
    const img = new Image();
    img.onload = () => {
      document.querySelectorAll("img.brandLogo, img.tickerLogo").forEach(el => {
        el.src = png;
        try{ el.style.objectFit = "cover"; }catch{}
      });
    };
    img.onerror = () => {
      document.querySelectorAll("img.brandLogo, img.tickerLogo").forEach(el => { el.src = jpg; });
    };
    img.src = png;
  }

  const DEFAULT_SETTINGS = {
    view: "memes",

    lang: "spanish",
    window: "4H",
    geo: "ES",

    maxTrends: 35,
    maxArticles: 250,

    autoRefresh: true,
    refreshEveryMs: 120_000,
    alertsEnabled: true,
    tickerEnabled: false,
    tickerSpeedSec: 28,

    memeSource: "mix",
    memeSort: "new",
    memeRangeHrs: 48,
    memeMaxPosts: 45,
    noThumbs: false
  };

  function loadSettings(){
    let s = null;
    try{
      const raw = localStorage.getItem(CFG.LS_SETTINGS);
      if (raw) s = JSON.parse(raw);
    }catch{}
    state.settings = { ...DEFAULT_SETTINGS, ...(s || {}) };

    state.settings.maxTrends = clamp(Number(state.settings.maxTrends || 35), 10, 80);
    state.settings.maxArticles = clamp(Number(state.settings.maxArticles || 250), 50, 500);
    state.settings.refreshEveryMs = clamp(Number(state.settings.refreshEveryMs || 120000), CFG.MIN_REFRESH_MS, 900000);
    state.settings.tickerSpeedSec = clamp(Number(state.settings.tickerSpeedSec || 28), 12, 120);

    state.settings.memeMaxPosts = clamp(Number(state.settings.memeMaxPosts || 45), 10, 120);
    state.settings.memeRangeHrs = clamp(Number(state.settings.memeRangeHrs || 48), 12, 168);
    state.settings.noThumbs = !!state.settings.noThumbs;

    if (!["spanish","english","mixed"].includes(state.settings.lang)) state.settings.lang = "spanish";
    if (!["2H","4H","6H","12H"].includes(String(state.settings.window).toUpperCase())) state.settings.window = "4H";
    if (!["ES","GLOBAL"].includes(String(state.settings.geo).toUpperCase())) state.settings.geo = "ES";

    if (!["mix","memes","dankmemes","meirl","wholesome","funny"].includes(String(state.settings.memeSource))) state.settings.memeSource = "mix";
    if (!["new","hot","top"].includes(String(state.settings.memeSort))) state.settings.memeSort = "new";

    try{
      const favRaw = localStorage.getItem(CFG.LS_FAVS);
      const favArr = favRaw ? JSON.parse(favRaw) : null;
      if (Array.isArray(favArr)) state.favs = new Set(favArr.map(String));
    }catch{}

    try{
      const ranksRaw = localStorage.getItem(CFG.LS_RANKS);
      const ranksObj = ranksRaw ? JSON.parse(ranksRaw) : null;
      if (ranksObj && typeof ranksObj === "object") state.ranks = ranksObj;
    }catch{}

    try{ state.compact = localStorage.getItem(CFG.LS_COMPACT) === "1"; }catch{}

    state.view = (state.settings.view === "memes") ? "memes" : "all";
  }

  function saveSettings(){
    try { localStorage.setItem(CFG.LS_SETTINGS, JSON.stringify(state.settings)); } catch {}
    try { localStorage.setItem(CFG.LS_FAVS, JSON.stringify([...state.favs])); } catch {}
    try { localStorage.setItem(CFG.LS_RANKS, JSON.stringify(state.ranks)); } catch {}
    try { localStorage.setItem(CFG.LS_COMPACT, state.compact ? "1" : "0"); } catch {}
  }

  function applySettingsToUI(){
    if (selLang) selLang.value = state.settings.lang;
    if (selWindow) selWindow.value = state.settings.window;
    if (selGeo) selGeo.value = state.settings.geo;

    if (cfgAuto) cfgAuto.checked = !!state.settings.autoRefresh;
    if (cfgEvery) cfgEvery.value = String(Math.round(state.settings.refreshEveryMs / 1000));
    if (cfgMaxTrends) cfgMaxTrends.value = String(state.settings.maxTrends);
    if (cfgAlerts) cfgAlerts.checked = !!state.settings.alertsEnabled;
    if (cfgTicker) cfgTicker.checked = !!state.settings.tickerEnabled;
    if (cfgTickerSpeed) cfgTickerSpeed.value = String(state.settings.tickerSpeedSec);

    if (cfgMemeMaxPosts) cfgMemeMaxPosts.value = String(state.settings.memeMaxPosts);
    if (cfgNoThumbs) cfgNoThumbs.checked = !!state.settings.noThumbs;

    if (selMemeSource) selMemeSource.value = state.settings.memeSource;
    if (selMemeSort) selMemeSort.value = state.settings.memeSort;
    if (selMemeRange) selMemeRange.value = String(state.settings.memeRangeHrs);

    document.documentElement.style.setProperty("--tickerDur", `${state.settings.tickerSpeedSec}s`);

    document.body.classList.toggle("compact", state.compact);
    btnCompact?.setAttribute("aria-pressed", state.compact ? "true" : "false");

    setTickerVisible(!!state.settings.tickerEnabled);
    btnTicker?.setAttribute("aria-pressed", state.settings.tickerEnabled ? "true" : "false");
  }

  function pickTimespanUi(){
    const v = String(selWindow?.value || state.settings.window || "4H").toUpperCase();
    return (["2H","4H","6H","12H"].includes(v)) ? v : "4H";
  }
  function pickTimespanHours(){
    const v = pickTimespanUi();
    if (v === "2H") return 2;
    if (v === "6H") return 6;
    if (v === "12H") return 12;
    return 4;
  }
  function pickLang(){
    const v = String(selLang?.value || state.settings.lang || "spanish").toLowerCase();
    if (v === "mixed") return "mixed";
    if (v === "english") return "english";
    return "spanish";
  }
  function pickGeo(){
    const v = String(selGeo?.value || state.settings.geo || "ES").toUpperCase();
    return (v === "GLOBAL") ? "GLOBAL" : "ES";
  }

  function pickMemeSource(){
    const v = String(selMemeSource?.value || state.settings.memeSource || "mix");
    return (["mix","memes","dankmemes","meirl","wholesome","funny"].includes(v)) ? v : "mix";
  }
  function pickMemeSort(){
    const v = String(selMemeSort?.value || state.settings.memeSort || "new");
    return (["new","hot","top"].includes(v)) ? v : "new";
  }
  function pickMemeRangeHrs(){
    const v = Number(selMemeRange?.value || state.settings.memeRangeHrs || 48);
    return clamp(v, 12, 168);
  }

  function openConfig(){ cfgModal?.classList.remove("hidden"); }
  function closeConfig(){ cfgModal?.classList.add("hidden"); }

  function setActiveTab(container, attr, value){
    if (!container) return;
    container.querySelectorAll(".tab").forEach(b => {
      const v = b.getAttribute(attr);
      const active = (v === value);
      b.classList.toggle("isActive", active);
      b.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function toggleCompact(){
    state.compact = !state.compact;
    document.body.classList.toggle("compact", state.compact);
    btnCompact?.setAttribute("aria-pressed", state.compact ? "true" : "false");
    saveSettings();
  }

  function setTickerVisible(on){
    if (!tickerBar) return;
    on ? tickerBar.classList.remove("hidden") : tickerBar.classList.add("hidden");
  }

  function ensureWidgetsScript(){
    try{
      if (window.twttr?.widgets) return true;
      if (document.querySelector(`script[src="${CFG.twWidgets}"]`)) return true;
      const s = document.createElement("script");
      s.async = true;
      s.src = CFG.twWidgets;
      s.charset = "utf-8";
      document.head.appendChild(s);
      return true;
    }catch{
      return false;
    }
  }

  function mountTimeline(){
    if (!timelineMount) return;

    timelineMount.innerHTML = "";

    const a = document.createElement("a");
    a.className = "twitter-timeline";
    a.href = CFG.profileUrlTW;
    a.setAttribute("data-theme", "dark");
    a.setAttribute("data-dnt", "true");
    a.setAttribute("data-chrome", "noheader nofooter");
    a.setAttribute("data-height", "720");
    a.textContent = `Tweets by @${CFG.profile}`;

    timelineMount.appendChild(a);

    ensureWidgetsScript();

    const tryLoad = () => {
      try{
        if (window.twttr?.widgets?.load) window.twttr.widgets.load(timelineMount);
      }catch{}
    };

    tryLoad();
    setTimeout(tryLoad, 1200);
    setTimeout(tryLoad, 2600);

    setTimeout(() => {
      const hasIframe = !!timelineMount.querySelector("iframe");
      if (hasIframe) return;

      if (document.getElementById("tl_fallback_hint")) return;

      const div = document.createElement("div");
      div.id = "tl_fallback_hint";
      div.className = "timelineFallback";
      div.innerHTML = `
        <div class="tlTitle">El feed no cargó</div>
        <div class="tlText">Algunos navegadores/adblock bloquean el widget. Puedes abrir el perfil directamente:</div>
        <a class="tlBtn" href="${CFG.profileUrlX}" target="_blank" rel="noreferrer">Abrir @${CFG.profile}</a>
      `;
      timelineMount.appendChild(div);
    }, 9000);
  }

  function setViewMode(v){
    state.view = v;
    state.settings.view = v;
    saveSettings();

    const isMemes = (v === "memes");
    if (trendFilters) trendFilters.classList.toggle("hidden", isMemes);
    if (memeFilters) memeFilters.classList.toggle("hidden", !isMemes);
    if (tabsCat) tabsCat.classList.toggle("hidden", isMemes);

    if (inpQ) inpQ.placeholder = isMemes ? "Buscar memes… (título)" : "Buscar…";
  }

  function splitWords(title){
    const raw = String(title || "")
      .replace(/[“”«»]/g, "\"")
      .replace(/[’]/g, "'")
      .replace(/[^\p{L}\p{N}_#@'"\s-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

    const out = [];
    if (!raw) return out;

    for (const tok of raw.split(" ")){
      const t = tok.trim();
      if (!t) continue;

      const isHash = t.startsWith("#") && t.length >= 2;
      const isAt = t.startsWith("@") && t.length >= 2;

      const base = (isHash || isAt) ? t.slice(1) : t;
      const norm = base.toLowerCase();

      const cap = /^[A-ZÁÉÍÓÚÜÑ]/.test(base);
      const hasNum = /\d/.test(base);

      out.push({
        raw: t,
        base,
        norm,
        isHash,
        isAt,
        cap,
        hasNum
      });
    }
    return out;
  }

  const STOP = new Set([
    "de","la","el","y","a","en","un","una","por","para","con","sin","del","los","las","al",
    "the","and","or","to","in","of","for","on","at","with","from","by","is","are","was","were",
    "que","se","su","sus","como","más","menos","muy","ya","no","sí","si","yo","tu","tú","mi","me",
    "this","that","these","those","it","its","as","an","be","been","being"
  ]);

  function isStop(w){
    const s = String(w || "").toLowerCase();
    return !s || s.length <= 2 || STOP.has(s);
  }

  function extractEntityPhrases(words){
    const phrases = [];
    let buf = [];
    const flush = () => {
      if (buf.length >= 2){
        const label = buf.map(x => x.base).join(" ");
        const key = label.toLowerCase();
        phrases.push({ key, label });
      }
      buf = [];
    };

    for (const w of words){
      if (!w.base || w.isHash || w.isAt) { flush(); continue; }
      if (w.cap && !w.hasNum && w.base.length >= 3){
        buf.push(w);
      }else{
        flush();
      }
    }
    flush();
    return phrases;
  }

  function extractNgrams(words){
    const grams = [];
    const usable = words.filter(w => w.base && !w.isHash && !w.isAt && !isStop(w.norm));
    for (let i=0; i<usable.length; i++){
      const a = usable[i];
      const b = usable[i+1];
      if (!b) continue;

      const label = `${a.base} ${b.base}`;
      const key = label.toLowerCase();
      if (label.length >= 8) grams.push({ key, label });
    }
    return grams;
  }

  function categoryOf(label){
    const s = safeLower(label);

    const sports = ["fútbol","liga","champions","nba","nfl","mlb","ucl","gol","barça","madrid","real madrid","atleti","tenis","formula","f1","ufc"];
    const politics = ["gobierno","presidente","elecciones","congreso","parlamento","trump","biden","putin","zelensky","otan","ue","europa","israel","gaza","ucrania","iran","china","vox","psoe","pp"];
    const news = ["muere","atentado","terremoto","incendio","explosión","accidente","hospital","alerta","última hora","breaking"];
    const viral = ["meme","viral","tiktok","streamer","youtuber","instagram","onlyfans","trend","challenge"];

    if (sports.some(k => s.includes(k))) return "sports";
    if (politics.some(k => s.includes(k))) return "politics";
    if (news.some(k => s.includes(k))) return "news";
    if (viral.some(k => s.includes(k))) return "viral";
    return "all";
  }

  function computeTrends(articles){
    const scores = new Map();
    const meta = new Map();

    const bump = (key, label, amt, a) => {
      if (!key || isStop(key)) return;
      const v = scores.get(key) || 0;
      scores.set(key, v + amt);

      if (!meta.has(key) && a){
        const url = (a?.url) ? String(a.url) : "";
        const title = (a?.title) ? String(a.title) : "";
        const img = (a?.socialimage || a?.image || a?.socialimageurl || "") ? String(a.socialimage || a.image || a.socialimageurl) : "";
        meta.set(key, {
          label: label || key,
          exampleUrl: url,
          sampleTitle: title,
          sampleImage: (img.startsWith("http") ? img : "")
        });
      }
    };

    for (const a of (articles || [])){
      const title = String(a?.title || "");
      if (!title) continue;

      const words = splitWords(title);

      for (const w of words){
        if (w.isHash && w.norm.length >= 3) bump(w.norm, w.raw, 6, a);
        if (w.isAt && w.norm.length >= 3) bump(w.norm, w.raw, 5, a);
      }

      for (const w of words){
        if (!w.base) continue;
        if (w.isHash || w.isAt) continue;
        if (isStop(w.norm)) continue;
        bump(w.norm, w.base, w.cap ? 2.2 : 1.1, a);
      }

      for (const p of extractEntityPhrases(words)) bump(p.key, p.label, 4.5, a);
      for (const p of extractNgrams(words)) bump(p.key, p.label, 2.0, a);
    }

    const items = [];
    for (const [key, score] of scores.entries()){
      const m = meta.get(key) || { label: key, exampleUrl: "", sampleTitle: "", sampleImage:"" };
      const cat = categoryOf(m.label);
      items.push({
        key,
        label: m.label,
        score,
        cat,
        exampleUrl: m.exampleUrl,
        sampleTitle: m.sampleTitle,
        sampleImage: m.sampleImage
      });
    }

    items.sort((a,b) => b.score - a.score);

    const ranked = items.map((it, idx) => {
      const rank = idx + 1;
      const prevRank = state.ranks[it.key];
      const delta = (typeof prevRank === "number") ? (prevRank - rank) : 0;
      return { ...it, rank, delta };
    });

    const nextRanks = Object.create(null);
    for (const it of ranked) nextRanks[it.key] = it.rank;
    state.ranks = nextRanks;

    return ranked;
  }

  function buildXSearchUrl(label){
    let q = String(label || "").trim();
    if (!q) return CFG.profileUrlX;
    if (!q.startsWith("#") && !q.startsWith("@") && /\s/.test(q)) q = `"${q}"`;
    return CFG.xSearchBase + encodeURIComponent(q);
  }

  function yyyymmddhhmmssUTC(d){
    const pad = (n) => String(n).padStart(2,"0");
    return (
      d.getUTCFullYear() +
      pad(d.getUTCMonth()+1) +
      pad(d.getUTCDate()) +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds())
    );
  }

  function buildGdeltQuery(){
    const lang = pickLang();
    const geo = pickGeo();

    let q;
    if (lang === "mixed") q = `(sourcelang:spanish OR sourcelang:english)`;
    else q = `sourcelang:${lang}`;

    if (geo === "GLOBAL" && lang === "spanish"){
      q = `(sourcelang:spanish OR sourcelang:english)`;
    }
    return q;
  }

  function buildGdeltUrl(){
    const hours = pickTimespanHours();
    const end = new Date();
    const start = new Date(Date.now() - hours * 3600_000);

    const params = new URLSearchParams();
    params.set("format", "json");
    params.set("mode", "artlist");
    params.set("sort", "hybridrel");
    params.set("maxrecords", String(clamp(state.settings.maxArticles, 50, 500)));
    params.set("query", buildGdeltQuery());
    params.set("startdatetime", yyyymmddhhmmssUTC(start));
    params.set("enddatetime", yyyymmddhhmmssUTC(end));
    return `${CFG.gdeltBase}?${params.toString()}`;
  }

  async function fetchWithTimeout(url, { timeoutMs, signal } = {}){
    const ac = new AbortController();
    const t = setTimeout(() => { try{ ac.abort(); }catch{} }, clamp(Number(timeoutMs || CFG.FETCH_TIMEOUT_MS), 2000, 45000));
    const anySigAbort = () => { try{ ac.abort(); }catch{} };

    if (signal) {
      if (signal.aborted) anySigAbort();
      else signal.addEventListener("abort", anySigAbort, { once:true });
    }

    try{
      const res = await fetch(url, { signal: ac.signal, cache: "no-store" });
      return res;
    } finally {
      clearTimeout(t);
      if (signal) { try{ signal.removeEventListener("abort", anySigAbort); }catch{} }
    }
  }

  async function fetchJsonSmart(url, signal){
    const tries = [url, ...CFG.proxies.map(p => p + encodeURIComponent(url))];
    let lastErr = null;

    for (const u of tries){
      try{
        const res = await fetchWithTimeout(u, { timeoutMs: CFG.FETCH_TIMEOUT_MS, signal });
        if (!res?.ok) throw new Error(`HTTP ${res?.status || 0}`);
        const txt = await res.text();
        return JSON.parse(txt);
      }catch(e){
        lastErr = e;
      }
    }
    throw lastErr || new Error("fetchJsonSmart failed");
  }

  function applyFilter(){
    const q = safeLower(inpQ?.value || "");

    if (state.view === "memes"){
      let list = Array.isArray(state.memes) ? state.memes.slice() : [];

      if (q) list = list.filter(m => safeLower(m.title).includes(q));

      state.memesFiltered = list;
      renderMemes(state.memesFiltered);
      setEmpty(state.memesFiltered.length === 0);
      setErr("");
      buildTickerFromCurrent();
      return;
    }

    let list = Array.isArray(state.trends) ? state.trends.slice() : [];

    if (q){
      list = list.filter(it => safeLower(it.label).includes(q));
    }

    if (state.view === "favs"){
      list = list.filter(it => state.favs.has(it.key));
    }

    if (state.category && state.category !== "all"){
      list = list.filter(it => it.cat === state.category);
    }

    state.filtered = list;
    renderTrends(state.filtered);
    setEmpty(state.filtered.length === 0);
    setErr("");
    buildTickerFromCurrent();
  }

  function renderTrends(list){
    if (!elList) return;

    elList.innerHTML = "";

    const maxT = clamp(Number(state.settings.maxTrends || 35), 10, 80);
    const slice = (list || []).slice(0, maxT);

    for (const it of slice){
      const row = document.createElement("div");
      row.className = "trend";

      const badgeDelta = (() => {
        if (!it.delta) return "";
        if (it.delta > 0) return `<span class="badge good" title="Sube en ranking">▲ ${it.delta}</span>`;
        return `<span class="badge bad" title="Baja en ranking">▼ ${Math.abs(it.delta)}</span>`;
      })();

      const badgeCat = (it.cat && it.cat !== "all")
        ? `<span class="badge cat">${escapeHtml(it.cat.toUpperCase())}</span>` : "";

      const titleUrl = buildXSearchUrl(it.label);

      const thumb = (!state.settings.noThumbs && it.sampleImage)
        ? `<img class="tThumb" src="${escapeHtml(it.sampleImage)}" alt="">`
        : "";

      const sampleLink = it.exampleUrl
        ? `<a class="tLink" href="${escapeHtml(it.exampleUrl)}" target="_blank" rel="noreferrer">${escapeHtml(it.sampleTitle || it.exampleUrl)}</a>`
        : "";

      row.innerHTML = `
        <div class="tLeft">
          <div class="tRank">${it.rank}</div>
          <div class="tMain">
            <div class="tTop">
              <a class="tTitle" href="${escapeHtml(titleUrl)}" target="_blank" rel="noreferrer">${escapeHtml(it.label)}</a>
              ${badgeDelta}
              ${badgeCat}
            </div>
            <div class="tMeta">Score: ${Math.round(it.score)}</div>
            <div class="tMedia">
              ${thumb}
              ${sampleLink}
            </div>
          </div>
        </div>
        <div class="actions">
          <button class="aBtn star ${state.favs.has(it.key) ? "on" : ""}" type="button" title="Favorito" aria-label="Favorito">★</button>
          <a class="aBtn" href="${escapeHtml(titleUrl)}" target="_blank" rel="noreferrer" title="Buscar en X">X</a>
          ${it.exampleUrl ? `<a class="aBtn" href="${escapeHtml(it.exampleUrl)}" target="_blank" rel="noreferrer" title="Abrir noticia">↗</a>` : ""}
        </div>
      `;

      const star = row.querySelector(".aBtn.star");
      star?.addEventListener("click", () => {
        if (state.favs.has(it.key)) state.favs.delete(it.key);
        else state.favs.add(it.key);
        saveSettings();
        applyFilter();
      });

      elList.appendChild(row);
    }
  }

  function fmtAgo(tsMs){
    const ms = Date.now() - tsMs;
    const m = Math.max(1, Math.floor(ms / 60000));
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  }

  function pickRedditMedia(p){
    const isOver18 = !!p?.over_18;
    if (isOver18) return null;

    const url = String(p?.url_overridden_by_dest || p?.url || "");

    if (p?.is_video && p?.media?.reddit_video?.fallback_url){
      return { type: "video", url: String(p.media.reddit_video.fallback_url) };
    }

    if (p?.secure_media?.reddit_video?.fallback_url){
      return { type: "video", url: String(p.secure_media.reddit_video.fallback_url) };
    }

    if (p?.preview?.images?.[0]?.source?.url){
      return { type: "image", url: decodeHtmlEntities(String(p.preview.images[0].source.url)) };
    }

    if (p?.is_gallery && p?.gallery_data?.items?.length && p?.media_metadata){
      const first = p.gallery_data.items[0];
      const id = first?.media_id;
      const mm = id ? p.media_metadata[id] : null;
      const u = mm?.s?.u || mm?.p?.[mm.p.length-1]?.u;
      if (u) return { type: "image", url: decodeHtmlEntities(String(u)) };
    }

    if (url){
      const low = url.toLowerCase();
      if (low.endsWith(".jpg") || low.endsWith(".jpeg") || low.endsWith(".png") || low.endsWith(".gif") || low.endsWith(".webp")){
        return { type: "image", url };
      }
      if (low.includes("i.redd.it") || low.includes("i.imgur.com")) return { type: "image", url };
    }

    return null;
  }

  function renderMemes(list){
    if (!elList) return;

    elList.innerHTML = "";

    const maxP = clamp(Number(state.settings.memeMaxPosts || 45), 10, 120);
    const slice = (list || []).slice(0, maxP);

    for (const m of slice){
      const card = document.createElement("div");
      card.className = "memeCard";

      const mediaHtml = (() => {
        if (!m.media) return "";
        if (m.media.type === "video"){
          return `<div class="memeMedia"><video controls playsinline preload="metadata" src="${escapeHtml(m.media.url)}"></video></div>`;
        }
        return `<div class="memeMedia"><img loading="lazy" decoding="async" src="${escapeHtml(m.media.url)}" alt=""></div>`;
      })();

      card.innerHTML = `
        <div class="memeHead">
          <div class="memeMeta">
            <div class="memeSub">r/${escapeHtml(m.subreddit)}</div>
            <div class="memeBy">u/${escapeHtml(m.author)} · ${escapeHtml(fmtAgo(m.createdMs))}</div>
          </div>
          <span class="tagPill">🔥 ${escapeHtml(String(m.score || 0))}</span>
        </div>
        <div class="memeTitle">${escapeHtml(m.title)}</div>
        ${mediaHtml}
        <div class="memeFoot">
          <div class="memeStats">
            <span class="tagPill">💬 ${escapeHtml(String(m.comments || 0))}</span>
            <span class="tagPill">🕒 ${escapeHtml(new Date(m.createdMs).toLocaleString())}</span>
          </div>
          <div class="memeBtns">
            <a class="aBtn" href="${escapeHtml(m.permalink)}" target="_blank" rel="noreferrer">Abrir</a>
          </div>
        </div>
      `;

      elList.appendChild(card);
    }
  }

  function buildTickerFromCurrent(){
    if (!tickerTrack) return;

    const items = [];
    if (state.view === "memes"){
      for (const m of (state.memesFiltered || []).slice(0, 18)){
        items.push({ label: m.title, url: m.permalink });
      }
    }else{
      for (const it of (state.filtered || []).slice(0, 18)){
        items.push({ label: it.label, url: buildXSearchUrl(it.label) });
      }
    }

    if (!items.length){
      tickerTrack.innerHTML = "";
      return;
    }

    const doubled = items.concat(items);
    tickerTrack.innerHTML = doubled.map(x => `
      <a class="tickerItem" href="${escapeHtml(x.url)}" target="_blank" rel="noreferrer">
        <span class="tickerDot"></span>${escapeHtml(x.label)}
      </a>
    `).join("");
  }

  async function refreshTrends(){
    setErr("");
    setEmpty(false);

    try{
      state.aborter?.abort?.();
    }catch{}
    state.aborter = new AbortController();

    try{
      const url = buildGdeltUrl();
      const data = await fetchJsonSmart(url, state.aborter.signal);
      const articles = (data && Array.isArray(data.articles)) ? data.articles : [];

      state.trends = computeTrends(articles);
      saveSettings();

      if (elLast) elLast.textContent = nowISO();
      applyFilter();
    }catch{
      setErr("No se pudo cargar tendencias. Prueba otra ventana (6H/12H) o desactiva privacidad estricta/adblock.");
      if (elLast) elLast.textContent = nowISO();
    }
  }

  async function refreshMemes(){
    setErr("");
    setEmpty(false);

    try{
      state.aborter?.abort?.();
    }catch{}
    state.aborter = new AbortController();

    try{
      const source = pickMemeSource();
      const sort = pickMemeSort();
      const rangeHrs = pickMemeRangeHrs();
      const subs = CFG.redditSubs[source] || CFG.redditSubs.mix;

      const cutoff = Date.now() - rangeHrs * 3600_000;

      const all = [];
      for (const sub of subs){
        const path = (sort === "hot") ? "hot" : (sort === "top" ? "top" : "new");
        const params = new URLSearchParams();
        params.set("limit", "80");
        params.set("raw_json", "1");
        if (sort === "top") params.set("t", rangeHrs <= 24 ? "day" : "week");

        const url = `${CFG.redditBase}/r/${sub}/${path}.json?${params.toString()}`;
        const json = await fetchJsonSmart(url, state.aborter.signal);
        const children = json?.data?.children || [];

        for (const ch of children){
          const p = ch?.data;
          if (!p) continue;
          if (p.over_18) continue;

          const createdMs = Math.floor(Number(p.created_utc || 0) * 1000);
          if (!createdMs || createdMs < cutoff) continue;

          const media = pickRedditMedia(p);
          if (!media) continue;

          all.push({
            id: String(p.id || ""),
            title: String(p.title || ""),
            subreddit: String(p.subreddit || sub),
            author: String(p.author || ""),
            score: Number(p.score || 0),
            comments: Number(p.num_comments || 0),
            createdMs,
            permalink: `${CFG.redditBase}${String(p.permalink || "")}`,
            media
          });
        }
      }

      const map = new Map();
      for (const m of all){
        if (!m.id) continue;
        if (!map.has(m.id)) map.set(m.id, m);
      }

      const merged = [...map.values()];
      merged.sort((a,b) => b.createdMs - a.createdMs);

      state.memes = merged;
      if (elLast) elLast.textContent = nowISO();

      applyFilter();
    }catch{
      setErr("No se pudo cargar memes (CORS/proxy). Prueba otra fuente o recarga.");
      if (elLast) elLast.textContent = nowISO();
    }
  }

  function schedule(){
    try { if (state.refreshTimer) clearTimeout(state.refreshTimer); } catch {}
    if (!state.settings.autoRefresh) return;

    const ms = clamp(Number(state.settings.refreshEveryMs || 120000), CFG.MIN_REFRESH_MS, 900000);
    state.refreshTimer = setTimeout(async () => {
      await refreshCurrent();
      schedule();
    }, ms);
  }

  async function refreshCurrent(){
    if (state.view === "memes") return refreshMemes();
    return refreshTrends();
  }

  async function swSkipWaiting(reg){
    try{
      if (!reg?.waiting) return;
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }catch{}
  }

  async function initAutoUpdateSW(){
    if (!("serviceWorker" in navigator)) return;

    try{
      const reg = await navigator.serviceWorker.register(CFG.SW_URL, { updateViaCache: "none" });
      state.swReg = reg;

      const reloadOnce = async () => {
        try{
          if (sessionStorage.getItem(CFG.SS_SW_RELOADED) === "1") return;
          sessionStorage.setItem(CFG.SS_SW_RELOADED, "1");
          location.reload();
        }catch{}
      };

      navigator.serviceWorker.addEventListener("controllerchange", () => { reloadOnce(); });

      const tick = async () => {
        try{
          await reg.update();
          if (reg.waiting) await swSkipWaiting(reg);
        }catch{}
      };

      try { if (state.swTick) clearInterval(state.swTick); } catch {}
      state.swTick = setInterval(tick, CFG.SW_UPDATE_EVERY_MS);

      on(document, "visibilitychange", () => {
        if (document.visibilityState === "visible") tick();
      }, { passive:true });

      tick();
    }catch{}
  }

  function bindUI(){
    on(btnRefresh, "click", async () => { await refreshCurrent(); schedule(); });
    on(btnCompact, "click", () => { toggleCompact(); });

    on(inpQ, "input", () => applyFilter());

    on(selLang, "change", async () => { state.settings.lang = pickLang(); saveSettings(); if (state.view !== "memes") await refreshTrends(); schedule(); });
    on(selWindow, "change", async () => { state.settings.window = pickTimespanUi(); saveSettings(); if (state.view !== "memes") await refreshTrends(); schedule(); });
    on(selGeo, "change", async () => { state.settings.geo = pickGeo(); saveSettings(); if (state.view !== "memes") await refreshTrends(); schedule(); });

    on(selMemeSource, "change", async () => { state.settings.memeSource = pickMemeSource(); saveSettings(); if (state.view === "memes") await refreshMemes(); schedule(); });
    on(selMemeSort, "change", async () => { state.settings.memeSort = pickMemeSort(); saveSettings(); if (state.view === "memes") await refreshMemes(); schedule(); });
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

      if (next !== "memes"){
        if (tabsCat) show(tabsCat);
      }

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
      await refreshCurrent();
      schedule();
    });

    on(window, "online", () => setNet(true));
    on(window, "offline", () => setNet(false));
  }

  (async function init(){
    applyPngLogoIfAvailable();

    loadSettings();
    applySettingsToUI();

    setNet(navigator.onLine);

    setViewMode(state.view);
    setActiveTab(tabsView, "data-view", state.view);
    setActiveTab(tabsCat, "data-cat", state.category);

    bindUI();

    mountTimeline();
    initAutoUpdateSW();

    buildTickerFromCurrent();

    await refreshCurrent();
    schedule();

    if (state.view === "memes") toast("MEMES", "Cargando memes de las últimas 48h…");
  })();
})();
