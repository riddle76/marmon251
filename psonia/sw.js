const cacheName = 'marmon-psonia-shell-v1';
const files = ['./', './index.html', './app.js', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', event => {
    event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(files)));
});
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys
        .filter(key => key.startsWith('marmon-psonia-shell-') && key !== cacheName)
        .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope) ||
        !files.includes('./' + new URL(request.url).pathname.slice(new URL(self.registration.scope).pathname.length))) return;
    event.respondWith(fetch(request).catch(async () =>
        await (await caches.open(cacheName)).match(request, { ignoreSearch: true }) || Response.error()));
});
