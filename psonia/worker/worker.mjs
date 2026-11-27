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

export default {
    async fetch(request, env) {
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
            if (path === '/health' && method === 'GET') {
                await db.prepare('SELECT revision FROM lists LIMIT 1').first();
                return reply({ ready: true });
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
                    db.prepare("INSERT INTO sessions VALUES (?, ?, 'owner')").bind(await digest(token), id)
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
                    db.prepare('DELETE FROM invites WHERE token_hash = ?').bind(hash)
                ]);
                if (!insert.meta.changes) return reply({ error: 'Η πρόσκληση έληξε ή έχει ήδη χρησιμοποιηθεί.' }, 410);
                return reply({ token, role: 'member' }, 201);
            }

            const bearer = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
            const session = bearer && await db.prepare('SELECT list_id, role FROM sessions WHERE token_hash = ?').bind(await digest(bearer)).first();
            if (!session) return reply({ error: 'Χρειάζεται ενεργή πρόσκληση για αυτή τη λίστα.' }, 401);
            const list = session.list_id;

            if (path === '/list' && method === 'GET') {
                const revision = await db.prepare('SELECT revision FROM lists WHERE id = ?').bind(list).first('revision');
                if (searchParams.get('revision') === String(revision)) return reply({ unchanged: true, revision, role: session.role });
                const [current, products, favorites] = await db.batch([
                    db.prepare('SELECT revision FROM lists WHERE id = ?').bind(list),
                    db.prepare('SELECT id, title, photo FROM items WHERE list_id = ? ORDER BY added_at, id').bind(list),
                    db.prepare('SELECT id, title FROM favorites WHERE list_id = ? ORDER BY added_at, id').bind(list)
                ]);
                return reply({ revision: current.results[0].revision, items: products.results, favorites: favorites.results, role: session.role });
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
                    db.prepare('INSERT OR IGNORE INTO items (list_id, id, title, added_at) SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM items WHERE list_id = ?) < ?')
                        .bind(list, id, title.trim(), Date.now() + index, list, MAX_ITEMS)));
                const added = result.reduce((sum, row) => sum + row.meta.changes, 0);
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
