const CACHE_NAME = 'ios-organizer-v3.2';
const ASSETS = [
  './',
  './index.html',
  './app.js?v=3.2',
  './style.css?v=3.2',
  './manifest.json',
  'https://unpkg.com/@phosphor-icons/web',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

// Install Event
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Caching Shell Assets');
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch Event
self.addEventListener('fetch', (e) => {
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
