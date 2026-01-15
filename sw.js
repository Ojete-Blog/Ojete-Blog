/* sw.js — GlobalEye Trends — cache v3 (GitHub Pages friendly + SKIP_WAITING) */
"use strict";

const CACHE = "ge-trends-v3";

/** Core (sin query) */
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

function stripQuery(urlStr){
  try{
    const u = new URL(urlStr);
    u.search = "";
    u.hash = "";
    return u.toString();
  }catch{
    return urlStr;
  }
}

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
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

/** ✅ Permite a app.js forzar “apply update” */
self.addEventListener("message", (e) => {
  const type = e?.data?.type || e?.data;
  if (type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (type === "CLEAR_CACHES") {
    e.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    })());
  }
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // No tocar cross-origin (X widgets, etc.)
  if (url.origin !== self.location.origin){
    // pero GDELT siempre live
    if (url.hostname.includes("gdeltproject.org")) {
      e.respondWith(fetch(req));
      return;
    }
    e.respondWith(fetch(req));
    return;
  }

  // Nunca cachear llamadas a GDELT si están en same-origin (normalmente no lo están)
  if (url.hostname.includes("gdeltproject.org")){
    e.respondWith(fetch(req));
    return;
  }

  // Normaliza clave (quita ?v= / ?cb= etc)
  const keyUrl = stripQuery(req.url);
  const keyReq = new Request(keyUrl, { method: "GET" });

  // HTML: network-first
  if (req.mode === "navigate"){
    e.respondWith((async () => {
      try{
        const fresh = await fetch(req, { cache: "no-store" });
        const c = await caches.open(CACHE);
        c.put(keyReq, fresh.clone());
        return fresh;
      }catch{
        const cached = await caches.match(keyReq);
        return cached || caches.match("./index.html");
      }
    })());
    return;
  }

  // Assets: stale-while-revalidate
  e.respondWith((async () => {
    const cached = await caches.match(keyReq);
    const fetchPromise = fetch(req).then(async (fresh) => {
      try{
        const c = await caches.open(CACHE);
        c.put(keyReq, fresh.clone());
      }catch{}
      return fresh;
    }).catch(() => null);

    if (cached) {
      fetchPromise.catch(() => null);
      return cached;
    }

    const fresh = await fetchPromise;
    if (fresh) return fresh;

    return caches.match("./index.html");
  })());
});
