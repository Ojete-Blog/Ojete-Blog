/* sw.js — GlobalEye Memes+Trends (GitHub Pages hardened) */
"use strict";

const SW_VERSION = "ge-memes-trends-sw-3"; // ⬅️ bump por la actualización de index/styles
const CACHE_CORE = `${SW_VERSION}::core`;
const CACHE_RUNTIME = `${SW_VERSION}::runtime`;

/**
 * CORE: shell + assets críticos
 * NOTA: mantengo compat con tus nombres existentes.
 * Si algún asset no existe, el SW no revienta: simplemente lo ignora.
 */
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

const STRIP_QS = [
  "v", "cb", "_", "__tnp", "__ge", "__ts",
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "source", "view"
];

function normalizeCacheKey(reqOrUrl){
  try{
    const url = new URL(typeof reqOrUrl === "string" ? reqOrUrl : reqOrUrl.url, self.location.origin);
    STRIP_QS.forEach(k => url.searchParams.delete(k));
    return url.toString();
  }catch{
    return (typeof reqOrUrl === "string") ? reqOrUrl : reqOrUrl.url;
  }
}

function isHtml(req){
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/html");
}

function isCorePath(urlObj){
  const path = urlObj.pathname;
  return CORE.some(p => {
    const a = p.replace("./","/");   // "./index.html" -> "/index.html"
    const b = p.replace("./","");    // "./index.html" -> "index.html"
    return path.endsWith(a) || path.endsWith("/"+b) || path.endsWith(b);
  });
}

async function cachePutNormalized(cacheName, reqOrUrl, res){
  try{
    const cache = await caches.open(cacheName);
    const key = normalizeCacheKey(reqOrUrl);
    await cache.put(key, res);
  }catch{}
}

async function cacheMatchNormalized(cacheName, reqOrUrl){
  try{
    const cache = await caches.open(cacheName);
    const key = normalizeCacheKey(reqOrUrl);
    return await cache.match(key);
  }catch{
    return null;
  }
}

async function safePrecacheCore(){
  try{
    // Evita quedarte pegado con un core viejo
    await caches.delete(CACHE_CORE).catch(()=>{});

    const cache = await caches.open(CACHE_CORE);

    await Promise.all(CORE.map(async (p) => {
      try{
        const req = new Request(p, { cache: "reload" });
        const res = await fetch(req);
        if (res && res.ok) {
          await cachePutNormalized(CACHE_CORE, p, res.clone());
        }
      }catch{}
    }));
  }catch{}
}

async function cleanupOldCaches(){
  try{
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (!k.startsWith(SW_VERSION)) return caches.delete(k);
      return Promise.resolve();
    }));
  }catch{}
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await safePrecacheCore();
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await cleanupOldCaches();
    self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const msg = event?.data;
  if (!msg) return;

  if (msg.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (msg.type === "CLEAR_CACHES") {
    event.waitUntil((async () => {
      try{
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }catch{}
    })());
    return;
  }

  if (msg.type === "PURGE_AND_RELOAD") {
    event.waitUntil((async () => {
      try{
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }catch{}
      try{
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const c of clients) {
          try{ c.navigate(c.url); }catch{}
        }
      }catch{}
    })());
    return;
  }

  // Opcional: si quieres “recalentar” el core desde la app
  if (msg.type === "REPRECACHE_CORE") {
    event.waitUntil(safePrecacheCore());
    return;
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!req || req.method !== "GET") return;

  const url = new URL(req.url);

  // GitHub Pages: no cacheamos cross-origin (Reddit/GDELT/X/etc)
  if (url.origin !== self.location.origin) return;

  const html = isHtml(req);
  const core = isCorePath(url);

  // HTML: network-first + fallback cache + fallback index
  if (html) {
    event.respondWith((async () => {
      try{
        const net = await fetch(req, { cache: "no-store" });
        if (net && net.ok) await cachePutNormalized(CACHE_CORE, req, net.clone());
        return net;
      }catch{
        const cached = await cacheMatchNormalized(CACHE_CORE, req);
        if (cached) return cached;

        const fallback = await cacheMatchNormalized(CACHE_CORE, "./index.html");
        return fallback || new Response("Offline", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" }
        });
      }
    })());
    return;
  }

  // CORE: cache-first con refresh en background (stale-while-revalidate suave)
  if (core) {
    event.respondWith((async () => {
      const cached = await cacheMatchNormalized(CACHE_CORE, req);

      const fetcher = (async () => {
        try{
          const net = await fetch(req, { cache: "no-store" });
          if (net && net.ok) await cachePutNormalized(CACHE_CORE, req, net.clone());
          return net;
        }catch{
          return null;
        }
      })();

      return cached || (await fetcher) || fetch(req);
    })());
    return;
  }

  // RUNTIME: cache-first (rápido) + refresh; útil para assets locales extra
  event.respondWith((async () => {
    const cached = await cacheMatchNormalized(CACHE_RUNTIME, req);

    const fetcher = (async () => {
      try{
        const net = await fetch(req, { cache: "no-store" });
        if (net && net.ok) await cachePutNormalized(CACHE_RUNTIME, req, net.clone());
        return net;
      }catch{
        return null;
      }
    })();

    return cached || (await fetcher) || fetch(req);
  })());
});