// service worker: офлайн-режим PWA + автоматическое обновление.
// Имя кэша постоянное — версия не бампается руками. Обновление работает так:
// index.html — сеть с cache:'no-cache' (мимо HTTP-кэша браузера, который на
// GitHub Pages не знает, что html нельзя кэшировать), ассеты сборки —
// хэшированные имена, каждый релиз это новые URL, они подтягиваются на лету.
// Офлайн: навигация откатывается на кэш, ассеты ищутся по всем кэшам.

const CACHE = 'daylik';
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // caches.match без указания кэша ищет по всем кэшам origin — если старая
  // вкладка офлайн получила новый index.html, её ассеты найдутся в старом кэше
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }))
  );
});
