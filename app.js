/* app.js — GlobalEye Trends (Memes + Tendencias) — final-1.3.0
   ✅ Mantiene IDs/estructura del HTML (no rompe tu layout)
   ✅ FIX: guardado favoritos (evita crash -> “no se actualiza”)
   ✅ MEMES: solo posts con imagen/vídeo (últimas 24/48/72h)
   ✅ Tarjetas tipo Reddit + votos up/down (localStorage)
   ✅ Feed X: botón “Recargar feed” (re-monta widget)
*/

(() => {
  "use strict";

  const APP_TAG = "globaleye-trends:final-1.3.0";

  // Anti doble carga (SW recarga, scripts duplicados, etc.)
  const prev = window.__GLOBAL_EYE_TRENDS__;
  if (prev?.tag === APP_TAG) return;
  if (typeof prev?.cleanup === "function") { try { prev.cleanup(); } catch {} }
  window.__GLOBAL_EYE_TRENDS__ = { tag: APP_TAG, cleanup: null };

  /* ------------------------------ Config ------------------------------ */
  const CFG = {
    profile: "GlobalEye_TV",
    profileUrlX: "https://x.com/GlobalEye_TV",
    profileUrlTW: "https://twitter.com/GlobalEye_TV",
    twWidgets: "https://platform.twitter.com/widgets.js",

    // Open data (no X API): GDELT doc API
    gdeltBase: "https://api.gdeltproject.org/api/v2/doc/doc",

    // Búsqueda en X (abre en navegador)
    xSearchBase: "https://x.com/search?q=",

    // Reddit (memes)
    redditBase: "https://www.reddit.com",
    redditSubs: {
      mix: ["memes", "dankmemes", "me_irl", "wholesomememes", "funny"],
      memes: ["memes"],
      dankmemes: ["dankmemes"],
      meirl: ["me_irl"],
      wholesome: ["wholesomememes"],
      funny: ["funny"]
    },

    // Proxies para Reddit (si CORS molesta)
    proxies: [
      "https://api.allorigins.win/raw?url=",
      "https://api.codetabs.com/v1/proxy?quest="
    ],

    logoPng: "./logo_ojo_png.png",
    logoJpg: "./logo_ojo.jpg",
    toastGif: "./logo_ojo_gif.gif",

    // Storage keys (mantengo los tuyos)
    LS_SETTINGS: "ge_trends_settings_final_1",
    LS_FAVS: "ge_trends_favs_final_1",
    LS_RANKS: "ge_trends_ranks_final_1",
    LS_COMPACT: "ge_trends_compact_final_1",

    // Nuevo: votos memes
    LS_MEME_VOTES: "ge_meme_votes_final_1",

    FETCH_TIMEOUT_MS: 13500,
    MIN_REFRESH_MS: 35000,
  };

  /* ------------------------------ DOM ------------------------------ */
  const $ = (id) => document.getElementById(id);

  const elList = $("list");
  const elEmpty = $("empty");
  const elErr = $("err");
  const elLast = $("lastUpdated");
  const elNet = $("netStatus");

  const btnRefresh = $("btnRefresh");
  const btnReloadX = $("btnReloadX");
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

  /* ------------------------------ Helpers ------------------------------ */
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const safeLower = (s) => String(s ?? "").toLowerCase();

  function nowLabel(){
    try{ return new Date().toLocaleString(); }catch{ return ""; }
  }

  function setErr(msg){
    if (!elErr) return;
    if (!msg){
      elErr.classList.add("hidden");
      elErr.textContent = "";
      return;
    }
    elErr.textContent = msg;
    elErr.classList.remove("hidden");
  }

  function setEmpty(on){
    if (!elEmpty) return;
    on ? elEmpty.classList.remove("hidden") : elEmpty.classList.add("hidden");
  }

  function setLast(){
    if (elLast) elLast.textContent = nowLabel() || "—";
  }

  function toast(title, msg){
    if (!toastHost) return;
    if (!state.settings.alertsEnabled) return;

    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = `
      <img class="toastImg" src="${CFG.logoPng}" alt="" />
      <div class="toastRow">
        <div class="toastTitle">${escapeHtml(title)}</div>
        <div class="toastMsg">${escapeHtml(msg)}</div>
      </div>
      <button class="toastX" type="button" aria-label="Cerrar">
        <span class="ms" aria-hidden="true">close</span>
      </button>
    `;
    const btn = t.querySelector(".toastX");
    btn?.addEventListener("click", () => t.remove(), { once:true });
    toastHost.appendChild(t);

    setTimeout(() => { try{ t.remove(); }catch{} }, 4500);
  }

  function escapeHtml(str){
    return String(str ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  /* ------------------------------ State ------------------------------ */
  const state = {
    // Settings persistentes
    settings: {
      autoRefresh: true,
      refreshEveryMs: 120_000,
      maxTrends: 35,
      maxArticles: 120,
      alertsEnabled: true,
      tickerEnabled: false,
      tickerSpeedSec: 28,
      memeMaxPosts: 45,
      noThumbs: false,
      lang: "spanish",
      window: "4H",
      geo: "ES",
    },

    // UI state
    view: "memes",     // memes | all | favs
    category: "all",   // all | news | viral | politics | sports
    compact: false,

    // Data
    trends: [],
    filteredTrends: [],
    favs: new Set(),
    ranks: Object.create(null),

    memes: [],
    filteredMemes: [],

    // Meme votes (local)
    memeVotes: Object.create(null), // key -> -1/0/1

    // Runtime
    aborter: null,
    refreshTimer: null,
    _cleanups: []
  };

  window.__GLOBAL_EYE_TRENDS__.cleanup = () => {
    try { state.aborter?.abort?.(); } catch {}
    try { clearInterval(state.refreshTimer); } catch {}
    state._cleanups.forEach(fn => { try{ fn(); }catch{} });
    state._cleanups = [];
  };

  /* ------------------------------ Persistence ------------------------------ */
  function loadSettings(){
    // Settings
    try{
      const raw = localStorage.getItem(CFG.LS_SETTINGS);
      if (raw){
        const obj = JSON.parse(raw);
        if (obj && typeof obj === "object"){
          state.settings.autoRefresh = !!obj.autoRefresh;
          state.settings.refreshEveryMs = clamp(Number(obj.refreshEveryMs ?? state.settings.refreshEveryMs), CFG.MIN_REFRESH_MS, 900_000);
          state.settings.maxTrends = clamp(Number(obj.maxTrends ?? state.settings.maxTrends), 10, 80);
          state.settings.maxArticles = clamp(Number(obj.maxArticles ?? state.settings.maxArticles), 50, 500);
          state.settings.alertsEnabled = (obj.alertsEnabled !== false);
          state.settings.tickerEnabled = !!obj.tickerEnabled;
          state.settings.tickerSpeedSec = clamp(Number(obj.tickerSpeedSec ?? state.settings.tickerSpeedSec), 12, 120);
          state.settings.memeMaxPosts = clamp(Number(obj.memeMaxPosts ?? state.settings.memeMaxPosts), 10, 120);
          state.settings.noThumbs = !!obj.noThumbs;
          state.settings.lang = String(obj.lang ?? state.settings.lang);
          state.settings.window = String(obj.window ?? state.settings.window);
          state.settings.geo = String(obj.geo ?? state.settings.geo);
        }
      }
    }catch{}

    // Compact
    try{
      const c = localStorage.getItem(CFG.LS_COMPACT);
      state.compact = (c === "1");
    }catch{}

    // Favs
    try{
      const rawFav = localStorage.getItem(CFG.LS_FAVS);
      if (rawFav){
        const arr = JSON.parse(rawFav);
        if (Array.isArray(arr)){
          state.favs = new Set(arr.map(String));
        }
      }
    }catch{}

    // Ranks
    try{
      const rawR = localStorage.getItem(CFG.LS_RANKS);
      if (rawR){
        const obj = JSON.parse(rawR);
        if (obj && typeof obj === "object") state.ranks = obj;
      }
    }catch{}

    // Meme votes
    try{
      const rawV = localStorage.getItem(CFG.LS_MEME_VOTES);
      if (rawV){
        const obj = JSON.parse(rawV);
        if (obj && typeof obj === "object"){
          state.memeVotes = obj;
        }
      }
    }catch{}
  }

  function saveSettings(){
    try{
      localStorage.setItem(CFG.LS_SETTINGS, JSON.stringify({
        autoRefresh: state.settings.autoRefresh,
        refreshEveryMs: state.settings.refreshEveryMs,
        maxTrends: state.settings.maxTrends,
        maxArticles: state.settings.maxArticles,
        alertsEnabled: state.settings.alertsEnabled,
        tickerEnabled: state.settings.tickerEnabled,
        tickerSpeedSec: state.settings.tickerSpeedSec,
        memeMaxPosts: state.settings.memeMaxPosts,
        noThumbs: state.settings.noThumbs,
        lang: pickLang(),
        window: pickTimespanUi(),
        geo: pickGeo(),
      }));
    }catch{}
    try{ localStorage.setItem(CFG.LS_COMPACT, state.compact ? "1" : "0"); }catch{}
  }

  function saveFavs(){
    // FIX CRÍTICO: aquí se te puede romper todo si queda mal serializado
    try{
      localStorage.setItem(CFG.LS_FAVS, JSON.stringify([...state.favs]));
    }catch{}
  }

  function saveRanks(){
    try{
      localStorage.setItem(CFG.LS_RANKS, JSON.stringify(state.ranks || {}));
    }catch{}
  }

  function saveMemeVotes(){
    try{
      localStorage.setItem(CFG.LS_MEME_VOTES, JSON.stringify(state.memeVotes || {}));
    }catch{}
  }

  /* ------------------------------ UI sync ------------------------------ */
  function syncUiFromState(){
    // Selects
    if (selLang) selLang.value = pickLang();
    if (selWindow) selWindow.value = pickTimespanUi();
    if (selGeo) selGeo.value = pickGeo();

    if (cfgAuto) cfgAuto.checked = !!state.settings.autoRefresh;
    if (cfgEvery) cfgEvery.value = String(Math.round(state.settings.refreshEveryMs / 1000));
    if (cfgMaxTrends) cfgMaxTrends.value = String(state.settings.maxTrends);
    if (cfgAlerts) cfgAlerts.checked = !!state.settings.alertsEnabled;
    if (cfgTicker) cfgTicker.checked = !!state.settings.tickerEnabled;
    if (cfgTickerSpeed) cfgTickerSpeed.value = String(state.settings.tickerSpeedSec);
    if (cfgMemeMaxPosts) cfgMemeMaxPosts.value = String(state.settings.memeMaxPosts);
    if (cfgNoThumbs) cfgNoThumbs.checked = !!state.settings.noThumbs;

    document.documentElement.style.setProperty("--tickerDur", `${state.settings.tickerSpeedSec}s`);

    document.body.classList.toggle("compact", state.compact);
    btnCompact?.setAttribute("aria-pressed", state.compact ? "true" : "false");

    setTickerVisible(!!state.settings.tickerEnabled);
    btnTicker?.setAttribute("aria-pressed", state.settings.tickerEnabled ? "true" : "false");

    // Filtros visibles según vista
    const memesOn = (state.view === "memes");
    trendFilters?.classList.toggle("hidden", memesOn);
    memeFilters?.classList.toggle("hidden", !memesOn);

    // Categorías solo para tendencias/favs
    tabsCat?.classList.toggle("hidden", memesOn);
  }

  function pickTimespanUi(){
    const v = String(selWindow?.value || state.settings.window || "4H").toUpperCase();
    return (["2H","4H","6H","12H"].includes(v)) ? v : "4H";
  }
  function pickTimespanGdelt(){ return pickTimespanUi().toLowerCase(); }
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

  /* ------------------------------ X Timeline ------------------------------ */
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

  function mountTimeline(force = false){
    if (!timelineMount) return;

    // Re-montar implica limpiar y volver a crear el anchor
    timelineMount.innerHTML = "";

    const a = document.createElement("a");
    a.className = "twitter-timeline";
    a.href = CFG.profileUrlTW;
    a.setAttribute("data-theme", "dark");
    a.setAttribute("data-dnt", "true");
    a.setAttribute("data-chrome", "noheader nofooter");
    a.setAttribute("data-height", "680");
    if (force) a.setAttribute("data-tt", String(Date.now())); // pequeño “bust” para algunos casos
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

    // Fallback si se bloquea (adblock)
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

  /* ------------------------------ GDELT (tendencias) ------------------------------ */
  function buildGdeltQuery(){
    const lang = pickLang();
    const geo = pickGeo();

    let q;
    if (lang === "mixed") q = `(sourcelang:spanish OR sourcelang:english)`;
    else q = `sourcelang:${lang}`;

    // Ajuste: si piden GLOBAL en español, amplío a mixto para mejores resultados
    if (geo === "GLOBAL" && lang === "spanish"){
      q = `(sourcelang:spanish OR sourcelang:english)`;
    }
    return q;
  }

  function buildGdeltUrl(format, cbName){
    const params = new URLSearchParams();
    params.set("format", format);
    params.set("mode", "artlist");
    params.set("sort", "hybridrel");
    params.set("maxrecords", String(clamp(state.settings.maxArticles, 50, 500)));
    params.set("timespan", pickTimespanGdelt());
    params.set("query", buildGdeltQuery());
    if (format === "jsonp") params.set("callback", cbName || "callback");
    return `${CFG.gdeltBase}?${params.toString()}`;
  }

  async function fetchWithTimeout(url, ms, signal){
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const onAbort = () => ctrl.abort();
    try{
      if (signal) signal.addEventListener("abort", onAbort, { once:true });
      return await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    }finally{
      clearTimeout(t);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  function jsonp(url, cbName, timeoutMs){
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const cleanup = () => {
        try { delete window[cbName]; } catch {}
        script.remove();
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("JSONP timeout"));
      }, timeoutMs || 12000);

      window[cbName] = (data) => {
        clearTimeout(timer);
        cleanup();
        resolve(data);
      };

      script.src = url;
      script.async = true;
      script.onerror = () => {
        clearTimeout(timer);
        cleanup();
        reject(new Error("JSONP load error"));
      };
      document.head.appendChild(script);
    });
  }

  async function getGdeltData(signal){
    const url = buildGdeltUrl("json");
    try{
      const r = await fetchWithTimeout(url, CFG.FETCH_TIMEOUT_MS, signal);
      if (!r.ok) throw new Error(`GDELT HTTP ${r.status}`);
      return await r.json();
    }catch{
      // Fallback JSONP (más tolerante si hay bloqueos intermedios)
      const cb = `__gdelt_cb_${Math.random().toString(16).slice(2)}`;
      const u2 = buildGdeltUrl("jsonp", cb);
      return await jsonp(u2, cb, CFG.FETCH_TIMEOUT_MS);
    }
  }

  function classifyTrend(title){
    const t = safeLower(title);
    const has = (...words) => words.some(w => t.includes(w));

    if (has("fútbol","liga","champions","madrid","barcelona","nba","nfl","goal","gol","tenis","ufc","motogp","f1","formula 1")) return "sports";
    if (has("gobierno","presidente","elecciones","congreso","senado","parlamento","pp ","psoe","vox","sumar","trump","biden","putin","ucrania","israel","gaza")) return "politics";
    if (has("viral","meme","tiktok","trend","influencer","streamer","youtube","instagram","x ","twitter","polémica","escándalo")) return "viral";
    return "news";
  }

  function normalizeTrends(data){
    const arts = data?.articles || data?.articles?.results || data?.results || data?.artlist || data?.artlist?.articles || data?.artlist?.articles?.results;
    const arr = Array.isArray(data?.articles) ? data.articles : Array.isArray(arts) ? arts : [];

    // “artlist” de GDELT suele traer data.articles
    const list = Array.isArray(data?.articles) ? data.articles : (Array.isArray(data?.articles?.results) ? data.articles.results : []);
    const src = list.length ? list : arr;

    const out = [];
    for (const a of src){
      const title = String(a?.title || a?.name || "").trim();
      const url = String(a?.url || a?.sourceCountry || a?.shareimage || "").trim();
      const domain = String(a?.domain || "").trim();
      const seen = String(a?.seendate || a?.seenDate || a?.date || "").trim();
      const image = String(a?.socialimage || a?.image || a?.shareimage || "").trim();

      if (!title) continue;

      // Key estable
      const key = `t:${hashStr((url || "") + "|" + title)}`;

      out.push({
        key,
        title,
        url: url && url.startsWith("http") ? url : "",
        domain,
        seen,
        image,
        cat: classifyTrend(title),
      });
    }

    // Ranking simple: frecuencia por title (muy light) + orden original
    // Si no hay suficiente, se queda como viene.
    return out.slice(0, clamp(state.settings.maxTrends, 10, 80));
  }

  /* ------------------------------ Reddit (memes) ------------------------------ */
  function pickMemeSubs(){
    const src = String(selMemeSource?.value || "mix");
    return CFG.redditSubs[src] || CFG.redditSubs.mix;
  }

  function pickMemeRangeHours(){
    const v = Number(selMemeRange?.value || 48);
    return (v === 24 || v === 48 || v === 72) ? v : 48;
  }

  function pickMemeSort(){
    const v = String(selMemeSort?.value || "new");
    return (["new","hot","top","best"].includes(v)) ? v : "new";
  }

  function redditListingSort(sort){
    // "best" es nuestro orden local, pero el fetch lo hago con "top" para tener material decente
    if (sort === "best") return "top";
    return sort;
  }

  function memeKeyFromPost(p){
    // Evito colisiones entre subs
    return `m:${p?.subreddit || "r"}:${p?.id || hashStr(p?.permalink || p?.url || p?.title || "")}`;
  }

  function getLocalVote(key){
    const v = Number(state.memeVotes?.[key] ?? 0);
    return (v === 1 || v === -1) ? v : 0;
  }

  function setLocalVote(key, v){
    const cur = getLocalVote(key);
    const next = (cur === v) ? 0 : v; // toggle
    state.memeVotes[key] = next;
    saveMemeVotes();
  }

  function pickMemeMedia(post){
    // Solo aceptamos media real
    const isVideo = !!post?.is_video;
    const hint = String(post?.post_hint || "");
    const url = String(post?.url || "");
    const perm = String(post?.permalink || "");

    // Preview image (si existe)
    const prevUrl =
      post?.preview?.images?.[0]?.source?.url
        ? String(post.preview.images[0].source.url).replaceAll("&amp;", "&")
        : "";

    // Reddit hosted video
    const rv = post?.media?.reddit_video;
    const fallbackVideo = rv?.fallback_url ? String(rv.fallback_url) : "";

    // Gallery
    const isGallery = !!post?.is_gallery && post?.media_metadata;

    // 1) Vídeo
    if (isVideo && fallbackVideo){
      return { type:"video", url: fallbackVideo, link: CFG.redditBase + perm };
    }

    // 2) Gallery -> primera imagen
    if (isGallery){
      const meta = post.media_metadata;
      const first = meta ? Object.values(meta)[0] : null;
      const u = first?.s?.u ? String(first.s.u).replaceAll("&amp;", "&") : "";
      if (u) return { type:"image", url: u, link: CFG.redditBase + perm };
    }

    // 3) Imagen directa / preview
    if (hint === "image"){
      const u = prevUrl || url;
      if (u && u.startsWith("http")) return { type:"image", url: u, link: CFG.redditBase + perm };
    }

    // 4) Links típicos de imagen
    if (url.match(/\.(png|jpe?g|gif|webp)(\?|$)/i)){
      return { type:"image", url, link: CFG.redditBase + perm };
    }

    // Si no hay media válida, fuera
    return { type:"", url:"", link: CFG.redditBase + perm };
  }

  async function fetchRedditJson(url, signal){
    // 1) Directo
    try{
      const r = await fetchWithTimeout(url, CFG.FETCH_TIMEOUT_MS, signal);
      if (r.ok) return await r.json();
    }catch{}

    // 2) Proxies (CORS)
    for (const p of CFG.proxies){
      try{
        const r = await fetchWithTimeout(p + encodeURIComponent(url), CFG.FETCH_TIMEOUT_MS, signal);
        if (r.ok) return await r.json();
      }catch{}
    }

    throw new Error("No se pudo cargar Reddit (CORS/red)");
  }

  async function loadMemes(signal){
    const subs = pickMemeSubs();
    const sort = pickMemeSort();
    const listing = redditListingSort(sort);

    const rangeHours = pickMemeRangeHours();
    const minUtc = (Date.now()/1000) - (rangeHours * 3600);

    const collected = [];
    const maxWant = clamp(state.settings.memeMaxPosts, 10, 120);

    // Recojo un poco más para poder filtrar por media + rango
    const perSubLimit = clamp(Math.ceil(maxWant / subs.length) * 3, 20, 80);

    for (const sub of subs){
      const u = `${CFG.redditBase}/r/${encodeURIComponent(sub)}/${listing}.json?raw_json=1&limit=${perSubLimit}`;
      const data = await fetchRedditJson(u, signal);

      const children = data?.data?.children || [];
      for (const c of children){
        const p = c?.data;
        if (!p) continue;

        // Rango tiempo
        const created = Number(p.created_utc || 0);
        if (!created || created < minUtc) continue;

        // NSFW fuera
        if (p.over_18) continue;

        // Solo media real
        const media = pickMemeMedia(p);
        if (!media.type || !media.url) continue;

        collected.push({
          id: String(p.id || ""),
          key: memeKeyFromPost(p),
          title: String(p.title || "").trim(),
          subreddit: String(p.subreddit || ""),
          author: String(p.author || ""),
          created_utc: created,
          score: Number(p.score || 0),
          comments: Number(p.num_comments || 0),
          permalink: String(p.permalink || ""),
          link: media.link,
          media
        });

        if (collected.length >= maxWant * 2) break;
      }
      if (collected.length >= maxWant * 2) break;
    }

    // Dedup por key
    const seen = new Set();
    const uniq = [];
    for (const m of collected){
      if (seen.has(m.key)) continue;
      seen.add(m.key);
      uniq.push(m);
    }

    // Orden final
    if (sort === "best"){
      // Prioriza tus upvotes y luego score
      uniq.sort((a,b) => {
        const av = getLocalVote(a.key);
        const bv = getLocalVote(b.key);
        if (bv !== av) return bv - av;
        return (b.score - a.score);
      });
    }else if (sort === "new"){
      uniq.sort((a,b) => b.created_utc - a.created_utc);
    }else if (sort === "top"){
      uniq.sort((a,b) => b.score - a.score);
    }else{
      // hot (mantengo aproximación)
      uniq.sort((a,b) => (b.score*0.8 + b.comments*0.2) - (a.score*0.8 + a.comments*0.2));
    }

    state.memes = uniq.slice(0, maxWant);
  }

  /* ------------------------------ Render ------------------------------ */
  function render(){
    setErr("");

    if (!elList) return;

    if (state.view === "memes"){
      renderMemes();
      return;
    }

    renderTrends();
  }

  function applyTrendFilter(){
    const q = safeLower(inpQ?.value || "");
    const cat = state.category;

    const base = (state.view === "favs")
      ? state.trends.filter(t => state.favs.has(t.key))
      : state.trends.slice();

    const out = [];
    for (const t of base){
      if (cat !== "all" && t.cat !== cat) continue;
      if (q){
        const hay = safeLower(t.title) + " " + safeLower(t.domain);
        if (!hay.includes(q)) continue;
      }
      out.push(t);
    }
    state.filteredTrends = out;
  }

  function renderTrends(){
    applyTrendFilter();

    const arr = state.filteredTrends;
    elList.innerHTML = "";

    if (!arr.length){
      setEmpty(true);
      return;
    }
    setEmpty(false);

    let i = 0;
    for (const t of arr){
      i++;
      const div = document.createElement("div");
      div.className = "trend";

      const starOn = state.favs.has(t.key);

      div.innerHTML = `
        <div class="tRank">${i}</div>
        <div class="tBody">
          <div class="tTitle">${escapeHtml(t.title)}</div>
          <div class="tMeta">
            <span class="tagPill"><span class="ms sm" aria-hidden="true">category</span> ${escapeHtml(t.cat)}</span>
            ${t.domain ? `<span class="tagPill"><span class="ms sm" aria-hidden="true">public</span> ${escapeHtml(t.domain)}</span>` : ""}
            ${t.seen ? `<span class="tagPill"><span class="ms sm" aria-hidden="true">schedule</span> ${escapeHtml(t.seen)}</span>` : ""}
          </div>
          <div class="tBtns" style="margin-top:10px">
            ${t.url ? `<a class="aBtn" href="${t.url}" target="_blank" rel="noreferrer"><span class="ms" aria-hidden="true">open_in_new</span> Abrir</a>` : ""}
            <a class="aBtn" href="${CFG.xSearchBase}${encodeURIComponent(t.title)}" target="_blank" rel="noreferrer">
              <span class="ms" aria-hidden="true">search</span> Buscar en X
            </a>
            <button class="aBtn star ${starOn ? "on" : ""}" type="button" data-act="fav" data-key="${escapeHtml(t.key)}" aria-label="Favorito">
              <span class="ms ${starOn ? "fill" : ""}" aria-hidden="true">star</span>
              ${starOn ? "Guardado" : "Guardar"}
            </button>
          </div>
        </div>
      `;

      elList.appendChild(div);
    }
  }

  function applyMemeFilter(){
    const q = safeLower(inpQ?.value || "");
    const out = [];

    for (const m of state.memes){
      if (q){
        const hay = safeLower(m.title) + " " + safeLower(m.subreddit) + " " + safeLower(m.author);
        if (!hay.includes(q)) continue;
      }
      // Extra seguridad: solo media
      if (!m.media?.type || !m.media?.url) continue;
      out.push(m);
    }

    state.filteredMemes = out;
  }

  function fmtAgo(utcSec){
    const s = Math.max(0, Math.floor(Date.now()/1000 - (utcSec || 0)));
    const m = Math.floor(s/60);
    const h = Math.floor(m/60);
    const d = Math.floor(h/24);
    if (d > 0) return `${d}d`;
    if (h > 0) return `${h}h`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
  }

  function renderMemes(){
    applyMemeFilter();

    const arr = state.filteredMemes;
    elList.innerHTML = "";

    if (!arr.length){
      setEmpty(true);
      return;
    }
    setEmpty(false);

    for (const m of arr){
      const vote = getLocalVote(m.key);
      const div = document.createElement("div");
      div.className = "memeCard";

      const mediaHtml = state.settings.noThumbs
        ? ""
        : (m.media.type === "video"
            ? `<div class="memeMedia"><video controls preload="metadata" src="${escapeHtml(m.media.url)}"></video></div>`
            : `<div class="memeMedia"><img loading="lazy" decoding="async" src="${escapeHtml(m.media.url)}" alt="" /></div>`
          );

      div.innerHTML = `
        <div class="memeVote" aria-label="Votos">
          <button class="voteBtn ${vote === 1 ? "on up" : ""}" type="button" data-act="vote" data-v="1" data-key="${escapeHtml(m.key)}" aria-label="Upvote">
            <span class="ms" aria-hidden="true">keyboard_arrow_up</span>
          </button>
          <div class="voteScore" title="Tu voto se guarda localmente">${escapeHtml(String(m.score))}</div>
          <button class="voteBtn ${vote === -1 ? "on down" : ""}" type="button" data-act="vote" data-v="-1" data-key="${escapeHtml(m.key)}" aria-label="Downvote">
            <span class="ms" aria-hidden="true">keyboard_arrow_down</span>
          </button>
        </div>

        <div class="memeMain">
          <div class="memeHead">
            <div class="memeMeta">
              <div class="memeSub">r/${escapeHtml(m.subreddit)}</div>
              <div class="memeBy">u/${escapeHtml(m.author)} • ${fmtAgo(m.created_utc)} • ${escapeHtml(String(m.comments))} com.</div>
            </div>
            <div class="tagPill" title="Solo memes con media">
              <span class="ms sm" aria-hidden="true">${m.media.type === "video" ? "smart_display" : "image"}</span>
              ${m.media.type === "video" ? "Vídeo" : "Imagen"}
            </div>
          </div>

          <div class="memeTitle">${escapeHtml(m.title)}</div>

          ${mediaHtml}

          <div class="memeFoot">
            <div class="memeStats">
              <span class="tagPill"><span class="ms sm" aria-hidden="true">thumb_up</span> Score: ${escapeHtml(String(m.score))}</span>
              <span class="tagPill"><span class="ms sm" aria-hidden="true">chat_bubble</span> ${escapeHtml(String(m.comments))}</span>
            </div>

            <div class="memeBtns">
              <a class="aBtn" href="${escapeHtml(m.link)}" target="_blank" rel="noreferrer">
                <span class="ms" aria-hidden="true">open_in_new</span> Abrir
              </a>
              <button class="aBtn" type="button" data-act="copy" data-url="${escapeHtml(m.link)}">
                <span class="ms" aria-hidden="true">content_copy</span> Copiar link
              </button>
            </div>
          </div>
        </div>
      `;

      elList.appendChild(div);
    }
  }

  /* ------------------------------ Actions ------------------------------ */
  function onListClick(e){
    const t = e.target?.closest?.("[data-act]");
    if (!t) return;

    const act = t.getAttribute("data-act");

    if (act === "fav"){
      const key = t.getAttribute("data-key") || "";
      if (!key) return;

      if (state.favs.has(key)) state.favs.delete(key);
      else state.favs.add(key);

      saveFavs();
      toast("Favoritos", state.favs.has(key) ? "Guardado" : "Quitado");

      // Re-render
      render();
      return;
    }

    if (act === "vote"){
      const key = t.getAttribute("data-key") || "";
      const v = Number(t.getAttribute("data-v") || "0");
      if (!key || (v !== 1 && v !== -1)) return;

      setLocalVote(key, v);

      // Si el orden es “best”, re-ordeno al vuelo
      if (state.view === "memes" && pickMemeSort() === "best"){
        state.memes.sort((a,b) => {
          const av = getLocalVote(a.key);
          const bv = getLocalVote(b.key);
          if (bv !== av) return bv - av;
          return (b.score - a.score);
        });
      }

      render();
      return;
    }

    if (act === "copy"){
      const url = t.getAttribute("data-url") || "";
      if (!url) return;
      navigator.clipboard?.writeText?.(url).then(
        () => toast("Copiado", "Link copiado al portapapeles"),
        () => toast("Copiado", "No se pudo copiar (permiso/navegador)")
      );
      return;
    }
  }

  function bindUI(){
    // Clicks en lista (delegación)
    if (elList){
      elList.addEventListener("click", onListClick);
      state._cleanups.push(() => elList.removeEventListener("click", onListClick));
    }

    btnRefresh?.addEventListener("click", () => refreshNow(true));
    btnReloadX?.addEventListener("click", () => mountTimeline(true));
    btnCompact?.addEventListener("click", toggleCompact);

    btnTicker?.addEventListener("click", () => {
      state.settings.tickerEnabled = !state.settings.tickerEnabled;
      btnTicker.setAttribute("aria-pressed", state.settings.tickerEnabled ? "true" : "false");
      setTickerVisible(state.settings.tickerEnabled);
      saveSettings();
    });

    tickerClose?.addEventListener("click", () => {
      state.settings.tickerEnabled = false;
      btnTicker?.setAttribute("aria-pressed", "false");
      setTickerVisible(false);
      saveSettings();
    });

    btnConfig?.addEventListener("click", openConfig);
    cfgClose?.addEventListener("click", closeConfig);

    cfgSave?.addEventListener("click", () => {
      state.settings.autoRefresh = !!cfgAuto?.checked;

      const sec = clamp(Number(cfgEvery?.value || 120), 35, 900);
      state.settings.refreshEveryMs = sec * 1000;

      state.settings.maxTrends = clamp(Number(cfgMaxTrends?.value || 35), 10, 80);
      state.settings.alertsEnabled = !!cfgAlerts?.checked;
      state.settings.tickerEnabled = !!cfgTicker?.checked;
      state.settings.tickerSpeedSec = clamp(Number(cfgTickerSpeed?.value || 28), 12, 120);
      state.settings.memeMaxPosts = clamp(Number(cfgMemeMaxPosts?.value || 45), 10, 120);
      state.settings.noThumbs = !!cfgNoThumbs?.checked;

      saveSettings();
      syncUiFromState();
      closeConfig();

      // Reaplico/recargo
      refreshNow(true);
      toast("Config", "Guardado");
    });

    // Inputs que refrescan
    inpQ?.addEventListener("input", () => render());

    selLang?.addEventListener("change", () => { saveSettings(); refreshNow(true); });
    selWindow?.addEventListener("change", () => { saveSettings(); refreshNow(true); });
    selGeo?.addEventListener("change", () => { saveSettings(); refreshNow(true); });

    selMemeSource?.addEventListener("change", () => refreshNow(true));
    selMemeSort?.addEventListener("change", () => refreshNow(true));
    selMemeRange?.addEventListener("change", () => refreshNow(true));

    // Tabs view
    tabsView?.addEventListener("click", (e) => {
      const b = e.target?.closest?.(".tab");
      if (!b) return;
      const v = b.getAttribute("data-view");
      if (!v) return;
      state.view = v;
      setActiveTab(tabsView, "data-view", v);
      syncUiFromState();
      render();
      // Si cambia a tendencias/favs, aseguro que haya datos
      if ((v === "all" || v === "favs") && !state.trends.length) refreshNow(true);
      if (v === "memes" && !state.memes.length) refreshNow(true);
    });

    // Tabs category
    tabsCat?.addEventListener("click", (e) => {
      const b = e.target?.closest?.(".tab");
      if (!b) return;
      const c = b.getAttribute("data-cat");
      if (!c) return;
      state.category = c;
      setActiveTab(tabsCat, "data-cat", c);
      render();
    });

    // Net status
    const onNet = () => {
      const on = navigator.onLine !== false;
      if (elNet) elNet.textContent = on ? "Online" : "Offline";
    };
    window.addEventListener("online", onNet);
    window.addEventListener("offline", onNet);
    state._cleanups.push(() => {
      window.removeEventListener("online", onNet);
      window.removeEventListener("offline", onNet);
    });
    onNet();
  }

  /* ------------------------------ Refresh logic ------------------------------ */
  function startAutoRefresh(){
    try{ clearInterval(state.refreshTimer); }catch{}
    if (!state.settings.autoRefresh) return;

    state.refreshTimer = setInterval(() => {
      refreshNow(false);
    }, clamp(state.settings.refreshEveryMs, CFG.MIN_REFRESH_MS, 900_000));
  }

  function buildTickerFromTrends(){
    if (!tickerTrack) return;
    const arr = state.trends.slice(0, 18);
    if (!arr.length){
      tickerTrack.innerHTML = "";
      return;
    }

    // Duplico para bucle infinito suave
    const items = arr.concat(arr);
    tickerTrack.innerHTML = items.map(t => `
      <span class="tickerItem">
        <span class="ms sm" aria-hidden="true">trending_up</span>
        ${escapeHtml(t.title)}
      </span>
    `).join("");
  }

  async function refreshNow(userTriggered){
    try{
      state.aborter?.abort?.();
    }catch{}
    state.aborter = new AbortController();
    const { signal } = state.aborter;

    if (userTriggered) toast("Actualizando", "Cargando datos…");

    try{
      // Memes
      if (state.view === "memes"){
        await loadMemes(signal);
      }

      // Tendencias (las cargo siempre en background para ticker/favs)
      const gd = await getGdeltData(signal);
      state.trends = normalizeTrends(gd);

      buildTickerFromTrends();
      setLast();

      // Render
      render();

    }catch(err){
      if (String(err?.name || "") === "AbortError") return;
      setErr(`Error: ${String(err?.message || err)}`);
      if (userTriggered) toast("Error", "No se pudo actualizar");
    }
  }

  /* ------------------------------ Hash ------------------------------ */
  function hashStr(s){
    // Hash simple (estable) para keys
    s = String(s ?? "");
    let h = 2166136261;
    for (let i=0; i<s.length; i++){
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  /* ------------------------------ Init ------------------------------ */
  function init(){
    loadSettings();
    bindUI();
    syncUiFromState();

    // Tabs default
    setActiveTab(tabsView, "data-view", state.view);
    setActiveTab(tabsCat, "data-cat", state.category);

    // Timeline
    mountTimeline(false);

    // Primera carga
    refreshNow(false);

    // Auto-refresh
    startAutoRefresh();
  }

  init();

})();
