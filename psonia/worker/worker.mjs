const MAX_ITEMS = 100;
const MAX_FAVORITES = 50;
const MAX_PHOTO = 95_000;
const TOKEN = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9-]{36}$/;

function randomToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('');
}

async function digest(value) {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

async function readJson(request) {
    const reader = request.body?.getReader();
    if (!reader) throw new RangeError('Λείπει η καταχώριση.');
    let size = 0, text = '';
    const decoder = new TextDecoder();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 110_000) {
                await reader.cancel();
                throw new RangeError('Η καταχώριση είναι πολύ μεγάλη.');
            }
            text += decoder.decode(value, { stream: true });
        }
        return JSON.parse(text + decoder.decode());
    } finally { reader.releaseLock(); }
}

function imageValue(value) {
    return typeof value === 'string' && value.length <= MAX_PHOTO &&
        (!value || /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(value));
}


const notificationSchemas = new WeakMap();

function ensureNotificationSchema(db) {
    if (!notificationSchemas.has(db)) {
        const setup = (async () => {
            const columns = await db.prepare('PRAGMA table_info(items)').all();
            if (!columns.results.some(column => column.name === 'added_by')) {
                try {
                    await db.prepare("ALTER TABLE items ADD COLUMN added_by TEXT NOT NULL DEFAULT ''").run();
                } catch (failure) {
                    const current = await db.prepare('PRAGMA table_info(items)').all();
                    if (!current.results.some(column => column.name === 'added_by')) throw failure;
                }
            }
            await db.batch([
                db.prepare('CREATE TABLE IF NOT EXISTS shopping_additions (sequence INTEGER PRIMARY KEY AUTOINCREMENT, list_id TEXT NOT NULL, actor_hash TEXT NOT NULL)'),
                db.prepare('CREATE INDEX IF NOT EXISTS shopping_additions_list ON shopping_additions(list_id, sequence)'),
                db.prepare('CREATE TABLE IF NOT EXISTS notification_receipts (token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE, seen_sequence INTEGER NOT NULL DEFAULT 0)'),
                db.prepare('CREATE TABLE IF NOT EXISTS push_subscriptions (token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE, endpoint TEXT NOT NULL UNIQUE)'),
                db.prepare('CREATE TABLE IF NOT EXISTS push_config (id INTEGER PRIMARY KEY CHECK (id = 1), public_key TEXT NOT NULL, private_jwk TEXT NOT NULL)'),
                db.prepare("CREATE TRIGGER IF NOT EXISTS shopping_addition_event AFTER INSERT ON items WHEN NEW.added_by <> '' BEGIN INSERT INTO shopping_additions (list_id, actor_hash) VALUES (NEW.list_id, NEW.added_by); END"),
                db.prepare('INSERT OR IGNORE INTO notification_receipts SELECT token_hash, COALESCE((SELECT MAX(sequence) FROM shopping_additions WHERE list_id = sessions.list_id), 0) FROM sessions')
            ]);
        })();
        notificationSchemas.set(db, setup);
        setup.catch(() => notificationSchemas.delete(db));
    }
    return notificationSchemas.get(db);
}

function base64url(bytes) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function pushKeys(db) {
    let saved = await db.prepare('SELECT public_key, private_jwk FROM push_config WHERE id = 1').first();
    if (!saved) {
        const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
        const publicKey = base64url(await crypto.subtle.exportKey('raw', pair.publicKey));
        const privateKey = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
        await db.prepare('INSERT OR IGNORE INTO push_config VALUES (1, ?, ?)').bind(publicKey, privateKey).run();
        saved = await db.prepare('SELECT public_key, private_jwk FROM push_config WHERE id = 1').first();
    }
    return saved;
}

function permittedPushEndpoint(value) {
    if (typeof value !== 'string' || value.length > 2048) return false;
    try {
        const url = new URL(value);
        const allowed = ['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com'];
        return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
            allowed.includes(url.hostname) && url.pathname !== '/';
    } catch { return false; }
}

async function sendShoppingPush(db, list, actor, origin) {
    const subscriptions = await db.prepare('SELECT p.token_hash, p.endpoint FROM push_subscriptions p JOIN sessions s ON s.token_hash = p.token_hash WHERE s.list_id = ? AND s.token_hash <> ? LIMIT 20').bind(list, actor).all();
    if (!subscriptions.results.length) return;
    const keys = await pushKeys(db);
    const privateKey = await crypto.subtle.importKey('jwk', JSON.parse(keys.private_jwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const deliveries = await Promise.allSettled(subscriptions.results.map(async subscription => {
        if (!permittedPushEndpoint(subscription.endpoint)) return;
        const header = base64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
        const claims = base64url(new TextEncoder().encode(JSON.stringify({
            aud: new URL(subscription.endpoint).origin,
            exp: Math.floor(Date.now() / 1000) + 3600,
            sub: origin + '/marmon251/psonia/'
        })));
        const signingInput = header + '.' + claims;
        const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(signingInput));
        // An empty Web Push message wakes the service worker, which fetches the current count securely.
        const response = await fetch(subscription.endpoint, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
            headers: { TTL: '86400', Topic: 'shopping-additions', Urgency: 'normal',
                Authorization: 'vapid t=' + signingInput + '.' + base64url(signature) + ', k=' + keys.public_key }
        });
        console.info('Shopping push gateway response', response.status);
        if (response.status === 404 || response.status === 410) {
            await db.prepare('DELETE FROM push_subscriptions WHERE token_hash = ? AND endpoint = ?').bind(subscription.token_hash, subscription.endpoint).run();
        } else if (!response.ok) {
            console.warn('Shopping push delivery failed', response.status);
        }
    }));
    for (const delivery of deliveries) {
        if (delivery.status === 'rejected') console.warn('Shopping push transport error', delivery.reason?.name ?? 'Error');
    }
}

export default {
    async fetch(request, env, ctx) {
        const origin = request.headers.get('Origin');
        const cors = origin === env.APP_ORIGIN ? {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Vary': 'Origin'
        } : {};
        const reply = (data, status = 200) => Response.json(data, {
            status, headers: { ...cors, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
        });
        if (origin && origin !== env.APP_ORIGIN) return reply({ error: 'Μη επιτρεπόμενη προέλευση.' }, 403);
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        const { pathname: path, searchParams } = new URL(request.url);
        const method = request.method;
        const db = env.DB;
        try {
            await ensureNotificationSchema(db);
            if (path === '/health' && method === 'GET') {
                await db.prepare('SELECT revision FROM lists LIMIT 1').first();
                return reply({ ready: true, notifications: true });
            }
            if (path === '/lists' && method === 'POST') {
                const { key } = await readJson(request);
                if (typeof env.CREATE_KEY !== 'string' || env.CREATE_KEY.length < 24) {
                    return reply({ error: 'Η δημιουργία λίστας δεν έχει ενεργοποιηθεί.' }, 503);
                }
                if (typeof key !== 'string' || key.length > 200 || await digest(key) !== await digest(env.CREATE_KEY)) {
                    return reply({ error: 'Ο κωδικός δημιουργίας δεν είναι σωστός.' }, 403);
                }
                const id = crypto.randomUUID(), token = randomToken();
                await db.batch([
                    db.prepare('INSERT INTO lists (id) VALUES (?)').bind(id),
                    db.prepare("INSERT INTO sessions VALUES (?, ?, 'owner')").bind(await digest(token), id),
                    db.prepare('INSERT INTO notification_receipts VALUES (?, 0)').bind(await digest(token))
                ]);
                return reply({ token, role: 'owner' }, 201);
            }
            if (path === '/join' && method === 'POST') {
                const { invite } = await readJson(request);
                if (typeof invite !== 'string' || !TOKEN.test(invite)) return reply({ error: 'Μη έγκυρη πρόσκληση.' }, 400);
                const hash = await digest(invite), token = randomToken(), now = Date.now();
                const [insert] = await db.batch([
                    db.prepare("INSERT INTO sessions SELECT ?, list_id, 'member' FROM invites WHERE token_hash = ? AND expires_at > ?")
                        .bind(await digest(token), hash, now),
                    db.prepare('DELETE FROM invites WHERE token_hash = ?').bind(hash),
                    db.prepare('INSERT OR IGNORE INTO notification_receipts SELECT token_hash, COALESCE((SELECT MAX(sequence) FROM shopping_additions WHERE list_id = sessions.list_id), 0) FROM sessions WHERE token_hash = ?').bind(await digest(token))
                ]);
                if (!insert.meta.changes) return reply({ error: 'Η πρόσκληση έληξε ή έχει ήδη χρησιμοποιηθεί.' }, 410);
                return reply({ token, role: 'member' }, 201);
            }

            const bearer = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
            const actor = bearer ? await digest(bearer) : '';
            const session = bearer && await db.prepare('SELECT list_id, role FROM sessions WHERE token_hash = ?').bind(actor).first();
            if (!session) return reply({ error: 'Χρειάζεται ενεργή πρόσκληση για αυτή τη λίστα.' }, 401);
            const list = session.list_id;


            if (path === '/notification-settings' && method === 'GET') {
                const keys = await pushKeys(db);
                return reply({ publicKey: keys.public_key });
            }
            if (path === '/notifications' && method === 'GET') {
                const state = await db.prepare('SELECT COUNT(*) AS count, COALESCE(MAX(sequence), 0) AS sequence FROM shopping_additions WHERE list_id = ? AND sequence > COALESCE((SELECT seen_sequence FROM notification_receipts WHERE token_hash = ?), 0) AND actor_hash <> ?').bind(list, actor, actor).first();
                return reply(state);
            }
            if (path === '/notifications/seen' && method === 'POST') {
                const { sequence } = await readJson(request);
                if (!Number.isSafeInteger(sequence) || sequence < 0) return reply({ error: 'Μη έγκυρη ενημέρωση.' }, 400);
                await db.prepare('UPDATE notification_receipts SET seen_sequence = MAX(seen_sequence, MIN(?, COALESCE((SELECT MAX(sequence) FROM shopping_additions WHERE list_id = ?), 0))) WHERE token_hash = ?').bind(sequence, list, actor).run();
                return reply({ ok: true });
            }
            if (path === '/push-subscription' && method === 'POST') {
                const { endpoint } = await readJson(request);
                if (!permittedPushEndpoint(endpoint)) return reply({ error: 'Μη έγκυρη συσκευή ειδοποιήσεων.' }, 400);
                const result = await db.prepare('INSERT INTO push_subscriptions (token_hash, endpoint) SELECT ?, ? WHERE (SELECT COUNT(*) FROM push_subscriptions p JOIN sessions s ON s.token_hash = p.token_hash WHERE s.list_id = ?) < 20 OR EXISTS (SELECT 1 FROM push_subscriptions WHERE token_hash = ?) ON CONFLICT(token_hash) DO UPDATE SET endpoint = excluded.endpoint').bind(actor, endpoint, list, actor).run();
                if (!result.meta.changes) return reply({ error: 'Έχουν ενεργοποιηθεί ειδοποιήσεις σε 20 συσκευές.' }, 409);
                return reply({ ok: true });
            }
            if (path === '/push-subscription' && method === 'DELETE') {
                await db.prepare('DELETE FROM push_subscriptions WHERE token_hash = ?').bind(actor).run();
                return reply({ ok: true });
            }

            if (path === '/list' && method === 'GET') {
                const revision = await db.prepare('SELECT revision FROM lists WHERE id = ?').bind(list).first('revision');
                if (searchParams.get('revision') === String(revision)) return reply({ unchanged: true, revision, role: session.role });
                const [current, products, favorites, additions] = await db.batch([
                    db.prepare('SELECT revision FROM lists WHERE id = ?').bind(list),
                    db.prepare('SELECT id, title, photo FROM items WHERE list_id = ? ORDER BY added_at, id').bind(list),
                    db.prepare('SELECT id, title FROM favorites WHERE list_id = ? ORDER BY added_at, id').bind(list),
                    db.prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM shopping_additions WHERE list_id = ?').bind(list)
                ]);
                return reply({ revision: current.results[0].revision, items: products.results, favorites: favorites.results, notificationSequence: additions.results[0].sequence, role: session.role });
            }
            if (path === '/invites' && method === 'POST') {
                if (session.role !== 'owner') return reply({ error: 'Μόνο ο δημιουργός μπορεί να προσκαλεί συσκευές.' }, 403);
                const invite = randomToken();
                await db.batch([
                    db.prepare('DELETE FROM invites WHERE list_id = ?').bind(list),
                    db.prepare('INSERT INTO invites VALUES (?, ?, ?)').bind(await digest(invite), list, Date.now() + 86_400_000)
                ]);
                return reply({ invite });
            }
            if (path === '/members' && method === 'DELETE') {
                if (session.role !== 'owner') return reply({ error: 'Μόνο ο δημιουργός μπορεί να αφαιρεί πρόσβαση.' }, 403);
                await db.batch([
                    db.prepare("DELETE FROM push_subscriptions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE list_id = ? AND role = 'member')").bind(list),
                    db.prepare("DELETE FROM notification_receipts WHERE token_hash IN (SELECT token_hash FROM sessions WHERE list_id = ? AND role = 'member')").bind(list),
                    db.prepare("DELETE FROM sessions WHERE list_id = ? AND role = 'member'").bind(list),
                    db.prepare('DELETE FROM invites WHERE list_id = ?').bind(list)
                ]);
                return reply({ ok: true });
            }
            if (path === '/favorites' && method === 'POST') {
                const { id, title } = await readJson(request);
                if (typeof id !== 'string' || !ID.test(id) || typeof title !== 'string' || !title.trim() || title.length > 140) {
                    return reply({ error: 'Χρειάζεται έγκυρο όνομα προϊόντος.' }, 400);
                }
                const normalized = title.trim().replace(/\s+/g, ' ');
                const key = normalized.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ς/g, 'σ');
                const result = await db.prepare('INSERT OR IGNORE INTO favorites (list_id, id, title, product_key, added_at) SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM favorites WHERE list_id = ?) < ?')
                    .bind(list, id, normalized, key, Date.now(), list, MAX_FAVORITES).run();
                if (!result.meta.changes) {
                    const existing = await db.prepare('SELECT id FROM favorites WHERE list_id = ? AND product_key = ?').bind(list, key).first();
                    if (!existing) return reply({ error: 'Μπορείς να αποθηκεύσεις έως 50 συχνά προϊόντα.' }, 409);
                }
                return reply({ ok: true }, 201);
            }
            const favorite = path.match(/^\/favorites\/([a-f0-9-]{36})$/)?.[1];
            if (favorite && method === 'DELETE') {
                await db.prepare('DELETE FROM favorites WHERE list_id = ? AND id = ?').bind(list, favorite).run();
                return reply({ ok: true });
            }
            if (path === '/items' && method === 'POST') {
                const { items } = await readJson(request);
                if (!Array.isArray(items) || !items.length || items.length > 30 ||
                    !items.every(item => item && ID.test(item.id) && typeof item.title === 'string' && item.title.trim() && item.title.length <= 140)) {
                    return reply({ error: 'Χρειάζονται έγκυρα προϊόντα.' }, 400);
                }
                const result = await db.batch(items.map(({ id, title }, index) =>
                    db.prepare('INSERT OR IGNORE INTO items (list_id, id, title, added_at, added_by) SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM items WHERE list_id = ?) < ? RETURNING id')
                        .bind(list, id, title.trim(), Date.now() + index, actor, list, MAX_ITEMS)));
                const added = result.reduce((sum, row) => sum + row.results.length, 0);
                if (added) {
                    const delivery = sendShoppingPush(db, list, actor, env.APP_ORIGIN).catch(() => console.warn('Shopping notification delivery unavailable'));
                    if (ctx?.waitUntil) ctx.waitUntil(delivery);
                    else await delivery;
                }
                return reply({ ok: true, added, requested: items.length }, 201);
            }
            const item = path.match(/^\/items\/([a-f0-9-]{36})$/)?.[1];
            if (item && method === 'PUT') {
                const { photo } = await readJson(request);
                if (!imageValue(photo)) return reply({ error: 'Η φωτογραφία χρειάζεται να είναι μικρότερη.' }, 400);
                const result = await db.prepare('UPDATE items SET photo = ? WHERE list_id = ? AND id = ?').bind(photo, list, item).run();
                return result.meta.changes ? reply({ ok: true }) : reply({ error: 'Το προϊόν αφαιρέθηκε από τη λίστα.' }, 404);
            }
            if (item && method === 'DELETE') {
                await db.prepare('DELETE FROM items WHERE list_id = ? AND id = ?').bind(list, item).run();
                return reply({ ok: true });
            }
            return reply({ error: 'Η διαδρομή δεν βρέθηκε.' }, 404);
        } catch (error) {
            if (error instanceof SyntaxError || error instanceof RangeError || error instanceof TypeError) {
                return reply({ error: 'Η καταχώριση δεν είναι έγκυρη.' }, 400);
            }
            return reply({ error: 'Η κοινή λίστα δεν είναι διαθέσιμη. Δοκίμασε ξανά.' }, 503);
        }
    }
};

