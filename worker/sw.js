// ═══════════════════════════════════════════════════
//  SP HOME INTERIOR — WORKER SERVICE WORKER
//  Scope: /worker/
//  Strategy: NETWORK-FIRST for the app's own files (so a new deploy is picked
//  up automatically), cache fallback when offline. The backend is never cached.
// ═══════════════════════════════════════════════════
const CACHE = 'sphome-worker-v2';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  '../shared/config.js',
  '../shared/logo.js',
  '../shared/logo.png',
  '../shared/icon-192.png',
  '../shared/icon-512.png',
  '../shared/maskable-192.png',
  '../shared/maskable-512.png',
  '../shared/apple-touch-icon.png',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.allSettled(ASSETS.map(function (u) { return cache.add(u); }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k.indexOf('sphome-worker-') === 0 && k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;                       // never touch POSTs (API writes)

  const url = new URL(req.url);
  // Backend + Google-hosted content: always live, never cached.
  if (url.hostname.indexOf('script.google') !== -1 || url.hostname.indexOf('googleusercontent.com') !== -1 ||
      url.hostname.indexOf('drive.google.com') !== -1) {
    return;
  }
  // Only manage same-origin files; let the browser handle fonts etc. itself.
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200) {
        const clone = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, clone); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (cached) {
        if (cached) return cached;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
