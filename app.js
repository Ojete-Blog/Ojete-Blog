/* app.js — GlobalEye Trends (GitHub Pages) v1.0.0 — 2026-01-15a
   ✅ 100% frontend (GitHub Pages)
   ✅ UI estilo X (dark) + animación
   ✅ “Tendencias ahora” = ranking calculado con titulares recientes (open data)
   ✅ Botón “Ver en X” (abre búsqueda en X con 1 click)
   ✅ Timeline real de @GlobalEye_TV embebido (oficial)
   NOTA: Leer tendencias oficiales de X vía API desde browser NO es viable por CORS/tiers. :contentReference[oaicite:5]{index=5}
*/

(() => {
  "use strict";

  const CFG = {
    xHandle: "GlobalEye_TV",
    xProfileUrl: "https://x.com/GlobalEye_TV",

    // Fuente open-data con CORS OK (GDELT soporta ACAO "*") :contentReference[oaicite:6]{index=6}
    gdeltBase: "https://api.gdeltproject.org/api/v2/doc/doc",

    // Auto refresh
    refreshEveryMs: 120_000,     // 2 min
    refreshJitterMs: 12_000,     // +/- jitter

    // Render
    maxArticles: 250,
    maxTrends: 20,

    // LocalStorage
    lsKey: "ge_trends_v1",
    lsKeyCompact: "ge_compact_v1"
  };

  const $ = (sel) => document.querySelector(sel);

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

  const state = {
    all: [],
    filtered: [],
    timer: null,
    lastRanks: new Map(),
    compact: false
  };

  const STOP_ES = new Set([
    "de","la","el","los","las","un","una","unos","unas","y","o","u","a","en","por","para","con","sin","del","al",
    "se","su","sus","lo","le","les","que","como","más","mas","ya","hoy","ayer","mañana","ahora","sobre","tras",
    "ante","entre","desde","hasta","contra","durante","según","cuando","donde","quién","quien","qué","que",
    "este","esta","estos","estas","eso","esa","esos","esas","aquí","alli","allí","ahí","muy","también","tambien"
  ]);

  const STOP_EN = new Set([
    "the","a","an","and","or","to","of","in","on","for","with","without","from","by","as","at","is","are","was","were",
    "be","been","it","its","this","that","these","those","now","today","yesterday","tomorrow","about","after","before"
  ]);

  function setNet(ok){
    elNet.textContent = ok ? "Online" : "Offline";
    const dot = document.querySelector(".dot");
    if (dot){
      dot.style.background = ok ? "var(--good)" : "var(--warn)";
      dot.style.boxShadow = ok ? "0 0 0 3px rgba(46,211,183,.12)" : "0 0 0 3px rgba(245,196,81,.12)";
    }
  }

  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

  function pickTimespan(){
    const v = (selWindow.value || "4H").toUpperCase();
    if (["2H","4H","6H","12H"].includes(v)) return v;
    return "4H";
  }

  function pickLang(){
    const v = (selLang.value || "spanish").toLowerCase();
    if (v === "mixed") return "mixed";
    if (v === "english") return "english";
    return "spanish";
  }

  function pickGeo(){
    const v = (selGeo.value || "ES").toUpperCase();
    return v === "GLOBAL" ? "GLOBAL" : "ES";
  }

  // Construye query GDELT. DOC API soporta sourcelang:spanish y también códigos. :contentReference[oaicite:7]{index=7}
  function buildGdeltQuery(){
    const lang = pickLang();
    const geo = pickGeo();

    // “ES” aquí lo interpretamos como foco hispano (sourcelang:spanish).
    // Si quisieras afinar por país exacto: se puede extender con sourceCountry (según dataset).
    let q;
    if (lang === "mixed") q = `(sourcelang:spanish OR sourcelang:english)`;
    else q = `sourcelang:${lang}`;

    // Un pequeño “boost” para GLOBAL: deja mixed/english y aumenta señal.
    if (geo === "GLOBAL" && lang === "spanish"){
      // Mantiene español pero abre un poquito la señal (sin romper)
      q = `(sourcelang:spanish OR sourcelang:english)`;
    }

    return q;
  }

  function buildUrl(){
    const params = new URLSearchParams();
    params.set("format", "json");
    params.set("mode", "ArtList");
    params.set("sort", "hybridrel");
    params.set("maxrecords", String(CFG.maxArticles));
    params.set("timespan", pickTimespan());
    params.set("query", buildGdeltQuery());
    return `${CFG.gdeltBase}?${params.toString()}`;
  }

  function safeLower(s){ return (s || "").toLowerCase(); }

  function normalizeToken(t){
    return safeLower(t)
      .replace(/[\u2019']/g, "")          // apostrofes
      .replace(/[^\p{L}\p{N}#@]+/gu, "")  // solo letras/números/#/@
      .trim();
  }

  function tokenizeTitle(title){
    // Split por espacios/puntuación manteniendo hashtags
    const raw = String(title || "")
      .replace(/[\u2014\u2013]/g, " ")
      .replace(/[(){}\[\]"“”.,:;!?]/g, " ")
      .split(/\s+/g);

    const out = [];
    for (const r of raw){
      const tok = normalizeToken(r);
      if (!tok) continue;
      if (tok.length < 3 && !tok.startsWith("#")) continue;
      out.push(tok);
    }
    return out;
  }

  function isStop(tok){
    const t = tok.replace(/^#/, "");
    return STOP_ES.has(t) || STOP_EN.has(t);
  }

  function titleCase(s){
    if (!s) return s;
    if (s.startsWith("#")) return s; // hashtags como están
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function computeTrends(articles){
    const freq = new Map();
    const sample = new Map(); // term -> {title,url,source}

    for (const a of articles){
      const title = a.title || "";
      const url = a.url || "";
      const source = a.sourceCountry || a.sourceCollection || a.domain || "";

      const toks = tokenizeTitle(title).filter(t => !isStop(t));

      // Unigramas
      for (const t of toks){
        freq.set(t, (freq.get(t) || 0) + 1);
        if (!sample.has(t)) sample.set(t, { title, url, source });
      }

      // Bigramas simples (para nombres compuestos)
      for (let i = 0; i < toks.length - 1; i++){
        const a1 = toks[i], a2 = toks[i+1];
        if (a1.length < 3 || a2.length < 3) continue;
        if (isStop(a1) || isStop(a2)) continue;
        const bi = `${a1} ${a2}`;
        freq.set(bi, (freq.get(bi) || 0) + 1);
        if (!sample.has(bi)) sample.set(bi, { title, url, source });
      }
    }

    // Score: freq y “premio” a hashtags
    const scored = [...freq.entries()]
      .map(([term, count]) => {
        const hashtagBoost = term.startsWith("#") ? 1.25 : 1.0;
        const lenPenalty = term.length > 24 ? 0.85 : 1.0;
        const score = count * hashtagBoost * lenPenalty;
        return { term, count, score };
      })
      .sort((x,y) => (y.score - x.score) || (y.count - x.count))
      .slice(0, CFG.maxTrends);

    return scored.map((t, idx) => {
      const s = sample.get(t.term);
      return {
        rank: idx + 1,
        term: t.term,
        label: titleCase(t.term),
        count: t.count,
        exampleTitle: s?.title || "",
        exampleUrl: s?.url || "",
        exampleSource: s?.source || ""
      };
    });
  }

  function loadLastRanks(){
    try{
      const raw = localStorage.getItem(CFG.lsKey);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!Array.isArray(data?.items)) return;
      state.lastRanks.clear();
      for (const it of data.items){
        if (it?.term) state.lastRanks.set(it.term, it.rank);
      }
    }catch{}
  }

  function saveRanks(items){
    try{
      localStorage.setItem(CFG.lsKey, JSON.stringify({
        ts: Date.now(),
        items: items.map(x => ({ term:x.term, rank:x.rank }))
      }));
    }catch{}
  }

  function computeDelta(term, rank){
    const prev = state.lastRanks.get(term);
    if (!prev) return { kind:"new", text:"NEW" };
    if (prev === rank) return { kind:"", text:"=" };
    if (rank < prev) return { kind:"up", text:`▲ ${prev-rank}` };
    return { kind:"down", text:`▼ ${rank-prev}` };
  }

  function setLastUpdated(){
    const d = new Date();
    const pad = (n) => String(n).padStart(2,"0");
    elLast.textContent = `Actualizado: ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function showError(msg){
    elErr.textContent = msg;
    elErr.classList.remove("hidden");
  }

  function clearError(){
    elErr.classList.add("hidden");
    elErr.textContent = "";
  }

  function render(items){
    elList.innerHTML = "";
    elEmpty.classList.toggle("hidden", items.length !== 0);

    const frag = document.createDocumentFragment();

    items.forEach((it, i) => {
      const d = computeDelta(it.term, it.rank);

      const row = document.createElement("div");
      row.className = "trend";
      row.style.animationDelay = `${clamp(i * 22, 0, 280)}ms`;

      row.innerHTML = `
        <div class="rank">${it.rank}</div>

        <div class="tMain">
          <div class="tTitle">${escapeHtml(it.label)}</div>
          <div class="tMeta">
            <span class="badge"><span class="delta ${d.kind}">${escapeHtml(d.text)}</span></span>
            <span class="badge">${escapeHtml(String(it.count))} menciones</span>
            ${it.exampleSource ? `<span class="badge">${escapeHtml(it.exampleSource)}</span>` : ""}
          </div>
        </div>

        <div class="actions">
          <button class="aBtn primary" data-x="${encodeURIComponent(it.term)}" title="Buscar en X">Ver en X</button>
          <button class="aBtn" data-more="1" title="Ver ejemplo">Ejemplo</button>
        </div>
      `;

      row.querySelector('[data-x]')?.addEventListener("click", (e) => {
        const q = e.currentTarget.getAttribute("data-x") || "";
        window.open(`https://x.com/search?q=${q}`, "_blank", "noreferrer");
      });

      row.querySelector('[data-more]')?.addEventListener("click", () => {
        const title = it.exampleTitle || "(sin ejemplo)";
        const url = it.exampleUrl || "";
        if (url) window.open(url, "_blank", "noreferrer");
        else alert(title);
      });

      frag.appendChild(row);
    });

    elList.appendChild(frag);
  }

  function escapeHtml(s){
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function applyFilter(){
    const q = safeLower(inpQ.value).trim();
    if (!q){
      state.filtered = state.all.slice();
    } else {
      state.filtered = state.all.filter(x => safeLower(x.term).includes(q) || safeLower(x.label).includes(q));
    }
    render(state.filtered);
  }

  async function fetchJson(url){
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function refresh(){
    clearError();
    setNet(navigator.onLine);

    // Carga ranks previos (para deltas)
    loadLastRanks();

    const url = buildUrl();

    try{
      // mini “latencia humana” para que la animación se note
      await sleep(120);

      const data = await fetchJson(url);

      const articles = Array.isArray(data?.articles) ? data.articles : [];
      if (!articles.length){
        state.all = [];
        state.filtered = [];
        render([]);
        setLastUpdated();
        saveRanks([]);
        return;
      }

      const trends = computeTrends(articles);

      state.all = trends;
      applyFilter();
      setLastUpdated();

      saveRanks(trends);

    }catch(err){
      showError(
        "No pude actualizar tendencias ahora mismo. " +
        "Esto puede pasar por rate-limit o cortes puntuales de la fuente. " +
        "Prueba en 1–2 min o cambia ventana/idioma."
      );
      // Mantén lo último si existía
      if (!state.all.length) render([]);
    }
  }

  function schedule(){
    if (state.timer) clearTimeout(state.timer);
    const jitter = Math.floor((Math.random() * 2 - 1) * CFG.refreshJitterMs);
    const wait = Math.max(35_000, CFG.refreshEveryMs + jitter);
    state.timer = setTimeout(async () => {
      await refresh();
      schedule();
    }, wait);
  }

  function loadCompact(){
    try{
      const v = localStorage.getItem(CFG.lsKeyCompact);
      state.compact = v === "1";
      document.body.classList.toggle("compact", state.compact);
      btnCompact.setAttribute("aria-pressed", state.compact ? "true" : "false");
    }catch{}
  }

  function toggleCompact(){
    state.compact = !state.compact;
    document.body.classList.toggle("compact", state.compact);
    btnCompact.setAttribute("aria-pressed", state.compact ? "true" : "false");
    try{ localStorage.setItem(CFG.lsKeyCompact, state.compact ? "1" : "0"); }catch{}
  }

  function bind(){
    btnRefresh.addEventListener("click", async () => {
      await refresh();
      schedule();
    });

    btnCompact.addEventListener("click", toggleCompact);

    inpQ.addEventListener("input", applyFilter);
    selLang.addEventListener("change", () => { inpQ.value=""; refresh(); schedule(); });
    selWindow.addEventListener("change", () => { inpQ.value=""; refresh(); schedule(); });
    selGeo.addEventListener("change", () => { inpQ.value=""; refresh(); schedule(); });

    window.addEventListener("online", () => setNet(true));
    window.addEventListener("offline", () => setNet(false));
  }

  async function boot(){
    bind();
    loadCompact();
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
