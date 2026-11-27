const cacheName = 'marmon-psonia-shell-v7';
const files = ['./', './index.html', './app.js?v=7', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', event => {
    event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(files)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys
        .filter(key => key.startsWith('marmon-psonia-shell-') && key !== cacheName)
        .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope) ||
        !files.some(file => file.split('?')[0] === './' + new URL(request.url).pathname.slice(new URL(self.registration.scope).pathname.length))) return;
    event.respondWith(fetch(request).catch(async () =>
        await (await caches.open(cacheName)).match(request, { ignoreSearch: true }) || Response.error()));
});


// Keep the connection in the service worker's private database so background pushes
// can read the current count without putting tokens in URLs or notification text.
function notificationDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('marmon-psonia-notifications', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('settings');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function notificationConnection(next) {
    const db = await notificationDatabase();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction('settings', next === undefined ? 'readonly' : 'readwrite');
            const store = tx.objectStore('settings');
            const request = next === undefined ? store.get('connection') : store.put(next, 'connection');
            let value;
            request.onsuccess = () => { value = request.result; };
            tx.oncomplete = () => resolve(value);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } finally { db.close(); }
}

async function notificationRequest(connection, path, body) {
    const response = await fetch(connection.endpoint + path, {
        method: body ? 'POST' : 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: 'Bearer ' + connection.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) {
        if (response.status === 401) await notificationConnection(null);
        throw new Error('Notification request failed');
    }
    return response.json();
}

async function updateShoppingBadge(count) {
    if (count > 0 && navigator.setAppBadge) await navigator.setAppBadge(count).catch(() => {});
    else if (navigator.clearAppBadge) await navigator.clearAppBadge().catch(() => {});
}

let notificationWork = Promise.resolve();
function queueNotification(work) {
    const next = notificationWork.then(work);
    notificationWork = next.catch(() => {});
    return next;
}

self.addEventListener('message', event => {
    const message = event.data;
    if (message?.type !== 'shopping-notification-state') return;
    event.waitUntil(queueNotification(async () => {
        const connection = message.connection;
        if (!connection) {
            await notificationConnection(null);
            await updateShoppingBadge(0);
            const notifications = await self.registration.getNotifications({ tag: 'shopping-additions' });
            notifications.forEach(notification => notification.close());
            return;
        }
        const endpoint = new URL(connection.endpoint);
        if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
            !/^[a-f0-9]{64}$/.test(connection.token)) return;
        await notificationConnection({ endpoint: endpoint.href.replace(/\/$/, ''), token: connection.token });
        if (!Number.isSafeInteger(message.seenSequence) || message.seenSequence < 0) return;
        const source = event.source?.id ? await self.clients.get(event.source.id) : null;
        if (source?.visibilityState !== 'visible' || !source.focused) return;
        try {
            await notificationRequest(connection, '/notifications/seen', { sequence: message.seenSequence });
            const state = await notificationRequest(connection, '/notifications');
            await updateShoppingBadge(state.count);
            event.source?.postMessage({ type: 'shopping-notifications-read', sequence: message.seenSequence });
            if (!state.count) {
                const notifications = await self.registration.getNotifications({ tag: 'shopping-additions' });
                notifications.forEach(notification => notification.close());
            }
        } catch { /* The next visible refresh retries acknowledgement after connectivity returns. */ }
    }));
});

self.addEventListener('push', event => {
    event.waitUntil(queueNotification(async () => {
        let count = 0;
        try {
            const connection = await notificationConnection();
            if (connection) {
                const state = await notificationRequest(connection, '/notifications');
                count = Number.isSafeInteger(state.count) ? state.count : 0;
            }
            await updateShoppingBadge(count);
        } catch { /* Always show a visible notification, including when the count cannot be fetched. */ }
        await self.registration.showNotification('Κοινά Ψώνια · Marmon251', {
            body: count === 1 ? 'Προστέθηκε 1 νέο προϊόν στη λίστα.' :
                count > 1 ? 'Προστέθηκαν ' + count + ' νέα προϊόντα στη λίστα.' : 'Η κοινή λίστα ενημερώθηκε.',
            tag: 'shopping-additions', renotify: false, silent: true,
            icon: new URL('./icon.svg', self.registration.scope).href
        });
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        windows.filter(client => client.url.startsWith(self.registration.scope))
            .forEach(client => client.postMessage({ type: 'shopping-list-updated' }));
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const existing = windows.find(client => client.url.startsWith(self.registration.scope));
        if (existing) {
            await existing.focus();
            existing.postMessage({ type: 'shopping-list-updated' });
        } else await self.clients.openWindow(self.registration.scope);
    })());
});
