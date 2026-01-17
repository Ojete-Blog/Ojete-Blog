/* app.js — GlobalEye Memes + Trends + X timeline (FINAL)
   - Header sin duplicados (solo render/estilos correctos desde HTML/CSS)
   - Memes: SOLO posts con imagen o vídeo (filtrado robusto)
   - Trends: GDELT (open data) con parse seguro (evita "Unexpected token 'Y'")
   - Timeline X: montaje robusto + botón recargar + fallback si bloqueado
   - Votos y favoritos persistentes (localStorage)
*/

(() => {
  "use strict";

  const APP_VERSION = "ge-memes-trends-final";
  const BUILD_ID = "2026-01-17a";

  // Guard anti doble carga
  try{
    const tag = `${APP_VERSION}:${BUILD_ID}`;
    if (window.__GE_APP__?.tag === tag) return;
    window.__GE_APP__ = { tag };
  }catch{}

  /* --------------------------- Helpers DOM --------------------------- */
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  function setHidden(el, hidden){
    if (!el) return;
    el.classList.toggle("hidden", !!hidden);
  }

  function nowMs(){ return Date.now(); }

  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  function formatAgo(tsMs){
    const s = Math.floor((Date.now() - tsMs) / 1000);
    if (s < 10) return "ahora";
    if (s < 60) return `${s}s`;
    const m = Math.floor(s/60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m/60);
    if (h < 48) return `${h}h`;
    const d = Math.floor(h/24);
    return `${d}d`;
  }

  function fmtNum(n){
    if (!Number.isFinite(n)) return "0";
    if (n >= 1e6) return `${(n/1e6).toFixed(1).replace(/\.0$/,"")}M`;
    if (n >= 1e3) return `${(n/1e3).toFixed(1).replace(/\.0$/,"")}K`;
    return String(n);
  }

  /* --------------------------- Storage --------------------------- */
  const LS_CFG = "ge_cfg_v1";
  const LS_VOTES = "ge_votes_v1";
  const LS_FAVS = "ge_favs_v1";
  const LS_UI = "ge_ui_v1";

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
    tickerSpeed: 120
  }, loadJSON(LS_CFG, {}));

  const votes = Object.assign({}, loadJSON(LS_VOTES, {})); // { [id]: -1|0|1 }
  const favs = Object.assign({}, loadJSON(LS_FAVS, {}));   // { [id]: item }
  const ui = Object.assign({
    view: "memes",
    compact: false,
    ticker: false
  }, loadJSON(LS_UI, {}));

  /* --------------------------- Elements --------------------------- */
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

    xTimelineMount: $("#xTimelineMount"),
    xFallback: $("#xFallback"),

    tickerBar: $("#tickerBar"),
    tickerTrack: $("#tickerTrack"),

    cfgModal: $("#cfgModal"),
    cfgClose: $("#cfgClose"),
    cfgSave: $("#cfgSave"),
    cfgAuto: $("#cfgAuto"),
    cfgEvery: $("#cfgEvery"),
    cfgMaxPosts: $("#cfgMaxPosts"),
    cfgNoThumbs: $("#cfgNoThumbs"),
    cfgTickerSpeed: $("#cfgTickerSpeed")
  };

  /* --------------------------- Networking (robusto) --------------------------- */
  function mkAbort(ms){
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort("timeout"), ms);
    return { ac, done: () => clearTimeout(t) };
  }

  async function fetchText(url, timeoutMs=12000){
    const { ac, done } = mkAbort(timeoutMs);
    try{
      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
        mode: "cors",
        signal: ac.signal,
        headers: { "accept": "application/json,text/plain,*/*" }
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text, headers: res.headers };
    }finally{
      done();
    }
  }

  function safeJsonParse(text){
    try{ return JSON.parse(text); }catch{ return null; }
  }

  async function fetchJsonSmart(url, timeoutMs=12000){
    const r = await fetchText(url, timeoutMs);
    const json = safeJsonParse(r.text);
    if (!json){
      const snippet = String(r.text || "").slice(0, 180).replace(/\s+/g, " ").trim();
      throw new Error(`Respuesta no-JSON (${r.status}). ${snippet || "Vacía"}`);
    }
    if (!r.ok){
      throw new Error(`HTTP ${r.status}`);
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
    throw lastErr || new Error("No se pudo cargar");
  }

  /* --------------------------- Reddit (memes) --------------------------- */
  const REDDIT_SUBS_MIX = ["memes", "dankmemes", "me_irl", "wholesomememes"];

  function redditEndpoint(sub, sort, limit){
    const s = (sort === "best") ? "new" : sort;
    let url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/${encodeURIComponent(s)}.json?limit=${encodeURIComponent(limit)}&raw_json=1`;
    if (s === "top") url += `&t=day`;
    return url;
  }

  function proxyUrlsFor(url){
    // Fallbacks best-effort por si Reddit bloquea CORS o hay rate limit
    return [
      url,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
      `https://thingproxy.freeboard.io/fetch/${url}`
    ];
  }

  function isImgUrl(u){
    return /\.(png|jpe?g|gif|webp)$/i.test(u || "");
  }
  function isMp4Url(u){
    return /\.mp4(\?|$)/i.test(u || "");
  }

  function pickBestPreview(post){
    const img = post?.preview?.images?.[0];
    if (!img) return null;
    const src = img?.source?.url || null;
    if (!src) return null;
    // raw_json=1 suele venir limpio, pero por si acaso:
    return src.replaceAll("&amp;", "&");
  }

  function pickGallery(post){
    if (!post?.is_gallery || !post?.media_metadata) return null;
    const keys = Object.keys(post.media_metadata);
    if (!keys.length) return null;
    const k = keys[0];
    const m = post.media_metadata[k];
    // Prefer u from "s"
    const u = m?.s?.u || m?.s?.gif || null;
    if (u) return String(u).replaceAll("&amp;", "&");
    // Si no, intentamos construir i.redd.it
    const mime = m?.m || "image/jpg";
    const ext = mime.includes("/") ? mime.split("/")[1].replace("jpeg","jpg") : "jpg";
    return `https://i.redd.it/${k}.${ext}`;
  }

  function extractMedia(post){
    if (!post || post.over_18) return null;

    // Reddit vídeo nativo
    if (post.is_video && post.media && post.media.reddit_video && post.media.reddit_video.fallback_url){
      const v = String(post.media.reddit_video.fallback_url).replaceAll("&amp;", "&");
      return { type: "video", url: v };
    }

    // Gallery
    const g = pickGallery(post);
    if (g && (isImgUrl(g) || g.includes("i.redd.it/"))) return { type: "image", url: g };

    // Imagen directa (post_hint)
    const uod = post.url_overridden_by_dest ? String(post.url_overridden_by_dest) : "";
    if (post.post_hint === "image" && uod){
      const u = uod.replaceAll("&amp;", "&");
      if (isImgUrl(u) || u.includes("i.redd.it/") || u.includes("i.imgur.com/")) return { type: "image", url: u };
    }

    // Preview
    const p = pickBestPreview(post);
    if (p && (isImgUrl(p) || p.includes("i.redd.it/") || p.includes("external-preview.redd.it/"))) {
      return { type: "image", url: p };
    }

    // URL directa con extensión
    const url = (uod || post.url || "").toString().replaceAll("&amp;", "&");
    if (isImgUrl(url)) return { type: "image", url };
    if (isMp4Url(url)) return { type: "video", url };

    return null;
  }

  function mapRedditPostToItem(post){
    const media = extractMedia(post);
    if (!media) return null;

    const createdMs = Math.floor((post.created_utc || 0) * 1000);
    return {
      id: post.id,
      fullId: post.name,
      title: post.title || "",
      subreddit: post.subreddit || "",
      author: post.author || "",
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
    const rangeH = Number(el.selRange.value || 48);
    const limit = clamp(Number(cfg.maxPosts || 45), 10, 120);

    const sort = (el.selSort.value || "new");
    const source = (el.selSource.value || "mix");

    const subs = source === "mix" ? REDDIT_SUBS_MIX : [source];

    // Pedimos algo más de lo que mostraremos para poder filtrar por horas y media
    const perSubLimit = clamp(Math.ceil(limit * (source === "mix" ? 1.25 : 2.0)), 25, 100);

    const reqs = subs.map(sub => {
      const url = redditEndpoint(sub, sort, perSubLimit);
      const urls = proxyUrlsFor(url);
      return tryUrlsJson(urls, 12000).then(json => ({ sub, json })).catch(err => ({ sub, err }));
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

    // Orden
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
      // hot: mantenemos aproximación por score+recencia
      out.sort((a,b) => (b.score*0.7 + b.numComments*0.3) - (a.score*0.7 + a.numComments*0.3));
    }

    out = out.slice(0, limit);

    return { items: out, errs };
  }

  /* --------------------------- GDELT (tendencias) --------------------------- */
  const GDELT_DOC = "https://api.gdeltproject.org/api/v2/doc/doc";

  function gdeltTimespanForHours(h){
    if (h <= 24) return "1d";
    if (h <= 48) return "2d";
    return "3d";
  }

  function buildGdeltQuery(){
    // Queremos titulares recientes, sin requerir keywords raras.
    // Fuente país/idioma opcional se podría añadir, pero para asegurar resultados:
    // Usamos un query "news" + filtros suaves.
    // (Si pones solo operadores y la query queda demasiado "vacía", GDELT puede responder con texto.)
    return `(news OR viral OR trending OR meme OR internet)`;
  }

  async function fetchTrends(){
    const rangeH = Number(el.selRange.value || 48);
    const timespan = gdeltTimespanForHours(rangeH);

    const query = buildGdeltQuery();
    const params = new URLSearchParams({
      query,
      mode: "artlist",
      format: "json",
      sort: "datedesc",
      maxrecords: "200",
      timespan
    });

    const url = `${GDELT_DOC}?${params.toString()}`;

    // GDELT normalmente tiene CORS abierto, pero hacemos parse seguro:
    const json = await fetchJsonSmart(url, 14000);

    const articles = Array.isArray(json?.articles) ? json.articles : [];
    const cutoff = Date.now() - (rangeH * 3600 * 1000);

    const titles = articles
      .filter(a => a && a.title)
      .filter(a => {
        const dt = a.seendate || a.datetime || a.date || a.sourceCountry; // fallback
        // Si no hay fecha, no filtramos por fecha (para no quedarnos a 0)
        if (!a.seendate && !a.datetime && !a.date) return true;
        const t = Date.parse(a.seendate || a.datetime || a.date);
        if (!Number.isFinite(t)) return true;
        return t >= cutoff;
      })
      .map(a => String(a.title));

    const trends = scoreTrendsFromTitles(titles);
    return trends;
  }

  const STOP = new Set([
    "de","la","el","y","a","en","un","una","unos","unas","que","se","por","para","con","sin","del","al",
    "lo","los","las","su","sus","es","son","fue","han","hoy","ayer","mañana","ya","más","menos","muy",
    "the","and","or","to","in","on","for","with","without","is","are","was","were","be","been","it","this","that",
    "as","at","by","from","an","a","of","you","your","they","their"
  ]);

  function cleanToken(t){
    return t
      .toLowerCase()
      .replace(/[“”"’'`´]/g, "")
      .replace(/[^\p{L}\p{N}_#@]+/gu, "")
      .trim();
  }

  function scoreTrendsFromTitles(titles){
    const counts = new Map();

    function bump(k, w=1){
      if (!k || k.length < 3) return;
      counts.set(k, (counts.get(k) || 0) + w);
    }

    for (const title of titles){
      const raw = String(title || "");
      const words0 = raw.split(/\s+/g).map(cleanToken).filter(Boolean);

      // hashtags y @
      for (const w of words0){
        if (w.startsWith("#") && w.length > 2) bump(w, 4);
        else if (w.startsWith("@") && w.length > 2) bump(w, 4);
      }

      const words = words0
        .filter(w => !w.startsWith("#") && !w.startsWith("@"))
        .filter(w => w.length >= 3)
        .filter(w => !STOP.has(w));

      // unigram
      for (const w of words) bump(w, 1);

      // bigram / trigram (frases)
      for (let i=0;i<words.length-1;i++){
        const a = words[i], b = words[i+1];
        if (!a || !b) continue;
        bump(`${a} ${b}`, 2.2);
      }
      for (let i=0;i<words.length-2;i++){
        const a = words[i], b = words[i+1], c = words[i+2];
        if (!a || !b || !c) continue;
        bump(`${a} ${b} ${c}`, 3.0);
      }
    }

    // ranking
    const arr = Array.from(counts.entries())
      .map(([k,score]) => ({ text: k, score }))
      .sort((a,b) => b.score - a.score)
      .slice(0, 40);

    // categoría simple
    for (const t of arr){
      const s = t.text;
      t.cat =
        /(eleccion|gobierno|presidente|congreso|politic|election|government)/i.test(s) ? "Política" :
        /(futbol|liga|nba|nfl|mlb|deport|sport)/i.test(s) ? "Deportes" :
        /(viral|meme|internet|tiktok|trend)/i.test(s) ? "Viral" : "Noticias";
    }

    return arr;
  }

  /* --------------------------- Render --------------------------- */
  let state = {
    memes: [],
    trends: []
  };

  function showErr(msg){
    el.errBanner.textContent = msg || "Error";
    setHidden(el.errBanner, !msg);
  }
  function showEmpty(on){
    setHidden(el.emptyBanner, !on);
  }

  function applyUIFlags(){
    document.documentElement.toggleAttribute("data-compact", !!ui.compact);
    document.documentElement.setAttribute("data-compact", ui.compact ? "1" : "0");

    document.documentElement.setAttribute("data-noThumbs", cfg.noThumbs ? "1" : "0");

    el.tickerBar.style.setProperty("--tickerSpeed", `${clamp(Number(cfg.tickerSpeed||120),30,300)}s`);
    setHidden(el.tickerBar, !ui.ticker);

    el.btnCompact.classList.toggle("isOn", !!ui.compact);
    el.btnTicker.classList.toggle("isOn", !!ui.ticker);
  }

  function setActiveTab(view){
    ui.view = view;
    saveJSON(LS_UI, ui);

    el.tabMemes.classList.toggle("isActive", view === "memes");
    el.tabTrends.classList.toggle("isActive", view === "trends");
    el.tabFavs.classList.toggle("isActive", view === "favs");

    setHidden(el.viewMemes, view !== "memes");
    setHidden(el.viewTrends, view !== "trends");
    setHidden(el.viewFavs, view !== "favs");

    // Re-render vista activa (por si cambia)
    render();
  }

  function render(){
    showErr("");
    showEmpty(false);

    if (ui.view === "memes") renderMemes();
    else if (ui.view === "trends") renderTrends();
    else renderFavs();
  }

  function passesSearch(text){
    const q = (el.q.value || "").trim().toLowerCase();
    if (!q) return true;
    return String(text || "").toLowerCase().includes(q);
  }

  function renderMemes(){
    const list = el.memesList;
    list.innerHTML = "";

    const items = state.memes.filter(it => passesSearch(it.title));
    if (!items.length){
      showEmpty(true);
      return;
    }

    for (const it of items){
      list.appendChild(renderMemeCard(it));
    }
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
    btnUp.addEventListener("click", (e) => { e.stopPropagation(); setVote(it.id, v === 1 ? 0 : 1); });

    const score = document.createElement("div");
    score.className = "voteScore";
    score.textContent = v === 0 ? "·" : (v === 1 ? "+1" : "-1");

    const btnDown = document.createElement("button");
    btnDown.className = "iconBtn voteBtn down" + (v === -1 ? " isOn" : "");
    btnDown.type = "button";
    btnDown.title = "Downvote";
    btnDown.innerHTML = `<span class="msr">arrow_downward</span>`;
    btnDown.addEventListener("click", (e) => { e.stopPropagation(); setVote(it.id, v === -1 ? 0 : -1); });

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
      <span>${formatAgo(it.createdMs)}</span>
      <span class="mDot">•</span>
      <a href="${it.permalink}" target="_blank" rel="noreferrer">Abrir</a>
    `;

    const title = document.createElement("div");
    title.className = "mTitle";
    title.textContent = it.title || "";

    const media = document.createElement("div");
    media.className = "mMedia";

    if (it.mediaType === "video"){
      const vid = document.createElement("video");
      vid.src = it.mediaUrl;
      vid.controls = true;
      vid.playsInline = true;
      vid.preload = "metadata";
      vid.muted = true;
      media.appendChild(vid);
    }else{
      const img = document.createElement("img");
      img.src = it.mediaUrl;
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = it.title || "meme";
      img.referrerPolicy = "no-referrer";
      media.appendChild(img);
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
    favBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFav(it);
    });

    actions.appendChild(favBtn);

    foot.appendChild(chips);
    foot.appendChild(actions);

    body.appendChild(meta);
    body.appendChild(title);
    body.appendChild(media);
    body.appendChild(foot);

    card.appendChild(votesCol);
    card.appendChild(body);

    // click en tarjeta abre permalink
    card.addEventListener("click", () => {
      if (it.permalink) window.open(it.permalink, "_blank", "noreferrer");
    });

    return card;
  }

  function renderTrends(){
    const list = el.trendsList;
    list.innerHTML = "";

    const items = state.trends.filter(it => passesSearch(it.text));
    if (!items.length){
      showEmpty(true);
      return;
    }

    let rank = 0;
    for (const t of items){
      rank++;
      const row = document.createElement("div");
      row.className = "tRow";

      const q = encodeURIComponent(t.text);
      const xUrl = `https://x.com/search?q=${q}`;

      row.innerHTML = `
        <div class="tRank">${rank}</div>
        <div class="tMain">
          <div class="tText">${escapeHtml(t.text)}</div>
          <div class="tMeta">
            <span>${escapeHtml(t.cat || "Noticias")}</span>
            <span>score ${Math.round(t.score)}</span>
          </div>
        </div>
        <div class="tActions">
          <a class="iconBtn" href="${xUrl}" target="_blank" rel="noreferrer" title="Buscar en X">
            <span class="msr">search</span>
          </a>
        </div>
      `;

      list.appendChild(row);
    }
  }

  function renderFavs(){
    const list = el.favsList;
    list.innerHTML = "";

    const items = Object.values(favs || {}).filter(Boolean);

    const filtered = items.filter(it => passesSearch(it.title || it.text || ""));
    if (!filtered.length){
      showEmpty(true);
      return;
    }

    // Orden: más reciente primero
    filtered.sort((a,b) => (b.createdMs||0) - (a.createdMs||0));

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
            <button class="iconBtn isOn" type="button" title="Quitar favorito">
              <span class="msr">star</span>
            </button>
          </div>
        `;
        row.querySelector("button")?.addEventListener("click", () => {
          delete favs[it.id];
          saveJSON(LS_FAVS, favs);
          renderFavs();
        });
        list.appendChild(row);
      }else{
        // Meme fav
        list.appendChild(renderMemeCard(it));
      }
    }
  }

  function escapeHtml(s){
    return String(s || "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  /* --------------------------- Votos / Favoritos --------------------------- */
  function setVote(id, val){
    votes[id] = val;
    saveJSON(LS_VOTES, votes);
    render();

    // ticker puede usar "best"
    if (ui.ticker) renderTicker();
  }

  function toggleFav(item){
    const id = item.id || item.text;
    if (!id) return;

    if (favs[id]){
      delete favs[id];
    }else{
      // Guardamos una copia ligera para que "Favoritos" renderice aunque no se haya fetcheado luego
      const copy = Object.assign({}, item);
      favs[id] = copy;
    }
    saveJSON(LS_FAVS, favs);
    render();
  }

  /* --------------------------- Ticker --------------------------- */
  function renderTicker(){
    const track = el.tickerTrack;
    track.innerHTML = "";

    // Elegimos contenido según vista
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

  /* --------------------------- X Timeline --------------------------- */
  let twLoaded = false;
  let twLoading = null;

  function loadTwitterWidgets(){
    if (twLoaded) return Promise.resolve(true);
    if (twLoading) return twLoading;

    twLoading = new Promise((resolve) => {
      // Si ya está (por cache o algo)
      if (window.twttr && window.twttr.widgets){
        twLoaded = true;
        resolve(true);
        return;
      }

      const s = document.createElement("script");
      s.src = "https://platform.twitter.com/widgets.js";
      s.async = true;
      s.onload = () => {
        twLoaded = true;
        resolve(true);
      };
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });

    return twLoading;
  }

  async function mountXTimeline(){
    setHidden(el.xFallback, true);

    // Re-montamos anchor (widget necesita el markup base)
    el.xTimelineMount.innerHTML = `
      <a class="twitter-timeline"
         data-theme="dark"
         data-dnt="true"
         data-chrome="noheader nofooter noborders transparent"
         data-tweet-limit="6"
         href="https://twitter.com/GlobalEye_TV">
         Tweets by @GlobalEye_TV
      </a>
    `;

    const ok = await loadTwitterWidgets();
    if (!ok){
      setHidden(el.xFallback, false);
      return;
    }

    try{
      if (window.twttr && window.twttr.widgets){
        await window.twttr.widgets.load(el.xTimelineMount);
      }
    }catch{}

    // Comprobación: si no aparece iframe, mostramos fallback
    setTimeout(() => {
      const iframe = el.xTimelineMount.querySelector("iframe");
      if (!iframe) setHidden(el.xFallback, false);
    }, 1800);
  }

  /* --------------------------- Config UI --------------------------- */
  function openCfg(){
    el.cfgAuto.checked = !!cfg.auto;
    el.cfgEvery.value = String(clamp(Number(cfg.everySec||120), 35, 900));
    el.cfgMaxPosts.value = String(clamp(Number(cfg.maxPosts||45), 10, 120));
    el.cfgNoThumbs.checked = !!cfg.noThumbs;
    el.cfgTickerSpeed.value = String(clamp(Number(cfg.tickerSpeed||120), 30, 300));
    setHidden(el.cfgModal, false);
  }
  function closeCfg(){
    setHidden(el.cfgModal, true);
  }
  function saveCfg(){
    cfg.auto = !!el.cfgAuto.checked;
    cfg.everySec = clamp(Number(el.cfgEvery.value||120), 35, 900);
    cfg.maxPosts = clamp(Number(el.cfgMaxPosts.value||45), 10, 120);
    cfg.noThumbs = !!el.cfgNoThumbs.checked;
    cfg.tickerSpeed = clamp(Number(el.cfgTickerSpeed.value||120), 30, 300);

    saveJSON(LS_CFG, cfg);
    applyUIFlags();
    render();
    if (ui.ticker) renderTicker();
    closeCfg();
  }

  /* --------------------------- Refresh (memes + trends) --------------------------- */
  let refreshTimer = null;
  let refreshing = false;

  async function refreshAll(){
    if (refreshing) return;
    refreshing = true;

    showErr("");
    showEmpty(false);

    el.lastUpdated.textContent = "Actualizando…";

    try{
      // 1) Memes
      const memesRes = await fetchMemes();
      state.memes = memesRes.items || [];

      // si hay errores parciales de subreddits, los mostramos suave (pero no rompemos)
      if (memesRes.errs && memesRes.errs.length){
        // NO lo marcamos como fallo total si tenemos memes.
        if (!state.memes.length){
          showErr(`Memes: ${memesRes.errs.join(" | ")}`);
        }
      }

      // 2) Trends
      try{
        state.trends = await fetchTrends();
      }catch(err){
        // si falla trends, no rompemos memes
        if (ui.view === "trends"){
          showErr(`Tendencias: ${err.message || err}`);
        }
        state.trends = state.trends || [];
      }

      el.lastUpdated.textContent = formatAgo(Date.now()) === "ahora" ? "Ahora" : `hace ${formatAgo(Date.now())}`;
      render();

      if (ui.ticker) renderTicker();
    }catch(err){
      showErr(err?.message || String(err));
      el.lastUpdated.textContent = "—";
    }finally{
      refreshing = false;
    }
  }

  function scheduleAuto(){
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    if (!cfg.auto) return;

    const ms = clamp(Number(cfg.everySec||120), 35, 900) * 1000;
    refreshTimer = setInterval(() => {
      refreshAll().catch(()=>{});
    }, ms);
  }

  /* --------------------------- Events --------------------------- */
  function bind(){
    window.addEventListener("online", () => { el.netStatus.textContent = "Online"; });
    window.addEventListener("offline", () => { el.netStatus.textContent = "Offline"; });

    el.tabMemes.addEventListener("click", () => setActiveTab("memes"));
    el.tabTrends.addEventListener("click", () => setActiveTab("trends"));
    el.tabFavs.addEventListener("click", () => setActiveTab("favs"));

    el.btnRefresh.addEventListener("click", () => refreshAll());
    el.btnReloadX.addEventListener("click", () => mountXTimeline());

    el.btnCompact.addEventListener("click", () => {
      ui.compact = !ui.compact;
      saveJSON(LS_UI, ui);
      applyUIFlags();
    });

    el.btnTicker.addEventListener("click", () => {
      ui.ticker = !ui.ticker;
      saveJSON(LS_UI, ui);
      applyUIFlags();
      if (ui.ticker) renderTicker();
    });

    el.btnConfig.addEventListener("click", () => openCfg());
    el.cfgClose.addEventListener("click", () => closeCfg());
    el.cfgSave.addEventListener("click", () => { saveCfg(); scheduleAuto(); });

    el.cfgModal.addEventListener("click", (e) => {
      if (e.target === el.cfgModal) closeCfg();
    });

    // Filtros/búsqueda
    el.q.addEventListener("input", () => render());
    el.selSource.addEventListener("change", () => refreshAll());
    el.selSort.addEventListener("change", () => refreshAll());
    el.selRange.addEventListener("change", () => refreshAll());

    // ESC cierra modal
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !el.cfgModal.classList.contains("hidden")){
        closeCfg();
      }
    });
  }

  /* --------------------------- SW (opcional) --------------------------- */
  function registerSW(){
    try{
      if (!("serviceWorker" in navigator)) return;
      navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch(()=>{});
    }catch{}
  }

  /* --------------------------- Init --------------------------- */
  function init(){
    // UI flags
    document.documentElement.setAttribute("data-compact", ui.compact ? "1" : "0");
    document.documentElement.setAttribute("data-noThumbs", cfg.noThumbs ? "1" : "0");

    // estado inicial
    setActiveTab(ui.view || "memes");
    applyUIFlags();

    // config defaults
    scheduleAuto();

    // timeline X
    mountXTimeline().catch(()=>{});

    // arranque
    refreshAll().catch(()=>{});

    // SW
    registerSW();
  }

  bind();
  init();
})();
