/* sw.js — offline cache so the game plays with no connection */
var CACHE = 'dtt-v1';
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

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return cached || fetch(e.request).then(function (res) {
        return res;
      }).catch(function () { return caches.match('./index.html'); });
    })
  );
});
