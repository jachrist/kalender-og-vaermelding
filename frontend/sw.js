// Service worker for Hytteportal.
// App-skallet caches (cache-first). API-kall går alltid til nettverket.

const CACHE = "hytteportal-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/app.js",
  "./js/api.js",
  "./icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // API-kall: alltid nettverk (ikke cache dynamiske data).
  if (url.pathname.startsWith("/api/") || url.port === "7071") return;

  // App-skall: cache-first med nettverks-fallback.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
