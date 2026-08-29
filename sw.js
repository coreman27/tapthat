/* sw.js — offline support with a NETWORK-FIRST strategy.
 * Network-first means the freshest code always wins when online; the cache is
 * only a fallback for offline. This prevents stale game code (e.g. an old
 * challenge list) from sticking around after an update.
 * Bump CACHE_VERSION whenever you want to guarantee old caches are purged.
 */
var CACHE_VERSION = 'v2';
var CACHE = 'dtt-' + CACHE_VERSION;
var ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/storage.js',
  './js/audio.js',
  './js/share.js',
  './js/challenges.js',
  './js/adaptive.js',
  './js/engine.js',
  './js/ui.js',
  './js/main.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Network-first: try the network, update the cache, fall back to cache when offline.
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // let cross-origin requests pass through

  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (cached) {
        return cached || caches.match('./index.html');
      });
    })
  );
});
