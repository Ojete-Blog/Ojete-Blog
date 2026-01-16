/* app.js — GlobalEye Trends — v1.4.1
   ✅ Feed embebido estable (widget oficial) — sin API de X
   ✅ Tendencias desde GDELT (open data) + fallback JSONP si falla fetch/CORS
   ✅ Evita “app muerta” por regex unicode (\p{L}) — ahora compatible
   ✅ Favoritos + tabs + ticker + config + auto-update SW
*/

(() => {
  "use strict";

  const APP_TAG = "globaleye-trends:v1.4.1";
  try {
    if (window.__GLOBAL_EYE_TRENDS__?.tag === APP_TAG) return;
    window.__GLOBAL_EYE_TRENDS__ = { tag: APP_TAG, startedAt: Date.now() };
  } catch {}

  /* ───────────────────────────── CONFIG ───────────────────────────── */
  const CFG = {
    profile: "GlobalEye_TV",
    profileUrlX: "https://x.com/GlobalEye_TV",
    profileUrlTW: "https://twitter.com/GlobalEye_TV", // widgets suele ir más fino con twitter.com

    gdeltBase: "https://api.gdeltproject.org/api/v2/doc/doc",
    xSearchBase: "https://x.com/search?q=",

    logoPng: "./logo_ojo_png.png",
    logoJpg: "./logo_ojo.jpg",
    toastGif: "./logo_ojo_gif.gif",

    LS_SETTINGS: "ge_trends_settings_v5",
    LS_FAVS: "ge_trends_favs_v5",
    LS_RANKS: "ge_trends_ranks_v5",
    LS_COMPACT: "ge_trends_compact_v5",

    FETCH_TIMEOUT_MS: 13500,
    MIN_REFRESH_MS: 35000,

    SW_URL: "./sw.js",
    SW_UPDATE_EVERY_MS: 8 * 60_000,
    SS_SW_RELOADED: "ge_sw_reloaded_once_v3",

    TW_WIDGETS: "https://platform.twitter.com/widgets.js"
  };

  /* ───────────────────────────── DOM ───────────────────────────── */
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

  const inpQ = $("q");
  const selLang = $("selLang");
  const selWindow = $("selWindow");
  const selGeo = $("selGeo");

  const tabsView = $("tabsView");
  const tabsCat = $("tabsCat");

  const timelineMount = $("timelineMount");
  const toastHost = $("toastHost");

  /* ───────────────────────────── STATE ───────────────────────────── */
  const DEFAULT_SETTINGS = {
    lang: "spanish",        // spanish | english | mixed
    window: "4H",           // 2H | 4H | 6H | 12H
    geo: "ES",              // ES | GLOBAL
    maxTrends: 35,
    autoRefresh: true,
    refreshEveryMs: 120_000,
    alertsEnabled: true,
    tickerEnabled: false,
    tickerSpeedSec: 28
  };

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    view: "all",       // all | favs
    category: "all",   // all|news|viral|politics|sports
    trends: [],
    filtered: [],
    favs: new Set(),
    ranks: Object.create(null),
    compact: false,

    aborter: null,
    refreshTimer: null,
    swReg: null,
    swTick: null
  };

  /* ───────────────────────────── UTIL ───────────────────────────── */
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const nowISO = () => new Date().toLocaleString();

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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
      el.style.transform = "translateY(10px)";
      setTimeout(() => el.remove(), 170);
    };
    el.querySelector(".toastX")?.addEventListener("click", kill, { once: true });
    toastHost.appendChild(el);
    setTimeout(kill, 3600);
  }

  /* ───────────────────────────── LOGO PNG AUTO ───────────────────────────── */
  function applyPngLogoIfAvailable() {
    const img = new Image();
    img.onload = () => {
      document.querySelectorAll("img.heroLogo, img.logoImg, img.tickerLogo")
        .forEach(el => { el.src = CFG.logoPng; el.style.objectFit = "contain"; });
      document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')
        .forEach(l => { try { l.href = CFG.logoPng; } catch {} });
    };
    img.onerror = () => {
      document.querySelectorAll("img.heroLogo, img.logoImg, img.tickerLogo")
        .forEach(el => { el.src = CFG.logoJpg; });
    };
    img.src = CFG.logoPng;
  }

  /* ───────────────────────────── SETTINGS ───────────────────────────── */
  function loadSettings() {
    try {
      const raw = localStorage.getItem(CFG.LS_SETTINGS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") state.settings = { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch {}

    try {
      const rawFav = localStorage.getItem(CFG.LS_FAVS);
      if (rawFav) {
        const arr = JSON.parse(rawFav);
        if (Array.isArray(arr)) state.favs = new Set(arr);
      }
    } catch {}

    try {
      const rawRanks = localStorage.getItem(CFG.LS_RANKS);
      if (rawRanks) {
        const parsed = JSON.parse(rawRanks);
        if (parsed && typeof parsed === "object") state.ranks = parsed;
      }
    } catch {}

    try {
      state.compact = localStorage.getItem(CFG.LS_COMPACT) === "1";
    } catch {}
  }

  function saveSettings() {
    try { localStorage.setItem(CFG.LS_SETTINGS, JSON.stringify(state.settings)); } catch {}
    try { localStorage.setItem(CFG.LS_FAVS, JSON.stringify([...state.favs])); } catch {}
    try { localStorage.setItem(CFG.LS_RANKS, JSON.stringify(state.ranks)); } catch {}
    try { localStorage.setItem(CFG.LS_COMPACT, state.compact ? "1" : "0"); } catch {}
  }

  function applySettingsToUI() {
    if (selLang) selLang.value = state.settings.lang;
    if (selWindow) selWindow.value = state.settings.window;
    if (selGeo) selGeo.value = state.settings.geo;

    if (cfgAuto) cfgAuto.checked = !!state.settings.autoRefresh;
    if (cfgEvery) cfgEvery.value = String(Math.round(state.settings.refreshEveryMs / 1000));
    if (cfgMaxTrends) cfgMaxTrends.value = String(state.settings.maxTrends);
    if (cfgAlerts) cfgAlerts.checked = !!state.settings.alertsEnabled;
    if (cfgTicker) cfgTicker.checked = !!state.settings.tickerEnabled;
    if (cfgTickerSpeed) cfgTickerSpeed.value = String(state.settings.tickerSpeedSec);

    document.documentElement.style.setProperty("--tickerDur", `${clamp(state.settings.tickerSpeedSec, 12, 120)}s`);

    document.body.classList.toggle("compact", state.compact);
    btnCompact?.setAttribute("aria-pressed", state.compact ? "true" : "false");

    setTickerVisible(!!state.settings.tickerEnabled);
    if (btnTicker) btnTicker.setAttribute("aria-pressed", state.settings.tickerEnabled ? "true" : "false");
  }

  /* ───────────────────────────── UI HELPERS ───────────────────────────── */
  function pickTimespanUi() {
    const v = String(selWindow?.value || state.settings.window || "4H").toUpperCase();
    return (["2H","4H","6H","12H"].includes(v)) ? v : "4H";
  }
  function pickTimespanGdelt() { return pickTimespanUi().toLowerCase(); } // "4h"
  function pickLang() {
    const v = String(selLang?.value || state.settings.lang || "spanish").toLowerCase();
    if (v === "mixed") return "mixed";
    if (v === "english") return "english";
    return "spanish";
  }
  function pickGeo() {
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

  /* ───────────────────────────── FEED (WIDGET OFICIAL) ───────────────────────────── */
  function ensureWidgetsScript(){
    // Si ya lo cargó index.html, esto no hace nada.
    try{
      if (window.twttr?.widgets) return true;
      if (document.querySelector(`script[src="${CFG.TW_WIDGETS}"]`)) return true;
      const s = document.createElement("script");
      s.async = true;
      s.src = CFG.TW_WIDGETS;
      s.charset = "utf-8";
      document.head.appendChild(s);
      return true;
    }catch{
      return false;
    }
  }

  function mountTimeline(){
    if (!timelineMount) return;

    // Limpia y vuelve a montar (por si hay recargas parciales)
    timelineMount.innerHTML = "";

    const a = document.createElement("a");
    a.className = "twitter-timeline";
    a.href = CFG.profileUrlTW;
    a.setAttribute("data-theme", "dark");
    a.setAttribute("data-chrome", "noheader nofooter transparent");
    a.setAttribute("data-dnt", "true");
    a.setAttribute("data-tweet-limit", "8");
    a.textContent = `Tweets by @${CFG.profile}`;
    timelineMount.appendChild(a);

    const ok = ensureWidgetsScript();

    const tryLoad = async () => {
      try{
        if (window.twttr?.widgets?.load) window.twttr.widgets.load(timelineMount);
      }catch{}
    };

    if (ok){
      tryLoad();
      setTimeout(tryLoad, 1200);
    }

    // fallback si a los 9s no hay iframe (bloqueos de privacidad/adblock)
    setTimeout(() => {
      const hasIframe = !!timelineMount.querySelector("iframe");
      if (hasIframe) return;

      if (document.getElementById("tl_fallback_hint")) return;

      const div = document.createElement("div");
      div.id = "tl_fallback_hint";
      div.className = "timelineFallback";
      div.innerHTML = `
        <div class="tlTitle">Timeline no cargó</div>
        <div class="tlText">Algunos navegadores / adblock bloquean el widget. Abre el perfil directamente:</div>
        <a class="tlBtn" href="${CFG.profileUrlX}" target="_blank" rel="noreferrer">
          Abrir @${CFG.profile}
        </a>
      `;
      timelineMount.appendChild(div);
    }, 9000);
  }

  /* ───────────────────────────── GDELT: URL + FETCH + JSONP FALLBACK ───────────────────────────── */
  function buildGdeltQuery(){
    const lang = pickLang();
    const geo = pickGeo();

    let q;
    if (lang === "mixed") q = `(sourcelang:spanish OR sourcelang:english)`;
    else q = `sourcelang:${lang}`;

    // Global abre señal un poco
    if (geo === "GLOBAL" && lang === "spanish"){
      q = `(sourcelang:spanish OR sourcelang:english)`;
    }

    // Nota: aquí podrías añadir filtros por país/fuente si quieres afinar más.
    return q;
  }

  function buildGdeltUrl(format /* json | jsonp */, cbName){
    const params = new URLSearchParams();
    params.set("format", format);
    params.set("mode", "artlist");
    params.set("sort", "hybridrel");
    params.set("maxrecords", String(250));               // artículos a analizar
    params.set("timespan", pickTimespanGdelt());         // "4h"
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
    // 1) Intento normal (JSON)
    try{
      const url = buildGdeltUrl("json");
      const res = await fetchWithTimeout(url, CFG.FETCH_TIMEOUT_MS, signal);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    }catch(e){
      // 2) Fallback JSONP (evita CORS)
      const cb = `__gdelt_cb_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const url = buildGdeltUrl("jsonp", cb);
      return await jsonp(url, cb, CFG.FETCH_TIMEOUT_MS);
    }
  }

  /* ───────────────────────────── EXTRACCIÓN DE “TENDENCIAS” ───────────────────────────── */
  function splitWords(title){
    const raw = String(title || "")
      .replace(/[–—]/g, " ")
      .replace(/[(){}\[\]:"“”'’]/g, " ")
      .replace(/[!?,.;]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!raw) return [];

    const parts = raw.split(" ");
    return parts.map(w => {
      const clean = w.replace(/^[^#@A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+|[^#@A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+$/g, "");
      const norm = normalizeToken(clean);
      const isHash = norm.startsWith("#");
      const isAt = norm.startsWith("@");
      const base = norm.replace(/^[@#]/, "");
      const cap = /^[A-ZÁÉÍÓÚÜÑ]/.test(clean) && !isHash && !isAt;
      return { raw: clean, norm, base, cap, isHash, isAt };
    }).filter(x => x.norm);
  }

  function normalizeToken(t){
    // Sin \p{L} para evitar “SyntaxError” en algunos navegadores/entornos
    return String(t || "")
      .replace(/[’']/g, "")
      .replace(/[^A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ#@]+/g, "")
      .trim()
      .toLowerCase();
  }

  const STOP_ES = new Set([
    "de","del","la","las","el","los","y","o","a","en","un","una","unos","unas",
    "con","sin","por","para","sobre","tras","ante","entre","hoy","ayer","mañana",
    "al","se","su","sus","que","como","más","menos","muy","ya","no","sí","lo",
    "es","son","fue","ser","era","han","ha","hay","este","esta","estos","estas"
  ]);
  const STOP_EN = new Set([
    "the","a","an","and","or","to","in","on","for","with","without","of","at","by",
    "today","yesterday","tomorrow","is","are","was","were","be","been","it","this","that"
  ]);

  function isStop(token){
    if (!token) return true;
    const base = String(token).replace(/^[@#]/, "");
    if (!base || base.length <= 2) return true;

    const lang = pickLang();
    if (lang === "english") return STOP_EN.has(base);
    if (lang === "spanish") return STOP_ES.has(base);
    return STOP_ES.has(base) || STOP_EN.has(base);
  }

  function categoryOf(label){
    const t = label.toLowerCase();
    const has = (arr) => arr.some(k => t.includes(k));

    if (has(["liga","champions","madrid","barça","barcelona","fútbol","nba","nfl","mlb","tenis","gol","derbi"])) return "sports";
    if (has(["elecciones","gobierno","presidente","congreso","senado","pp","psoe","vox","sumar","ue","otan","rusia","ucrania","israel","gaza"])) return "politics";
    if (has(["viral","meme","tiktok","streamer","influencer","trend","trending","gameplay","clip"])) return "viral";
    return "news";
  }

  function extractCandidatesFromArticles(articles){
    const counts = new Map();

    const bump = (key, sampleTitle) => {
      if (!key || isStop(key)) return;
      const prev = counts.get(key);
      if (!prev) counts.set(key, { key, n: 1, sampleTitle });
      else { prev.n++; }
    };

    for (const a of articles){
      const title = a?.title || a?.title_translated || a?.seendate || "";
      const words = splitWords(title);

      // 1) hashtags / @mentions directos
      for (const w of words){
        if (w.isHash || w.isAt) bump(w.norm, title);
      }

      // 2) “frases” por mayúsculas (2-4 tokens seguidos capitalizados)
      const caps = [];
      for (const w of words){
        if (w.cap && w.base && w.base.length > 2) caps.push(w.raw);
        else caps.push("|");
      }
      const capStr = caps.join(" ");
      const chunks = capStr.split("|").map(x => x.trim()).filter(Boolean);
      for (const ch of chunks){
        const toks = ch.split(/\s+/).filter(Boolean);
        // toma subfrases de longitud 2-4
        for (let len = 2; len <= 4; len++){
          for (let i = 0; i + len <= toks.length; i++){
            const phrase = toks.slice(i, i+len).join(" ");
            const key = normalizeToken(phrase).replace(/[#@]/g,""); // frase “normal”
            if (key.length >= 4) bump(key, title);
          }
        }
      }

      // 3) bigramas/trigramas básicos (sin stopwords duras)
      const cleanBases = words
        .filter(w => !w.isHash && !w.isAt)
        .map(w => w.base)
        .filter(b => b && !isStop(b));

      for (let i = 0; i < cleanBases.length; i++){
        const bi = (i+1 < cleanBases.length) ? `${cleanBases[i]} ${cleanBases[i+1]}` : null;
        const tri = (i+2 < cleanBases.length) ? `${cleanBases[i]} ${cleanBases[i+1]} ${cleanBases[i+2]}` : null;
        if (bi && bi.length >= 6) bump(normalizeToken(bi), title);
        if (tri && tri.length >= 10) bump(normalizeToken(tri), title);
      }
    }

    // convierte a lista ordenada
    const list = [...counts.values()]
      .sort((a,b) => b.n - a.n)
      .slice(0, clamp(state.settings.maxTrends, 10, 80))
      .map((x, idx) => ({
        id: x.key,
        label: prettifyLabel(x.key),
        score: x.n,
        rank: idx + 1,
        cat: categoryOf(x.key),
        sampleTitle: x.sampleTitle || ""
      }));

    return list;
  }

  function prettifyLabel(key){
    // intenta reconstruir algo “bonito” a partir del token normalizado
    const s = String(key || "").trim();
    if (!s) return s;
    if (s.startsWith("#") || s.startsWith("@")) return s;

    // si viene como palabras, capitaliza primera letra de cada palabra
    const parts = s.split(/\s+/).filter(Boolean);
    return parts.map(p => p.length <= 3 ? p.toUpperCase() : (p[0].toUpperCase() + p.slice(1))).join(" ");
  }

  /* ───────────────────────────── RENDER ───────────────────────────── */
  function setTickerVisible(on){
    if (!tickerBar) return;
    tickerBar.classList.toggle("hidden", !on);
  }

  function buildXSearchUrl(label){
    const q = encodeURIComponent(label.startsWith("#") || label.startsWith("@") ? label : `"${label}"`);
    return `${CFG.xSearchBase}${q}&f=top`;
  }

  function render(){
    if (!elList) return;

    elList.innerHTML = "";

    const arr = state.filtered;
    setEmpty(arr.length === 0);

    for (const t of arr){
      const isFav = state.favs.has(t.id);
      const el = document.createElement("div");
      el.className = "trend";

      el.innerHTML = `
        <div class="rank">${t.rank}</div>
        <div class="tBody">
          <div class="tTop">
            <div class="tLabel" title="${escapeHtml(t.sampleTitle)}">${escapeHtml(t.label)}</div>
            <div class="tBadges">
              <span class="cat">${escapeHtml(t.cat)}</span>
              <span class="delta">${t.score}</span>
            </div>
          </div>
          <div class="tMeta">
            <span>${escapeHtml(t.sampleTitle || "—")}</span>
          </div>
        </div>
        <div class="actions">
          <a class="aBtn primary" href="${buildXSearchUrl(t.label)}" target="_blank" rel="noreferrer">Ver</a>
          <button class="aBtn" type="button" data-copy="${escapeHtml(t.label)}">Copiar</button>
          <button class="aBtn favBtn ${isFav ? "isFav" : ""}" type="button" data-fav="${escapeHtml(t.id)}" aria-label="Favorito">
            ${isFav ? "★" : "☆"}
          </button>
        </div>
      `;

      elList.appendChild(el);
    }

    // acciones
    elList.querySelectorAll("button[data-copy]").forEach(b => {
      b.addEventListener("click", async () => {
        const v = b.getAttribute("data-copy") || "";
        try { await navigator.clipboard.writeText(v); toast("Copiado", v); }
        catch { toast("Copiar", "No se pudo copiar (permiso)."); }
      });
    });

    elList.querySelectorAll("button[data-fav]").forEach(b => {
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-fav");
        if (!id) return;
        if (state.favs.has(id)) state.favs.delete(id);
        else state.favs.add(id);
        saveSettings();
        applyFilter();
      });
    });
  }

  function applyFilter(){
    const q = String(inpQ?.value || "").trim().toLowerCase();
    const view = state.view;
    const cat = state.category;

    let arr = state.trends.slice();

    if (view === "favs"){
      arr = arr.filter(x => state.favs.has(x.id));
    }

    if (cat !== "all"){
      arr = arr.filter(x => x.cat === cat);
    }

    if (q){
      arr = arr.filter(x =>
        x.label.toLowerCase().includes(q) ||
        String(x.sampleTitle || "").toLowerCase().includes(q)
      );
    }

    // re-rank visible list
    arr = arr.map((x, i) => ({ ...x, rank: i+1 }));
    state.filtered = arr;

    render();
    rebuildTickerFromTrends();
  }

  function rebuildTickerFromTrends(){
    if (!tickerTrack) return;
    tickerTrack.innerHTML = "";

    const items = state.trends.slice(0, 25).map(t => t.label);
    if (!items.length) return;

    const frag = document.createDocumentFragment();

    const addRun = () => {
      for (let i = 0; i < items.length; i++){
        const s = document.createElement("span");
        s.className = "tickerItem";
        s.innerHTML = `<span>${escapeHtml(items[i])}</span><span class="tickerSep">•</span>`;
        frag.appendChild(s);
      }
    };

    // duplica para que el loop sea continuo
    addRun();
    addRun();

    tickerTrack.appendChild(frag);
  }

  /* ───────────────────────────── ALERTAS SUAVES ───────────────────────────── */
  function diffTop(oldRanks, newTrends){
    const oldTop = new Set(Object.keys(oldRanks || {}).slice(0, 5));
    const newTop = new Set(newTrends.slice(0, 5).map(t => t.id));
    const added = [];
    for (const id of newTop){
      if (!oldTop.has(id)) added.push(id);
    }
    return added;
  }

  function updateRanks(trends){
    const next = {};
    for (const t of trends.slice(0, 50)){
      next[t.id] = t.rank;
    }
    state.ranks = next;
    saveSettings();
  }

  /* ───────────────────────────── REFRESH ───────────────────────────── */
  async function refresh(){
    setErr("");
    setEmpty(false);

    if (state.aborter) state.aborter.abort();
    state.aborter = new AbortController();

    try{
      if (elLast) elLast.textContent = "Cargando…";

      const data = await getGdeltData(state.aborter.signal);
      const articles = Array.isArray(data?.articles) ? data.articles : [];

      if (!articles.length){
        state.trends = [];
        applyFilter();
        setErr("No llegaron artículos desde GDELT en esta ventana. Prueba a cambiar a 12h o a ‘Mixto’.");
        if (elLast) elLast.textContent = `Actualizado: ${nowISO()}`;
        return;
      }

      const trends = extractCandidatesFromArticles(articles);

      // alertas por cambio en top
      if (state.settings.alertsEnabled){
        const added = diffTop(state.ranks, trends);
        if (added.length){
          toast("Tendencias nuevas", `Entraron en TOP: ${prettifyLabel(added[0])}${added[1] ? " +" : ""}`);
        }
      }

      state.trends = trends;
      updateRanks(trends);

      applyFilter();

      if (elLast) elLast.textContent = `Actualizado: ${nowISO()} · artículos: ${articles.length}`;
    }catch(e){
      setErr(`Error cargando tendencias: ${String(e?.message || e)}`);
      if (elLast) elLast.textContent = `Error: ${nowISO()}`;
    }
  }

  function schedule(){
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    if (!state.settings.autoRefresh) return;

    const ms = clamp(state.settings.refreshEveryMs, CFG.MIN_REFRESH_MS, 900_000);
    state.refreshTimer = setInterval(refresh, ms);
  }

  /* ───────────────────────────── SW AUTO UPDATE ───────────────────────────── */
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
      const w = reg?.waiting;
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

      if (reg.waiting) await swSkipWaiting(reg);

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
        try{ if (reg.waiting) await swSkipWaiting(reg); }catch{}
      };

      if (state.swTick) clearInterval(state.swTick);
      state.swTick = setInterval(tick, CFG.SW_UPDATE_EVERY_MS);

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") tick();
      }, { passive:true });

      tick();
    }catch{
      // si falla SW, la app sigue
    }
  }

  /* ───────────────────────────── BIND ───────────────────────────── */
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
      state.category = btn.getAttribute("data-cat") || "all";
      setActiveTab(tabsCat, "data-cat", state.category);
      applyFilter();
    });
  }

  function bindConfig(){
    btnConfig?.addEventListener("click", openConfig);
    cfgClose?.addEventListener("click", closeConfig);

    cfgModal?.addEventListener("click", (e) => {
      if (e.target === cfgModal) closeConfig();
    });

    cfgSave?.addEventListener("click", () => {
      const everySec = clamp(Number(cfgEvery?.value || 120), 35, 900);
      const maxT = clamp(Number(cfgMaxTrends?.value || 35), 10, 80);
      const tSpd = clamp(Number(cfgTickerSpeed?.value || 28), 12, 120);

      state.settings.autoRefresh = !!cfgAuto?.checked;
      state.settings.refreshEveryMs = everySec * 1000;
      state.settings.maxTrends = maxT;
      state.settings.alertsEnabled = !!cfgAlerts?.checked;
      state.settings.tickerEnabled = !!cfgTicker?.checked;
      state.settings.tickerSpeedSec = tSpd;

      document.documentElement.style.setProperty("--tickerDur", `${tSpd}s`);
      setTickerVisible(state.settings.tickerEnabled);
      btnTicker?.setAttribute("aria-pressed", state.settings.tickerEnabled ? "true" : "false");

      saveSettings();
      closeConfig();
      schedule();
      applyFilter();
      toast("Guardado", "Configuración aplicada.");
    });
  }

  function bindTicker(){
    btnTicker?.addEventListener("click", () => {
      state.settings.tickerEnabled = !state.settings.tickerEnabled;
      setTickerVisible(state.settings.tickerEnabled);
      btnTicker.setAttribute("aria-pressed", state.settings.tickerEnabled ? "true" : "false");
      if (cfgTicker) cfgTicker.checked = state.settings.tickerEnabled;
      saveSettings();
    });

    tickerClose?.addEventListener("click", () => {
      state.settings.tickerEnabled = false;
      setTickerVisible(false);
      btnTicker?.setAttribute("aria-pressed", "false");
      if (cfgTicker) cfgTicker.checked = false;
      saveSettings();
    });
  }

  function bind(){
    btnRefresh?.addEventListener("click", async () => { await refresh(); schedule(); });
    btnCompact?.addEventListener("click", toggleCompact);
    inpQ?.addEventListener("input", applyFilter);

    selLang?.addEventListener("change", () => {
      state.settings.lang = pickLang();
      saveSettings();
      if (inpQ) inpQ.value = "";
      refresh(); schedule();
    });

    selWindow?.addEventListener("change", () => {
      state.settings.window = pickTimespanUi();
      saveSettings();
      if (inpQ) inpQ.value = "";
      refresh(); schedule();
    });

    selGeo?.addEventListener("change", () => {
      state.settings.geo = pickGeo();
      saveSettings();
      if (inpQ) inpQ.value = "";
      refresh(); schedule();
    });

    window.addEventListener("online", () => setNet(true));
    window.addEventListener("offline", () => setNet(false));

    bindTabs();
    bindConfig();
    bindTicker();
  }

  /* ───────────────────────────── BOOT ───────────────────────────── */
  window.addEventListener("error", (e) => {
    // Si algo revienta, al menos lo ves en pantalla
    try{
      setErr(`JS error: ${e?.message || "desconocido"}`);
    }catch{}
  });

  function boot(){
    setNet(navigator.onLine);

    loadSettings();
    applySettingsToUI();
    applyPngLogoIfAvailable();

    // set tabs estado
    setActiveTab(tabsView, "data-view", state.view);
    setActiveTab(tabsCat, "data-cat", state.category);

    bind();
    mountTimeline();
    refresh();
    schedule();
    initAutoUpdateSW();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
