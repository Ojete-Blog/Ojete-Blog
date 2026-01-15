/* sw.js — GlobalEye Trends — cache v3 (GitHub Pages friendly + PNG + auto-update shell)
   ✅ Evita quedarte “pegado” con app.js/styles viejos
   ✅ CORE shell: network-first (fallback cache)
   ✅ Assets (imgs/icons): stale-while-revalidate (rápido + se actualiza solo)
   ✅ API GDELT: siempre live (no cache)
   ✅ Cross-origin (X / Ko-fi / twitter widgets): passthrough (no cache)
   ✅ Limpieza de caches antiguos + SKIP_WAITING + CLEAR_CACHES por mensaje
*/

"use strict";

const SW_VERSION = "ge-trends-v3";
const CACHE = SW_VERSION;

// Archivos “core” de la app (incluye PNG transparente)
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./logo_ojo_png.png",
  "./logo_ojo.jpg",
  "./logo_ojo_gif.gif",
  "./banner_ojo.jpg"
];

// Para que GitHub Pages no se quede con keys distintas por ?v=...
const STRIP_QS_PARAMS = new Set([
  "v","ver","version","cb","cachebust","t","ts","tsMs","_",
  "__tnp","__ge","__sw","build","buildId"
]);

function stripCacheBusters(urlObj){
  const u = new URL(urlObj.toString());
  // Solo para same-origin
  for (const k of [...u.searchParams.keys()]){
    if (STRIP_QS_PARAMS.has(k)) u.searchParams.delete(k);
  }
  return u;
}

function isSameOrigin(urlObj){
  return urlObj.origin === self.location.origin;
}

function isGdelt(urlObj){
  return urlObj.hostname.includes("gdeltproject.org");
}

function isCrossOriginWeDontCache(urlObj){
  // Widgets de X / recursos externos: mejor no cachearlos aquí
  const h = urlObj.hostname;
  return (
    h.includes("platform.twitter.com") ||
    h.includes("x.com") ||
    h.includes("twimg.com") ||
    h.includes("ko-fi.com") ||
    h.includes("kofi.com")
  );
}

function isShellPath(urlObj){
  const p = urlObj.pathname;
  return (
    p.endsWith("/") ||
    p.endsWith("/index.html") ||
    p.endsWith("/app.js") ||
    p.endsWith("/styles.css") ||
    p.endsWith("/manifest.webmanifest")
  );
}

function isAssetRequest(req){
  // imágenes, fuentes, etc.
  return req.destination === "image" || req.destination === "font";
}

async function cachePutSafe(cache, req, res){
  try{
    // Solo cachea respuestas OK y “basic” (same-origin) para evitar problemas
    if (!res || !res.ok) return;
    // Para requests same-origin, el type suele ser "basic"
    await cache.put(req, res);
  }catch{
    // Silencioso: no rompemos la navegación por errores de cache
  }
}

/* ───────────────────────────── INSTALL ───────────────────────────── */
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // addAll puede fallar si falta un asset; hacemos fallback robusto:
    await Promise.all(CORE.map(async (path) => {
      try{
        const req = new Request(path, { cache: "reload" });
        const res = await fetch(req);
        if (res && res.ok) await c.put(req, res);
      }catch{
        // si un archivo no existe, no abortamos instalación
      }
    }));
    self.skipWaiting();
  })());
});

/* ───────────────────────────── ACTIVATE ───────────────────────────── */
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE) ? caches.delete(k) : null));
    await self.clients.claim();
  })());
});

/* ───────────────────────────── MESSAGES ───────────────────────────── */
self.addEventListener("message", (event) => {
  const msg = event?.data;
  if (!msg) return;

  if (msg === "SKIP_WAITING" || msg?.type === "SKIP_WAITING"){
    self.skipWaiting();
    return;
  }

  if (msg === "CLEAR_CACHES" || msg?.type === "CLEAR_CACHES"){
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    })());
  }
});

/* ───────────────────────────── FETCH ───────────────────────────── */
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Solo GET
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Passthrough cross-origin (no cache)
  if (!isSameOrigin(url) || isCrossOriginWeDontCache(url)){
    // OJO: gdelt es cross-origin, pero lo tratamos abajo
    if (isGdelt(url)) {
      event.respondWith((async () => {
        try{
          // Siempre live, sin cache
          return await fetch(req, { cache: "no-store" });
        }catch{
          return new Response(
            JSON.stringify({ articles: [] }),
            { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
          );
        }
      })());
    }
    return; // deja al navegador manejarlo
  }

  // Normaliza la key (quita cache-busters)
  const normUrl = stripCacheBusters(url);
  const normReq = new Request(normUrl.toString(), {
    method: "GET",
    headers: req.headers,
    mode: req.mode,
    credentials: req.credentials,
    redirect: req.redirect,
    referrer: req.referrer,
    referrerPolicy: req.referrerPolicy,
    integrity: req.integrity,
    cache: "default"
  });

  // Navegación (HTML): network-first + fallback cache + fallback index.html
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);

      try{
        const fresh = await fetch(req, { cache: "no-store" });
        await cachePutSafe(cache, normReq, fresh.clone());
        return fresh;
      }catch{
        const cached = await cache.match(normReq);
        return cached || cache.match("./index.html") || new Response("Offline", { status: 503 });
      }
    })());
    return;
  }

  // Shell (app.js/styles/manifest): network-first para evitar “viejo pegado”
  if (isShellPath(normUrl)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try{
        const fresh = await fetch(normReq, { cache: "no-store" });
        await cachePutSafe(cache, normReq, fresh.clone());
        return fresh;
      }catch{
        const cached = await cache.match(normReq);
        return cached || new Response("Offline", { status: 503 });
      }
    })());
    return;
  }

  // Assets (imgs/fonts): stale-while-revalidate (rápido y se actualiza)
  if (isAssetRequest(req)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(normReq);

      const fetchPromise = (async () => {
        try{
          const fresh = await fetch(normReq);
          await cachePutSafe(cache, normReq, fresh.clone());
          return fresh;
        }catch{
          return null;
        }
      })();

      // Devuelve cache si existe; si no, espera a red
      return cached || (await fetchPromise) || new Response("", { status: 504 });
    })());
    return;
  }

  // Resto: cache-first simple (con guardado)
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(normReq);
    if (cached) return cached;

    try{
      const fresh = await fetch(normReq);
      await cachePutSafe(cache, normReq, fresh.clone());
      return fresh;
    }catch{
      return new Response("Offline", { status: 503 });
    }
  })());
});
