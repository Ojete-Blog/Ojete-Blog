/* sw.js — GlobalEye Trends — cache v4 (GitHub Pages friendly + AUTO-UPDATE)
   ✅ CORE precache
   ✅ Network-first para navegación/HTML
   ✅ Shell crítico (index/app/styles/manifest) network-first
   ✅ Assets: stale-while-revalidate
   ✅ Nunca cachea GDELT
   ✅ SKIP_WAITING + CLEAR_CACHES
   ✅ Normaliza cache-key quitando cachebusters (?v=, ?cb=, ?__=, etc.)
*/
"use strict";

const VERSION = "ge-trends-v4";
const CACHE = VERSION;

const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./logo_ojo.jpg",
  "./logo_ojo_png.png",
  "./logo_ojo_gif.gif",
  "./banner_ojo.jpg"
];

const SHELL_CRITICAL = new Set([
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest"
]);

const CACHEBUST_KEYS = new Set(["v","ver","cb","t","ts","_","__","cachebust","utm_source","utm_medium","utm_campaign"]);

function stripCacheBusters(urlStr){
  const u = new URL(urlStr);
  // solo mismo origin
  // (en SW esto siempre es absoluto)
  for (const k of Array.from(u.searchParams.keys())){
    if (CACHEBUST_KEYS.has(k)) u.searchParams.delete(k);
  }
  return u;
}

async function cachePutSafe(cache, req, res){
  try{
    if (!res) return;
    if (!res.ok) return;
    // basic = same-origin
    if (res.type && res.type !== "basic") return;
    await cache.put(req, res.clone());
  }catch{}
}

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // recarga real para evitar quedarse con viejos
    await c.addAll(CORE.map(p => new Request(p, { cache: "reload" })));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE) ? caches.delete(k) : null));
    self.clients.claim();
  })());
});

self.addEventListener("message", (e) => {
  const data = e.data || {};
  if (data.type === "SKIP_WAITING"){
    self.skipWaiting();
  }
  if (data.type === "CLEAR_CACHES"){
    e.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    })());
  }
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Nunca cachear GDELT (siempre live)
  if (url.hostname.includes("gdeltproject.org")){
    e.respondWith(fetch(req));
    return;
  }

  // Solo cache same-origin
  const sameOrigin = (url.origin === self.location.origin);

  // NAV/HTML: network-first
  if (req.mode === "navigate"){
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      try{
        const fresh = await fetch(req, { cache: "no-store" });
        const normUrl = stripCacheBusters(req.url);
        const normReq = new Request(normUrl.toString(), { cache: "reload" });
        await cachePutSafe(c, normReq, fresh);
        return fresh;
      }catch{
        const cached = await c.match("./index.html");
        return cached || new Response("Offline", { status: 200, headers: { "content-type":"text/plain; charset=utf-8" } });
      }
    })());
    return;
  }

  if (!sameOrigin){
    // para externos (widgets.js etc): passthrough
    return;
  }

  // Normaliza la key (quita ?v= etc.)
  const normUrl = stripCacheBusters(req.url);
  const normPath = normUrl.pathname.endsWith("/") ? "/" : normUrl.pathname;
  const normReq = new Request(normUrl.toString());

  // Shell crítico: network-first (evita “app.js viejo”)
  if (SHELL_CRITICAL.has(normPath)){
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      try{
        const fresh = await fetch(req, { cache: "no-store" });
        await cachePutSafe(c, normReq, fresh);
        return fresh;
      }catch{
        const cached = await c.match(normReq);
        return cached || c.match("./index.html");
      }
    })());
    return;
  }

  // Assets: stale-while-revalidate
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const cached = await c.match(normReq);
    const fetchPromise = (async () => {
      try{
        const fresh = await fetch(req);
        await cachePutSafe(c, normReq, fresh);
        return fresh;
      }catch{
        return null;
      }
    })();

    if (cached){
      // actualiza en background
      e.waitUntil(fetchPromise);
      return cached;
    }

    const fresh = await fetchPromise;
    return fresh || new Response("", { status: 504 });
  })());
});
