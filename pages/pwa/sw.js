// Vickery Electric Crew — Minimal Service Worker
// Provides PWA installability. No aggressive caching to keep data fresh.

const CACHE_NAME = "ve-crew-shell-v1";

// Only cache the crew shell and its core assets
const SHELL_URLS = [
  "/crew",
  "/pages/css/brand.css",
  "/pages/js/crew.js",
  "/pages/img/pwa-icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first: always try network, fall back to cache only for navigation
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API calls: always network, never cache
  if (url.pathname.startsWith("/api/")) return;

  // Navigation requests (HTML pages): network first, no cache fallback
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/crew")));
    return;
  }

  // Static assets: network first, then cache
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
