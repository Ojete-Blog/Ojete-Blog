/* sw.js — GlobalEye Trends — FINAL (hardened) */
"use strict";

const SW_VERSION = "ge-trends-sw-final-3";
const CORE_CACHE = `${SW_VERSION}::core`;
const RUNTIME_CACHE = `${SW_VERSION}::runtime`;

// Ajusta solo si cambias el nombre real de archivos
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

// Parámetros típicos de cache-bust
const STRIP_QS = ["v", "cb", "_", "__tnp", "__ge", "__ts", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];

function normalizeCacheKey(input) {
  try{
    const u = new URL(typeof input === "string" ? input : input.url, self.location.origin);
    STRIP_QS.forEach(k => u.searchParams.delete(k));
    // Normaliza "./" y "/" para evitar duplicados en cache
    if (u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "/");
    return u.toString();
  }catch{
    return typeof input === "string" ? input : input.url;
  }
}

function isCoreRequest(urlObj) {
  const p = urlObj.pathname;
  // Matches para core (soporta path base de GH Pages)
  // Ej: /repo/index.html -> endsWith(/index.html)
  return CORE.some((item) => {
    const rel = item.replace("./", "/");
    const rel2 = item.replace("./", "");
    return p.endsWith(rel) || p.endsWith("/" + rel2) || p.endsWith(rel2);
  });
}

function isHtmlRequest(req) {
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/html");
}

async function cachePutNormalized(cacheName, reqOrUrl, res) {
  try{
    const cache = await caches.open(cacheName);
    const key = normalizeCacheKey(reqOrUrl);
    await cache.put(key, res);
  }catch{}
}

async function cacheMatchNormalized(cacheName, reqOrUrl) {
  try{
    const cache = await caches.open(cacheName);
    const key = normalizeCacheKey(reqOrUrl);
    return await cache.match(key);
  }catch{
    return null;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try{
      const cache = await caches.open(CORE_CACHE);
      // addAll usa Request exacto; luego normalizamos en fetch igualmente
      await cache.addAll(CORE);
    }catch{}
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try{
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => {
        if (!k.startsWith(SW_VERSION)) return caches.delete(k);
        return Promise.resolve();
      }));
    }catch{}
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
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    })());
    return;
  }

  // Opcional: purga + recarga clientes (si lo llamas desde app.js)
  if (msg.type === "PURGE_AND_RELOAD") {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clients) {
        try{ c.navigate(c.url); }catch{}
      }
    })());
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!req || req.method !== "GET") return;

  const url = new URL(req.url);

  // Solo mismo origen (tu GH pages)
  if (url.origin !== self.location.origin) return;

  const html = isHtmlRequest(req);
  const core = isCoreRequest(url);

  // 1) HTML: network-first (evita quedarte pegado con index viejo)
  if (html) {
    event.respondWith((async () => {
      try{
        const net = await fetch(req, { cache: "no-store" });
        await cachePutNormalized(CORE_CACHE, req, net.clone());
        return net;
      }catch{
        const cached = await cacheMatchNormalized(CORE_CACHE, req);
        if (cached) return cached;

        // Fallback a index.html cacheado
        const fallback = await cacheMatchNormalized(CORE_CACHE, "./index.html");
        return fallback || new Response("Offline", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }

  // 2) CORE: stale-while-revalidate (rápido + se actualiza)
  if (core) {
    event.respondWith((async () => {
      const cached = await cacheMatchNormalized(CORE_CACHE, req);

      const fetcher = (async () => {
        try{
          const net = await fetch(req, { cache: "no-store" });
          await cachePutNormalized(CORE_CACHE, req, net.clone());
          return net;
        }catch{
          return null;
        }
      })();

      return cached || (await fetcher) || fetch(req);
    })());
    return;
  }

  // 3) RUNTIME: stale-while-revalidate con key normalizada
  event.respondWith((async () => {
    const cached = await cacheMatchNormalized(RUNTIME_CACHE, req);

    const fetcher = (async () => {
      try{
        const net = await fetch(req, { cache: "no-store" });
        await cachePutNormalized(RUNTIME_CACHE, req, net.clone());
        return net;
      }catch{
        return null;
      }
    })();

    return cached || (await fetcher) || fetch(req);
  })());
});
