const CACHE_NAME = 'sumsurge-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  // Include this build's hashed JS and CSS so an installed game can open offline.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const response = await fetch('/index.html', { cache: 'reload' });
    if (!response.ok) throw new Error('App shell unavailable');
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map((match) => match[1]);
    await cache.addAll([...SHELL, ...assets]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME && /^(mathsgrid-cache-|sumsurge-)/.test(key)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.open(CACHE_NAME)).match('/index.html')));
    return;
  }
  // Cache only successful local assets; failed scripts never receive HTML.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});
