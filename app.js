/* app.js — GlobalEye Trends (GitHub Pages) v1.1.0 — 2026-01-15b
   ✅ 100% frontend (GitHub Pages)
   ✅ Branding: logo + banner + gif para alertas
   ✅ Ko-fi integrado (link directo)
   ✅ Mejor detección de ENTIDADES (nombres propios) + trending phrases (2-4 palabras)
   ✅ Categorías heurísticas: Noticias / Viral / Política / Deportes
   ✅ Favoritos (localStorage) + alertas suaves
   ✅ Modo Ticker (marquee) con velocidad configurable
   ✅ Panel de configuración (sin romper IDs existentes)
*/

(() => {
  "use strict";

  const CFG = {
    xHandle: "GlobalEye_TV",
    xProfileUrl: "https://x.com/GlobalEye_TV",
    kofiUrl: "https://ko-fi.com/global_eye",

    // Open data con CORS OK
    gdeltBase: "https://api.gdeltproject.org/api/v2/doc/doc",

    // LocalStorage
    LS_SETTINGS: "ge_settings_v1",
    LS_RANKS: "ge_ranks_v2",
    LS_FAVS: "ge_favs_v1",
    LS_COMPACT: "ge_compact_v1",

    // Branding assets (en raíz)
    toastGif: "./logo_ojo_gif.gif",

    // Límites de seguridad
    MIN_REFRESH_MS: 35_000,
    MAX_REFRESH_MS: 15 * 60_000
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // Elementos existentes (no tocar IDs)
  const elList = $("#list");
  const elEmpty = $("#empty");
  const elErr = $("#err");
  const elLast = $("#lastUpdated");
  const elNet = $("#netStatus");
  const btnRefresh = $("#btnRefresh");
  const btnCompact = $("#btnCompact");
  const inpQ = $("#q");
  const selLang = $("#selLang");
  const selWindow = $("#selWindow");
  const selGeo = $("#selGeo");

  // Nuevos
  const btnConfig = $("#btnConfig");
  const cfgModal = $("#cfgModal");
  const cfgClose = $("#cfgClose");
  const cfgSave = $("#cfgSave");
  const cfgReset = $("#cfgReset");
  const cfgAuto = $("#cfgAuto");
  const cfgEvery = $("#cfgEvery");
  const cfgMaxTrends = $("#cfgMaxTrends");
  const cfgAlerts = $("#cfgAlerts");
  const cfgTicker = $("#cfgTicker");
  const cfgTickerSpeed = $("#cfgTickerSpeed");

  const toastHost = $("#toastHost");

  const tabsView = $("#tabsView");
  const tabsCat = $("#tabsCat");

  const btnTicker = $("#btnTicker");
  const tickerBar = $("#tickerBar");
  const tickerTrack = $("#tickerTrack");
  const tickerClose = $("#tickerClose");

  const STOP_ES = new Set([
    "de","la","el","los","las","un","una","unos","unas","y","o","u","a","en","por","para","con","sin","del","al",
    "se","su","sus","lo","le","les","que","como","más","mas","ya","hoy","ayer","mañana","ahora","sobre","tras",
    "ante","entre","desde","hasta","contra","durante","según","cuando","donde","quién","quien","qué","este","esta",
    "estos","estas","eso","esa","esos","esas","aquí","alli","allí","ahí","muy","también","tambien","ser","es","son",
    "fue","han","hay","sus","una","uno","dos","tres"
  ]);

  const STOP_EN = new Set([
    "the","a","an","and","or","to","of","in","on","for","with","without","from","by","as","at","is","are","was","were",
    "be","been","it","its","this","that","these","those","now","today","yesterday","tomorrow","about","after","before"
  ]);

  const CAT = {
    all: "all",
    news: "news",
    viral: "viral",
    politics: "politics",
    sports: "sports"
  };

  const CAT_LABEL = {
    [CAT.news]: "Noticias",
    [CAT.viral]: "Viral",
    [CAT.politics]: "Política",
    [CAT.sports]: "Deportes"
  };

  const DEFAULT_SETTINGS = {
    autoRefresh: true,
    refreshEveryMs: 120_000,
    refreshJitterMs: 12_000,
    maxArticles: 260,
    maxTrends: 24,
    alertsEnabled: true,
    tickerEnabled: false,
    tickerSpeedSec: 28
  };

  const state = {
    all: [],
    filtered: [],
    timer: null,
    abort: null,
    lastRanks: new Map(),
    favs: new Set(),
    view: "all",        // "all" | "favs"
    category: "all",    // "all" | CAT.*
    compact: false,
    settings: { ...DEFAULT_SETTINGS }
  };

  function safeLower(s){ return String(s || "").toLowerCase(); }
  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }
  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

  function escapeHtml(s){
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
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
    const pad = (n) => String(n).padStart(2,"0");
    elLast.textContent = `Actualizado: ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function showError(msg){
    if (!elErr) return;
    elErr.textContent = msg;
    elErr.classList.remove("hidden");
  }

  function clearError(){
    if (!elErr) return;
    elErr.classList.add("hidden");
    elErr.textContent = "";
  }

  function loadCompact(){
    try{
      const v = localStorage.getItem(CFG.LS_COMPACT);
      state.compact = v === "1";
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
    try{
      localStorage.setItem(CFG.LS_SETTINGS, JSON.stringify(state.settings));
    }catch{}
  }

  function applySettingsToUI(){
    // selects existentes
    if (selLang && state.settings.lang) selLang.value = state.settings.lang;
    if (selWindow && state.settings.window) selWindow.value = state.settings.window;
    if (selGeo && state.settings.geo) selGeo.value = state.settings.geo;

    // modal
    if (cfgAuto) cfgAuto.checked = !!state.settings.autoRefresh;
    if (cfgEvery) cfgEvery.value = String(Math.round(state.settings.refreshEveryMs / 1000));
    if (cfgMaxTrends) cfgMaxTrends.value = String(state.settings.maxTrends);
    if (cfgAlerts) cfgAlerts.checked = !!state.settings.alertsEnabled;
    if (cfgTicker) cfgTicker.checked = !!state.settings.tickerEnabled;
    if (cfgTickerSpeed) cfgTickerSpeed.value = String(state.settings.tickerSpeedSec);

    // ticker css
    document.documentElement.style.setProperty("--tickerDur", `${clamp(state.settings.tickerSpeedSec, 12, 120)}s`);
    setTickerVisible(!!state.settings.tickerEnabled);
  }

  function loadFavs(){
    try{
      const raw = localStorage.getItem(CFG.LS_FAVS);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)){
        state.favs = new Set(arr.filter(Boolean).map(String));
      }
    }catch{}
  }

  function saveFavs(){
    try{
      localStorage.setItem(CFG.LS_FAVS, JSON.stringify(Array.from(state.favs)));
    }catch{}
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
    applyFilter(); // re-render
  }

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
      setTimeout(() => el.remove(), 160);
    };

    el.querySelector(".toastX")?.addEventListener("click", kill);

    toastHost.appendChild(el);
    setTimeout(kill, 3400);
  }

  function pickTimespan(){
    const v = (selWindow?.value || "4H").toUpperCase();
    if (["2H","4H","6H","12H"].includes(v)) return v;
    return "4H";
  }

  function pickLang(){
    const v = (selLang?.value || "spanish").toLowerCase();
    if (v === "mixed") return "mixed";
    if (v === "english") return "english";
    return "spanish";
  }

  function pickGeo(){
    const v = (selGeo?.value || "ES").toUpperCase();
    return v === "GLOBAL" ? "GLOBAL" : "ES";
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

  function buildUrl(){
    const params = new URLSearchParams();
    params.set("format", "json");
    params.set("mode", "ArtList");
    params.set("sort", "hybridrel");
    params.set("maxrecords", String(state.settings.maxArticles));
    params.set("timespan", pickTimespan());
    params.set("query", buildGdeltQuery());
    return `${CFG.gdeltBase}?${params.toString()}`;
  }

  function isStop(tokenLower){
    return STOP_ES.has(tokenLower) || STOP_EN.has(tokenLower);
  }

  function splitWords(title){
    // Mantiene raw para detectar Capitalized / ALLCAPS
    const raw = String(title || "")
      .replace(/[\u2014\u2013]/g, " ")
      .replace(/[(){}\[\]"“”.,:;!?]/g, " ")
      .split(/\s+/g)
      .filter(Boolean);

    return raw.map(w => {
      const rawW = w.trim();
      const isHash = rawW.startsWith("#");
      const isAt = rawW.startsWith("@");
      const cleaned = rawW
        .replace(/[\u2019']/g, "")
        .replace(/[^\p{L}\p{N}#@]+/gu, "")
        .trim();

      const lower = cleaned.toLowerCase();
      const letters = cleaned.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "");
      const isAllCaps = letters.length >= 3 && letters === letters.toUpperCase();
      const isCap = letters.length >= 2 && letters[0] === letters[0]?.toUpperCase();

      return {
        raw: cleaned,
        lower,
        isHash,
        isAt,
        isAllCaps,
        isCap
      };
    }).filter(x => x.raw && x.lower);
  }

  function extractEntityPhrases(words){
    // Secuencias 2-4 palabras (Capitalized o ALLCAPS), permite conectores cortos dentro
    const out = [];
    const connectors = new Set(["de","del","la","las","los","y","e","da","do","of","the"]);

    for (let i = 0; i < words.length; i++){
      let parts = [];
      let score = 0;
      let j = i;
      while (j < words.length && parts.length < 6){
        const w = words[j];

        const pure = w.lower.replace(/^#|^@/, "");
        const isConnector = connectors.has(pure) && parts.length > 0;

        if (w.isHash || w.isAt){
          break;
        }

        if (w.isCap || w.isAllCaps){
          parts.push(w.raw);
          score++;
          j++;
          continue;
        }

        if (isConnector){
          parts.push(w.raw);
          j++;
          continue;
        }

        break;
      }

      const normParts = parts.filter(p => p && p.length >= 2);
      // Filtra conectores al final
      while (normParts.length && connectors.has(normParts[normParts.length-1].toLowerCase())) normParts.pop();

      // Elimina conectores duplicados y exige 2-4 “palabras reales”
      const realWords = normParts.filter(p => !connectors.has(p.toLowerCase()));
      if (realWords.length >= 2 && realWords.length <= 4 && score >= 2){
        const phrase = normParts.join(" ").replace(/\s+/g," ").trim();
        // Evita cosas tipo "El Gobierno" (demasiado genérico) si no hay apellido/segundo término claro
        const lower = phrase.toLowerCase();
        if (!/^(el|la|los|las)\s+(gobierno|presidente|ministro|ministerio)$/i.test(lower)){
          out.push(phrase);
        }
      }
    }

    // dedup simple
    return Array.from(new Set(out.map(x => x.trim()))).slice(0, 6);
  }

  function buildNgrams(tokensLower, n){
    const out = [];
    for (let i=0; i<=tokensLower.length-n; i++){
      const chunk = tokensLower.slice(i, i+n);
      if (chunk.some(t => isStop(t))) continue;
      if (chunk.some(t => t.length < 3)) continue;
      out.push(chunk.join(" "));
    }
    return out;
  }

  function classify(term, exampleTitle){
    const t = safeLower(term);
    const s = safeLower(exampleTitle);

    const sportsKw = [
      "liga","laliga","premier","champions","ucl","europa league","nba","nfl","mlb","fútbol","futbol","gol","derbi",
      "real madrid","barça","barcelona","atleti","atlético","sevilla","valencia","betis","tenis","formula 1","f1"
    ];

    const polKw = [
      "gobierno","congreso","senado","elecciones","presidente","ministro","ministerio","parlamento","partido",
      "moncloa","pp","psoe","vox","sumar","podemos","ue","europea","ukraine","otan","nato","israel","gaza"
    ];

    const viralKw = [
      "viral","meme","tiktok","streamer","influencer","youtuber","clip","trend","challenge","polémica","polémica",
      "drama","filtrado","filtración","filtracion","se hace viral","reventar","rompe internet"
    ];

    const hit = (arr) => arr.some(k => s.includes(k) || t.includes(k));

    if (hit(sportsKw)) return CAT.sports;
    if (hit(polKw)) return CAT.politics;
    if (hit(viralKw)) return CAT.viral;

    // hashtags deportivos típicos
    if (t.includes("#laliga") || t.includes("#ucl") || t.includes("#nba") || t.includes("#f1")) return CAT.sports;

    return CAT.news;
  }

  function computeTrends(articles){
    const map = new Map();   // key -> {term,label,count,score,...}
    const sample = new Map();// key -> {title,url,source}

    const add = (term, label, weight, a) => {
      const key = safeLower(term).trim();
      if (!key || key.length < 3) return;
      if (isStop(key.replace(/^#|^@/,""))) return;
      if (/^\d+$/.test(key)) return;

      const prev = map.get(key);
      if (!prev){
        map.set(key, {
          term,
          label,
          count: 1,
          weight
        });
        sample.set(key, {
          title: a.title || "",
          url: a.url || "",
          source: a.sourceCountry || a.sourceCollection || a.domain || ""
        });
      } else {
        prev.count++;
        // si aparece con mejor “forma” (más larga / más “humana”), actualiza label
        if ((label?.length || 0) > (prev.label?.length || 0)) prev.label = label;
        // weight medio (suave)
        prev.weight = Math.max(prev.weight, weight);
      }
    };

    for (const a of articles){
      const title = a?.title || "";
      if (!title) continue;

      const words = splitWords(title);

      // Hashtags / handles
      for (const w of words){
        if (w.isHash && w.lower.length >= 3) add(w.raw, w.raw, 2.1, a);
        if (w.isAt && w.lower.length >= 3) add(w.raw, w.raw, 1.9, a);
      }

      // Entidades (capitalizadas)
      const entities = extractEntityPhrases(words);
      for (const e of entities){
        add(e, e, 1.75, a);
      }

      // Tokens normalizados (para n-grams)
      const toks = words
        .map(w => w.lower.replace(/^#|^@/, ""))
        .map(t => t.replace(/[\u2019']/g, ""))
        .map(t => t.replace(/[^\p{L}\p{N}]+/gu, ""))
        .filter(Boolean)
        .filter(t => t.length >= 3)
        .filter(t => !isStop(t));

      // Unigrams (menos peso)
      for (const t of toks){
        add(t, titleCase(t), 1.0, a);
      }

      // Phrases 2-3 (trending phrases)
      const grams2 = buildNgrams(toks, 2);
      const grams3 = buildNgrams(toks, 3);

      for (const g of grams2) add(g, smartTitleCase(g), 1.45, a);
      for (const g of grams3) add(g, smartTitleCase(g), 1.60, a);
    }

    const items = Array.from(map.entries()).map(([key, v]) => {
      const smp = sample.get(key) || {};
      const isPhrase = v.term.includes(" ");
      const isHash = v.term.startsWith("#");
      const isAt = v.term.startsWith("@");

      const lenBoost = isPhrase ? 1.15 : 1.0;
      const specialBoost = isHash ? 1.25 : (isAt ? 1.10 : 1.0);

      const score = (v.count * v.weight) * lenBoost * specialBoost;

      const cat = classify(v.term, smp.title || "");

      return {
        term: v.term,
        label: v.label,
        count: v.count,
        score,
        category: cat,
        exampleTitle: smp.title || "",
        exampleUrl: smp.url || "",
        exampleSource: smp.source || ""
      };
    });

    items.sort((a,b) =>
      (b.score - a.score) ||
      (b.count - a.count) ||
      a.term.localeCompare(b.term)
    );

    const top = items.slice(0, clamp(state.settings.maxTrends, 10, 60));
    top.forEach((it, idx) => it.rank = idx + 1);

    return top;
  }

  function titleCaseWord(w){
    if (!w) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }

  function smartTitleCase(phrase){
    // respeta hashtags/handles, y title-case suave
    if (!phrase) return phrase;
    if (phrase.startsWith("#") || phrase.startsWith("@")) return phrase;
    return phrase.split(" ").map(titleCaseWord).join(" ");
  }

  function titleCase(token){
    if (!token) return token;
    if (token.startsWith("#") || token.startsWith("@")) return token;
    return titleCaseWord(token);
  }

  function loadLastRanks(){
    try{
      const raw = localStorage.getItem(CFG.LS_RANKS);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!Array.isArray(data?.items)) return;
      state.lastRanks.clear();
      for (const it of data.items){
        if (it?.term) state.lastRanks.set(String(it.term), Number(it.rank));
      }
    }catch{}
  }

  function saveRanks(items){
    try{
      localStorage.setItem(CFG.LS_RANKS, JSON.stringify({
        ts: Date.now(),
        items: items.map(x => ({ term: x.term, rank: x.rank }))
      }));
    }catch{}
  }

  function computeDelta(term, rank){
    const prev = state.lastRanks.get(String(term));
    if (!prev) return { kind:"new", text:"NEW" };
    if (prev === rank) return { kind:"", text:"=" };
    if (rank < prev) return { kind:"up", text:`▲ ${prev-rank}` };
    return { kind:"down", text:`▼ ${rank-prev}` };
  }

  function catBadge(cat){
    if (cat === CAT.news) return { cls:"news", txt:"Noticias" };
    if (cat === CAT.viral) return { cls:"viral", txt:"Viral" };
    if (cat === CAT.politics) return { cls:"politics", txt:"Política" };
    if (cat === CAT.sports) return { cls:"sports", txt:"Deportes" };
    return { cls:"news", txt:"Noticias" };
  }

  function render(items){
    if (!elList) return;

    elList.innerHTML = "";
    elEmpty?.classList.toggle("hidden", items.length !== 0);

    const frag = document.createDocumentFragment();

    items.forEach((it, i) => {
      const d = computeDelta(it.term, it.rank);
      const fav = state.favs.has(String(it.term));
      const cb = catBadge(it.category);

      const row = document.createElement("div");
      row.className = "trend";
      row.style.animationDelay = `${clamp(i * 22, 0, 280)}ms`;

      row.innerHTML = `
        <div class="rank">${it.rank}</div>

        <div class="tMain">
          <div class="tTitleRow">
            <div class="tTitle" title="${escapeHtml(it.label)}">${escapeHtml(it.label)}</div>
            <span class="catBadge ${cb.cls}">${escapeHtml(cb.txt)}</span>
          </div>
          <div class="tMeta">
            <span class="badge"><span class="delta ${d.kind}">${escapeHtml(d.text)}</span></span>
            <span class="badge">${escapeHtml(String(it.count))} menciones</span>
            ${it.exampleSource ? `<span class="badge">${escapeHtml(it.exampleSource)}</span>` : ""}
          </div>
        </div>

        <div class="actions">
          <button class="aBtn star ${fav ? "isFav":""}" data-fav="${encodeURIComponent(it.term)}"
                  title="${fav ? "Quitar de favoritos":"Guardar en favoritos"}">${fav ? "★":"☆"}</button>
          <button class="aBtn primary" data-x="${encodeURIComponent(it.term)}" title="Buscar en X">Ver en X</button>
          <button class="aBtn" data-more="1" title="Ver ejemplo">Ejemplo</button>
        </div>
      `;

      row.querySelector('[data-x]')?.addEventListener("click", (e) => {
        const q = e.currentTarget.getAttribute("data-x") || "";
        window.open(`https://x.com/search?q=${q}`, "_blank", "noreferrer");
      });

      row.querySelector('[data-more]')?.addEventListener("click", () => {
        const url = it.exampleUrl || "";
        if (url) window.open(url, "_blank", "noreferrer");
        else if (it.exampleTitle) alert(it.exampleTitle);
      });

      row.querySelector('[data-fav]')?.addEventListener("click", () => {
        toggleFav(it.term, it.label);
      });

      frag.appendChild(row);
    });

    elList.appendChild(frag);
  }

  function applyFilter(){
    const q = safeLower(inpQ?.value || "").trim();

    let list = state.all.slice();

    // vista
    if (state.view === "favs"){
      list = list.filter(x => state.favs.has(String(x.term)));
    }

    // categoría
    if (state.category !== "all"){
      list = list.filter(x => x.category === state.category);
    }

    // texto
    if (q){
      list = list.filter(x =>
        safeLower(x.term).includes(q) ||
        safeLower(x.label).includes(q)
      );
    }

    state.filtered = list;
    render(state.filtered);

    // ticker
    updateTicker();
  }

  async function fetchJson(url){
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function maybeFavRankAlerts(newItems){
    if (!state.settings.alertsEnabled) return;
    if (!state.favs.size) return;

    // si un favorito entra en top o sube fuerte, alerta
    for (const it of newItems){
      if (!state.favs.has(String(it.term))) continue;
      const prev = state.lastRanks.get(String(it.term));
      if (!prev){
        toast("Favorito en ranking", it.label);
      } else if (it.rank <= prev - 5){
        toast("Favorito subiendo", `${it.label} (▲ ${prev - it.rank})`);
      }
    }
  }

  async function refresh(){
    clearError();
    setNet(navigator.onLine);

    // prev ranks
    loadLastRanks();

    const url = buildUrl();

    try{
      // corta fetch anterior
      if (state.abort) state.abort.abort();
      state.abort = new AbortController();

      // mini “latencia humana”
      await sleep(120);

      const data = await fetchJson(url);

      const articles = Array.isArray(data?.articles) ? data.articles : [];
      if (!articles.length){
        state.all = [];
        state.filtered = [];
        render([]);
        setLastUpdated();
        saveRanks([]);
        updateTicker();
        return;
      }

      const trends = computeTrends(articles);

      // alertas favoritas comparando con prev ranks
      maybeFavRankAlerts(trends);

      state.all = trends;
      applyFilter();
      setLastUpdated();

      saveRanks(trends);

    }catch(err){
      showError(
        "No pude actualizar tendencias ahora mismo. " +
        "Puede ser rate-limit o un corte puntual de la fuente. " +
        "Prueba en 1–2 min o cambia ventana/idioma."
      );
      if (!state.all.length) render([]);
    }
  }

  function schedule(){
    if (state.timer) clearTimeout(state.timer);

    if (!state.settings.autoRefresh) return;

    const jitter = Math.floor((Math.random() * 2 - 1) * state.settings.refreshJitterMs);
    const wait = clamp(state.settings.refreshEveryMs + jitter, CFG.MIN_REFRESH_MS, CFG.MAX_REFRESH_MS);

    state.timer = setTimeout(async () => {
      await refresh();
      schedule();
    }, wait);
  }

  function setActiveTab(container, selectorAttr, value){
    if (!container) return;
    const btns = Array.from(container.querySelectorAll(".tab"));
    for (const b of btns){
      const v = b.getAttribute(selectorAttr);
      const active = v === value;
      b.classList.toggle("isActive", active);
      b.setAttribute("aria-selected", active ? "true" : "false");
    }
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

  function openConfig(){
    if (!cfgModal) return;
    cfgModal.classList.remove("hidden");
  }

  function closeConfig(){
    if (!cfgModal) return;
    cfgModal.classList.add("hidden");
  }

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

      saveSettings();
      applySettingsToUI();

      // refresca scheduling y render
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
    toast("Ticker", state.settings.tickerEnabled ? "Activado" : "Desactivado");
  }

  function updateTicker(){
    if (!tickerTrack) return;
    if (!state.settings.tickerEnabled){
      tickerTrack.innerHTML = "";
      return;
    }

    const base = state.filtered.length ? state.filtered : state.all;
    const top = base.slice(0, Math.min(18, base.length));

    if (!top.length){
      tickerTrack.innerHTML = `<span class="tickerItem">Sin datos…</span>`;
      return;
    }

    const html = top.map((it, idx) => {
      const q = encodeURIComponent(it.term);
      const sep = (idx === top.length - 1) ? "" : `<span class="tickerSep">•</span>`;
      return `
        <a class="tickerItem" href="https://x.com/search?q=${q}" target="_blank" rel="noreferrer">
          ${escapeHtml(it.label)}
        </a>
        ${sep}
      `;
    }).join("");

    // “reinicia” animación cambiando el nodo (simple y efectivo)
    tickerTrack.innerHTML = html;
    tickerTrack.style.animation = "none";
    // eslint-disable-next-line no-unused-expressions
    tickerTrack.offsetHeight;
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

  function bind(){
    btnRefresh?.addEventListener("click", async () => {
      await refresh();
      schedule();
    });

    btnCompact?.addEventListener("click", toggleCompact);

    inpQ?.addEventListener("input", applyFilter);

    selLang?.addEventListener("change", () => {
      state.settings.lang = pickLang();
      saveSettings();
      inpQ.value = "";
      refresh();
      schedule();
    });

    selWindow?.addEventListener("change", () => {
      state.settings.window = pickTimespan();
      saveSettings();
      inpQ.value = "";
      refresh();
      schedule();
    });

    selGeo?.addEventListener("change", () => {
      state.settings.geo = pickGeo();
      saveSettings();
      inpQ.value = "";
      refresh();
      schedule();
    });

    window.addEventListener("online", () => setNet(true));
    window.addEventListener("offline", () => setNet(false));

    bindTabs();
    bindConfig();
    bindTicker();
  }

  async function boot(){
    // carga settings/favs/compact
    loadSettings();
    loadFavs();
    loadCompact();

    // refleja selects en settings por si vienes “limpio”
    state.settings.lang = pickLang();
    state.settings.window = pickTimespan();
    state.settings.geo = pickGeo();

    applySettingsToUI();
    setActiveTab(tabsView, "data-view", state.view);
    setActiveTab(tabsCat, "data-cat", state.category);

    bind();
    setNet(navigator.onLine);

    // SW (opcional)
    if ("serviceWorker" in navigator){
      try{ await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }); }catch{}
    }

    await refresh();
    schedule();
  }

  boot();
})();
