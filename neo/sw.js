const cacheName = 'marmon-neo-1';
const assets = ['./', './index.html', './app.js', './manifest.webmanifest', '../icon.png'];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)));
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys
        .filter(key => key.startsWith('marmon-neo-') && key !== cacheName)
        .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET' || !event.request.url.startsWith(self.registration.scope)) return;
    event.respondWith(fetch(event.request).catch(async () => {
        const cache = await caches.open(cacheName);
        const fallback = event.request.mode === 'navigate' ? './index.html' : event.request;
        return await cache.match(fallback) || Response.error();
    }));
});
