(() => {
  "use strict";

  const APP_TAG = "globaleye-trends:final-1.0.0";

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

  const inpQ = $("q");
  const selLang = $("selLang");
  const selWindow = $("selWindow");
  const selGeo = $("selGeo");

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
    el.querySelector(".toastX")?.addEventListener("click", kill, { once:true });
    toastHost.appendChild(el);
    requestAnimationFrame(() => {});
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
    lang: "spanish",
    window: "4H",
    geo: "ES",
    maxTrends: 35,
    maxArticles: 250,
    autoRefresh: true,
    refreshEveryMs: 120_000,
    alertsEnabled: true,
    tickerEnabled: false,
    tickerSpeedSec: 28
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

    if (!["spanish","english","mixed"].includes(state.settings.lang)) state.settings.lang = "spanish";
    if (!["2H","4H","6H","12H"].includes(String(state.settings.window).toUpperCase())) state.settings.window = "4H";
    if (!["ES","GLOBAL"].includes(String(state.settings.geo).toUpperCase())) state.settings.geo = "ES";

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

    try{
      state.compact = localStorage.getItem(CFG.LS_COMPACT) === "1";
    }catch{}
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
    try{
      const url = buildGdeltUrl("json");
      const res = await fetchWithTimeout(url, CFG.FETCH_TIMEOUT_MS, signal);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    }catch{
      const cb = `__gdelt_cb_${Date.now()}_${Math.floor(Math.random()*1e6)}`;
      const url = buildGdeltUrl("jsonp", cb);
      return await jsonp(url, cb, CFG.FETCH_TIMEOUT_MS);
    }
  }

  const STOP_ES = new Set([
    "el","la","los","las","un","una","unos","unas","y","o","u","de","del","al","a","en","por","para","con","sin",
    "se","su","sus","lo","le","les","que","como","más","mas","muy","ya","no","sí","si","es","son","fue","han","hay",
    "este","esta","estos","estas","eso","esa","esos","esas","aquí","alli","allí","ahí",
    "hoy","ayer","mañana","ante","tras","entre","sobre","contra","durante","desde","hasta","porque","cuando","donde",
    "uno","dos","tres","cuatro","cinco","seis","siete","ocho","nueve","diez"
  ]);
  const STOP_EN = new Set([
    "the","a","an","and","or","to","of","in","on","for","with","without","at","by","from","as","is","are","was","were",
    "be","been","it","its","this","that","these","those","today","yesterday","tomorrow","new","more","less","very"
  ]);

  function categoryOf(label){
    const t = safeLower(label);
    const sports = ["fc","real madrid","barcelona","uefa","fifa","nba","nfl","mlb","gol","match","liga","champions","tennis","f1","formula 1"];
    const politics = ["gobierno","congreso","senado","presidente","elecciones","pp","psoe","vox","sanchez","trump","biden","putin","zelensky","ue","unión europea","parlamento","iran","israel","gaza","ucrania","rusia"];
    const viral = ["meme","tiktok","viral","streamer","influencer","trend","challenge","onlyfans","clip","cringe"];
    if (sports.some(k => t.includes(k))) return "sports";
    if (politics.some(k => t.includes(k))) return "politics";
    if (viral.some(k => t.includes(k))) return "viral";
    return "news";
  }

  function normalizeToken(t){
    return safeLower(t)
      .replace(/[\u2019']/g, "")
      .replace(/[^A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ#@]+/g, "")
      .trim();
  }

  function normalizePhrase(t){
    return safeLower(t)
      .replace(/[\u2019']/g, "")
      .replace(/[^A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ\s]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isStop(tokenOrPhrase){
    if (!tokenOrPhrase) return true;
    const s = String(tokenOrPhrase).trim();
    if (!s) return true;

    const lang = pickLang();
    const stopSet = (lang === "english") ? STOP_EN : (lang === "spanish") ? STOP_ES : null;

    if (s.includes(" ")){
      const words = s.split(" ").map(w => w.replace(/^[@#]/,"")).filter(Boolean);
      if (!words.length) return true;

      const isStopWord = (w) => {
        if (w.length <= 2) return true;
        if (stopSet) return stopSet.has(w);
        return STOP_ES.has(w) || STOP_EN.has(w);
      };

      return words.every(isStopWord);
    }

    const t = s.replace(/^[@#]/, "");
    if (!t || t.length <= 2) return true;
    if (stopSet) return stopSet.has(t);
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
    const connectors = new Set(["de","del","la","las","los","y","da","do","dos","das","van","von","of","the"]);
    const phrases = [];
    let buf = [];

    const flush = () => {
      if (buf.length >= 2){
        const label = buf.join(" ");
        const key = normalizePhrase(label);
        if (key && !isStop(key)) phrases.push({ key, label });
      }
      buf = [];
    };

    for (let i=0;i<words.length;i++){
      const w = words[i];

      if (w.isHash || w.isAt){
        flush();
        continue;
      }

      const lower = safeLower(w.base);
      const isConn = connectors.has(lower);

      if (w.cap){
        buf.push(w.raw);
      } else if (isConn && buf.length){
        buf.push(w.raw);
      } else {
        flush();
      }
    }
    flush();

    const seen = new Set();
    return phrases.filter(p => (p.key && !seen.has(p.key) && (seen.add(p.key), true)));
  }

  function extractNgrams(words){
    const tokens = words
      .filter(w => !w.isHash && !w.isAt)
      .map(w => w.base)
      .filter(Boolean);

    const out = [];
    const pushN = (n) => {
      for (let i=0;i<=tokens.length-n;i++){
        const slice = tokens.slice(i, i+n);
        const label = slice.join(" ");
        const key = normalizePhrase(label);
        if (!key || isStop(key)) continue;
        out.push({ key, label });
      }
    };
    pushN(2);
    pushN(3);

    const seen = new Set();
    return out.filter(p => (p.key && !seen.has(p.key) && (seen.add(p.key), true)));
  }

  function computeTrends(articles){
    const scores = new Map();
    const meta = new Map();

    function bump(key, label, add, a){
      if (!key || isStop(key)) return;
      scores.set(key, (scores.get(key) || 0) + add);

      if (!meta.has(key)){
        const url = a?.url ? String(a.url) : "";
        const title = a?.title ? String(a.title) : "";
        const img = (a?.socialimage || a?.image || a?.socialimageurl || "") ? String(a.socialimage || a.image || a.socialimageurl) : "";

        meta.set(key, {
          label: label || key,
          exampleUrl: url,
          sampleTitle: title,
          sampleImage: (img.startsWith("http") ? img : "")
        });
      }
    }

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
        if (isStop(w.base)) continue;
        bump(w.base, w.raw, w.cap ? 2.2 : 1.2, a);
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

  function render(list){
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

      const badgeCat = (() => {
        if (state.category !== "all") return "";
        if (it.cat === "sports") return `<span class="badge warn">Deportes</span>`;
        if (it.cat === "politics") return `<span class="badge bad">Política</span>`;
        if (it.cat === "viral") return `<span class="badge good">Viral</span>`;
        return `<span class="badge">Noticias</span>`;
      })();

      const favOn = state.favs.has(it.key);
      const favCls = favOn ? "aBtn star on" : "aBtn star";

      const sampleBlock = (() => {
        const title = it.sampleTitle ? escapeHtml(it.sampleTitle) : "";
        const url = it.exampleUrl ? String(it.exampleUrl) : "";
        const img = it.sampleImage ? String(it.sampleImage) : "";

        if (!url && !img && !title) return "";

        const imgHtml = img
          ? `<img class="tThumb" src="${escapeHtml(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';" />`
          : "";

        const linkText = title || "Abrir fuente";
        const linkHref = url || (img || "#");

        return `<div class="tMedia">${imgHtml}<a class="tLink" href="${escapeHtml(linkHref)}" target="_blank" rel="noreferrer">${escapeHtml(linkText)}</a></div>`;
      })();

      row.innerHTML = `
        <div class="rank">${it.rank}</div>

        <div class="tBody">
          <div class="tTop">
            <div class="tLabel" title="${escapeHtml(it.label)}">${escapeHtml(it.label)}</div>
            ${badgeDelta}
            ${badgeCat}
          </div>

          <div class="tMeta">
            <div>Score: <b>${Math.round(it.score)}</b></div>
            ${sampleBlock}
          </div>
        </div>

        <div class="actions">
          <button class="${favCls}" type="button" title="Favorito" aria-label="Favorito">★</button>
          <a class="aBtn" href="${escapeHtml(buildXSearchUrl(it.label))}" target="_blank" rel="noreferrer" title="Buscar en X" aria-label="Buscar en X">X</a>
          <button class="aBtn" type="button" title="Copiar" aria-label="Copiar">⎘</button>
        </div>
      `;

      const btnStar = row.querySelector(".aBtn.star");
      const btnCopy = row.querySelectorAll(".aBtn")[2];

      btnStar?.addEventListener("click", () => {
        if (state.favs.has(it.key)) state.favs.delete(it.key);
        else state.favs.add(it.key);
        saveSettings();
        applyFilter();
      });

      btnCopy?.addEventListener("click", async () => {
        const ok = await copyToClipboard(it.label);
        if (ok && state.settings.alertsEnabled) toast("Copiado", it.label);
      });

      elList.appendChild(row);
    }
  }

  function updateTicker(list){
    if (!tickerTrack) return;

    const items = (list || []).slice(0, clamp(state.settings.maxTrends || 35, 10, 80));
    if (!items.length){
      tickerTrack.innerHTML = "";
      return;
    }

    const make = (arr) => arr.map(it => {
      const href = buildXSearchUrl(it.label);
      return `
        <a class="tickerItem" href="${escapeHtml(href)}" target="_blank" rel="noreferrer" title="${escapeHtml(it.label)}">
          <span class="tickerDot"></span>
          <span>${escapeHtml(it.label)}</span>
        </a>`;
    }).join("");

    tickerTrack.innerHTML = make(items) + make(items);
  }

  function applyFilter(){
    const q = safeLower(inpQ?.value || "").trim();

    let arr = state.trends.slice();

    if (state.view === "favs") arr = arr.filter(x => state.favs.has(x.key));
    if (state.category !== "all") arr = arr.filter(x => x.cat === state.category);
    if (q) arr = arr.filter(x => safeLower(x.label).includes(q) || safeLower(x.key).includes(q));

    arr = arr.map((x, i) => ({ ...x, rank: i + 1 }));

    state.filtered = arr;

    setEmpty(arr.length === 0);
    render(arr);
    updateTicker(arr);
  }

  async function refresh(){
    setErr("");
    setEmpty(false);
    if (elLast) elLast.textContent = "Cargando…";

    try { state.aborter?.abort?.(); } catch {}
    state.aborter = new AbortController();

    try{
      const data = await getGdeltData(state.aborter.signal);
      const articles = Array.isArray(data?.articles) ? data.articles : [];

      state.trends = computeTrends(articles);
      saveSettings();

      if (elLast) elLast.textContent = nowISO();
      applyFilter();
    }catch{
      setErr("No se pudo cargar tendencias. Prueba otra ventana (6H/12H) o desactiva privacidad estricta/adblock.");
      if (elLast) elLast.textContent = nowISO();
    }
  }

  function schedule(){
    try { if (state.refreshTimer) clearTimeout(state.refreshTimer); } catch {}
    if (!state.settings.autoRefresh) return;

    const ms = clamp(Number(state.settings.refreshEveryMs || 120000), CFG.MIN_REFRESH_MS, 900000);
    state.refreshTimer = setTimeout(async () => {
      await refresh();
      schedule();
    }, ms);
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
    on(btnRefresh, "click", async () => { await refresh(); schedule(); });
    on(btnCompact, "click", () => { toggleCompact(); });

    on(inpQ, "input", () => applyFilter());

    on(selLang, "change", async () => { state.settings.lang = pickLang(); saveSettings(); await refresh(); schedule(); });
    on(selWindow, "change", async () => { state.settings.window = pickTimespanUi(); saveSettings(); await refresh(); schedule(); });
    on(selGeo, "change", async () => { state.settings.geo = pickGeo(); saveSettings(); await refresh(); schedule(); });

    on(tabsView, "click", (e) => {
      const btn = e.target?.closest?.(".tab");
      if (!btn) return;
      const view = btn.getAttribute("data-view") || "all";
      state.view = (view === "favs") ? "favs" : "all";
      setActiveTab(tabsView, "data-view", state.view);
      applyFilter();
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

      state.settings.autoRefresh = !!cfgAuto?.checked;
      state.settings.refreshEveryMs = everySec * 1000;
      state.settings.maxTrends = maxT;
      state.settings.alertsEnabled = !!cfgAlerts?.checked;
      state.settings.tickerEnabled = !!cfgTicker?.checked;
      state.settings.tickerSpeedSec = tSpd;

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
    applyPngLogoIfAvailable();

    loadSettings();
    applySettingsToUI();

    setNet(navigator.onLine);

    setActiveTab(tabsView, "data-view", state.view);
    setActiveTab(tabsCat, "data-cat", state.category);

    bindUI();

    mountTimeline();
    initAutoUpdateSW();

    await refresh();
    schedule();
  })();
})();
