/* app.js — GlobalEye Memes + Trends + X timeline (FINAL+)
   ✅ Compatible con tu index.html actual (IDs: tabMemes/tabTrends/tabFavs, btnRefresh, xTimelineMount, memesList...)
   ✅ Memes: SOLO posts con imagen o vídeo (extracción robusta + fallbacks + onerror visible)
   ✅ Tendencias: GDELT (open data) con parse seguro + “+INFO” por tarjeta (enlaces + ejemplos)
   ✅ Timeline X: montaje robusto (sin duplicar script) + fallback RSS (Nitter/proxies) si bloqueado
   ✅ Votos y favoritos persistentes (localStorage)
   ✅ Anti-doble-carga + cleanup (intervalos, listeners) para evitar estados raros en recargas/SW
   ✅ SIN fugas: listeners dinámicos NO se registran en el cleanup global
*/
(() => {
  "use strict";

  const APP_VERSION = "ge-memes-trends-final";
  const BUILD_ID = "2026-01-17c";

  /* ───────────────────────────── Guard + Cleanup ───────────────────────────── */
  const TAG = `${APP_VERSION}:${BUILD_ID}`;
  try{
    if (window.__GE_APP__?.tag === TAG) return;
    if (window.__GE_APP__?.cleanup) {
      try{ window.__GE_APP__.cleanup(); }catch{}
    }
    window.__GE_APP__ = { tag: TAG, cleanup: null };
  }catch{}

  const _cleanup = {
    timers: new Set(),
    listeners: [],
    aborters: new Set(),
  };

  function trackTimer(id){ _cleanup.timers.add(id); return id; }
  function untrackTimer(id){ try{ _cleanup.timers.delete(id); }catch{} }
  function setIntervalSafe(fn, ms){ return trackTimer(setInterval(fn, ms)); }
  function setTimeoutSafe(fn, ms){ return trackTimer(setTimeout(fn, ms)); }
  function clearTracked(id){
    if (id == null) return;
    try{ clearInterval(id); }catch{}
    try{ clearTimeout(id); }catch{}
    untrackTimer(id);
  }
  function clearAllTimers(){
    for (const id of _cleanup.timers){
      try{ clearInterval(id); }catch{}
      try{ clearTimeout(id); }catch{}
    }
    _cleanup.timers.clear();
  }
  function on(target, type, handler, opts){
    if (!target) return;
    target.addEventListener(type, handler, opts);
    _cleanup.listeners.push([target, type, handler, opts]);
  }
  // Para nodos dinámicos: NO registramos en cleanup (evita fugas por re-render)
  function onDyn(target, type, handler, opts){
    if (!target) return;
    target.addEventListener(type, handler, opts);
  }
  function offAll(){
    for (const [t, type, h, opts] of _cleanup.listeners){
      try{ t.removeEventListener(type, h, opts); }catch{}
    }
    _cleanup.listeners.length = 0;
  }
  function abortAll(){
    for (const ac of _cleanup.aborters){
      try{ ac.abort("cleanup"); }catch{}
    }
    _cleanup.aborters.clear();
  }

  window.__GE_APP__.cleanup = () => {
    abortAll();
    offAll();
    clearAllTimers();
  };

  /* ───────────────────────────── Helpers DOM ───────────────────────────── */
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  function pickFirst(...sels){
    for (const s of sels){
      const el = $(s);
      if (el) return el;
    }
    return null;
  }

  function setHidden(el, hidden){
    if (!el) return;
    el.classList.toggle("hidden", !!hidden);
    try{ el.toggleAttribute?.("hidden", !!hidden); }catch{}
  }

  function clamp(n, a, b){ n = Number(n); return Math.max(a, Math.min(b, n)); }

  function fmtNum(n){
    n = Number(n);
    if (!Number.isFinite(n)) return "0";
    if (n >= 1e6) return `${(n/1e6).toFixed(1).replace(/\.0$/,"")}M`;
    if (n >= 1e3) return `${(n/1e3).toFixed(1).replace(/\.0$/,"")}K`;
    return String(n);
  }

  function formatAgoMs(deltaMs){
    const s = Math.floor(deltaMs / 1000);
    if (s < 10) return "ahora";
    if (s < 60) return `${s}s`;
    const m = Math.floor(s/60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m/60);
    if (h < 48) return `${h}h`;
    const d = Math.floor(h/24);
    return `${d}d`;
  }

  function escapeHtml(s){
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function safeUrl(u){
    try{
      const x = new URL(String(u || ""));
      return x.toString();
    }catch{
      return "";
    }
  }

  /* ───────────────────────────── Storage ───────────────────────────── */
  const LS_CFG         = "ge_cfg_v1";
  const LS_VOTES       = "ge_votes_v1";
  const LS_FAVS        = "ge_favs_v1";
  const LS_UI          = "ge_ui_v1";
  const LS_CACHE_MEMES = "ge_cache_memes_v1";
  const LS_CACHE_TR    = "ge_cache_trends_v1";

  function loadJSON(key, fallback){
    try{
      const v = localStorage.getItem(key);
      if (!v) return fallback;
      return JSON.parse(v);
    }catch{
      return fallback;
    }
  }
  function saveJSON(key, value){
    try{ localStorage.setItem(key, JSON.stringify(value)); }catch{}
  }

  const cfg = Object.assign({
    auto: true,
    everySec: 120,
    maxPosts: 45,
    noThumbs: false,
    tickerSpeed: 120,
    xUser: "GlobalEye_TV",
  }, loadJSON(LS_CFG, {}));

  const votes = Object.assign({}, loadJSON(LS_VOTES, {})); // { [id]: -1|0|1 }
  const favs  = Object.assign({}, loadJSON(LS_FAVS, {}));  // { [id]: item }

  const ui = Object.assign({
    view: "memes",
    compact: false,
    ticker: false
  }, loadJSON(LS_UI, {}));

  /* ───────────────────────────── Elements (multi-compat) ───────────────────────────── */
  const el = {
    tabMemes: $("#tabMemes"),
    tabTrends: $("#tabTrends"),
    tabFavs: $("#tabFavs"),

    btnRefresh: $("#btnRefresh"),
    btnReloadX: $("#btnReloadX"),
    btnCompact: $("#btnCompact"),
    btnTicker: $("#btnTicker"),
    btnConfig: $("#btnConfig"),

    q: $("#q"),
    selSource: $("#selSource"),
    selSort: $("#selSort"),
    selRange: $("#selRange"),

    netStatus: $("#netStatus"),
    lastUpdated: $("#lastUpdated"),

    errBanner: $("#errBanner"),
    emptyBanner: $("#emptyBanner"),

    viewMemes: $("#viewMemes"),
    viewTrends: $("#viewTrends"),
    viewFavs: $("#viewFavs"),

    memesList: $("#memesList"),
    trendsList: $("#trendsList"),
    favsList: $("#favsList"),

    xTimelineMount: pickFirst("#xTimelineMount", "#timelineMount"),
    xFallback: pickFirst("#xFallback"),

    tickerBar: $("#tickerBar"),
    tickerTrack: $("#tickerTrack"),
    tickerClose: $("#tickerClose"),

    cfgModal: $("#cfgModal"),
    cfgClose: $("#cfgClose"),
    cfgSave: $("#cfgSave"),
    cfgAuto: $("#cfgAuto"),
    cfgEvery: $("#cfgEvery"),
    cfgMaxPosts: $("#cfgMaxPosts"),
    cfgNoThumbs: $("#cfgNoThumbs"),
    cfgTickerSpeed: $("#cfgTickerSpeed")
  };

  function softAssertBasics(){
    const missing = [];
    if (!el.memesList) missing.push("#memesList");
    if (!el.trendsList) missing.push("#trendsList");
    if (!el.favsList) missing.push("#favsList");
    if (!el.viewMemes) missing.push("#viewMemes");
    if (!el.viewTrends) missing.push("#viewTrends");
    if (!el.viewFavs) missing.push("#viewFavs");
    if (missing.length){
      showErr(`Faltan contenedores en HTML: ${missing.join(", ")} (revisa index.html).`);
      return false;
    }
    return true;
  }

  /* ───────────────────────────── Networking (robusto) ───────────────────────────── */
  function mkAbort(timeoutMs){
    const ac = new AbortController();
    _cleanup.aborters.add(ac);
    const t = setTimeoutSafe(() => { try{ ac.abort("timeout"); }catch{} }, timeoutMs);
    return {
      ac,
      done: () => {
        clearTracked(t);
        try{ _cleanup.aborters.delete(ac); }catch{}
      }
    };
  }

  async function fetchText(url, timeoutMs=12000){
    const { ac, done } = mkAbort(timeoutMs);
    try{
      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
        mode: "cors",
        signal: ac.signal,
        headers: { "accept": "application/json,text/plain,text/xml,*/*" }
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text, headers: res.headers, url };
    }finally{
      done();
    }
  }

  function stripXssi(text){
    let t = String(text || "");
    if (t.startsWith(")]}',")) t = t.slice(5);
    return t.trim();
  }

  function safeJsonParse(text){
    try{ return JSON.parse(stripXssi(text)); }catch{ return null; }
  }

  async function fetchJsonSmart(url, timeoutMs=12000){
    const r = await fetchText(url, timeoutMs);
    const json = safeJsonParse(r.text);

    if (!json){
      const snippet = String(r.text || "")
        .slice(0, 220)
        .replace(/\s+/g, " ")
        .trim();
      throw new Error(`Respuesta no-JSON (${r.status}) en ${new URL(url).hostname}: ${snippet || "vacía"}`);
    }
    if (!r.ok){
      throw new Error(`HTTP ${r.status} en ${new URL(url).hostname}`);
    }
    return json;
  }

  async function tryUrlsJson(urls, timeoutMs=12000){
    let lastErr = null;
    for (const u of urls){
      try{
        return await fetchJsonSmart(u, timeoutMs);
      }catch(err){
        lastErr = err;
      }
    }
    throw lastErr || new Error("No se pudo cargar JSON");
  }

  function proxyUrlsFor(url){
    return [
      url,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
      `https://thingproxy.freeboard.io/fetch/${url}`
    ];
  }

  /* ───────────────────────────── Memes (Reddit) ───────────────────────────── */
  // Incluye tu subreddit + memes en español (además del mix global).
  const REDDIT_SUBS_MIX = [
    "OJOOJITOOJETE",
    "memesESP",
    "memesenespanol",
    "memes",
    "dankmemes",
    "me_irl",
    "wholesomememes",
    "funny"
  ];

  function parseSourceValue(v){
    const raw = String(v || "").trim();
    if (!raw) return "mix";
    if (raw === "mix") return "mix";

    // Permite valores tipo "r/xxxx" o URL completa
    if (/^r\//i.test(raw)) return raw.slice(2);
    if (/^https?:\/\//i.test(raw)){
      try{
        const u = new URL(raw);
        const m = u.pathname.match(/\/r\/([^/]+)/i);
        if (m && m[1]) return m[1];
      }catch{}
    }
    return raw;
  }

  function redditEndpoint(sub, sort, limit){
    const s = (sort === "best") ? "new" : sort;
    let url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/${encodeURIComponent(s)}.json?limit=${encodeURIComponent(limit)}&raw_json=1`;
    if (s === "top") url += `&t=day`;
    return url;
  }

  function isImgUrl(u){ return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(u || ""); }
  function isMp4Url(u){ return /\.mp4(\?|$)/i.test(u || ""); }
  function isGifv(u){ return /\.gifv(\?|$)/i.test(u || ""); }

  function normalizeMediaUrl(u){
    if (!u) return "";
    let s = String(u).replaceAll("&amp;", "&").trim();
    if (isGifv(s)) s = s.replace(/\.gifv(\?.*)?$/i, ".mp4$1");
    if (s.startsWith("http://")) s = "https://" + s.slice(7);
    return s;
  }

  function pickBestPreview(post){
    const img = post?.preview?.images?.[0];
    const src = img?.source?.url || null;
    return src ? normalizeMediaUrl(src) : null;
  }

  function pickGallery(post){
    if (!post?.is_gallery || !post?.media_metadata) return null;
    const keys = Object.keys(post.media_metadata);
    if (!keys.length) return null;
    const k = keys[0];
    const m = post.media_metadata[k];
    const u = m?.s?.u || m?.s?.gif || null;
    if (u) return normalizeMediaUrl(u);

    const mime = m?.m || "image/jpeg";
    const ext = mime.includes("/") ? mime.split("/")[1].replace("jpeg","jpg") : "jpg";
    return `https://i.redd.it/${k}.${ext}`;
  }

  function extractMedia(post){
    if (!post || post.over_18) return null;

    const rv = post?.media?.reddit_video?.fallback_url;
    if (post.is_video && rv){
      return { type: "video", url: normalizeMediaUrl(rv) };
    }

    const rvp = post?.preview?.reddit_video_preview?.fallback_url;
    if (rvp){
      return { type: "video", url: normalizeMediaUrl(rvp) };
    }

    const g = pickGallery(post);
    if (g && (isImgUrl(g) || g.includes("i.redd.it/"))) return { type: "image", url: normalizeMediaUrl(g) };

    const uod = post.url_overridden_by_dest ? normalizeMediaUrl(post.url_overridden_by_dest) : "";
    if (post.post_hint === "image" && uod){
      if (isImgUrl(uod) || uod.includes("i.redd.it/") || uod.includes("i.imgur.com/")) {
        return { type: "image", url: uod };
      }
    }

    const p = pickBestPreview(post);
    if (p && (isImgUrl(p) || p.includes("i.redd.it/") || p.includes("external-preview.redd.it/") || p.includes("preview.redd.it/"))){
      return { type: "image", url: p };
    }

    const url = normalizeMediaUrl(uod || post.url || "");
    if (isImgUrl(url)) return { type: "image", url };
    if (isMp4Url(url)) return { type: "video", url };

    return null;
  }

  function mapRedditPostToItem(post){
    const media = extractMedia(post);
    if (!media) return null;

    const createdMs = Math.floor((post.created_utc || 0) * 1000);
    return {
      kind: "meme",
      id: String(post.id || ""),
      fullId: String(post.name || ""),
      title: String(post.title || ""),
      subreddit: String(post.subreddit || ""),
      author: String(post.author || ""),
      permalink: post.permalink ? `https://www.reddit.com${post.permalink}` : "",
      createdMs,
      score: Number(post.score || 0),
      numComments: Number(post.num_comments || 0),
      mediaType: media.type,
      mediaUrl: media.url
    };
  }

  function dedupById(items){
    const map = new Map();
    for (const it of items){
      if (!it || !it.id) continue;
      if (!map.has(it.id)) map.set(it.id, it);
    }
    return Array.from(map.values());
  }

  async function fetchMemes(){
    const rangeH = Number(el.selRange?.value || 48);
    const limit = clamp(cfg.maxPosts || 45, 10, 120);

    const sort = (el.selSort?.value || "new");
    const source = parseSourceValue(el.selSource?.value || "mix");

    const subs = (source === "mix") ? REDDIT_SUBS_MIX : [source];

    const perSubLimit = clamp(Math.ceil(limit * (source === "mix" ? 1.35 : 2.0)), 25, 100);

    const reqs = subs.map(sub => {
      const url = redditEndpoint(sub, sort, perSubLimit);
      const urls = proxyUrlsFor(url);
      return tryUrlsJson(urls, 14000).then(json => ({ sub, json })).catch(err => ({ sub, err }));
    });

    const results = await Promise.all(reqs);

    const rawPosts = [];
    const errs = [];

    for (const r of results){
      if (r.err){
        errs.push(`${r.sub}: ${r.err.message || r.err}`);
        continue;
      }
      const children = r?.json?.data?.children || [];
      for (const c of children){
        const post = c?.data;
        if (post) rawPosts.push(post);
      }
    }

    const cutoff = Date.now() - (rangeH * 3600 * 1000);

    const items = rawPosts
      .map(mapRedditPostToItem)
      .filter(Boolean)
      .filter(it => it.createdMs >= cutoff);

    let out = dedupById(items);

    if (sort === "best"){
      out.sort((a,b) => {
        const va = Number(votes[a.id] || 0);
        const vb = Number(votes[b.id] || 0);
        if (vb !== va) return vb - va;
        return b.createdMs - a.createdMs;
      });
    }else if (sort === "new"){
      out.sort((a,b) => b.createdMs - a.createdMs);
    }else if (sort === "top"){
      out.sort((a,b) => b.score - a.score);
    }else{
      out.sort((a,b) => (b.score*0.7 + b.numComments*0.3) - (a.score*0.7 + a.numComments*0.3));
    }

    out = out.slice(0, limit);

    return { items: out, errs };
  }

  /* ───────────────────────────── Tendencias (GDELT) ───────────────────────────── */
  const GDELT_DOC = "https://api.gdeltproject.org/api/v2/doc/doc";

  function gdeltTimespanForHours(h){
    if (h <= 24) return "1d";
    if (h <= 48) return "2d";
    return "3d";
  }

  function buildGdeltQuery(){
    return `(news OR viral OR trending OR internet OR meme)`;
  }

  const STOP = new Set([
    "de","la","el","y","a","en","un","una","unos","unas","que","se","por","para","con","sin","del","al",
    "lo","los","las","su","sus","es","son","fue","han","hoy","ayer","mañana","ya","más","menos","muy",
    "the","and","or","to","in","on","for","with","without","is","are","was","were","be","been","it","this","that",
    "as","at","by","from","an","a","of","you","your","they","their"
  ]);

  function cleanToken(t){
    return String(t || "")
      .toLowerCase()
      .replace(/[“”"’'`´]/g, "")
      .replace(/[^\p{L}\p{N}_#@]+/gu, "")
      .trim();
  }

  function classifyTrend(s){
    return /(eleccion|gobierno|presidente|congreso|politic|election|government|parlamento|senado)/i.test(s) ? "Política" :
      /(futbol|liga|nba|nfl|mlb|deport|sport|champions|uefa|laliga)/i.test(s) ? "Deportes" :
      /(viral|meme|internet|tiktok|trend|streamer|youtuber|influencer)/i.test(s) ? "Viral" :
      "Noticias";
  }

  function scoreTrendsFromTitles(titles){
    const counts = new Map();
    const examples = new Map(); // key -> [title...]
    const totalTitles = titles.length;

    function addExample(k, title){
      if (!k || !title) return;
      let arr = examples.get(k);
      if (!arr){
        arr = [];
        examples.set(k, arr);
      }
      if (arr.length >= 3) return;
      if (!arr.includes(title)) arr.push(title);
    }

    function bump(k, w=1, title=""){
      if (!k || k.length < 3) return;
      counts.set(k, (counts.get(k) || 0) + w);
      addExample(k, title);
    }

    for (const title of titles){
      const raw = String(title || "");
      const words0 = raw.split(/\s+/g).map(cleanToken).filter(Boolean);

      for (const w of words0){
        if (w.startsWith("#") && w.length > 2) bump(w, 4, raw);
        else if (w.startsWith("@") && w.length > 2) bump(w, 4, raw);
      }

      const words = words0
        .filter(w => !w.startsWith("#") && !w.startsWith("@"))
        .filter(w => w.length >= 3)
        .filter(w => !STOP.has(w));

      for (const w of words) bump(w, 1, raw);

      for (let i=0;i<words.length-1;i++){
        const a = words[i], b = words[i+1];
        if (!a || !b) continue;
        bump(`${a} ${b}`, 2.2, raw);
      }
      for (let i=0;i<words.length-2;i++){
        const a = words[i], b = words[i+1], c = words[i+2];
        if (!a || !b || !c) continue;
        bump(`${a} ${b} ${c}`, 3.0, raw);
      }
    }

    const arr = Array.from(counts.entries())
      .map(([k,score]) => ({
        kind: "trend",
        text: k,
        score,
        examples: examples.get(k) || [],
        totalTitles,
      }))
      .sort((a,b) => b.score - a.score)
      .slice(0, 40);

    for (const t of arr){
      t.cat = classifyTrend(t.text);
      t.id = `trend:${t.text}`;
    }

    return arr;
  }

  async function fetchTrends(){
    const rangeH = Number(el.selRange?.value || 48);
    const timespan = gdeltTimespanForHours(rangeH);
    const query = buildGdeltQuery();

    const params = new URLSearchParams({
      query,
      mode: "artlist",
      format: "json",
      sort: "datedesc",
      maxrecords: "250",
      timespan
    });

    const url = `${GDELT_DOC}?${params.toString()}`;

    const json = await tryUrlsJson(proxyUrlsFor(url), 16000);

    const articles = Array.isArray(json?.articles) ? json.articles : [];
    const cutoff = Date.now() - (rangeH * 3600 * 1000);

    const titles = articles
      .filter(a => a && a.title)
      .filter(a => {
        const dt = a.seendate || a.datetime || a.date || "";
        if (!dt) return true;
        const t = Date.parse(dt);
        if (!Number.isFinite(t)) return true;
        return t >= cutoff;
      })
      .map(a => String(a.title));

    return scoreTrendsFromTitles(titles);
  }

  /* ───────────────────────────── State ───────────────────────────── */
  const state = {
    memes: [],
    trends: [],
    lastRefreshMs: 0
  };

  /* ───────────────────────────── UI helpers ───────────────────────────── */
  function showErr(msg){
    if (!el.errBanner) return;
    el.errBanner.textContent = msg || "";
    setHidden(el.errBanner, !msg);
  }
  function showEmpty(on){
    if (!el.emptyBanner) return;
    setHidden(el.emptyBanner, !on);
  }

  function applyUIFlags(){
    document.documentElement.setAttribute("data-compact", ui.compact ? "1" : "0");
    document.documentElement.setAttribute("data-noThumbs", cfg.noThumbs ? "1" : "0");

    if (el.tickerBar){
      el.tickerBar.style.setProperty("--tickerSpeed", `${clamp(cfg.tickerSpeed || 120, 30, 300)}s`);
      setHidden(el.tickerBar, !ui.ticker);
    }

    el.btnCompact?.classList.toggle("isOn", !!ui.compact);
    el.btnTicker?.classList.toggle("isOn", !!ui.ticker);
  }

  function setActiveTab(view){
    ui.view = view;
    saveJSON(LS_UI, ui);

    el.tabMemes?.classList.toggle("isActive", view === "memes");
    el.tabTrends?.classList.toggle("isActive", view === "trends");
    el.tabFavs?.classList.toggle("isActive", view === "favs");

    setHidden(el.viewMemes, view !== "memes");
    setHidden(el.viewTrends, view !== "trends");
    setHidden(el.viewFavs, view !== "favs");

    render();
    if (ui.ticker) renderTicker();
  }

  function passesSearch(text){
    const q = (el.q?.value || "").trim().toLowerCase();
    if (!q) return true;
    return String(text || "").toLowerCase().includes(q);
  }

  function openInNew(url){
    const u = safeUrl(url);
    if (!u) return;
    try{ window.open(u, "_blank", "noreferrer"); }catch{}
  }

  /* ───────────────────────────── Render ───────────────────────────── */
  function render(){
    showErr("");
    showEmpty(false);

    if (ui.view === "memes") renderMemes();
    else if (ui.view === "trends") renderTrends();
    else renderFavs();
  }

  function renderMemes(){
    const list = el.memesList;
    if (!list) return;
    list.innerHTML = "";

    const items = (state.memes || []).filter(it => passesSearch(it.title));
    if (!items.length){
      showEmpty(true);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const it of items){
      frag.appendChild(renderMemeCard(it));
    }
    list.appendChild(frag);
  }

  function renderMemeCard(it){
    const card = document.createElement("article");
    card.className = "mCard";
    card.dataset.id = it.id;

    const v = Number(votes[it.id] || 0);
    const isFav = !!favs[it.id];

    const votesCol = document.createElement("div");
    votesCol.className = "mVotes";

    const btnUp = document.createElement("button");
    btnUp.className = "iconBtn voteBtn up" + (v === 1 ? " isOn" : "");
    btnUp.type = "button";
    btnUp.title = "Upvote";
    btnUp.innerHTML = `<span class="msr">arrow_upward</span>`;
    onDyn(btnUp, "click", (e) => { e.stopPropagation(); setVote(it.id, v === 1 ? 0 : 1); });

    const score = document.createElement("div");
    score.className = "voteScore";
    score.textContent = v === 0 ? "·" : (v === 1 ? "+1" : "-1");

    const btnDown = document.createElement("button");
    btnDown.className = "iconBtn voteBtn down" + (v === -1 ? " isOn" : "");
    btnDown.type = "button";
    btnDown.title = "Downvote";
    btnDown.innerHTML = `<span class="msr">arrow_downward</span>`;
    onDyn(btnDown, "click", (e) => { e.stopPropagation(); setVote(it.id, v === -1 ? 0 : -1); });

    votesCol.appendChild(btnUp);
    votesCol.appendChild(score);
    votesCol.appendChild(btnDown);

    const body = document.createElement("div");
    body.className = "mBody";

    const meta = document.createElement("div");
    meta.className = "mMeta";
    meta.innerHTML = `
      <span>r/${escapeHtml(it.subreddit)}</span>
      <span class="mDot">•</span>
      <span>${escapeHtml(formatAgoMs(Math.max(0, Date.now() - (it.createdMs||0))))}</span>
      <span class="mDot">•</span>
      <a href="${escapeHtml(it.permalink)}" target="_blank" rel="noreferrer">Abrir</a>
    `;

    const title = document.createElement("div");
    title.className = "mTitle";
    title.textContent = it.title || "";

    const media = document.createElement("div");
    media.className = "mMedia";

    if (cfg.noThumbs){
      const hint = document.createElement("div");
      hint.className = "mMediaHint";
      hint.innerHTML = `<span class="msr">visibility_off</span><span>Media oculta (Config)</span>`;
      media.appendChild(hint);
    }else if (it.mediaType === "video"){
      const vid = document.createElement("video");
      vid.src = it.mediaUrl;
      vid.controls = true;
      vid.playsInline = true;
      vid.preload = "metadata";
      vid.muted = true;

      const fallback = document.createElement("div");
      fallback.className = "mMediaFail hidden";
      fallback.innerHTML = `
        <span class="msr">error</span>
        <span>No se pudo cargar el vídeo.</span>
        <a class="btn ghost" href="${escapeHtml(it.permalink)}" target="_blank" rel="noreferrer">
          <span class="msr">open_in_new</span><span>Abrir</span>
        </a>
      `;

      onDyn(vid, "error", () => setHidden(fallback, false));

      media.appendChild(vid);
      media.appendChild(fallback);
    }else{
      const img = document.createElement("img");
      img.src = it.mediaUrl;
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = it.title || "meme";

      const fallback = document.createElement("div");
      fallback.className = "mMediaFail hidden";
      fallback.innerHTML = `
        <span class="msr">broken_image</span>
        <span>No se pudo cargar la imagen.</span>
        <a class="btn ghost" href="${escapeHtml(it.permalink)}" target="_blank" rel="noreferrer">
          <span class="msr">open_in_new</span><span>Abrir</span>
        </a>
      `;

      onDyn(img, "error", () => {
        setHidden(fallback, false);
        try{
          const u = new URL(img.src);
          if (u.hostname.includes("external-preview.redd.it")){
            u.search = "";
            img.src = u.toString();
          }
        }catch{}
      });

      media.appendChild(img);
      media.appendChild(fallback);
    }

    const foot = document.createElement("div");
    foot.className = "mFoot";

    const chips = document.createElement("div");
    chips.className = "chips";
    chips.innerHTML = `
      <span class="chip"><span class="msr">thumb_up</span>${fmtNum(it.score)}</span>
      <span class="chip"><span class="msr">chat_bubble</span>${fmtNum(it.numComments)}</span>
    `;

    const actions = document.createElement("div");
    actions.className = "actionsInline";

    const favBtn = document.createElement("button");
    favBtn.className = "iconBtn" + (isFav ? " isOn" : "");
    favBtn.type = "button";
    favBtn.title = isFav ? "Quitar favorito" : "Favorito";
    favBtn.innerHTML = `<span class="msr">star</span>`;
    onDyn(favBtn, "click", (e) => { e.stopPropagation(); toggleFav(it); });

    actions.appendChild(favBtn);

    foot.appendChild(chips);
    foot.appendChild(actions);

    body.appendChild(meta);
    body.appendChild(title);
    body.appendChild(media);
    body.appendChild(foot);

    card.appendChild(votesCol);
    card.appendChild(body);

    onDyn(card, "click", () => { if (it.permalink) openInNew(it.permalink); });

    return card;
  }

  function renderTrends(){
    const list = el.trendsList;
    if (!list) return;
    list.innerHTML = "";

    const items = (state.trends || []).filter(it => passesSearch(it.text));
    if (!items.length){
      showEmpty(true);
      return;
    }

    const frag = document.createDocumentFragment();
    let rank = 0;

    for (const t of items){
      rank++;

      const row = document.createElement("div");
      row.className = "tRow";
      row.dataset.id = t.id;

      const q = encodeURIComponent(t.text);
      const xUrl = `https://x.com/search?q=${q}`;
      const gUrl = `https://www.google.com/search?q=${q}`;
      const rUrl = `https://www.reddit.com/search/?q=${q}`;
      const wUrl = `https://en.wikipedia.org/w/index.php?search=${q}`;
      const gdeltUrl = `${GDELT_DOC}?${new URLSearchParams({
        query: t.text,
        mode: "artlist",
        format: "json",
        sort: "datedesc",
        maxrecords: "50",
        timespan: gdeltTimespanForHours(Number(el.selRange?.value || 48))
      }).toString()}`;

      row.innerHTML = `
        <div class="tRank">${rank}</div>
        <div class="tMain">
          <div class="tText">${escapeHtml(t.text)}</div>
          <div class="tMeta">
            <span>${escapeHtml(t.cat || "Noticias")}</span>
            <span>score ${Math.round(t.score)}</span>
          </div>
          <div class="tInfo hidden" data-role="info">
            <div class="tInfoLinks">
              <a class="btn ghost" href="${xUrl}" target="_blank" rel="noreferrer"><span class="msr">search</span><span>X</span></a>
              <a class="btn ghost" href="${gUrl}" target="_blank" rel="noreferrer"><span class="msr">public</span><span>Google</span></a>
              <a class="btn ghost" href="${rUrl}" target="_blank" rel="noreferrer"><span class="msr">forum</span><span>Reddit</span></a>
              <a class="btn ghost" href="${wUrl}" target="_blank" rel="noreferrer"><span class="msr">menu_book</span><span>Wiki</span></a>
              <a class="btn ghost" href="${gdeltUrl}" target="_blank" rel="noreferrer"><span class="msr">dataset</span><span>GDELT</span></a>
            </div>
            ${
              (t.examples && t.examples.length)
                ? `<div class="tExamples">
                     <div class="tExamplesTitle">Ejemplos recientes</div>
                     <ul>${t.examples.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
                   </div>`
                : `<div class="tExamples muted">Sin ejemplos (esta tendencia viene por señales globales).</div>`
            }
          </div>
        </div>
        <div class="tActions">
          <button class="iconBtn" type="button" data-act="info" title="+Info"><span class="msr">info</span></button>
          <a class="iconBtn" href="${xUrl}" target="_blank" rel="noreferrer" title="Buscar en X">
            <span class="msr">search</span>
          </a>
          <button class="iconBtn ${favs[t.id] ? "isOn" : ""}" type="button" data-act="fav" title="${favs[t.id] ? "Quitar favorito" : "Favorito"}">
            <span class="msr">star</span>
          </button>
        </div>
      `;

      const btnInfo = row.querySelector('[data-act="info"]');
      const btnFav = row.querySelector('[data-act="fav"]');
      const infoBox = row.querySelector('[data-role="info"]');

      onDyn(btnInfo, "click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const hidden = infoBox?.classList.contains("hidden");
        setHidden(infoBox, !hidden);
      });

      onDyn(btnFav, "click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFav(t);
      });

      frag.appendChild(row);
    }

    list.appendChild(frag);
  }

  function renderFavs(){
    const list = el.favsList;
    if (!list) return;
    list.innerHTML = "";

    const items = Object.values(favs || {}).filter(Boolean);
    const filtered = items.filter(it => passesSearch(it.title || it.text || ""));
    if (!filtered.length){
      showEmpty(true);
      return;
    }

    filtered.sort((a,b) => (b.createdMs||0) - (a.createdMs||0));

    const frag = document.createDocumentFragment();
    for (const it of filtered){
      if (it.kind === "trend"){
        const row = document.createElement("div");
        row.className = "tRow";

        const q = encodeURIComponent(it.text);
        const xUrl = `https://x.com/search?q=${q}`;

        row.innerHTML = `
          <div class="tRank">★</div>
          <div class="tMain">
            <div class="tText">${escapeHtml(it.text)}</div>
            <div class="tMeta"><span>Trend</span></div>
          </div>
          <div class="tActions">
            <a class="iconBtn" href="${xUrl}" target="_blank" rel="noreferrer" title="Buscar en X">
              <span class="msr">search</span>
            </a>
            <button class="iconBtn isOn" type="button" title="Quitar favorito" data-act="unfav">
              <span class="msr">star</span>
            </button>
          </div>
        `;

        const btn = row.querySelector('[data-act="unfav"]');
        onDyn(btn, "click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          delete favs[it.id];
          saveJSON(LS_FAVS, favs);
          renderFavs();
          if (ui.ticker) renderTicker();
        });

        frag.appendChild(row);
      }else{
        frag.appendChild(renderMemeCard(it));
      }
    }
    list.appendChild(frag);
  }

  /* ───────────────────────────── Votes / Favs ───────────────────────────── */
  function setVote(id, val){
    votes[id] = val;
    saveJSON(LS_VOTES, votes);
    render();
    if (ui.ticker) renderTicker();
  }

  function toggleFav(item){
    const id = item?.id || item?.text;
    if (!id) return;

    if (favs[id]){
      delete favs[id];
    }else{
      const copy = Object.assign({}, item);
      if (copy.kind === "trend"){
        copy.id = copy.id || `trend:${copy.text}`;
      }
      favs[id] = copy;
    }
    saveJSON(LS_FAVS, favs);
    render();
    if (ui.ticker) renderTicker();
  }

  /* ───────────────────────────── Ticker ───────────────────────────── */
  function renderTicker(){
    const track = el.tickerTrack;
    if (!track) return;
    track.innerHTML = "";

    let text = "";
    if (ui.view === "trends" && state.trends.length){
      text = state.trends.slice(0, 18).map(t => `• ${t.text}`).join("   ");
    }else if (state.memes.length){
      text = state.memes.slice(0, 12).map(m => `• ${m.title}`).join("   ");
    }else{
      text = "• GlobalEye •";
    }

    const run = document.createElement("div");
    run.className = "run";
    run.textContent = text;
    track.appendChild(run);
  }

  function setTickerVisible(on){
    ui.ticker = !!on;
    saveJSON(LS_UI, ui);
    applyUIFlags();
    if (ui.ticker) renderTicker();
  }

  /* ───────────────────────────── X Timeline + Fallback RSS ───────────────────────────── */
  function twitterScriptAlreadyPresent(){
    return !!$$('script[src*="platform.twitter.com/widgets.js"]').length;
  }

  function waitForTwttr(ms=3500){
    const start = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        if (window.twttr?.widgets?.load) return resolve(true);
        if (Date.now() - start >= ms) return resolve(false);
        setTimeoutSafe(tick, 120);
      };
      tick();
    });
  }

  async function ensureTwitterWidgets(){
    if (window.twttr?.widgets?.load) return true;

    if (twitterScriptAlreadyPresent()){
      return await waitForTwttr(4500);
    }

    return await new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "https://platform.twitter.com/widgets.js";
      s.async = true;
      s.onload = () => resolve(!!window.twttr?.widgets?.load);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }

  function getXUser(){
    const u = String(cfg.xUser || "GlobalEye_TV").trim().replace(/^@/,"");
    return u || "GlobalEye_TV";
  }

  async function loadXFallbackFeed(){
    if (!el.xFallback) return;
    const user = getXUser();

    const instances = [
      `https://nitter.net/${user}/rss`,
      `https://nitter.poast.org/${user}/rss`,
      `https://nitter.lacontrevoie.fr/${user}/rss`,
      `https://nitter.privacydev.net/${user}/rss`,
    ];

    const urls = [];
    for (const u of instances){
      urls.push(...proxyUrlsFor(u));
    }

    let xmlText = "";
    let lastErr = null;

    for (const u of urls){
      try{
        const r = await fetchText(u, 12000);
        const t = String(r.text || "").trim();
        if (!t) throw new Error("vacío");
        if (!t.includes("<rss") && !t.includes("<feed")) throw new Error("no-rss");
        xmlText = t;
        break;
      }catch(err){
        lastErr = err;
      }
    }

    if (!xmlText){
      el.xFallback.innerHTML = `
        <div class="xFallbackBox">
          <div class="xFallbackTitle">Timeline no disponible</div>
          <div class="xFallbackMsg">El embed de X está bloqueado (o no cargó). Puedes abrir el perfil directamente.</div>
          <div class="xFallbackActions">
            <a class="btn" href="https://x.com/${escapeHtml(user)}" target="_blank" rel="noreferrer">
              <span class="msr">open_in_new</span><span>Abrir @${escapeHtml(user)}</span>
            </a>
          </div>
        </div>
      `;
      return;
    }

    let items = [];
    try{
      const doc = new DOMParser().parseFromString(xmlText, "text/xml");
      const rssItems = Array.from(doc.querySelectorAll("item")).slice(0, 8);
      items = rssItems.map(it => ({
        title: it.querySelector("title")?.textContent || "",
        link: it.querySelector("link")?.textContent || "",
        date: it.querySelector("pubDate")?.textContent || ""
      })).filter(x => x.title || x.link);
      if (!items.length){
        // Atom
        const entries = Array.from(doc.querySelectorAll("entry")).slice(0, 8);
        items = entries.map(e => ({
          title: e.querySelector("title")?.textContent || "",
          link: e.querySelector("link")?.getAttribute("href") || "",
          date: e.querySelector("updated")?.textContent || e.querySelector("published")?.textContent || ""
        })).filter(x => x.title || x.link);
      }
    }catch{
      items = [];
    }

    const userUrl = `https://x.com/${user}`;

    el.xFallback.innerHTML = `
      <div class="xFallbackBox">
        <div class="xFallbackTitle">Feed alternativo (RSS)</div>
        <div class="xFallbackMsg">Si el embed de X está bloqueado, aquí tienes un resumen reciente.</div>
        <div class="xFallbackActions">
          <a class="btn" href="${escapeHtml(userUrl)}" target="_blank" rel="noreferrer">
            <span class="msr">open_in_new</span><span>Abrir @${escapeHtml(user)}</span>
          </a>
        </div>
        ${
          items.length
            ? `<ul class="xFallbackList">
                ${items.map(x => `
                  <li>
                    <a href="${escapeHtml(x.link || userUrl)}" target="_blank" rel="noreferrer">
                      ${escapeHtml(x.title).slice(0, 140)}
                    </a>
                  </li>
                `).join("")}
              </ul>`
            : `<div class="xFallbackMsg muted">No se pudieron extraer items del RSS.</div>`
        }
      </div>
    `;
  }

  async function mountXTimeline(){
    if (!el.xTimelineMount) return;

    setHidden(el.xFallback, true);

    const user = getXUser();

    el.xTimelineMount.innerHTML = `
      <a class="twitter-timeline"
         data-theme="dark"
         data-dnt="true"
         data-chrome="noheader nofooter noborders transparent"
         data-tweet-limit="6"
         data-height="680"
         href="https://twitter.com/${escapeHtml(user)}">
         Tweets by @${escapeHtml(user)}
      </a>
    `;

    const ok = await ensureTwitterWidgets();
    if (!ok){
      setHidden(el.xFallback, false);
      await loadXFallbackFeed().catch(()=>{});
      return;
    }

    try{
      await window.twttr.widgets.load(el.xTimelineMount);
    }catch{}

    setTimeoutSafe(async () => {
      try{ await window.twttr.widgets.load(el.xTimelineMount); }catch{}
    }, 900);

    setTimeoutSafe(async () => {
      const iframe = el.xTimelineMount.querySelector("iframe");
      if (!iframe){
        setHidden(el.xFallback, false);
        await loadXFallbackFeed().catch(()=>{});
      }
    }, 1800);
  }

  /* ───────────────────────────── Config modal ───────────────────────────── */
  function openCfg(){
    if (!el.cfgModal) return;
    if (el.cfgAuto) el.cfgAuto.checked = !!cfg.auto;
    if (el.cfgEvery) el.cfgEvery.value = String(clamp(cfg.everySec || 120, 35, 900));
    if (el.cfgMaxPosts) el.cfgMaxPosts.value = String(clamp(cfg.maxPosts || 45, 10, 120));
    if (el.cfgNoThumbs) el.cfgNoThumbs.checked = !!cfg.noThumbs;
    if (el.cfgTickerSpeed) el.cfgTickerSpeed.value = String(clamp(cfg.tickerSpeed || 120, 30, 300));
    setHidden(el.cfgModal, false);
  }
  function closeCfg(){ setHidden(el.cfgModal, true); }
  function saveCfg(){
    cfg.auto = !!el.cfgAuto?.checked;
    cfg.everySec = clamp(el.cfgEvery?.value || 120, 35, 900);
    cfg.maxPosts = clamp(el.cfgMaxPosts?.value || 45, 10, 120);
    cfg.noThumbs = !!el.cfgNoThumbs?.checked;
    cfg.tickerSpeed = clamp(el.cfgTickerSpeed?.value || 120, 30, 300);

    saveJSON(LS_CFG, cfg);
    applyUIFlags();
    render();
    if (ui.ticker) renderTicker();
    closeCfg();
  }

  /* ───────────────────────────── Refresh ───────────────────────────── */
  let refreshTimer = null;
  let labelTimer = null;
  let refreshing = false;

  function setNetLabel(){
    if (!el.netStatus) return;
    el.netStatus.textContent = navigator.onLine ? "Online" : "Offline";
  }

  function setLastUpdatedLabel(){
    if (!el.lastUpdated) return;
    if (!state.lastRefreshMs){
      el.lastUpdated.textContent = "—";
      return;
    }
    const ago = formatAgoMs(Date.now() - state.lastRefreshMs);
    el.lastUpdated.textContent = (ago === "ahora") ? "Ahora" : `hace ${ago}`;
  }

  function scheduleAuto(){
    clearTracked(refreshTimer);
    refreshTimer = null;

    if (!cfg.auto) return;

    const ms = clamp(cfg.everySec || 120, 35, 900) * 1000;
    refreshTimer = setIntervalSafe(() => { refreshAll().catch(()=>{}); }, ms);
  }

  function startUpdatedLabelTicker(){
    clearTracked(labelTimer);
    labelTimer = null;
    labelTimer = setIntervalSafe(() => { setLastUpdatedLabel(); }, 5000);
  }

  function cacheSave(key, payload){
    saveJSON(key, { ts: Date.now(), payload });
  }
  function cacheLoad(key){
    const c = loadJSON(key, null);
    if (!c || !c.payload) return null;
    return c;
  }

  async function refreshAll(){
    if (refreshing) return;
    if (!softAssertBasics()) return;

    refreshing = true;
    showErr("");
    showEmpty(false);

    if (el.lastUpdated) el.lastUpdated.textContent = "Actualizando…";

    try{
      const memesRes = await fetchMemes();
      state.memes = memesRes.items || [];
      cacheSave(LS_CACHE_MEMES, state.memes);

      if (memesRes.errs?.length && !state.memes.length){
        showErr(`Memes: ${memesRes.errs.join(" | ")}`);
      }

      try{
        state.trends = await fetchTrends();
        cacheSave(LS_CACHE_TR, state.trends);
      }catch(err){
        const cached = cacheLoad(LS_CACHE_TR);
        if (cached?.payload?.length){
          state.trends = cached.payload;
          if (ui.view === "trends"){
            showErr(`Tendencias: fallo de red, usando cache (${formatAgoMs(Date.now()-cached.ts)}).`);
          }
        }else{
          if (ui.view === "trends") showErr(`Tendencias: ${err.message || err}`);
          state.trends = [];
        }
      }

      state.lastRefreshMs = Date.now();
      setLastUpdatedLabel();
      render();
      if (ui.ticker) renderTicker();
    }catch(err){
      const cachedM = cacheLoad(LS_CACHE_MEMES);
      if (cachedM?.payload?.length){
        state.memes = cachedM.payload;
        showErr(`Fallo de red, usando cache (${formatAgoMs(Date.now()-cachedM.ts)}).`);
        render();
        if (ui.ticker) renderTicker();
      }else{
        showErr(err?.message || String(err));
      }
      if (el.lastUpdated) el.lastUpdated.textContent = "—";
    }finally{
      refreshing = false;
    }
  }

  /* ───────────────────────────── Events ───────────────────────────── */
  function bind(){
    on(window, "online", setNetLabel);
    on(window, "offline", setNetLabel);

    on(el.tabMemes, "click", () => setActiveTab("memes"));
    on(el.tabTrends, "click", () => setActiveTab("trends"));
    on(el.tabFavs, "click", () => setActiveTab("favs"));

    on(el.btnRefresh, "click", () => refreshAll());
    on(el.btnReloadX, "click", () => mountXTimeline());

    on(el.btnCompact, "click", () => {
      ui.compact = !ui.compact;
      saveJSON(LS_UI, ui);
      applyUIFlags();
    });

    on(el.btnTicker, "click", () => setTickerVisible(!ui.ticker));
    on(el.tickerClose, "click", () => setTickerVisible(false));

    on(el.btnConfig, "click", openCfg);
    on(el.cfgClose, "click", closeCfg);
    on(el.cfgSave, "click", () => { saveCfg(); scheduleAuto(); });

    on(el.cfgModal, "click", (e) => { if (e.target === el.cfgModal) closeCfg(); });

    on(el.q, "input", render);
    on(el.selSource, "change", refreshAll);
    on(el.selSort, "change", refreshAll);
    on(el.selRange, "change", refreshAll);

    on(window, "keydown", (e) => {
      if (e.key === "Escape" && el.cfgModal && !el.cfgModal.classList.contains("hidden")){
        closeCfg();
      }
    });
  }

  /* ───────────────────────────── SW (opcional) ───────────────────────────── */
  function registerSW(){
    try{
      if (!("serviceWorker" in navigator)) return;
      navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch(()=>{});
    }catch{}
  }

  /* ───────────────────────────── Splash (opcional, no rompe si no existe) ───────────────────────────── */
  function handleOptionalSplashMinMs(minMs=5000){
    const splash = pickFirst("#splash", "#bootSplash", "#loadingSplash");
    if (!splash) return { done: () => {} };

    const start = Date.now();
    let finished = false;

    function hide(){
      if (finished) return;
      finished = true;
      splash.classList.add("hidden");
      try{ splash.setAttribute("aria-hidden","true"); }catch{}
    }

    // Nunca antes del mínimo
    const t = setTimeoutSafe(() => hide(), minMs);

    return {
      done: () => {
        const elapsed = Date.now() - start;
        const remain = Math.max(0, minMs - elapsed);
        clearTracked(t);
        setTimeoutSafe(() => hide(), remain);
      }
    };
  }

  /* ───────────────────────────── Init ───────────────────────────── */
  function init(){
    const splash = handleOptionalSplashMinMs(5000);

    setNetLabel();
    applyUIFlags();
    startUpdatedLabelTicker();

    setActiveTab(ui.view || "memes");

    mountXTimeline().catch(()=>{});

    const cachedM = cacheLoad(LS_CACHE_MEMES);
    if (cachedM?.payload?.length) state.memes = cachedM.payload;

    const cachedT = cacheLoad(LS_CACHE_TR);
    if (cachedT?.payload?.length) state.trends = cachedT.payload;

    render();

    refreshAll().finally(() => {
      splash.done();
    }).catch(() => {
      splash.done();
    });

    scheduleAuto();
    registerSW();
  }

  bind();
  init();
})();
