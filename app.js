/* app.js — Ojete Blog / GlobalEye Trends — v1.4.1 (FIX HARD)
   ✅ FIX CRÍTICO: arregla errores de sintaxis que rompían TODO (tendencias/timeline/etc.)
   ✅ Tendencias: entidades + frases 2–4 + hashtags/@ + scoring + dedupe
   ✅ Cache last-good en localStorage: si falla la red, sigues viendo algo
   ✅ Timeline: rescue + carga widgets.js si falta + fallback si el navegador lo bloquea
   ✅ Anti-duplicidades: guard + listeners únicos + timers únicos + AbortController
   ✅ Ticker + favoritos + alerts suaves + config modal
   ✅ SW auto-update (si sw.js soporta SKIP_WAITING)
*/

(() => {
  "use strict";

  /* ───────────────────────────── GUARD ANTI DOBLE CARGA ───────────────────────────── */
  const APP_TAG = "ojete-trends:v1.4.1";
  try{
    if (window.__OJETE_TRENDS_APP__?.tag === APP_TAG) return;
    window.__OJETE_TRENDS_APP__ = { tag: APP_TAG, startedAt: Date.now() };
  }catch{}

  /* ───────────────────────────── CONFIG ───────────────────────────── */
  const CFG = {
    gdeltBase: "https://api.gdeltproject.org/api/v2/doc/doc",
    X_SEARCH: "https://x.com/search?q=",

    // Branding (local)
    logoPng: "./logo_ojo_png.png",
    logoJpg: "./logo_ojo.jpg",
    toastGif: "./logo_ojo_gif.gif",

    // LocalStorage
    LS_SETTINGS: "ojete_trends_settings_v3",
    LS_FAVS: "ojete_trends_favs_v3",
    LS_RANKS: "ojete_trends_ranks_v3",
    LS_COMPACT: "ojete_trends_compact_v3",
    LS_LASTGOOD: "ojete_trends_lastgood_v1",

    // Scheduler
    MIN_REFRESH_MS: 35_000,
    MAX_REFRESH_MS: 900_000,

    // Network
    FETCH_TIMEOUT_MS: 12_500,

    // SW auto-update
    SW_URL: "./sw.js",
    SW_UPDATE_EVERY_MS: 8 * 60_000, // 8 min
    SS_SW_RELOADED: "ojete_sw_reloaded_once",

    // Timeline
    X_WIDGETS_SRC: "https://platform.twitter.com/widgets.js",
    X_WIDGETS_ID: "twitter-wjs",
  };

  /* ───────────────────────────── DOM ───────────────────────────── */
  const elList = document.getElementById("list");
  const elEmpty = document.getElementById("empty");
  const elErr = document.getElementById("err");
  const elLast = document.getElementById("lastUpdated");
  const elNet = document.getElementById("netStatus");

  const btnRefresh = document.getElementById("btnRefresh");
  const btnCompact = document.getElementById("btnCompact");

  const inpQ = document.getElementById("q");
  const selLang = document.getElementById("selLang");
  const selWindow = document.getElementById("selWindow");
  const selGeo = document.getElementById("selGeo");

  const tabsView = document.getElementById("tabsView");
  const tabsCat = document.getElementById("tabsCat");

  // Ticker
  const btnTicker = document.getElementById("btnTicker");
  const tickerBar = document.getElementById("tickerBar");
  const tickerTrack = document.getElementById("tickerTrack");
  const tickerClose = document.getElementById("tickerClose");

  // Toasts
  const toastHost = document.getElementById("toastHost");

  // Config modal
  const btnConfig = document.getElementById("btnConfig");
  const cfgModal = document.getElementById("cfgModal");
  const cfgClose = document.getElementById("cfgClose");
  const cfgSave = document.getElementById("cfgSave");
  const cfgReset = document.getElementById("cfgReset");

  const cfgAuto = document.getElementById("cfgAuto");
  const cfgEvery = document.getElementById("cfgEvery");
  const cfgMaxTrends = document.getElementById("cfgMaxTrends");
  const cfgAlerts = document.getElementById("cfgAlerts");
  const cfgTicker = document.getElementById("cfgTicker");
  const cfgTickerSpeed = document.getElementById("cfgTickerSpeed");

  /* ───────────────────────────── STOPWORDS / CATEGORÍAS ───────────────────────────── */
  const STOP_ES = new Set([
    "el","la","los","las","un","una","unos","unas","y","o","u","de","del","al","a","en","por","para","con","sin",
    "se","su","sus","lo","le","les","que","como","más","mas","muy","ya","no","sí","si","es","son","fue","han","hay",
    "este","esta","estos","estas","eso","esa","esos","esas","aquí","alli","allí","ahí",
    "hoy","ayer","mañana","ahora","sobre","tras","ante","entre","desde","hasta","contra","durante","según","cuando",
    "donde","quién","quien","qué","porque","pues","también","tambien","ser","estar","está","están","fueron",
    "uno","dos","tres","cuatro","cinco","seis","siete","ocho","nueve","diez"
  ]);

  const STOP_EN = new Set([
    "the","a","an","and","or","to","of","in","on","for","with","without","from","by","as","at",
    "is","are","was","were","be","been","it","its","this","that","these","those","now","today","yesterday","tomorrow",
    "about","after","before"
  ]);

  const CAT = { all:"all", news:"news", viral:"viral", politics:"politics", sports:"sports" };
  const CAT_LABEL = {
    [CAT.news]: "Noticias",
    [CAT.viral]: "Viral",
    [CAT.politics]: "Política",
    [CAT.sports]: "Deportes"
  };

  const DEFAULT_SETTINGS = {
    // Refresh
    autoRefresh: true,
    refreshEveryMs: 120_000,
    refreshJitterMs: 12_000,

    // Data
    maxArticles: 260,
    maxTrends: 24,

    // UX
    alertsEnabled: true,
    tickerEnabled: false,
    tickerSpeedSec: 28,

    // persist selects
    lang: "spanish",   // spanish | english | mixed
    window: "4H",      // 2H | 4H | 6H | 12H
    geo: "ES"          // ES | GLOBAL (heurístico)
  };

  const state = {
    all: [],
    filtered: [],

    timer: null,
    abort: null,
    refreshing: false,
    failCount: 0,

    lastRanks: new Map(),
    favs: new Set(),

    view: "all",        // all | favs
    category: "all",    // all | news | viral | politics | sports
    compact: false,

    settings: { ...DEFAULT_SETTINGS },

    bound: false,
    swReg: null,
    swTick: null,

    twttrReadyPromise: null,
  };

  /* ───────────────────────────── UTILS ───────────────────────────── */
  const safeLower = (s) => String(s || "").toLowerCase();
  const clamp = (n,a,b) => Math.max(a, Math.min(b, n));

  function escapeHtml(s){
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function safeUrl(u){
    const s = String(u || "").trim();
    if (!s) return "";
    if (!/^https?:\/\//i.test(s)) return "";
    return s;
  }

  function setNet(ok){
    if (elNet) elNet.textContent = ok ? "Online" : "Offline";
    const dot = document.querySelector(".dot");
    if (dot){
      dot.style.background = ok ? "var(--good)" : "var(--warn)";
      dot.style.boxShadow = ok
        ? "0 0 0 3px rgba(46,211,183,0.12)"
        : "0 0 0 3px rgba(245,196,81,0.12)";
    }
  }

  function setLastUpdated(){
    if (!elLast) return;
    const d = new Date();
    elLast.textContent = `Actualizado: ${d.toLocaleString()}`;
  }

  function clearError(){
    if (!elErr) return;
    elErr.classList.add("hidden");
    elErr.textContent = "";
  }
  function showError(msg){
    if (!elErr) return;
    elErr.classList.remove("hidden");
    elErr.textContent = msg;
  }

  function setLoading(on){
    if (!elList) return;
    elList.setAttribute("aria-busy", on ? "true" : "false");
    if (btnRefresh) btnRefresh.disabled = !!on;
    document.body.classList.toggle("isLoading", !!on);

    if (on && !state.all.length){
      elList.innerHTML = `
        <div class="trend" style="opacity:.55">
          <div class="rank">…</div>
          <div class="tBody">
            <div class="tTop"><div class="tLabel">Cargando tendencias…</div></div>
            <div class="tMeta"><span>Esperando datos</span></div>
          </div>
        </div>
      `;
    }
  }

  /* ───────────────────────────── TOASTS ───────────────────────────── */
  function toast(title, msg){
    if (!toastHost) return;

    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `
      <img class="toastImg" src="${CFG.toastGif}" alt="" />
      <div class="toastRow">
        <div class="toastTitle">${escapeHtml(title)}</div>
        <div class="toastMsg">${escapeHtml(msg)}</div>
      </div>
      <button class="toastX" type="button" aria-label="Cerrar">✕</button>
    `;

    const kill = () => {
      el.style.transition = "opacity .14s ease, transform .14s ease";
      el.style.opacity = "0";
      el.style.transform = "translateY(8px)";
      setTimeout(() => el.remove(), 170);
    };

    el.querySelector(".toastX")?.addEventListener("click", kill, { once:true });
    toastHost.appendChild(el);
    setTimeout(kill, 3600);
  }

  /* ───────────────────────────── BRANDING PNG (AUTO) ───────────────────────────── */
  function applyPngLogoIfAvailable(){
    const png = CFG.logoPng;
    const jpg = CFG.logoJpg;

    const img = new Image();
    img.onload = () => {
      document.querySelectorAll("img.heroLogo, img.logoImg, img.tickerLogo")
        .forEach(el => {
          el.src = png;
          try{
            el.style.objectFit = "contain";
            el.style.background = "transparent";
          }catch{}
        });

      const icon = document.querySelector('link[rel="icon"]');
      if (icon) icon.href = png;

      const apple = document.querySelector('link[rel="apple-touch-icon"]');
      if (apple) apple.href = png;
    };
    img.onerror = () => {
      document.querySelectorAll("img.heroLogo, img.logoImg, img.tickerLogo")
        .forEach(el => { el.src = jpg; });
    };
    img.src = png;
  }

  /* ───────────────────────────── SELECTS ───────────────────────────── */
  function pickTimespan(){
    const v = String(selWindow?.value || state.settings.window || "4H").toUpperCase();
    return (["2H","4H","6H","12H"].includes(v)) ? v : "4H";
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

  /* ───────────────────────────── FETCH ───────────────────────────── */
  function buildGdeltQuery(){
    const lang = pickLang();
    const geo = pickGeo();

    let q;
    if (lang === "mixed") q = `(sourcelang:spanish OR sourcelang:english)`;
    else q = `sourcelang:${lang}`;

    // “GLOBAL” abre señal un poco
    if (geo === "GLOBAL" && lang === "spanish"){
      q = `(sourcelang:spanish OR sourcelang:english)`;
    }
    return q;
  }

  function buildUrl(){
    const params = new URLSearchParams();
    params.set("format", "json");
    params.set("mode", "ArtList");
    params.set("sort", "hybridrel");
    params.set("maxrecords", String(clamp(state.settings.maxArticles, 50, 500)));
    params.set("timespan", pickTimespan());
    params.set("query", buildGdeltQuery());
    return `${CFG.gdeltBase}?${params.toString()}`;
  }

  async function fetchWithTimeout(url, ms, signal){
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);

    const onAbort = () => ctrl.abort();
    try{
      if (signal) signal.addEventListener("abort", onAbort, { once:true });
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      return res;
    }finally{
      clearTimeout(t);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  /* ───────────────────────────── FECHAS (GDELT) ───────────────────────────── */
  function parseGdeltSeenDate(a){
    // GDELT suele traer seendate: "YYYYMMDDHHMMSS"
    const s = String(a?.seendate || a?.seenDate || "").trim();
    if (!/^\d{14}$/.test(s)) return 0;
    const y = Number(s.slice(0,4));
    const mo = Number(s.slice(4,6)) - 1;
    const d = Number(s.slice(6,8));
    const h = Number(s.slice(8,10));
    const mi = Number(s.slice(10,12));
    const se = Number(s.slice(12,14));
    const dt = new Date(y, mo, d, h, mi, se);
    return Number.isFinite(dt.getTime()) ? dt.getTime() : 0;
  }

  function recencyMultiplier(ts){
    if (!ts) return 1.0;
    const ageMs = Date.now() - ts;
    if (ageMs <= 30 * 60_000) return 1.35;   // <30m
    if (ageMs <= 90 * 60_000) return 1.20;   // <90m
    if (ageMs <= 4 * 60 * 60_000) return 1.08; // <4h
    return 1.0;
  }

  /* ───────────────────────────── TOKENS / ENTIDADES / FRASES ───────────────────────────── */
  function normalizeToken(t){
    return safeLower(t)
      .replace(/[\u2019']/g, "")
      .replace(/[^\p{L}\p{N}#@]+/gu, "")
      .trim();
  }

  function isStop(token){
    if (!token) return true;
    const t = token.replace(/^[@#]/, "");
    if (!t) return true;
    if (t.length <= 2) return true;

    const lang = pickLang();
    if (lang === "english") return STOP_EN.has(t);
    if (lang === "spanish") return STOP_ES.has(t);
    return STOP_ES.has(t) || STOP_EN.has(t);
  }

  function splitWords(title){
    const raw = String(title || "")
      .replace(/[\u2013\u2014]/g, " ")
      .replace(/[(){}\[\]:"“”'’]/g, " ")
      .replace(/[!?,.;]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const parts = raw ? raw.split(" ") : [];
    return parts.map(w => {
      const clean = w.replace(/^[^#@A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+|[^#@A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+$/g, "");
      const norm = normalizeToken(clean);
      const isHash = norm.startsWith("#");
      const isAt = norm.startsWith("@");
      const base = norm.replace(/^[@#]/,"");
      const cap = /^[A-ZÁÉÍÓÚÜÑ]/.test(clean) && !isHash && !isAt;

      return { raw: clean, norm, base, cap, isHash, isAt };
    }).filter(x => x.norm);
  }

  function extractEntityPhrases(words){
    const connectors = new Set(["de","del","la","las","los","y","da","do","dos","das"]);
    const out = [];

    let i = 0;
    while (i < words.length){
      const w = words[i];
      if (!w.cap || isStop(w.norm)) { i++; continue; }

      const start = i;
      let end = i;

      while (end + 1 < words.length){
        const next = words[end + 1];
        const n = next.norm.replace(/^[@#]/,"");

        if (next.cap && !isStop(next.norm)){ end++; continue; }

        if (!next.isHash && !next.isAt && connectors.has(n) && end + 2 < words.length){
          const after = words[end + 2];
          if (after.cap && !isStop(after.norm)){ end += 2; continue; }
        }
        break;
      }

      if (end > start){
        const phrase = words.slice(start, end + 1).map(x => x.raw).join(" ").trim();
        const normPhrase = normalizeToken(phrase);
        if (normPhrase && normPhrase.length >= 5) out.push(phrase);
      }

      i = end + 1;
    }
    return out;
  }

  function extractNgrams(words, nMin, nMax){
    const toks = words
      .filter(w => !w.isAt && !w.isHash)
      .map(w => normalizeToken(w.raw))
      .filter(Boolean);

    const grams = [];
    for (let n = nMin; n <= nMax; n++){
      for (let i = 0; i <= toks.length - n; i++){
        const slice = toks.slice(i, i + n);
        if (slice.some(isStop)) continue;
        if (slice.every(x => /^[0-9]+$/.test(x))) continue;
        if (!slice.some(x => x.length >= 4 && !isStop(x))) continue;

        const phrase = slice.join(" ");
        if (phrase.length >= 6 && phrase.length <= 60) grams.push(phrase);
      }
    }
    return grams;
  }

  /* ───────────────────────────── CLASIFICACIÓN ───────────────────────────── */
  function classify(label, sampleTitle){
    const s = safeLower(label + " " + (sampleTitle || ""));

    const sports =
      /\b(liga|laliga|champions|europa league|premier|nba|nfl|mlb|f1|formula 1|gran premio|gp|goles|gol|partido|derbi|clásico|clasico|madrid|barça|barca|barcelona|atleti|atlético|atletico|sevilla|valencia|betis)\b/.test(s);
    if (sports) return CAT.sports;

    const politics =
      /\b(gobierno|congreso|senado|parlamento|presidente|ministro|ministra|elecciones|pp|psoe|vox|podemos|sumar|política|politica|ley|decreto|tribunal|constitucional|ue|otan|onu|casa blanca|trump|biden|putin|zelenski|zelensky|netanyahu)\b/.test(s);
    if (politics) return CAT.politics;

    const viral =
      /\b(viral|meme|tiktok|tik tok|twitch|streamer|youtube|youtuber|influencer|polémica|polemica|trend|challenge|filtrado|filtración|filtracion|escándalo|escandalo)\b/.test(s);
    if (viral) return CAT.viral;

    return CAT.news;
  }

  /* ───────────────────────────── RANKS (NEW/▲/▼) ───────────────────────────── */
  function loadLastRanks(){
    try{
      const raw = localStorage.getItem(CFG.LS_RANKS);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const obj = parsed?.ranks || parsed;
      if (!obj || typeof obj !== "object") return;

      state.lastRanks = new Map(Object.entries(obj).map(([k,v]) => [String(k), Number(v)]));
    }catch{}
  }

  function saveRanks(trends){
    try{
      const ranks = {};
      trends.forEach((t, idx) => { ranks[String(t.term)] = idx + 1; });
      localStorage.setItem(CFG.LS_RANKS, JSON.stringify({ ts: Date.now(), ranks }));
      state.lastRanks = new Map(Object.entries(ranks).map(([k,v]) => [String(k), Number(v)]));
    }catch{}
  }

  function deltaBadge(term, newRank){
    const oldRank = state.lastRanks.get(String(term));
    if (!oldRank) return { cls: "new", txt: "NEW" };
    const diff = oldRank - newRank;
    if (diff > 0) return { cls: "up", txt: `▲${diff}` };
    if (diff < 0) return { cls: "down", txt: `▼${Math.abs(diff)}` };
    return { cls: "same", txt: "—" };
  }

  /* ───────────────────────────── FAVORITOS ───────────────────────────── */
  function loadFavs(){
    try{
      const raw = localStorage.getItem(CFG.LS_FAVS);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) state.favs = new Set(arr.filter(Boolean).map(String));
    }catch{}
  }
  function saveFavs(){
    try{ localStorage.setItem(CFG.LS_FAVS, JSON.stringify(Array.from(state.favs))); }catch{}
  }

  function toggleFav(term, label){
    const key = String(term);
    const was = state.favs.has(key);
    if (was) state.favs.delete(key);
    else state.favs.add(key);
    saveFavs();

    if (state.settings.alertsEnabled){
      toast(was ? "Favorito eliminado" : "Favorito guardado", label || term);
    }
    applyFilter();
  }

  /* ───────────────────────────── SETTINGS / COMPACT ───────────────────────────── */
  function loadCompact(){
    try{
      const v = localStorage.getItem(CFG.LS_COMPACT);
      state.compact = (v === "1");
      document.body.classList.toggle("compact", state.compact);
      btnCompact?.setAttribute("aria-pressed", state.compact ? "true" : "false");
    }catch{}
  }

  function toggleCompact(){
    state.compact = !state.compact;
    document.body.classList.toggle("compact", state.compact);
    btnCompact?.setAttribute("aria-pressed", state.compact ? "true" : "false");
    try{ localStorage.setItem(CFG.LS_COMPACT, state.compact ? "1" : "0"); }catch{}
  }

  function loadSettings(){
    try{
      const raw = localStorage.getItem(CFG.LS_SETTINGS);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object"){
        state.settings = { ...DEFAULT_SETTINGS, ...parsed };
      }
    }catch{}
  }

  function saveSettings(){
    try{ localStorage.setItem(CFG.LS_SETTINGS, JSON.stringify(state.settings)); }catch{}
  }

  function applySettingsToUI(){
    if (selLang && state.settings.lang) selLang.value = state.settings.lang;
    if (selWindow && state.settings.window) selWindow.value = state.settings.window;
    if (selGeo && state.settings.geo) selGeo.value = state.settings.geo;

    if (cfgAuto) cfgAuto.checked = !!state.settings.autoRefresh;
    if (cfgEvery) cfgEvery.value = String(Math.round(state.settings.refreshEveryMs / 1000));
    if (cfgMaxTrends) cfgMaxTrends.value = String(state.settings.maxTrends);
    if (cfgAlerts) cfgAlerts.checked = !!state.settings.alertsEnabled;
    if (cfgTicker) cfgTicker.checked = !!state.settings.tickerEnabled;
    if (cfgTickerSpeed) cfgTickerSpeed.value = String(state.settings.tickerSpeedSec);

    document.documentElement.style.setProperty("--tickerDur", `${clamp(state.settings.tickerSpeedSec, 12, 120)}s`);
    setTickerVisible(!!state.settings.tickerEnabled);
  }

  /* ───────────────────────────── CACHE LAST-GOOD ───────────────────────────── */
  function saveLastGood(trends){
    try{
      localStorage.setItem(CFG.LS_LASTGOOD, JSON.stringify({
        ts: Date.now(),
        trends: Array.isArray(trends) ? trends : []
      }));
    }catch{}
  }

  function loadLastGood(){
    try{
      const raw = localStorage.getItem(CFG.LS_LASTGOOD);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.trends)) return null;
      return obj;
    }catch{
      return null;
    }
  }

  /* ───────────────────────────── TABS / MODAL / TICKER ───────────────────────────── */
  function setActiveTab(container, attr, value){
    if (!container) return;
    container.querySelectorAll(".tab").forEach(b => {
      const v = b.getAttribute(attr);
      const active = (v === value);
      b.classList.toggle("isActive", active);
      b.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function bindTabs(){
    tabsView?.addEventListener("click", (e) => {
      const btn = e.target?.closest?.(".tab");
      if (!btn) return;
      const view = btn.getAttribute("data-view") || "all";
      state.view = (view === "favs") ? "favs" : "all";
      setActiveTab(tabsView, "data-view", state.view);
      applyFilter();
    });

    tabsCat?.addEventListener("click", (e) => {
      const btn = e.target?.closest?.(".tab");
      if (!btn) return;
      const cat = btn.getAttribute("data-cat") || "all";
      state.category = cat;
      setActiveTab(tabsCat, "data-cat", state.category);
      applyFilter();
    });
  }

  function openConfig(){ cfgModal?.classList.remove("hidden"); }
  function closeConfig(){ cfgModal?.classList.add("hidden"); }

  function bindConfig(){
    btnConfig?.addEventListener("click", openConfig);
    cfgClose?.addEventListener("click", closeConfig);

    cfgModal?.addEventListener("click", (e) => {
      if (e.target === cfgModal) closeConfig();
    });

    cfgSave?.addEventListener("click", () => {
      const everySec = clamp(Number(cfgEvery?.value || 120), 35, 900);
      const maxT = clamp(Number(cfgMaxTrends?.value || 24), 10, 60);
      const tickerSec = clamp(Number(cfgTickerSpeed?.value || 28), 12, 120);

      state.settings.autoRefresh = !!cfgAuto?.checked;
      state.settings.refreshEveryMs = everySec * 1000;
      state.settings.maxTrends = maxT;
      state.settings.alertsEnabled = !!cfgAlerts?.checked;
      state.settings.tickerEnabled = !!cfgTicker?.checked;
      state.settings.tickerSpeedSec = tickerSec;

      state.settings.lang = pickLang();
      state.settings.window = pickTimespan();
      state.settings.geo = pickGeo();

      saveSettings();
      applySettingsToUI();

      schedule();
      applyFilter();

      closeConfig();
      toast("Configuración guardada", "Ajustes aplicados.");
    });

    cfgReset?.addEventListener("click", () => {
      state.settings = { ...DEFAULT_SETTINGS };
      saveSettings();
      applySettingsToUI();
      schedule();
      applyFilter();
      toast("Reset", "Configuración restaurada.");
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && cfgModal && !cfgModal.classList.contains("hidden")){
        closeConfig();
      }
    });
  }

  function setTickerVisible(on){
    if (!tickerBar) return;
    tickerBar.classList.toggle("hidden", !on);
  }

  function toggleTicker(){
    state.settings.tickerEnabled = !state.settings.tickerEnabled;
    saveSettings();
    applySettingsToUI();
    if (state.settings.alertsEnabled) toast("Ticker", state.settings.tickerEnabled ? "Activado" : "Desactivado");
  }

  function updateTicker(){
    if (!tickerTrack) return;
    if (!state.settings.tickerEnabled){
      tickerTrack.innerHTML = "";
      return;
    }

    const base = state.filtered.length ? state.filtered : state.all;
    const top = base.slice(0, clamp(state.settings.maxTrends, 10, 60));

    tickerTrack.innerHTML = top.map((it) => {
      const q = encodeURIComponent(it.label);
      return `
        <a class="tickerItem" href="${CFG.X_SEARCH}${q}" target="_blank" rel="noreferrer noopener">${escapeHtml(it.label)}</a>
        <span class="tickerSep">•</span>
      `;
    }).join("");

    tickerTrack.style.animation = "none";
    tickerTrack.offsetHeight; // force reflow
    tickerTrack.style.animation = "";
  }

  function bindTicker(){
    btnTicker?.addEventListener("click", toggleTicker);
    tickerClose?.addEventListener("click", () => {
      state.settings.tickerEnabled = false;
      saveSettings();
      applySettingsToUI();
    });
  }

  /* ───────────────────────────── COMPUTE TRENDS ───────────────────────────── */
  function computeTrends(articles){
    const freq = new Map(); // term -> score accumulator
    const meta = new Map(); // term -> {label, exampleUrl, sampleTitle, rawFreq}

    const add = (term, label, weight, exampleUrl, sampleTitle) => {
      if (!term || !label) return;
      const key = String(term);
      freq.set(key, (freq.get(key) || 0) + weight);

      if (!meta.has(key)){
        meta.set(key, { label, exampleUrl: exampleUrl || "", sampleTitle: sampleTitle || "", rawFreq: 0 });
      }
      const m = meta.get(key);
      m.rawFreq += 1;
      if (!m.exampleUrl && exampleUrl) m.exampleUrl = exampleUrl;
      if (!m.sampleTitle && sampleTitle) m.sampleTitle = sampleTitle;
    };

    for (const a of articles){
      const title = a?.title || "";
      const url = safeUrl(a?.url || "");
      if (!title) continue;

      const seenTs = parseGdeltSeenDate(a);
      const mult = recencyMultiplier(seenTs);

      const words = splitWords(title);

      // hashtags y mentions
      for (const w of words){
        if (w.isHash && w.base && !isStop(w.base)){
          add(w.norm, w.raw, 2.2 * mult, url, title);
        }else if (w.isAt && w.base && !isStop(w.base)){
          add(w.norm, w.raw, 1.6 * mult, url, title);
        }
      }

      // entidades
      const entities = extractEntityPhrases(words);
      for (const e of entities){
        const norm = normalizeToken(e);
        if (!norm || isStop(norm)) continue;
        add(norm, e, 1.4 * mult, url, title);
      }

      // frases (2-4)
      const grams = extractNgrams(words, 2, 4);
      for (const g of grams){
        const norm = normalizeToken(g);
        if (!norm) continue;
        add(norm, g, 1.15 * mult, url, title);
      }

      // tokens sueltos fuertes
      for (const w of words){
        if (w.isHash || w.isAt) continue;
        const base = normalizeToken(w.raw);
        if (!base || isStop(base)) continue;
        if (base.length < 4) continue;
        add(base, w.raw, 0.55 * mult, url, title);
      }
    }

    const scored = [...freq.entries()].map(([term, score]) => {
      const m = meta.get(term) || {};
      const label = m.label || term;
      const sampleTitle = m.sampleTitle || "";
      const exampleUrl = m.exampleUrl || "";
      const cat = classify(label, sampleTitle);

      // score final suavizado
      const finalScore = score * 10;

      return {
        term,
        label,
        score: Math.round(finalScore),
        rawFreq: m.rawFreq || 0,
        cat,
        exampleUrl
      };
    });

    scored.sort((a,b) => b.score - a.score);

    // dedupe leve: #X vs X
    const seen = new Set();
    const out = [];
    const maxT = clamp(state.settings.maxTrends, 10, 60);

    for (const it of scored){
      const key = safeLower(it.label).replace(/^#/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
      if (out.length >= maxT) break;
    }

    return out;
  }

  /* ───────────────────────────── RENDER / FILTER ───────────────────────────── */
  function render(items){
    if (!elList) return;

    elList.innerHTML = "";
    const frag = document.createDocumentFragment();

    items.forEach((it, idx) => {
      const rank = idx + 1;
      const delta = deltaBadge(it.term, rank);
      const isFav = state.favs.has(String(it.term));
      const catLabel = (it.cat && it.cat !== "all") ? (CAT_LABEL[it.cat] || "") : "";

      const node = document.createElement("div");
      node.className = "trend";
      node.style.animationDelay = `${Math.min(idx * 10, 160)}ms`;

      const xq = encodeURIComponent(it.label);
      const xUrl = `${CFG.X_SEARCH}${xq}`;

      const exampleUrl = safeUrl(it.exampleUrl);
      const exampleBtn = exampleUrl
        ? `<a class="aBtn" href="${escapeHtml(exampleUrl)}" target="_blank" rel="noreferrer noopener">Ejemplo</a>`
        : ``;

      node.innerHTML = `
        <div class="rank">${rank}</div>
        <div class="tBody">
          <div class="tTop">
            <div class="tLabel">${escapeHtml(it.label)}</div>
            <div class="tBadges">
              <span class="delta ${delta.cls}">${escapeHtml(delta.txt)}</span>
              ${catLabel ? `<span class="cat">${escapeHtml(catLabel)}</span>` : ``}
            </div>
          </div>
          <div class="tMeta">
            <span>${escapeHtml(String(it.rawFreq || 0))} menciones</span>
            <span class="dotSep">•</span>
            <span>score ${escapeHtml(String(it.score || 0))}</span>
          </div>
        </div>

        <div class="actions">
          <button class="aBtn favBtn ${isFav ? "isFav" : ""}" type="button" title="Guardar favorito" aria-label="Favorito">
            ${isFav ? "★" : "☆"}
          </button>
          <a class="aBtn primary" href="${xUrl}" target="_blank" rel="noreferrer noopener">Ver en X</a>
          ${exampleBtn}
        </div>
      `;

      node.querySelector(".favBtn")?.addEventListener("click", () => toggleFav(it.term, it.label));
      frag.appendChild(node);
    });

    elList.appendChild(frag);

    const has = items.length > 0;
    if (elEmpty) elEmpty.classList.toggle("hidden", has);
    updateTicker();
  }

  function applyFilter(){
    const qRaw = safeLower(inpQ?.value || "").trim();

    let arr = state.all.slice();

    // Vista favoritos
    if (state.view === "favs"){
      arr = arr.filter(it => state.favs.has(String(it.term)));
    }

    // Categoría
    if (state.category && state.category !== "all"){
      arr = arr.filter(it => it.cat === state.category);
    }

    // Búsqueda: si empieza por "#" filtra hashtags
    if (qRaw.startsWith("#")){
      arr = arr.filter(it => String(it.label || "").trim().startsWith("#"));
    }

    if (qRaw){
      arr = arr.filter(it => safeLower(it.label).includes(qRaw));
    }

    state.filtered = arr;
    render(arr);
  }

  /* ───────────────────────────── ALERTAS SUAVES PARA FAVORITOS ───────────────────────────── */
  function favRankAlerts(trends){
    if (!state.settings.alertsEnabled) return;
    if (!state.favs.size) return;

    const newRanks = new Map();
    trends.forEach((t, idx) => newRanks.set(String(t.term), idx + 1));

    for (const fav of state.favs){
      const nr = newRanks.get(String(fav));
      if (!nr) continue;

      const old = state.lastRanks.get(String(fav));
      if (!old){
        toast("Favorito en ranking", `Entró al Top: #${nr}`);
      }else{
        const diff = old - nr;
        if (diff >= 5){
          toast("Favorito subiendo", `▲${diff} posiciones (ahora #${nr})`);
        }
      }
    }
  }

  /* ───────────────────────────── REFRESH / SCHEDULER ───────────────────────────── */
  async function refresh(){
    if (state.refreshing) return;
    state.refreshing = true;
    setLoading(true);
    clearError();

    if (state.abort){
      try{ state.abort.abort(); }catch{}
    }
    state.abort = new AbortController();

    try{
      const url = buildUrl();
      const res = await fetchWithTimeout(url, CFG.FETCH_TIMEOUT_MS, state.abort.signal);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json().catch(() => ({}));
      const articles = Array.isArray(data?.articles) ? data.articles : [];

      if (!articles.length){
        const cached = loadLastGood();
        if (cached?.trends?.length){
          state.all = cached.trends;
          applyFilter();
          setLastUpdated();
          saveRanks(state.all);
          showError("Sin artículos ahora mismo. Mostrando el último ranking guardado.");
          return;
        }

        state.all = [];
        state.filtered = [];
        render([]);
        setLastUpdated();
        saveRanks([]);
        state.failCount = 0;
        showError("No llegaron artículos. Prueba otra ventana (2H/4H/6H) o idioma.");
        return;
      }

      const trends = computeTrends(articles);

      favRankAlerts(trends);

      state.all = trends;
      applyFilter();
      setLastUpdated();
      saveRanks(trends);
      saveLastGood(trends);

      state.failCount = 0;
    }catch(err){
      if (err?.name === "AbortError"){
        // silencioso
      }else{
        state.failCount = clamp(state.failCount + 1, 0, 6);

        const cached = loadLastGood();
        if (cached?.trends?.length){
          state.all = cached.trends;
          applyFilter();
          setLastUpdated();
          showError("No pude actualizar ahora mismo. Mostrando el último ranking guardado.");
        }else{
          showError(
            "No pude actualizar tendencias ahora mismo. " +
            "Puede ser rate-limit o un corte puntual de la fuente. " +
            "Prueba en 1–2 min o cambia ventana/idioma."
          );
          if (!state.all.length) render([]);
        }
      }
    }finally{
      setLoading(false);
      state.refreshing = false;
    }
  }

  function schedule(){
    if (state.timer) clearTimeout(state.timer);
    if (!state.settings.autoRefresh) return;

    const baseEvery = clamp(Number(state.settings.refreshEveryMs || DEFAULT_SETTINGS.refreshEveryMs), CFG.MIN_REFRESH_MS, CFG.MAX_REFRESH_MS);
    const jitterMax = clamp(Number(state.settings.refreshJitterMs || DEFAULT_SETTINGS.refreshJitterMs), 0, 60_000);

    // backoff suave en errores
    const mult = 1 + Math.min(state.failCount, 4) * 0.6;
    const every = clamp(Math.round(baseEvery * mult), CFG.MIN_REFRESH_MS, CFG.MAX_REFRESH_MS);

    const jitter = Math.floor((Math.random() * 2 - 1) * jitterMax);
    const wait = clamp(every + jitter, CFG.MIN_REFRESH_MS, CFG.MAX_REFRESH_MS);

    state.timer = setTimeout(async () => {
      await refresh();
      schedule();
    }, wait);
  }

  /* ───────────────────────────── TIMELINE RESCUE (WIDGETS) ───────────────────────────── */
  function ensureTwitterWidgetsScript(){
    if (state.twttrReadyPromise) return state.twttrReadyPromise;

    state.twttrReadyPromise = new Promise((resolve) => {
      // ya existe loader oficial en index.html → aprovecha
      if (window.twttr?.ready){
        try{
          window.twttr.ready(() => resolve(window.twttr));
          return;
        }catch{}
      }

      // si ya está el script
      const already = document.getElementById(CFG.X_WIDGETS_ID);
      if (already){
        // espera un poco a que cree window.twttr
        setTimeout(() => resolve(window.twttr || null), 300);
        return;
      }

      // busca por src en scripts
      const scripts = Array.from(document.scripts || []);
      const foundBySrc = scripts.some(s => String(s.src || "").includes("platform.twitter.com/widgets.js"));
      if (foundBySrc){
        setTimeout(() => resolve(window.twttr || null), 300);
        return;
      }

      // inyecta
      const js = document.createElement("script");
      js.id = CFG.X_WIDGETS_ID;
      js.async = true;
      js.src = CFG.X_WIDGETS_SRC;
      js.onload = () => resolve(window.twttr || null);
      js.onerror = () => resolve(null);
      document.head.appendChild(js);
    });

    return state.twttrReadyPromise;
  }

  async function timelineRescue(){
    const wrap = document.querySelector(".timelineWrap");
    const anchor = wrap?.querySelector?.("a.twitter-timeline");
    if (!wrap || !anchor) return;

    try{
      anchor.setAttribute("data-tweet-limit", anchor.getAttribute("data-tweet-limit") || "20");
      anchor.setAttribute("data-theme", "dark");
    }catch{}

    const tw = await ensureTwitterWidgetsScript();

    // intenta load cuando twttr esté listo
    const tryLoad = () => {
      try{
        window.twttr?.widgets?.load?.(wrap);
      }catch{}
    };

    if (tw?.ready){
      try{ tw.ready(() => tryLoad()); }catch{ tryLoad(); }
    }else{
      tryLoad();
    }

    // fallback si a los 8s no hay iframe
    setTimeout(() => {
      const hasIframe = !!wrap.querySelector("iframe");
      if (hasIframe) return;

      const hintId = "tl_fallback_hint";
      if (document.getElementById(hintId)) return;

      const div = document.createElement("div");
      div.id = hintId;
      div.style.cssText = "margin-top:10px;padding:10px;border:1px solid rgba(255,255,255,0.14);border-radius:12px;background:rgba(255,255,255,0.04);color:rgba(231,233,234,0.88);font-size:13px;line-height:1.35";
      div.innerHTML = `
        <div style="font-weight:800;margin-bottom:4px">Timeline no cargó</div>
        <div style="opacity:.9">Algunos navegadores bloquean el widget. Abre el perfil directamente:</div>
        <a href="https://x.com/GlobalEye_TV" target="_blank" rel="noreferrer noopener"
           style="display:inline-block;margin-top:8px;padding:8px 10px;border-radius:10px;background:rgba(29,155,240,0.16);color:#e7e9ea;text-decoration:none">
          Abrir @GlobalEye_TV
        </a>
      `;
      wrap.appendChild(div);
    }, 8000);
  }

  /* ───────────────────────────── AUTO-UPDATE (SERVICE WORKER) ───────────────────────────── */
  function swReloadOnce(){
    try{
      const done = sessionStorage.getItem(CFG.SS_SW_RELOADED);
      if (done === "1") return false;
      sessionStorage.setItem(CFG.SS_SW_RELOADED, "1");
      return true;
    }catch{
      return true;
    }
  }

  async function swSkipWaiting(reg){
    try{
      if (!reg) return false;
      const w = reg.waiting;
      if (!w) return false;
      w.postMessage({ type: "SKIP_WAITING" });
      return true;
    }catch{
      return false;
    }
  }

  function bindSwControllerChange(){
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (swReloadOnce()){
        toast("Actualización", "Aplicando nueva versión…");
        setTimeout(() => location.reload(), 650);
      }
    });
  }

  async function initAutoUpdateSW(){
    if (!("serviceWorker" in navigator)) return;

    bindSwControllerChange();

    try{
      const reg = await navigator.serviceWorker.register(CFG.SW_URL, { updateViaCache: "none" });
      state.swReg = reg;

      if (reg.waiting){
        await swSkipWaiting(reg);
      }

      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;

        installing.addEventListener("statechange", async () => {
          if (installing.state !== "installed") return;
          if (navigator.serviceWorker.controller){
            toast("Actualización detectada", "Actualizando…");
            await swSkipWaiting(reg);
          }
        });
      });

      const tick = async () => {
        try{ await reg.update(); }catch{}
        try{
          if (reg.waiting) await swSkipWaiting(reg);
        }catch{}
      };

      if (state.swTick) clearInterval(state.swTick);
      state.swTick = setInterval(tick, CFG.SW_UPDATE_EVERY_MS);

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") tick();
      }, { passive:true });

      tick();
    }catch{
      // sin SW, la app sigue funcionando
    }
  }

  /* ───────────────────────────── BIND ───────────────────────────── */
  function bind(){
    if (state.bound) return;
    state.bound = true;

    btnRefresh?.addEventListener("click", async () => {
      await refresh();
      schedule();
    });

    btnCompact?.addEventListener("click", toggleCompact);
    inpQ?.addEventListener("input", applyFilter);

    selLang?.addEventListener("change", () => {
      state.settings.lang = pickLang();
      saveSettings();
      if (inpQ) inpQ.value = "";
      refresh();
      schedule();
    });

    selWindow?.addEventListener("change", () => {
      state.settings.window = pickTimespan();
      saveSettings();
      if (inpQ) inpQ.value = "";
      refresh();
      schedule();
    });

    selGeo?.addEventListener("change", () => {
      state.settings.geo = pickGeo();
      saveSettings();
      if (inpQ) inpQ.value = "";
      refresh();
      schedule();
    });

    window.addEventListener("online", () => setNet(true));
    window.addEventListener("offline", () => setNet(false));

    bindTabs();
    bindConfig();
    bindTicker();

    setActiveTab(tabsView, "data-view", state.view);
    setActiveTab(tabsCat, "data-cat", state.category);
  }

  /* ───────────────────────────── BOOT ───────────────────────────── */
  async function boot(){
    applyPngLogoIfAvailable();

    loadSettings();
    loadFavs();
    loadLastRanks();
    loadCompact();

    state.settings.lang = state.settings.lang || pickLang();
    state.settings.window = state.settings.window || pickTimespan();
    state.settings.geo = state.settings.geo || pickGeo();

    applySettingsToUI();
    bind();
    setNet(navigator.onLine);

    // pinta cache si existe (instantáneo)
    const cached = loadLastGood();
    if (cached?.trends?.length){
      state.all = cached.trends;
      applyFilter();
      setLastUpdated();
    }

    initAutoUpdateSW();
    timelineRescue();

    await refresh();
    schedule();
  }

  boot();
})();
