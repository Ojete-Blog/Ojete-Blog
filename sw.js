/* sw.js — GlobalEye Trends — cache v2 (GitHub Pages friendly) */
"use strict";

const CACHE = "ge-trends-v2";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./logo_ojo.jpg",
  "./logo_ojo_gif.gif",
  "./banner_ojo.jpg"
];

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

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Nunca cachear la API (siempre live)
  if (url.hostname.includes("gdeltproject.org")){
    e.respondWith(fetch(req));
    return;
  }

  // HTML: network-first
  if (req.mode === "navigate"){
    e.respondWith((async () => {
      try{
        const fresh = await fetch(req, { cache: "no-store" });
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
        return fresh;
      }catch{
        const cached = await caches.match(req);
        return cached || caches.match("./index.html");
      }
    })());
    return;
  }

  // Assets: cache-first
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    const fresh = await fetch(req);
    const c = await caches.open(CACHE);
    c.put(req, fresh.clone());
    return fresh;
  })());
});
