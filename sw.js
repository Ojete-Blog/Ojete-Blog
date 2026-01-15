/* sw.js — GlobalEye Trends — cache v3 (GitHub Pages friendly + update real)
   ✅ Network-first para navegación (HTML)
   ✅ Stale-while-revalidate para assets SAME-ORIGIN
   ✅ No cachea GDELT ni cross-origin
   ✅ Soporta SKIP_WAITING + CLEAR_CACHES
*/

"use strict";

const CACHE = "ge-trends-v3";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./logo_ojo.jpg",
  "./logo_ojo_png.png",
  "./logo_ojo_favicon.png",
  "./logo_ojo_gif.gif",
  "./banner_ojo.jpg"
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);

    // Precarga robusta (evita quedarte con archivos viejos)
    await Promise.all(CORE.map(async (url) => {
      try{
        const req = new Request(url, { cache: "reload" });
        const res = await fetch(req);
        if (res.ok) await c.put(req, res.clone());
      }catch{
        // si algún asset falla, no rompe la instalación
      }
    }));

    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE) ? caches.delete(k) : null));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => {
  const type = e?.data?.type;
  if (type === "SKIP_WAITING"){
    self.skipWaiting();
  }
  if (type === "CLEAR_CACHES"){
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

  // Nunca cachear la API (siempre live)
  if (url.hostname.includes("gdeltproject.org") || url.hostname.includes("api.gdeltproject.org")){
    e.respondWith(fetch(req));
    return;
  }

  // No cachear cross-origin (ej: platform.twitter.com)
  const sameOrigin = (url.origin === self.location.origin);
  if (!sameOrigin){
    e.respondWith(fetch(req));
    return;
  }

  // HTML navegación: network-first
  if (req.mode === "navigate"){
    e.respondWith((async () => {
      try{
        const fresh = await fetch(new Request(req.url, { cache: "no-store" }));
        const c = await caches.open(CACHE);
        c.put("./index.html", fresh.clone());
        return fresh;
      }catch{
        const cached = await caches.match(req);
        return cached || caches.match("./index.html");
      }
    })());
    return;
  }

  // Assets: stale-while-revalidate
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const cached = await c.match(req);

    const fetchAndUpdate = (async () => {
      try{
        const fresh = await fetch(req);
        if (fresh && fresh.ok) c.put(req, fresh.clone());
        return fresh;
      }catch{
        return null;
      }
    })();

    // Devuelve cache si existe, y refresca en segundo plano
    if (cached){
      fetchAndUpdate;
      return cached;
    }

    // Si no hay cache, intenta red
    const fresh = await fetchAndUpdate;
    if (fresh) return fresh;

    // fallback suave
    return caches.match("./index.html");
  })());
});
