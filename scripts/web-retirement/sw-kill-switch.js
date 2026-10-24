/* Replaces the old web game's service worker. Browsers that installed the game (home screen or
   cached) re-check /sw.js, find this, clear every cache, unregister, and reload their pages so
   they fall through to the redirect. There is deliberately no fetch handler. */
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.map(function (key) { return caches.delete(key); }));
    await self.registration.unregister();
    var clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(function (client) { client.navigate(client.url); });
  })());
});
