"use strict";

/* ==========================================================
   Service Worker — GlobalEye Trends (Final)
   - Core cache: shell de la app
   - HTML: network-first (evita quedarte con index viejo)
   - Runtime: cache para recursos internos
   ========================================================== */

const SW_VERSION = "ge-trends-sw-final-3";
const CACHE_CORE = `${SW_VERSION}::core`;
const CACHE_RUNTIME = `${SW_VERSION}::runtime`;

const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./logo_ojo_png.png",
  "./logo_ojo_favicon.png",
  "./logo_ojo.jpg",
  "./logo_ojo_gif.gif",
  "./banner_ojo.jpg"
];

function normalizeCacheKey(reqUrl){
  try{
    const u = new URL(reqUrl, self.location.origin);
    ["v","cb","_","__tnp","__ge","__ts"].forEach(k => u.searchParams.delete(k));
    return u.toString();
  }catch{
    return reqUrl;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try{
      const cache = await caches.open(CACHE_CORE);
      await cache.addAll(CORE);
    }catch{}
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => {
      if (!k.startsWith(SW_VERSION)) return caches.delete(k);
      return Promise.resolve();
    }));
    self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const msg = event?.data;
  if (!msg) return;

  if (msg.type === "SKIP_WAITING") self.skipWaiting();

  if (msg.type === "CLEAR_CACHES") {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    })());
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!req || req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isHtml = req.headers.get("accept")?.includes("text/html");
  const path = url.pathname.replace(self.location.pathname.replace(/\/[^/]*$/, "/"), "/");
  const isCore = CORE.some(p => {
    const pp = p.replace("./", "/");
    return url.pathname.endsWith(pp) || url.pathname.endsWith(p.replace("./",""));
  });

  // HTML: network-first
  if (isHtml) {
    event.respondWith((async () => {
      try{
        const net = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE_CORE);
        cache.put(req, net.clone());
        return net;
      }catch{
        const cache = await caches.open(CACHE_CORE);
        const cached = await cache.match(req);
        return cached || caches.match("./index.html");
      }
    })());
    return;
  }

  // Core assets: cache-first + refresh
  if (isCore) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_CORE);
      const cached = await cache.match(req);

      const fetcher = fetch(req, { cache: "no-store" }).then(async (net) => {
        cache.put(req, net.clone());
        return net;
      }).catch(() => null);

      return cached || (await fetcher) || fetch(req);
    })());
    return;
  }

  // Runtime: cache-first (normalized key) + refresh
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_RUNTIME);
    const key = normalizeCacheKey(req.url);

    const cached = await cache.match(key);
    const fetcher = fetch(req, { cache: "no-store" }).then(async (net) => {
      cache.put(key, net.clone());
      return net;
    }).catch(() => null);

    return cached || (await fetcher) || fetch(req);
  })());
});
