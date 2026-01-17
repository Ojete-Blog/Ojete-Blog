(() => {
  "use strict";

  /* ==========================================================
     GlobalEye Trends — Final (Memes + Trends + X Timeline)
     FIXES IMPORTANTES:
     - Evita crasheos por errores de merge/render.
     - Reddit: usa endpoint CORS-friendly (api.reddit.com) + fallback.
     - SOLO memes con IMAGEN o VIDEO (filtrado fuerte).
     - VOTACIÓN local (up/down) + orden "Best (tus votos)".
     - Tendencias: cache-bust + pipeline robusto de scoring.
     - Timeline X: carga robusta + recarga + fallback.
     - UI: Material Symbols, toasts, ticker OBS.
     ========================================================== */

  const APP_TAG = "globaleye-trends:final-2.0.0";

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

    // Fetch base (CORS OK) + base para abrir links
    redditApiBase: "https://api.reddit.com",
    redditWebBase: "https://www.reddit.com",
    redditSubs: {
      mix: ["memes", "dankmemes", "me_irl", "wholesomememes", "funny"],
      memes: ["memes"],
      dankmemes: ["dankmemes"],
      meirl: ["me_irl"],
      wholesome: ["wholesomememes"],
      funny: ["funny"]
    },

    // Proxies opcionales (último recurso)
    proxies: [
      "https://api.allorigins.win/raw?url=",
      "https://api.codetabs.com/v1/proxy?quest="
    ],

    logoPng: "./logo_ojo_png.png",
    toastGif: "./logo_ojo_gif.gif",

    LS_SETTINGS: "ge_trends_settings_final_2",
    LS_FAVS: "ge_trends_favs_final_2",
    LS_RANKS: "ge_trends_ranks_final_2",
    LS_COMPACT: "ge_trends_compact_final_2",
    LS_VOTES: "ge_trends_votes_final_2",

    FETCH_TIMEOUT_MS: 14000,
    MIN_REFRESH_MS: 35000,

    SW_URL: "./sw.js",
    SW_UPDATE_EVERY_MS: 8 * 60_000,
    SS_SW_RELOADED: "ge_sw_reloaded_once_final_2"
  };

  const $ = (id) => document.getElementById(id);

  // Core UI
  const elList = $("list");
  const elEmpty = $("empty");
  const elErr = $("err");
  const elLast = $("lastUpdated");
  const elNet = $("netStatus");

  const btnRefresh = $("btnRefresh");
  const btnCompact = $("btnCompact");
  const btnTicker = $("btnTicker");
  const btnConfig = $("btnConfig");

  const tickerBar = $("tickerBar");
  const tickerTrack = $("tickerTrack");
  const tickerClose = $("tickerClose");

  const btnReloadX = $("btnReloadX");
  const timelineMount = $("timelineMount");

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

  const toastHost = $("toastHost");

  /* ==========================
     Helpers
     ========================== */
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const safeLower = (s) => String(s ?? "").toLowerCase();
  const nowISO = () => new Date().toLocaleString();
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
  const decodeHtml = (s) => String(s ?? "").replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/&quot;/g,'"');

  function setText(el, t){ if (el) el.textContent = String(t ?? ""); }

  function showErr(msg){
    if (!elErr) return;
    elErr.classList.remove("hidden");
    elErr.textContent = msg || "Error desconocido";
  }
  function hideErr(){ elErr?.classList.add("hidden"); elErr && (elErr.textContent=""); }

  function showEmpty(on){
    if (!elEmpty) return;
    elEmpty.classList.toggle("hidden", !on);
  }

  function toast(title, msg, imgUrl){
    if (!toastHost) return;
    const div = document.createElement("div");
    div.className = "toast";
    div.innerHTML = `
      <img class="toastImg" src="${esc(imgUrl || CFG.toastGif)}" alt="">
      <div class="toastRow">
        <div class="toastTitle">${esc(title || "Aviso")}</div>
        <div class="toastMsg">${esc(msg || "")}</div>
      </div>
      <button class="toastX" type="button" aria-label="Cerrar">✕</button>
    `;
    const btn = div.querySelector(".toastX");
    btn?.addEventListener("click", () => div.remove(), { once:true });
    toastHost.appendChild(div);
    setTimeout(() => { try { div.remove(); } catch {} }, 5200);
  }

  /* ==========================
     State + Storage
     ========================== */
  const state = {
    settings: null,
    view: "memes",     // memes | all | favs
    category: "all",   // all | news | viral | politics | sports (para tendencias)

    trends: [],
    filtered: [],
    favs: new Set(),
    ranks: Object.create(null),

    memes: [],
    memesFiltered: [],

    votes: Object.create(null), // id -> -1/0/1
    compact: false,

    aborter: null,
    refreshTimer: null,

    swReg: null,
    swTick: null,

    _cleanups: []
  };

  function loadJson(key, fallback){
    try{
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    }catch{
      return fallback;
    }
  }
  function saveJson(key, val){
    try{ localStorage.setItem(key, JSON.stringify(val)); }catch{}
  }

  function loadSettings(){
    const s = loadJson(CFG.LS_SETTINGS, null) || {};
    state.settings = {
      view: s.view || "memes",
      category: s.category || "all",
      lang: s.lang || "spanish",
      window: s.window || "4H",
      geo: s.geo || "ES",
      auto: (typeof s.auto === "boolean") ? s.auto : true,
      everySec: clamp(Number(s.everySec || 120), 35, 900),
      maxTrends: clamp(Number(s.maxTrends || 35), 10, 80),
      ticker: !!s.ticker,
      tickerSpeed: clamp(Number(s.tickerSpeed || 28), 12, 120),
      memeSource: s.memeSource || "mix",
      memeSort: s.memeSort || "new",     // new|hot|top|best
      memeRangeH: clamp(Number(s.memeRangeH || 48), 24, 72),
      memeMaxPosts: clamp(Number(s.memeMaxPosts || 45), 10, 120),
      noThumbs: !!s.noThumbs,
      alerts: (typeof s.alerts === "boolean") ? s.alerts : true
    };

    state.view = state.settings.view;
    state.category = state.settings.category;

    state.favs = new Set(loadJson(CFG.LS_FAVS, []));
    state.ranks = loadJson(CFG.LS_RANKS, Object.create(null)) || Object.create(null);
    state.compact = !!loadJson(CFG.LS_COMPACT, false);
    state.votes = loadJson(CFG.LS_VOTES, Object.create(null)) || Object.create(null);

    document.body.classList.toggle("compact", state.compact);

    // Sync UI
    if (selLang) selLang.value = state.settings.lang;
    if (selWindow) selWindow.value = state.settings.window;
    if (selGeo) selGeo.value = state.settings.geo;

    if (selMemeSource) selMemeSource.value = state.settings.memeSource;
    if (selMemeSort) selMemeSort.value = state.settings.memeSort;
    if (selMemeRange) selMemeRange.value = String(state.settings.memeRangeH);

    if (cfgAuto) cfgAuto.checked = state.settings.auto;
    if (cfgEvery) cfgEvery.value = String(state.settings.everySec);
    if (cfgMaxTrends) cfgMaxTrends.value = String(state.settings.maxTrends);
    if (cfgAlerts) cfgAlerts.checked = state.settings.alerts;
    if (cfgTicker) cfgTicker.checked = state.settings.ticker;
    if (cfgTickerSpeed) cfgTickerSpeed.value = String(state.settings.tickerSpeed);
    if (cfgMemeMaxPosts) cfgMemeMaxPosts.value = String(state.settings.memeMaxPosts);
    if (cfgNoThumbs) cfgNoThumbs.checked = state.settings.noThumbs;

    setViewMode(state.view, true);
    setCategory(state.category, true);
    setTickerVisible(state.settings.ticker);
    updateTickerSpeed();
  }

  function saveSettings(){
    const s = state.settings || {};
    s.view = state.view;
    s.category = state.category;
    saveJson(CFG.LS_SETTINGS, s);
  }

  function saveFavs(){ saveJson(CFG.LS_FAVS, Array.from(state.favs)); }
  function saveRanks(){ saveJson(CFG.LS_RANKS, state.ranks); }
  function saveCompact(){ saveJson(CFG.LS_COMPACT, state.compact); }
  function saveVotes(){ saveJson(CFG.LS_VOTES, state.votes); }

  function favKeyTrend(label){ return `t:${safeLower(label)}`; }
  function favKeyMeme(id){ return `m:${id}`; }

  function isFav(key){ return state.favs.has(key); }
  function toggleFav(key){
    if (state.favs.has(key)) state.favs.delete(key);
    else state.favs.add(key);
    saveFavs();
  }

  function getVote(id){
    const v = Number(state.votes?.[id] ?? 0);
    return (v === 1 || v === -1) ? v : 0;
  }
  function setVote(id, v){
    state.votes[id] = v;
    saveVotes();
  }

  /* ==========================
     UI Actions
     ========================== */
  function setTickerVisible(on){
    if (!tickerBar) return;
    tickerBar.classList.toggle("hidden", !on);
    state.settings.ticker = !!on;
    if (cfgTicker) cfgTicker.checked = !!on;
    saveSettings();
  }

  function updateTickerSpeed(){
    const sec = clamp(Number(state.settings.tickerSpeed || 28), 12, 120);
    state.settings.tickerSpeed = sec;
    if (tickerTrack) tickerTrack.style.setProperty("--tickerDur", `${sec}s`);
  }

  function setViewMode(v, silent){
    state.view = v;
    state.settings.view = v;
    saveSettings();

    const isMemes = (v === "memes");
    const isTrends = (v === "all");
    const isFavs = (v === "favs");

    if (trendFilters) trendFilters.classList.toggle("hidden", !isTrends);
    if (memeFilters) memeFilters.classList.toggle("hidden", !isMemes);

    if (tabsCat) tabsCat.classList.toggle("hidden", !isTrends);

    if (inpQ) inpQ.placeholder = isMemes ? "Buscar memes…" : (isTrends ? "Buscar tendencias…" : "Buscar favoritos…");

    if (!silent) applyFiltersAndRender();
  }

  function setCategory(cat, silent){
    state.category = cat;
    state.settings.category = cat;
    saveSettings();
    if (!silent) applyFiltersAndRender();
  }

  function setTabsActive(container, dataAttr, val){
    if (!container) return;
    const btns = container.querySelectorAll("button");
    btns.forEach(b => {
      const v = b.getAttribute(dataAttr);
      const on = (v === val);
      b.classList.toggle("isActive", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function bindUI(){
    // Header buttons
    btnRefresh?.addEventListener("click", () => refreshNow(), { passive:true });

    btnCompact?.addEventListener("click", () => {
      state.compact = !state.compact;
      document.body.classList.toggle("compact", state.compact);
      saveCompact();
    }, { passive:true });

    btnTicker?.addEventListener("click", () => setTickerVisible(tickerBar?.classList.contains("hidden")), { passive:true });
    tickerClose?.addEventListener("click", () => setTickerVisible(false), { passive:true });

    btnConfig?.addEventListener("click", () => openConfig(true), { passive:true });
    cfgClose?.addEventListener("click", () => openConfig(false), { passive:true });

    cfgSave?.addEventListener("click", () => {
      // Leer config
      state.settings.auto = !!cfgAuto?.checked;
      state.settings.everySec = clamp(Number(cfgEvery?.value || 120), 35, 900);
      state.settings.maxTrends = clamp(Number(cfgMaxTrends?.value || 35), 10, 80);
      state.settings.alerts = !!cfgAlerts?.checked;
      state.settings.ticker = !!cfgTicker?.checked;
      state.settings.tickerSpeed = clamp(Number(cfgTickerSpeed?.value || 28), 12, 120);
      state.settings.memeMaxPosts = clamp(Number(cfgMemeMaxPosts?.value || 45), 10, 120);
      state.settings.noThumbs = !!cfgNoThumbs?.checked;

      updateTickerSpeed();
      setTickerVisible(state.settings.ticker);

      saveSettings();
      openConfig(false);
      setupAutoRefresh();
      applyFiltersAndRender();
      toast("Config", "Configuración guardada.");
    }, { passive:true });

    // Tabs view
    tabsView?.addEventListener("click", (e) => {
      const b = e.target?.closest("button.tab");
      if (!b) return;
      const v = b.getAttribute("data-view");
      if (!v) return;
      setTabsActive(tabsView, "data-view", v);
      setViewMode(v, false);
    });

    // Tabs category
    tabsCat?.addEventListener("click", (e) => {
      const b = e.target?.closest("button.tab");
      if (!b) return;
      const c = b.getAttribute("data-cat");
      if (!c) return;
      setTabsActive(tabsCat, "data-cat", c);
      setCategory(c, false);
    });

    // Filters
    inpQ?.addEventListener("input", () => applyFiltersAndRender(), { passive:true });

    selLang?.addEventListener("change", () => { state.settings.lang = selLang.value; saveSettings(); refreshNow(true); }, { passive:true });
    selWindow?.addEventListener("change", () => { state.settings.window = selWindow.value; saveSettings(); refreshNow(true); }, { passive:true });
    selGeo?.addEventListener("change", () => { state.settings.geo = selGeo.value; saveSettings(); refreshNow(true); }, { passive:true });

    selMemeSource?.addEventListener("change", () => { state.settings.memeSource = selMemeSource.value; saveSettings(); refreshNow(false); }, { passive:true });
    selMemeSort?.addEventListener("change", () => { state.settings.memeSort = selMemeSort.value; saveSettings(); refreshNow(false); }, { passive:true });
    selMemeRange?.addEventListener("change", () => { state.settings.memeRangeH = clamp(Number(selMemeRange.value), 24, 72); saveSettings(); refreshNow(false); }, { passive:true });

    // Timeline reload
    btnReloadX?.addEventListener("click", () => mountTimeline(true), { passive:true });

    // Close modal by click outside
    cfgModal?.addEventListener("click", (e) => {
      if (e.target === cfgModal) openConfig(false);
    });

    // Online/offline
    window.addEventListener("online", () => setText(elNet, "OK"), { passive:true });
    window.addEventListener("offline", () => setText(elNet, "OFF"), { passive:true });
  }

  function openConfig(on){
    if (!cfgModal) return;
    cfgModal.classList.toggle("hidden", !on);
  }

  /* ==========================
     Networking
     ========================== */
  function makeAbort(){
    try{ state.aborter?.abort(); }catch{}
    state.aborter = new AbortController();
    return state.aborter;
  }

  async function fetchJson(url, { signal } = {}){
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), CFG.FETCH_TIMEOUT_MS);

    const merged = new AbortController();
    const onAbort = () => merged.abort();
    signal?.addEventListener("abort", onAbort, { once:true });
    ctrl.signal.addEventListener("abort", onAbort, { once:true });

    try{
      const res = await fetch(url, { signal: merged.signal, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async function fetchJsonWithFallback(urls, signal){
    let lastErr = null;
    for (const u of urls){
      try{
        return await fetchJson(u, { signal });
      }catch(e){
        lastErr = e;
      }
    }
    throw lastErr || new Error("Fetch failed");
  }

  /* ==========================
     X timeline (robusto)
     ========================== */
  function ensureWidgetsScript(){
    try{
      if (window.twttr?.widgets) return Promise.resolve(true);

      const existing = document.querySelector(`script[src="${CFG.twWidgets}"]`);
      if (existing) {
        return new Promise((resolve) => {
          const done = () => resolve(true);
          existing.addEventListener("load", done, { once:true });
          setTimeout(done, 1800);
        });
      }

      return new Promise((resolve) => {
        const s = document.createElement("script");
        s.async = true;
        s.src = CFG.twWidgets;
        s.charset = "utf-8";
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
        setTimeout(() => resolve(!!window.twttr?.widgets), 2400);
      });
    }catch{
      return Promise.resolve(false);
    }
  }

  async function mountTimeline(force){
    if (!timelineMount) return;

    if (force) timelineMount.innerHTML = "";
    else if (timelineMount.querySelector("iframe")) return;

    timelineMount.innerHTML = "";

    const ok = await ensureWidgetsScript();

    // Prefer createTimeline si existe (más robusto)
    try{
      if (ok && window.twttr?.widgets?.createTimeline){
        const wrap = document.createElement("div");
        timelineMount.appendChild(wrap);

        await window.twttr.widgets.createTimeline(
          { sourceType:"profile", screenName: CFG.profile },
          wrap,
          { theme:"dark", dnt:true, chrome:"noheader nofooter", height: 720 }
        );
        return;
      }
    }catch{
      // fallback abajo
    }

    // Fallback clásico: anchor + widgets.load
    const a = document.createElement("a");
    a.className = "twitter-timeline";
    a.href = CFG.profileUrlTW;
    a.setAttribute("data-theme", "dark");
    a.setAttribute("data-dnt", "true");
    a.setAttribute("data-chrome", "noheader nofooter");
    a.setAttribute("data-height", "720");
    a.textContent = `Tweets by @${CFG.profile}`;
    timelineMount.appendChild(a);

    try{
      window.twttr?.widgets?.load?.(timelineMount);
    }catch{}

    // Fallback visual si no aparece iframe
    setTimeout(() => {
      const hasIframe = !!timelineMount.querySelector("iframe");
      if (hasIframe) return;

      if (timelineMount.querySelector(".timelineFallback")) return;

      const div = document.createElement("div");
      div.className = "timelineFallback";
      div.innerHTML = `
        <div class="tlTitle">El feed no cargó</div>
        <div class="tlText">Algunos navegadores/adblock bloquean el widget. Puedes abrir el perfil directamente:</div>
        <a class="tlBtn" href="${CFG.profileUrlX}" target="_blank" rel="noreferrer">Abrir @${CFG.profile}</a>
      `;
      timelineMount.appendChild(div);
    }, 9000);
  }

  /* ==========================
     GDELT trends
     ========================== */
  function timespanFromWindow(win){
    const w = safeLower(win || "4H");
    if (w === "2h") return "2h";
    if (w === "6h") return "6h";
    if (w === "12h") return "12h";
    return "4h";
  }

  function buildGdeltQuery(){
    const lang = state.settings.lang;
    const geo = state.settings.geo;

    const parts = [];

    if (geo === "ES") parts.push("sourcecountry:sp"); // FIPS Spain = SP
    if (lang === "spanish") parts.push("sourcelang:spanish");
    else if (lang === "english") parts.push("sourcelang:english");
    else {
      // mixed => sin filtro de idioma
      // OJO: query no puede quedar vacío
    }

    if (!parts.length) parts.push("a");
    return parts.join(" ");
  }

  async function fetchGdeltArticles(signal){
    const q = buildGdeltQuery();
    const span = timespanFromWindow(state.settings.window);
    const url =
      `${CFG.gdeltBase}?format=json&mode=ArtList&sort=HybridRel&maxrecords=250` +
      `&timespan=${encodeURIComponent(span)}` +
      `&query=${encodeURIComponent(q)}` +
      `&__ge=${Date.now()}`;

    const data = await fetchJson(url, { signal });
    const arts = Array.isArray(data?.articles) ? data.articles : [];
    return arts;
  }

  const STOP_ES = new Set([
    "de","la","el","y","en","a","los","las","un","una","unos","unas","por","para","con","sin",
    "del","al","se","su","sus","es","son","fue","ser","han","hoy","ayer","mañana","más","menos",
    "que","como","qué","cuando","donde","desde","hasta","sobre","tras","ante","entre","contra",
    "ya","no","sí","pero","también","muy","esto","esta","estos","estas","este","esa","ese","esas","esos"
  ]);
  const STOP_EN = new Set([
    "the","a","an","and","or","in","on","at","to","for","from","with","without","of","by",
    "is","are","was","were","be","been","being","as","it","its","this","that","these","those",
    "today","yesterday","tomorrow","more","less","not","but","also","very"
  ]);

  function normToken(w){
    return safeLower(w)
      .replace(/[“”"’'`]/g,"")
      .replace(/[^\p{L}\p{N}_#@-]+/gu,"")
      .trim();
  }

  function extractCandidates(title){
    const raw = String(title || "");
    const tags = raw.match(/[@#][\w_]{2,}/g) || [];

    // tokens
    const words = raw
      .replace(/[(){}\[\]<>]/g," ")
      .replace(/[.,;:!?/\\|]/g," ")
      .split(/\s+/g)
      .map(normToken)
      .filter(Boolean);

    const toks = [];
    for (const w of words){
      if (w.startsWith("#") || w.startsWith("@")) continue;
      if (w.length < 3) continue;
      if (STOP_ES.has(w) || STOP_EN.has(w)) continue;
      toks.push(w);
    }

    // ngrams (2-3)
    const grams = [];
    for (let i=0;i<toks.length;i++){
      const a=toks[i], b=toks[i+1], c=toks[i+2];
      if (a && b) grams.push(`${a} ${b}`);
      if (a && b && c) grams.push(`${a} ${b} ${c}`);
    }

    // “entidades” simples: palabras capitalizadas en el título original
    const ents = [];
    const cap = raw.match(/\b[A-ZÁÉÍÓÚÜÑ][\p{L}\p{N}_-]{2,}(?:\s+[A-ZÁÉÍÓÚÜÑ][\p{L}\p{N}_-]{2,}){0,3}\b/gu) || [];
    for (const e of cap){
      const ne = e.trim();
      if (ne.length >= 4) ents.push(ne);
    }

    return { tags, grams, ents };
  }

  function classifyTrend(label){
    const t = safeLower(label);
    if (/(elecci|gobiern|congreso|parlament|president|trump|putin|biden|israel|gaza|ucrania|rusia|otan|ue|europa)/.test(t)) return "politics";
    if (/(liga|nba|nfl|fútbol|futbol|champions|barça|madrid|tenis|ufc|mundial|gol|deporte)/.test(t)) return "sports";
    if (/(meme|viral|tiktok|youtube|stream|trend|polémic|drama|influencer|celebr)/.test(t)) return "viral";
    return "news";
  }

  function computeTrends(articles){
    const map = new Map();

    const domainSeen = new Map(); // label -> Set(domains)
    const now = Date.now();

    for (const a of articles){
      const title = a?.title;
      if (!title) continue;

      const url = a?.url || "";
      let dom = "";
      try{ dom = (new URL(url)).hostname.replace(/^www\./,""); }catch{}

      const img = a?.socialimage || "";
      const ts = a?.seendate ? Date.parse(a.seendate) : NaN;
      const ageH = Number.isFinite(ts) ? Math.max(0, (now - ts) / 36e5) : 6;

      const { tags, grams, ents } = extractCandidates(title);

      const add = (label, w) => {
        const key = safeLower(label);
        if (!key || key.length < 3) return;

        const cur = map.get(key) || {
          key,
          label,
          score: 0,
          hits: 0,
          sampleUrl: url,
          sampleImage: img,
          cat: "news",
          ageHint: ageH
        };

        cur.hits += 1;
        cur.score += w;
        cur.ageHint = Math.min(cur.ageHint, ageH);
        if (!cur.sampleUrl && url) cur.sampleUrl = url;
        if (!cur.sampleImage && img) cur.sampleImage = img;

        cur.cat = classifyTrend(cur.label);

        map.set(key, cur);

        if (dom){
          let s = domainSeen.get(key);
          if (!s){ s = new Set(); domainSeen.set(key, s); }
          s.add(dom);
        }
      };

      // peso por frescura (más reciente, más peso)
      const freshness = clamp(1.0 + (6 - Math.min(6, ageH)) * 0.12, 0.9, 1.7);

      for (const t of tags) add(t, 8.0 * freshness);
      for (const g of grams) add(g, 2.3 * freshness);
      for (const e of ents) add(e, 3.1 * freshness);
    }

    // Post-procesado: boost por diversidad de dominios
    const items = Array.from(map.values()).map(it => {
      const doms = domainSeen.get(it.key);
      const diversity = doms ? clamp(doms.size, 1, 9) : 1;
      it.score = it.score * (1 + (diversity - 1) * 0.10);
      return it;
    });

    // ordenar + rank + delta
    items.sort((a,b) => (b.score - a.score));
    const maxN = state.settings.maxTrends || 35;

    const out = [];
    for (let i=0;i<items.length && out.length<maxN;i++){
      const it = items[i];

      // limpiar ruido (muy corto / muy genérico)
      const lk = safeLower(it.label);
      if (lk.length < 4) continue;
      if (STOP_ES.has(lk) || STOP_EN.has(lk)) continue;

      const rank = out.length + 1;
      const prevRank = Number(state.ranks?.[it.key] ?? 0);
      const delta = prevRank ? (prevRank - rank) : 0;

      out.push({
        ...it,
        rank,
        delta,
        score: Math.round(it.score * 10) / 10
      });
    }

    // guardar ranks para próxima delta
    const newRanks = Object.create(null);
    out.forEach(t => { newRanks[t.key] = t.rank; });
    state.ranks = newRanks;
    saveRanks();

    return out;
  }

  /* ==========================
     Reddit memes (solo media)
     ========================== */
  function pickSubs(){
    const src = state.settings.memeSource || "mix";
    return CFG.redditSubs[src] || CFG.redditSubs.mix;
  }

  function buildRedditUrl(sub, sort, limit){
    const l = clamp(Number(limit || 45), 10, 120);
    const s = sort || "new";
    const t = (s === "top") ? "&t=day" : "";
    return `${CFG.redditApiBase}/r/${encodeURIComponent(sub)}/${encodeURIComponent(s)}.json?raw_json=1&limit=${l}${t}&__ge=${Date.now()}`;
  }

  function coalesceMediaPost(p){
    // si es crosspost, a veces el media está en el parent_list
    if (p?.crosspost_parent_list?.length) {
      const cp = p.crosspost_parent_list[0];
      if (cp) return cp;
    }
    return p;
  }

  function pickRedditMedia(p){
    if (!p) return null;
    const pp = coalesceMediaPost(p);

    // Video reddit
    if (pp.is_video && pp.media?.reddit_video?.fallback_url) {
      const vurl = decodeHtml(pp.media.reddit_video.fallback_url);
      const poster = decodeHtml(pp.preview?.images?.[0]?.source?.url || "");
      return { kind:"video", url:vurl, poster };
    }

    // Gallery
    if (pp.is_gallery && pp.media_metadata){
      const keys = Object.keys(pp.media_metadata);
      if (keys.length){
        const m = pp.media_metadata[keys[0]];
        const s = m?.s?.u ? decodeHtml(m.s.u) : "";
        if (s) return { kind:"img", url:s };
      }
    }

    // Preview image
    const prev = pp.preview?.images?.[0];
    if (prev?.resolutions?.length){
      const best = prev.resolutions[prev.resolutions.length - 1];
      const url = decodeHtml(best?.url || prev?.source?.url || "");
      if (url) return { kind:"img", url };
    }

    // Direct url to image/gif
    const u = decodeHtml(pp.url_overridden_by_dest || pp.url || "");
    if (u){
      const low = safeLower(u);
      const isImg = /\.(png|jpg|jpeg|webp|gif)(\?|$)/.test(low);
      const isMp4 = /\.(mp4)(\?|$)/.test(low);

      if (low.endsWith(".gifv")) return { kind:"video", url: u.replace(/\.gifv(\?.*)?$/i, ".mp4$1") };
      if (isMp4) return { kind:"video", url: u };
      if (isImg) return { kind:"img", url: u };
    }

    return null;
  }

  function toMemeItem(child){
    const d = child?.data;
    if (!d) return null;
    if (d.stickied) return null;

    const createdMs = Number(d.created_utc || 0) * 1000;
    if (!createdMs) return null;

    const rangeH = Number(state.settings.memeRangeH || 48);
    const maxAgeMs = clamp(rangeH, 24, 72) * 3600_000;
    if ((Date.now() - createdMs) > maxAgeMs) return null;

    const media = pickRedditMedia(d);
    if (!media) return null;

    const permalink = d.permalink ? (CFG.redditWebBase + d.permalink) : "";

    return {
      id: d.id,
      title: d.title || "",
      subreddit: d.subreddit || "",
      author: d.author || "",
      score: Number(d.score || 0),
      comments: Number(d.num_comments || 0),
      createdMs,
      url: permalink,
      media
    };
  }

  async function fetchMemes(signal){
    const subs = pickSubs();
    const sort = state.settings.memeSort === "best" ? "new" : (state.settings.memeSort || "new");
    const limit = state.settings.memeMaxPosts || 45;

    const out = [];
    const seen = new Set();

    // Concurrencia baja para no colapsar
    for (const sub of subs){
      const u1 = buildRedditUrl(sub, sort, limit);

      const urls = [u1];
      // último recurso: proxy al endpoint web
      const webUrl = `${CFG.redditWebBase}/r/${encodeURIComponent(sub)}/${encodeURIComponent(sort)}.json?raw_json=1&limit=${clamp(limit,10,120)}&__ge=${Date.now()}`;
      for (const p of CFG.proxies) urls.push(p + encodeURIComponent(webUrl));

      let json = null;
      try{
        json = await fetchJsonWithFallback(urls, signal);
      }catch{
        continue;
      }

      const children = json?.data?.children || [];
      for (const ch of children){
        const m = toMemeItem(ch);
        if (!m) continue;
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        out.push(m);
      }
    }

    return out;
  }

  /* ==========================
     Render
     ========================== */
  function fmtAgo(ms){
    const diff = Math.max(0, Date.now() - ms);
    const min = Math.round(diff/60000);
    if (min < 60) return `${min}m`;
    const h = Math.round(min/60);
    if (h < 48) return `${h}h`;
    const d = Math.round(h/24);
    return `${d}d`;
  }

  function buildTrendCard(t){
    const key = favKeyTrend(t.label);
    const favOn = isFav(key);

    const delta = Number(t.delta || 0);
    let deltaBadge = "";
    if (delta > 0) deltaBadge = `<span class="badge good"><span class="ms" aria-hidden="true">arrow_drop_up</span>+${delta}</span>`;
    else if (delta < 0) deltaBadge = `<span class="badge warn"><span class="ms" aria-hidden="true">arrow_drop_down</span>${delta}</span>`;
    else deltaBadge = `<span class="badge"><span class="ms" aria-hidden="true">remove</span>0</span>`;

    const cat = t.cat || "news";
    const catLbl = (cat === "politics") ? "Política" : (cat === "sports") ? "Deportes" : (cat === "viral") ? "Viral" : "Noticias";

    const img = t.sampleImage ? `<img class="toastImg" style="width:46px;height:46px;border-radius:16px" src="${esc(t.sampleImage)}" alt="">` : "";

    const xUrl = CFG.xSearchBase + encodeURIComponent(t.label);

    return `
      <div class="card" data-kind="trend" data-key="${esc(t.key)}">
        <div class="cardHead">
          <div style="min-width:0">
            <div class="cardTitle">${esc(t.rank)}. ${esc(t.label)}</div>
            <div class="cardMeta">
              <span class="badge pri"><span class="ms" aria-hidden="true">trending_up</span>${esc(String(t.score))}</span>
              ${deltaBadge}
              <span class="badge"><span class="ms" aria-hidden="true">category</span>${esc(catLbl)}</span>
            </div>
          </div>

          <div class="cardActions">
            <button class="aBtn star ${favOn ? "on" : ""}" type="button" data-act="fav" title="Favorito">
              <span class="ms" aria-hidden="true">star</span>
            </button>
            <a class="aBtn" href="${esc(xUrl)}" target="_blank" rel="noreferrer" title="Buscar en X">
              <span class="ms" aria-hidden="true">search</span>
            </a>
          </div>
        </div>

        ${img ? `<div style="padding:0 12px 12px 12px;display:flex;gap:10px;align-items:center">${img}<div style="color:rgba(255,255,255,.72);font-size:12.5px;line-height:1.35">Abrir búsqueda en X con un click</div></div>` : `<div style="padding:0 12px 12px 12px;color:rgba(255,255,255,.72);font-size:12.5px">Abrir búsqueda en X con un click</div>`}
      </div>
    `;
  }

  function buildMemeCard(m){
    const fkey = favKeyMeme(m.id);
    const favOn = isFav(fkey);

    const v = getVote(m.id);
    const upOn = (v === 1);
    const downOn = (v === -1);

    const noThumbs = !!state.settings.noThumbs;

    let mediaHtml = "";
    if (!noThumbs && m.media){
      if (m.media.kind === "video"){
        const poster = m.media.poster ? ` poster="${esc(m.media.poster)}"` : "";
        mediaHtml = `
          <div class="memeMedia">
            <video src="${esc(m.media.url)}"${poster} controls playsinline muted preload="metadata"></video>
          </div>
        `;
      }else{
        mediaHtml = `
          <div class="memeMedia">
            <img src="${esc(m.media.url)}" alt="${esc(m.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">
          </div>
        `;
      }
    }

    const metaLeft = `
      <span class="badge"><span class="ms" aria-hidden="true">public</span>r/${esc(m.subreddit)}</span>
      <span class="badge"><span class="ms" aria-hidden="true">schedule</span>${esc(fmtAgo(m.createdMs))}</span>
    `;

    const metaRight = `
      <span class="badge"><span class="ms" aria-hidden="true">forum</span>${esc(String(m.comments))}</span>
      <span class="badge"><span class="ms" aria-hidden="true">insights</span>${esc(String(m.score))}</span>
    `;

    return `
      <div class="card" data-kind="meme" data-id="${esc(m.id)}">
        <div class="cardHead">
          <div style="min-width:0">
            <div class="cardTitle">${esc(m.title)}</div>
            <div class="cardMeta">${metaLeft} ${metaRight}</div>
          </div>

          <div class="cardActions">
            <button class="aBtn star ${favOn ? "on" : ""}" type="button" data-act="fav" title="Favorito">
              <span class="ms" aria-hidden="true">star</span>
            </button>
            <a class="aBtn" href="${esc(m.url)}" target="_blank" rel="noreferrer" title="Abrir post">
              <span class="ms" aria-hidden="true">open_in_new</span>
            </a>
          </div>
        </div>

        ${mediaHtml}

        <div class="memeFoot">
          <div class="voteBox">
            <button class="voteBtn up ${upOn ? "on" : ""}" type="button" data-act="up" title="Voto positivo">
              <span class="ms" aria-hidden="true">thumb_up</span>
            </button>
            <button class="voteBtn down ${downOn ? "on" : ""}" type="button" data-act="down" title="Voto negativo">
              <span class="ms" aria-hidden="true">thumb_down</span>
            </button>
            <span class="scorePill" title="Tu voto local (no afecta Reddit)">
              <span class="ms" aria-hidden="true">how_to_vote</span>
              <span class="scoreTxt">${v === 1 ? "+1" : v === -1 ? "-1" : "0"}</span>
            </span>
          </div>

          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span class="badge"><span class="ms" aria-hidden="true">person</span>${esc(m.author)}</span>
          </div>
        </div>
      </div>
    `;
  }

  function render(){
    hideErr();
    showEmpty(false);

    if (!elList) return;

    // set active tab states
    setTabsActive(tabsView, "data-view", state.view);
    setTabsActive(tabsCat, "data-cat", state.category);

    if (state.view === "memes"){
      const items = state.memesFiltered || [];
      if (!items.length){
        elList.innerHTML = "";
        showEmpty(true);
        return;
      }
      elList.innerHTML = items.map(buildMemeCard).join("");
    }
    else if (state.view === "all"){
      const items = state.filtered || [];
      if (!items.length){
        elList.innerHTML = "";
        showEmpty(true);
        return;
      }
      elList.innerHTML = items.map(buildTrendCard).join("");
    }
    else {
      // favs
      const favs = Array.from(state.favs);

      const tFavs = [];
      const mFavs = [];

      for (const k of favs){
        if (k.startsWith("t:")){
          const key = k.slice(2);
          const t = state.trends.find(x => x.key === key);
          if (t) tFavs.push(t);
        } else if (k.startsWith("m:")){
          const id = k.slice(2);
          const m = state.memes.find(x => x.id === id);
          if (m) mFavs.push(m);
        }
      }

      const merged = [];
      // mostrar memes favoritos primero (la gente suele querer memes)
      for (const m of mFavs) merged.push({ kind:"m", m });
      for (const t of tFavs) merged.push({ kind:"t", t });

      if (!merged.length){
        elList.innerHTML = "";
        showEmpty(true);
        return;
      }

      elList.innerHTML = merged.map(x => {
        if (x.kind === "m") return buildMemeCard(x.m);
        return buildTrendCard(x.t);
      }).join("");
    }

    // listeners delegados (1 vez)
    bindListDelegation();
  }

  let listDelegated = false;
  function bindListDelegation(){
    if (listDelegated || !elList) return;
    listDelegated = true;

    elList.addEventListener("click", (e) => {
      const card = e.target?.closest(".card");
      if (!card) return;

      const act = e.target?.closest("button,[data-act]")?.getAttribute("data-act");

      // Favoritos
      if (e.target?.closest("button.aBtn.star")){
        if (card.getAttribute("data-kind") === "trend"){
          const key = card.getAttribute("data-key");
          if (!key) return;
          const k = `t:${key}`;
          toggleFav(k);
          applyFiltersAndRender(true);
        } else if (card.getAttribute("data-kind") === "meme"){
          const id = card.getAttribute("data-id");
          if (!id) return;
          toggleFav(favKeyMeme(id));
          applyFiltersAndRender(true);
        }
        return;
      }

      // Votos memes
      if (card.getAttribute("data-kind") === "meme" && act){
        const id = card.getAttribute("data-id");
        if (!id) return;

        if (act === "up"){
          const cur = getVote(id);
          setVote(id, cur === 1 ? 0 : 1);
        } else if (act === "down"){
          const cur = getVote(id);
          setVote(id, cur === -1 ? 0 : -1);
        }

        // si estamos en best, reordenar
        if (state.settings.memeSort === "best") applyFiltersAndRender(true);
        else render();
      }
    }, { passive:true });
  }

  /* ==========================
     Filtering
     ========================== */
  function applyFiltersAndRender(silentToast){
    const q = safeLower(inpQ?.value || "").trim();

    if (state.view === "memes"){
      let arr = Array.isArray(state.memes) ? state.memes.slice() : [];

      // buscador
      if (q){
        arr = arr.filter(m =>
          safeLower(m.title).includes(q) ||
          safeLower(m.subreddit).includes(q) ||
          safeLower(m.author).includes(q)
        );
      }

      // orden best (combina reddit score + voto local)
      if (state.settings.memeSort === "best"){
        arr.sort((a,b) => {
          const av = getVote(a.id), bv = getVote(b.id);
          const as = (a.score || 0) + av * 350;
          const bs = (b.score || 0) + bv * 350;
          if (bs !== as) return bs - as;
          return (b.createdMs - a.createdMs);
        });
      } else {
        // mantener orden por fetch (new/hot/top) + fallback a recencia
        arr.sort((a,b) => (b.createdMs - a.createdMs));
      }

      state.memesFiltered = arr.slice(0, state.settings.memeMaxPosts || 45);
    }
    else if (state.view === "all"){
      let arr = Array.isArray(state.trends) ? state.trends.slice() : [];

      // category
      if (state.category && state.category !== "all"){
        arr = arr.filter(t => t.cat === state.category);
      }

      // search
      if (q){
        arr = arr.filter(t => safeLower(t.label).includes(q));
      }

      state.filtered = arr;
    }
    else {
      // favs view: no extra filter aquí (se aplica en render)
    }

    render();
    if (!silentToast && state.settings.alerts) {
      setTimeout(() => {
        if (state.view === "memes") toast("Memes", "Filtro aplicado.");
        else if (state.view === "all") toast("Tendencias", "Filtro aplicado.");
        else toast("Favoritos", "Lista actualizada.");
      }, 50);
    }
  }

  /* ==========================
     Refresh pipeline
     ========================== */
  async function refreshNow(onlyTrends){
    const aborter = makeAbort();
    hideErr();
    showEmpty(false);
    setText(elLast, nowISO());
    setText(elNet, navigator.onLine ? "OK" : "OFF");

    try{
      if (state.view === "all" || onlyTrends){
        const arts = await fetchGdeltArticles(aborter.signal);
        state.trends = computeTrends(arts);
      } else {
        state.memes = await fetchMemes(aborter.signal);
      }

      // si estamos en favs, conviene refrescar ambas fuentes al pulsar actualizar
      if (state.view === "favs" && !onlyTrends){
        try{
          const arts = await fetchGdeltArticles(aborter.signal);
          state.trends = computeTrends(arts);
        }catch{}
        try{
          state.memes = await fetchMemes(aborter.signal);
        }catch{}
      }

      applyFiltersAndRender(true);

      if (state.settings.alerts){
        toast("OK", "Actualizado.");
      }

      // ticker content
      rebuildTicker();

    }catch(e){
      showErr(`No se pudo actualizar. ${e?.message ? `(${e.message})` : ""}`);
      if (state.settings.alerts) toast("Error", "No se pudo actualizar. Revisa conexión o filtros.");
    }
  }

  function setupAutoRefresh(){
    try{ clearInterval(state.refreshTimer); }catch{}
    state.refreshTimer = null;

    if (!state.settings.auto) return;

    const ms = clamp(Number(state.settings.everySec || 120), 35, 900) * 1000;
    const safeMs = Math.max(ms, CFG.MIN_REFRESH_MS);

    state.refreshTimer = setInterval(() => {
      // refresca lo que se esté viendo
      refreshNow(state.view === "all");
    }, safeMs);
  }

  /* ==========================
     Ticker
     ========================== */
  function rebuildTicker(){
    if (!tickerTrack) return;

    const items = [];
    if (state.view === "all" || state.view === "favs"){
      const base = (state.view === "all") ? (state.filtered || state.trends || []) : (state.trends || []);
      for (const t of base.slice(0, 20)){
        items.push(`T${t.rank}: ${t.label}`);
      }
    }
    if (state.view === "memes" || state.view === "favs"){
      const base = (state.view === "memes") ? (state.memesFiltered || state.memes || []) : (state.memes || []);
      for (const m of base.slice(0, 20)){
        items.push(`r/${m.subreddit}: ${m.title}`);
      }
    }

    if (!items.length){
      tickerTrack.innerHTML = "";
      return;
    }

    // duplicar para scroll infinito
    const clean = items.map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
    const doubled = clean.concat(clean);

    tickerTrack.innerHTML = doubled.map(txt => `<span class="tickerItem"><span class="ms" aria-hidden="true">bolt</span>${esc(txt)}</span>`).join("");
    updateTickerSpeed();
  }

  /* ==========================
     Service Worker (safe)
     ========================== */
  async function setupServiceWorker(){
    if (!("serviceWorker" in navigator)) return;
    try{
      const reg = await navigator.serviceWorker.register(CFG.SW_URL, { updateViaCache: "none" });
      state.swReg = reg;

      // Poll updates
      state.swTick = setInterval(() => {
        try{ reg.update(); }catch{}
      }, CFG.SW_UPDATE_EVERY_MS);

      // Reload once when new SW takes control
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        const done = sessionStorage.getItem(CFG.SS_SW_RELOADED);
        if (done) return;
        sessionStorage.setItem(CFG.SS_SW_RELOADED, "1");
        location.reload();
      });

    }catch{
      // ignore
    }
  }

  /* ==========================
     Boot
     ========================== */
  async function init(){
    loadSettings();
    bindUI();
    setupAutoRefresh();
    setupServiceWorker();

    // Timeline
    mountTimeline(false);

    // First load: memes
    refreshNow(false);
  }

  state._cleanups.push(() => {
    try{ clearInterval(state.refreshTimer); }catch{}
    try{ clearInterval(state.swTick); }catch{}
    try{ state.aborter?.abort(); }catch{}
  });

  window.__GLOBAL_EYE_TRENDS__.cleanup = () => {
    for (const fn of state._cleanups) { try{ fn(); }catch{} }
  };

  init();
})();
