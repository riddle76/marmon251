const shoppingWords = new Map(
    ('γάλα πατάτα πατάτες ψωμί αυγό αυγά αβγό αβγά γιαούρτι γιαούρτια τυρί τυριά φέτα βούτυρο ' +
    'τυροσαλάτα κασέρι γραβιέρα γαλοπούλα ζαμπόν μπέικον πάριζα κοτόπουλο κιμάς κρέας μπριζόλες ' +
    'ψάρι ψάρια τόνος σαρδέλες ρύζι μακαρόνια ζυμαρικά σπαγγέτι αλεύρι ζάχαρη αλάτι πιπέρι ' +
    'καφές τσάι κακάο σοκολάτα μπισκότα φρυγανιές δημητριακά βρώμη μέλι μαρμελάδα ' +
    'μήλο μήλα μπανάνα μπανάνες πορτοκάλι πορτοκάλια λεμόνι λεμόνια αχλάδι αχλάδια φράουλες σταφύλια ' +
    'ντομάτα ντομάτες ντοματάκια αγγούρι αγγούρια κρεμμύδι κρεμμύδια σκόρδο καρότο καρότα ' +
    'μαρούλι λάχανο μπρόκολο κολοκύθια μελιτζάνες πιπεριές μανιτάρια σπανάκι ' +
    'φακές ρεβίθια φασόλια αρακάς ελιές λάδι ελαιόλαδο ξύδι νερό χυμός αναψυκτικά μπύρα κρασί ' +
    'χαρτί σαπούνι σαμπουάν οδοντόκρεμα απορρυπαντικό χλωρίνη σακούλες τοστ κρέμα').split(' ')
        .map(word => [normalizeShoppingWord(word), word])
);
for (const [misspelling, correction] of Object.entries({
    παταταις: 'πατάτες', γαλλα: 'γάλα', ντοματαις: 'ντομάτες', γιαουρτη: 'γιαούρτι', ψομι: 'ψωμί'
})) shoppingWords.set(normalizeShoppingWord(misspelling), correction);

const shoppingCompounds = new Set(['τυρι κρεμα', 'ψωμι τοστ', 'γαλα κακαο', 'ζαχαρη αχνη', 'χυμος πορτοκαλι'].map(normalizeShoppingWord));
const shoppingQualifiers = new Set(['με', 'χωρις', 'για', 'σε', 'απο']);
const shoppingArticles = new Set(['το', 'τη', 'την', 'τα', 'τον']);
const shoppingUnits = new Set(['κιλο', 'κιλα', 'γραμ', 'γραμμαρια', 'λιτρο', 'λιτρα', 'τεμαχιο', 'τεμαχια']);

function normalizeShoppingWord(word) {
    return word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ς/g, 'σ');
}

function correctShoppingSpelling(text) {
    return text.replace(/[\p{Script=Greek}\p{M}]+/gu, word => {
        const correct = shoppingWords.get(normalizeShoppingWord(word));
        if (!correct) return word;
        if (word === word.toLocaleUpperCase('el')) return correct.toLocaleUpperCase('el');
        if (word[0] === word[0].toLocaleUpperCase('el')) return correct[0].toLocaleUpperCase('el') + correct.slice(1);
        return correct;
    });
}

function splitRecognizedProducts(text) {
    const words = text.split(/\s+/);
    const normalized = words.map(normalizeShoppingWord);
    const parts = [];
    let start = 0;
    let foundProduct = false;
    for (let i = 0; i < words.length; i++) {
        if (!shoppingWords.has(normalized[i])) continue;
        const previous = normalized[i - 1];
        const compound = shoppingCompounds.has(previous + ' ' + normalized[i]);
        const qualifier = shoppingArticles.has(previous) ? normalized[i - 2] : previous;
        if (foundProduct && (compound || shoppingQualifiers.has(qualifier))) continue;
        if (foundProduct) {
            let split = i;
            if (shoppingUnits.has(normalized[split - 1]) && /^\d+(?:[,.]\d+)?$/.test(normalized[split - 2])) split--;
            if (/^\d+(?:[,.]\d+)?$/.test(normalized[split - 1])) split--;
            const end = normalized[split - 1] === 'και' ? split - 1 : split;
            parts.push(words.slice(start, end).join(' '));
            start = split;
        }
        foundProduct = true;
    }
    return [...parts, words.slice(start).join(' ')];
}

function splitShopping(text) {
    return text.split(/[\n;!?•]+|(?<!\d)[,.]|[,.](?!\d)|\s+(?:κόμμα|επόμενο)\s+/iu)
        .map(item => correctShoppingSpelling(item.trim())).filter(Boolean).flatMap(splitRecognizedProducts);
}

const shoppingCategories = new Map(Object.entries({
    'Φρούτα και λαχανικά': 'πατάτα πατάτες μήλο μήλα μπανάνα μπανάνες πορτοκάλι πορτοκάλια λεμόνι λεμόνια αχλάδι αχλάδια φράουλες σταφύλια ντομάτα ντομάτες ντοματάκια αγγούρι αγγούρια κρεμμύδι κρεμμύδια σκόρδο καρότο καρότα μαρούλι λάχανο μπρόκολο κολοκύθια μελιτζάνες πιπεριές μανιτάρια σπανάκι',
    'Γαλακτοκομικά και αυγά': 'γάλα αυγό αυγά αβγό αβγά γιαούρτι γιαούρτια τυρί τυριά φέτα βούτυρο κρέμα τυροσαλάτα κασέρι γραβιέρα',
    'Αρτοποιείο': 'ψωμί τοστ φρυγανιές',
    'Κρέας, ψάρια και αλλαντικά': 'γαλοπούλα ζαμπόν μπέικον πάριζα κοτόπουλο κιμάς κρέας μπριζόλες ψάρι ψάρια τόνος σαρδέλες',
    'Τρόφιμα ντουλαπιού': 'ρύζι μακαρόνια ζυμαρικά σπαγγέτι αλεύρι ζάχαρη αλάτι πιπέρι καφές τσάι κακάο σοκολάτα μπισκότα δημητριακά βρώμη μέλι μαρμελάδα φακές ρεβίθια φασόλια αρακάς ελιές λάδι ελαιόλαδο ξύδι',
    'Ποτά': 'νερό χυμός αναψυκτικά μπύρα κρασί',
    'Σπίτι και φροντίδα': 'χαρτί σαπούνι σαμπουάν οδοντόκρεμα απορρυπαντικό χλωρίνη σακούλες'
}).map(([category, products]) => [category, new Set(products.split(' ').map(normalizeShoppingWord))]));

function shoppingCategory(text) {
    for (const word of correctShoppingSpelling(text).split(/\s+/)) {
        const name = normalizeShoppingWord(word).replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
        for (const [category, products] of shoppingCategories) {
            if (products.has(name)) return category;
        }
    }
    return 'Λοιπά';
}

const $ = selector => document.querySelector(selector);
const storageKey = 'marmon-psonia-v1';
const device = loadDevice();
let products = device.local;
let favorites = device.favorites;
let revision = null;
let role = device.connection?.role;
let error = '';
let refreshing = false;
let busy = false;
let pendingInvite = null;
let editPhotoId = null;
let selectedPhoto = '';
let notificationSequence = null;
let lastSentSequence = -1;
let notificationPublicKey = '';
const serviceWorkerReady = 'serviceWorker' in navigator ? navigator.serviceWorker.register('./sw.js')
    .then(() => navigator.serviceWorker.ready).catch(() => null) : Promise.resolve(null);


function loadDevice() {
    try {
        const value = JSON.parse(localStorage.getItem(storageKey));
        if (Array.isArray(value?.local)) return { ...value, favorites: Array.isArray(value.favorites) ? value.favorites : [] };
    } catch {}
    return { local: [], favorites: [], connection: null };
}

function saveDevice(next) {
    localStorage.setItem(storageKey, JSON.stringify(next));
    Object.assign(device, next);
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function validPhoto(value) {
    return typeof value === 'string' && /^data:image\/jpeg;base64,\/9j\/[a-z\d+/]+=*$/i.test(value);
}

function validEndpoint(value) {
    const url = new URL(value);
    const local = ['localhost','127.0.0.1'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) {
        throw new Error('Χρειάζεται έγκυρη διεύθυνση HTTPS.');
    }
    return url.href.replace(/\/$/, '');
}

async function api(path, options = {}) {
    const { method = 'GET', body, endpoint = device.connection?.endpoint, token = device.connection?.token } = options;
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body) headers['Content-Type'] = 'application/json';
    const result = await fetch(endpoint + path, {
        method, headers, body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(12000)
    });
    const data = await result.json();
    if (!result.ok) {
        const failure = new Error(data.error || 'Η κοινή λίστα δεν είναι διαθέσιμη.');
        failure.status = result.status;
        throw failure;
    }
    return data;
}

function favoriteKey(title) {
    return normalizeShoppingWord(title.trim().replace(/\s+/g, ' '));
}

function favoriteFor(title) {
    const key = favoriteKey(title);
    return favorites.find(item => favoriteKey(item.title) === key);
}

function renderFavorites() {
    const list = $('#favorite-items');
    $('#favorite-empty').hidden = favorites.length > 0;
    list.innerHTML = favorites.map(item => {
        const title = escapeHtml(item.title);
        const id = escapeHtml(item.id);
        const onList = products.some(product => favoriteKey(product.title) === favoriteKey(item.title));
        return '<li><button class="favorite-add" data-use-favorite="' + id + '"' + (onList ? ' disabled' : '') +
            ' aria-label="Προσθήκη στη λίστα: ' + title + '">' +
            (onList ? '<span aria-hidden="true">✓</span> ' : '<span aria-hidden="true">+</span> ') + title + '</button>' +
            '<button class="favorite-star" data-remove-favorite="' + id + '" aria-label="Αφαίρεση από τα Συχνά: ' + title + '">×</button></li>';
    }).join('');
}

function productRow(item) {
    const image = validPhoto(item.photo) ? '<img src="' + item.photo + '" alt="" loading="lazy">' : 'Φωτογραφία';
    const name = escapeHtml(correctShoppingSpelling(item.title));
    const id = escapeHtml(item.id);
    const favorite = favoriteFor(item.title);
    return '<li><button data-remove="' + id + '" class="product" aria-label="Διαγραφή: ' + name + '">' +
        '<span aria-hidden="true" class="check">✓</span><strong>' + name + '</strong></button>' +
        '<button class="photo-button" data-photo="' + id + '" aria-label="Φωτογραφία: ' + name + '">' + image + '</button>' +
        '<button class="favorite-star" data-save-favorite="' + id + '" aria-pressed="' + Boolean(favorite) +
        '" aria-label="' + (favorite ? 'Αφαίρεση από τα Συχνά: ' : 'Αποθήκευση στα Συχνά: ') + name +
        '">' + (favorite ? '★' : '☆') + '</button></li>';
}

function render() {
    $('#mode').textContent = device.connection ? 'Κοινή λίστα' : 'Λίστα σε αυτή τη συσκευή';
    $('#warning').textContent = error;
    $('#summary').textContent = products.length === 1 ? '1 προϊόν' : products.length + ' προϊόντα';
    const groups = new Map([...shoppingCategories.keys(), 'Λοιπά'].map(name => [name, []]));
    for (const item of products) groups.get(shoppingCategory(item.title)).push(item);
    $('#products').innerHTML = [...groups].filter(([, list]) => list.length)
        .map(([name, list]) => '<section><h2>' + name + '</h2><ul>' + list.map(productRow).join('') + '</ul></section>').join('');
    $('#empty').hidden = products.length !== 0;
    renderFavorites();
    $('#invite-open').textContent = role === 'owner' ? 'Πρόσκληση' : 'Κοινή χρήση';
}

async function refresh(force = false) {
    const connection = device.connection;
    if (!connection || (refreshing && !force)) return;
    if (refreshing) {
        await refreshing;
        if (device.connection !== connection) return;
    }
    const previous = revision;
    const work = async () => {
        try {
            const snapshot = await api('/list' + (force || previous === null ? '' : '?revision=' + previous));
            if (device.connection !== connection) return;
            if (revision === null || snapshot.revision >= revision) {
                if (!snapshot.unchanged) {
                    products = snapshot.items;
                    favorites = snapshot.favorites || [];
                    notificationSequence = snapshot.notificationSequence ?? null;
                }
                revision = snapshot.revision;
            }
            role = snapshot.role;
            error = '';
            render();
            if (!document.hidden) void syncNotificationState();
        } catch (failure) {
            if (device.connection !== connection) return;
            error = failure.status === 401 ? 'Η πρόσβαση έληξε ή αφαιρέθηκε.' : 'Δεν έγινε συγχρονισμός. Η εφαρμογή θα δοκιμάσει ξανά.';
            if (failure.status === 401) {
                products = [];
                favorites = [];
                revision = null;
            }
            render();
        }
    };
    const ongoing = work();
    refreshing = ongoing;
    await ongoing;
    if (refreshing === ongoing) refreshing = false;
}

async function changeItems(path, method, body, localChange, localKey = 'local') {
    if (busy) return false;
    busy = true;
    try {
        if (device.connection) {
            const result = await api(path, { method, body });
            await refresh(true);
            if (result.requested && result.added < result.requested) {
                error = 'Η κοινή λίστα δέχεται έως 100 προϊόντα. Προστέθηκαν ' + result.added + '.';
            }
        } else {
            const list = localChange(device[localKey]);
            saveDevice({ ...device, [localKey]: list });
            products = device.local;
            favorites = device.favorites;
            error = '';
        }
        render();
        return true;
    } catch (failure) {
        error = failure.name === 'TypeError' || failure.name === 'TimeoutError' ?
            'Δεν υπάρχει σύνδεση. Δοκίμασε ξανά.' : failure.message;
        render();
        return false;
    } finally { busy = false; }
}

async function connect(endpoint, path, body) {
    const session = await api(path, { endpoint, token: null, method: 'POST', body });
    saveDevice({ ...device, connection: { endpoint, token: session.token, role: session.role } });
    products = [];
    favorites = [];
    revision = null;
    role = session.role;
    await refresh(true);
}

function showShare() {
    const owner = device.connection && role === 'owner';
    $('#connect').hidden = Boolean(device.connection) || Boolean(pendingInvite);
    const pasteForm = $('#paste-invite');
    if (pasteForm) pasteForm.hidden = Boolean(device.connection) || Boolean(pendingInvite);
    $('#accept-invite').hidden = !pendingInvite || Boolean(device.connection);
    $('#owner-actions').hidden = !owner;
    $('#connected').hidden = !device.connection;
    $('#invite-output').hidden = true;
    $('#share-status').textContent = device.connection ? 'Αυτή η συσκευή είναι συνδεδεμένη στην κοινή λίστα.' :
        pendingInvite ? 'Έχεις λάβει πρόσκληση για την κοινή λίστα.' : 'Για κοινή λίστα χρειάζεται ενεργός διακομιστής συγχρονισμού.';
    if (!$('#share').open) $('#share').showModal();
    void showNotificationSettings();
}

function readInvite() {
    try {
        const params = new URLSearchParams(location.hash.slice(1));
        const invite = params.get('invite');
        if (!invite || !/^[a-f0-9]{64}$/.test(invite)) return;
        pendingInvite = { invite, endpoint: validEndpoint(params.get('server')) };
        history.replaceState(null, '', location.pathname + location.search);
        showShare();
    } catch {
        error = 'Η πρόσκληση δεν είναι έγκυρη.';
    }
}

$('#add').onsubmit = async event => {
    event.preventDefault();
    const field = $('#entry');
    const titles = splitShopping(field.value).filter(title => title.length <= 140);
    if (!titles.length) return;
    if (titles.length > 30) {
        error = 'Πρόσθεσε έως 30 προϊόντα τη φορά.';
        render();
        return;
    }
    const items = titles.map(title => ({ id: crypto.randomUUID(), title, photo: '' }));
    if (await changeItems('/items', 'POST', { items }, previous => [...previous, ...items])) field.value = '';
};

$('#products').onclick = event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.remove) {
        const id = target.dataset.remove;
        void changeItems('/items/' + encodeURIComponent(id), 'DELETE', null, previous => previous.filter(item => item.id !== id));
    }
    if (target.dataset.saveFavorite) {
        const item = products.find(entry => entry.id === target.dataset.saveFavorite);
        if (!item) return;
        const existing = favoriteFor(item.title);
        if (existing) removeFavorite(existing.id);
        else {
            if (favorites.length >= 50) {
                error = 'Μπορείς να αποθηκεύσεις έως 50 συχνά προϊόντα.';
                render();
                return;
            }
            const favorite = { id: crypto.randomUUID(), title: correctShoppingSpelling(item.title) };
            void changeItems('/favorites', 'POST', favorite, previous => [...previous, favorite], 'favorites');
        }
    }
    if (target.dataset.photo) {
        const item = products.find(entry => entry.id === target.dataset.photo);
        if (!item) return;
        editPhotoId = item.id;
        selectedPhoto = validPhoto(item.photo) ? item.photo : '';
        $('#photo-title').textContent = item.title;
        $('#photo-status').textContent = '';
        previewPhoto();
        $('#photo').showModal();
    }
};

function removeFavorite(id) {
    void changeItems('/favorites/' + encodeURIComponent(id), 'DELETE', null,
        previous => previous.filter(item => item.id !== id), 'favorites');
}

$('#favorite-items').onclick = event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.removeFavorite) removeFavorite(target.dataset.removeFavorite);
    const favorite = favorites.find(item => item.id === target.dataset.useFavorite);
    if (!favorite || products.some(item => favoriteKey(item.title) === favoriteKey(favorite.title))) return;
    const item = { id: crypto.randomUUID(), title: favorite.title, photo: '' };
    void changeItems('/items', 'POST', { items: [item] }, previous => [...previous, item]);
};

function previewPhoto() {
    const img = $('#photo-preview');
    img.hidden = !selectedPhoto;
    if (selectedPhoto) img.src = selectedPhoto;
    else img.removeAttribute('src');
    $('#photo-clear').hidden = !selectedPhoto;
}

async function photoFile(file) {
    const src = URL.createObjectURL(file);
    try {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement('canvas');
        const ratio = Math.min(1, 500 / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));
        const context = canvas.getContext('2d', { alpha: false });
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const photo = canvas.toDataURL('image/jpeg', .67);
        if (!validPhoto(photo) || photo.length > 95_000) throw new Error('Η φωτογραφία είναι πολύ μεγάλη.');
        return photo;
    } finally { URL.revokeObjectURL(src); }
}

let photoGeneration = 0;
$('#photo').addEventListener('close', () => { ++photoGeneration; $('#photo-save').disabled = false; });
for (const picker of [$('#camera'), $('#library')]) picker.onchange = async () => {
    const file = picker.files[0];
    if (!file) return;
    picker.value = '';
    const generation = ++photoGeneration;
    $('#photo-save').disabled = true;
    try {
        const image = await photoFile(file);
        if (generation !== photoGeneration) return;
        selectedPhoto = image;
        $('#photo-status').textContent = '';
        previewPhoto();
    } catch {
        if (generation === photoGeneration) $('#photo-status').textContent = 'Η φωτογραφία δεν άνοιξε ή ήταν πολύ μεγάλη.';
    } finally {
        if (generation === photoGeneration) $('#photo-save').disabled = false;
    }
};
$('#photo-clear').onclick = () => {
    ++photoGeneration;
    selectedPhoto = '';
    $('#photo-save').disabled = false;
    previewPhoto();
};
$('#photo-save').onclick = async () => {
    const id = editPhotoId, photo = selectedPhoto;
    if (await changeItems('/items/' + encodeURIComponent(id), 'PUT', { photo },
        previous => previous.map(item => item.id === id ? { ...item, photo } : item))) $('#photo').close();
    else $('#photo-status').textContent = error;
};


async function syncNotificationState() {
    const connection = device.connection;
    const sequence = notificationSequence;
    if (document.hidden || !document.hasFocus() || (connection && sequence === lastSentSequence)) return;
    const registration = await serviceWorkerReady;
    if (!registration?.active || connection !== device.connection || document.hidden || !document.hasFocus()) return;
    registration.active.postMessage({ type: 'shopping-notification-state', connection,
        seenSequence: Number.isSafeInteger(sequence) ? sequence : null });

}

async function showNotificationSettings() {
    const section = $('#notification-options');
    section.hidden = !device.connection;
    if (!device.connection) return;
    const connection = device.connection;
    const button = $('#enable-notifications');
    const status = $('#notification-status');
    button.disabled = true;
    const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (iphone && !installed) {
        status.textContent = 'Άνοιξε τα Κοινά Ψώνια από το εικονίδιο στην αρχική οθόνη για να ενεργοποιήσεις ειδοποιήσεις.';
        return;
    }
    if (!('Notification' in window) || !('PushManager' in window)) {
        status.textContent = 'Αυτός ο περιηγητής δεν υποστηρίζει ειδοποιήσεις για την εφαρμογή.';
        return;
    }
    if (Notification.permission === 'denied') {
        status.textContent = 'Επίτρεψε τις ειδοποιήσεις για τα Κοινά Ψώνια στις Ρυθμίσεις του κινητού.';
        return;
    }
    status.textContent = 'Έλεγχος ειδοποιήσεων…';
    try {
        const settings = await api('/notification-settings');
        const registration = await serviceWorkerReady;
        if (connection !== device.connection) return;
        if (!registration?.active) throw new Error('Η εφαρμογή προετοιμάζεται. Κλείσε και άνοιξέ την ξανά.');
        notificationPublicKey = settings.publicKey;
        const subscription = await registration.pushManager.getSubscription();
        button.textContent = subscription ? 'Απενεργοποίηση ειδοποιήσεων' : 'Ενεργοποίηση ειδοποιήσεων';
        status.textContent = subscription ? 'Οι ειδοποιήσεις είναι ενεργές σε αυτή τη συσκευή.' :
            'Ο αριθμός στο εικονίδιο δείχνει τις νέες προσθήκες του άλλου και μηδενίζεται όταν ανοίγεις τη λίστα. Θα εμφανίζεται και ειδοποίηση χωρίς ήχο.';
        button.disabled = false;
    } catch (failure) {
        status.textContent = failure.status === 404 ? 'Χρειάζεται πρώτα ενημέρωση της υπηρεσίας ειδοποιήσεων.' :
            failure.status ? 'Η υπηρεσία ειδοποιήσεων δεν είναι διαθέσιμη αυτή τη στιγμή.' : failure.message;
    }
}

function notificationKey(value) {
    return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0));
}

$('#enable-notifications').onclick = async () => {
    const button = $('#enable-notifications');
    const status = $('#notification-status');
    const connection = device.connection;
    button.disabled = true;
    // Ask immediately from the tap, before any network request, as required on iPhone.
    const permission = Notification.permission === 'default' ? Notification.requestPermission() : Promise.resolve(Notification.permission);
    try {
        if (await permission !== 'granted') throw new Error('Χρειάζεται να επιτρέψεις τις ειδοποιήσεις.');
        const registration = await serviceWorkerReady;
        if (!registration?.active || !connection || connection !== device.connection) return;
        let subscription = await registration.pushManager.getSubscription();
        if (subscription) {
            await api('/push-subscription', { method: 'DELETE' });
            await subscription.unsubscribe();
            registration.active.postMessage({ type: 'shopping-notification-state', connection: null });
        } else {
            subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: notificationKey(notificationPublicKey) });
            try {
                await api('/push-subscription', { method: 'POST', body: { endpoint: subscription.endpoint } });
            } catch (failure) {
                await subscription.unsubscribe();
                throw failure;
            }
            lastSentSequence = -1;
            await syncNotificationState();
        }
        await showNotificationSettings();
    } catch (failure) {
        status.textContent = failure.message;
        button.disabled = false;
    }
};

const pasteInvite = $('#paste-invite');
if (pasteInvite) pasteInvite.onsubmit = event => {
    event.preventDefault();
    try {
        const url = new URL(pasteInvite.elements.invitation.value.trim());
        const params = new URLSearchParams(url.hash.slice(1));
        const invite = params.get('invite');
        if (url.origin !== location.origin || !/^\/marmon251\/psonia\/(?:index\.html)?$/.test(url.pathname) ||
            !/^[a-f0-9]{64}$/.test(invite ?? '')) throw new Error();
        pendingInvite = { invite, endpoint: validEndpoint(params.get('server') ?? '') };
        pasteInvite.reset();
        showShare();
        $('#accept-invite').focus();
    } catch {
        $('#share-status').textContent = 'Επικόλλησε ολόκληρο τον σύνδεσμο της πρόσκλησης από τα Κοινά Ψώνια.';
    }
};

$('#invite-open').onclick = showShare;
$('#connect').onsubmit = async event => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button');
    submit.disabled = true;
    const fields = new FormData(event.currentTarget);
    try {
        const endpoint = validEndpoint(fields.get('endpoint'));
        await connect(endpoint, '/lists', { key: fields.get('key').trim() });
        $('#connect').reset();
        $('#share').close();
    } catch (failure) { $('#share-status').textContent = failure.message; }
    finally { submit.disabled = false; }
};
$('#accept-invite').onclick = async () => {
    if (!pendingInvite) return;
    $('#accept-invite').disabled = true;
    try {
        await connect(pendingInvite.endpoint, '/join', { invite: pendingInvite.invite });
        pendingInvite = null;
        $('#share').close();
    } catch (failure) { $('#share-status').textContent = failure.message; }
    finally { $('#accept-invite').disabled = false; }
};
$('#generate-invite').onclick = async () => {
    $('#generate-invite').disabled = true;
    try {
        const { invite } = await api('/invites', { method: 'POST' });
        $('#invite-link').value = location.origin + location.pathname + '#' +
            new URLSearchParams({ server: device.connection.endpoint, invite });
        $('#invite-output').hidden = false;
        $('#share-status').textContent = 'Η πρόσκληση χρησιμοποιείται μία φορά και ισχύει για 24 ώρες.';
    } catch (failure) { $('#share-status').textContent = failure.message; }
    finally { $('#generate-invite').disabled = false; }
};
$('#copy-invite').onclick = async () => {
    try { await navigator.clipboard.writeText($('#invite-link').value); $('#share-status').textContent = 'Αντιγράφηκε ο σύνδεσμος.'; }
    catch { $('#invite-link').select(); }
};
$('#disconnect').onclick = async () => {
    if (role === 'owner' && !confirm('Η αποσύνδεση αφαιρεί το δικαίωμα διαχείρισης από αυτή τη συσκευή. Συνέχεια;')) return;
    if (device.connection) {
        try { await api('/push-subscription', { method: 'DELETE' }); } catch {}
    }
    const registration = await serviceWorkerReady;
    registration?.active?.postMessage({ type: 'shopping-notification-state', connection: null });
    if (registration) {
        const subscription = await registration.pushManager?.getSubscription();
        if (subscription) await subscription.unsubscribe();
    }
    notificationSequence = null;
    lastSentSequence = -1;
    saveDevice({ ...device, connection: null });
    products = device.local;
    favorites = device.favorites;
    role = null;
    revision = null;
    error = '';
    render();
    if (pendingInvite) {
        $('#accept-invite').hidden = false;
        $('#connect').hidden = true;
        $('#connected').hidden = true;
        $('#owner-actions').hidden = true;
        $('#share-status').textContent = 'Πάτησε Αποδοχή πρόσκλησης για να ανοίξεις τη νέα λίστα.';
    } else $('#share').close();
};
$('#revoke').onclick = async () => {
    if (!confirm('Να αφαιρεθεί η πρόσβαση από τις προσκεκλημένες συσκευές;')) return;
    try {
        await api('/members', { method: 'DELETE' });
        $('#invite-output').hidden = true;
        $('#share-status').textContent = 'Η πρόσβαση αφαιρέθηκε. Μπορείς να δημιουργήσεις νέα πρόσκληση.';
    } catch (failure) { $('#share-status').textContent = failure.message; }
};
for (const dialog of document.querySelectorAll('dialog')) {
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
}

render();
readInvite();
render();
void refresh();
document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastSentSequence = -1; void refresh(); } });
window.addEventListener('focus', () => { if (!document.hidden) void refresh(true); });
window.addEventListener('online', () => void refresh());
setInterval(() => { if (!document.hidden) void refresh(); }, 8000);
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type === 'shopping-list-updated' && !document.hidden) void refresh(true);
        if (event.data?.type === 'shopping-notifications-read' && event.data.sequence === notificationSequence) lastSentSequence = event.data.sequence;
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        lastSentSequence = -1;
        void syncNotificationState();
    });
}

