const CACHE_NAME = 'ios-organizer-v4.4';
const ASSETS = [
  './',
  './index.html',
  './app.js?v=4.1',
  './style.css?v=4.1',
  './leave-fix.js?v=2.1',
  './leave-fix.css?v=2.1',
  './manifest.json'
];

// Install Event
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Caching Shell Assets');
      return Promise.allSettled(ASSETS.map((asset) => cache.add(asset)));
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

// Fetch Event
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  // Fix for Phosphor Icons and Google Fonts
  if (e.request.url.includes('unpkg.com') || e.request.url.includes('fonts.gstatic.com') || e.request.url.includes('fonts.googleapis.com')) {
    e.respondWith(
      caches.match(e.request).then((cachedResponse) => {
        return cachedResponse || fetch(e.request).then((fetchResponse) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, fetchResponse.clone());
            return fetchResponse;
          });
        });
      })
    );
    return;
  }

  const requestUrl = new URL(e.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;

  if (isSameOrigin) {
    e.respondWith(
      fetch(e.request).then((fetchResponse) => {
        const responseClone = fetchResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, responseClone);
        });
        return fetchResponse;
      }).catch(() => {
        return caches.match(e.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (e.request.mode === 'navigate') {
            return caches.match('./index.html') || caches.match('/marmon251/index.html');
          }
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      return cachedResponse || fetch(e.request);
    }).catch(() => {
      if (e.request.mode === 'navigate') {
        return caches.match('./index.html') || caches.match('/marmon251/index.html');
      }
    })
  );
});
