function dateKey(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function parseLeaveDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const day = new Date(value + 'T00:00:00Z');
    return Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value ? null : day;
}

function isLeaveWorkday(value) {
    const day = parseLeaveDate(value)?.getUTCDay();
    return day >= 1 && day <= 5;
}

function uniqueLeaveDates(values) {
    return [...new Set(values.filter(value => typeof value === 'string' && parseLeaveDate(value)))].sort();
}

function leaveRange(from, to) {
    const start = parseLeaveDate(from);
    const end = parseLeaveDate(to);
    if (!start || !end || end < start || end - start > 366 * 86400000) return null;
    const dates = [];
    for (const day = start; day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
        const weekday = day.getUTCDay();
        if (weekday >= 1 && weekday <= 5) dates.push(day.toISOString().slice(0, 10));
    }
    return dates;
}

function summarizeLeave(tasks, year, today) {
    const dates = tasks.filter(task => task.category === 'leaves' && Array.isArray(task.leaveDates))
        .flatMap(task => task.leaveDates);
    const eligible = uniqueLeaveDates(dates).filter(day => day.startsWith(year + '-') && isLeaveWorkday(day));
    const used = eligible.filter(day => day <= today).length;
    return { used, planned: eligible.length - used };
}

function calendarText(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/[,;]/g, '\\$&');
}

function foldCalendarLine(line) {
    const encoder = new TextEncoder();
    let length = 0;
    let output = '';
    for (const character of line) {
        const size = encoder.encode(character).length;
        if (length + size > 75) {
            output += '\r\n ';
            length = 1;
        }
        output += character;
        length += size;
    }
    return output;
}

function appointmentCalendar(task, now = new Date()) {
    const start = new Date(task.datetime);
    if (!task.datetime || Number.isNaN(start.getTime())) return null;
    const end = new Date(start.getTime() + 30 * 60000);
    const stamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Marmon 251//Appointments//EL',
        'BEGIN:VEVENT',
        'UID:' + calendarText(task.id) + '@marmon251',
        'DTSTAMP:' + stamp(now),
        'DTSTART:' + stamp(start),
        'DTEND:' + stamp(end),
        'SUMMARY:' + calendarText(task.title),
        'DESCRIPTION:' + calendarText(task.comments),
        'BEGIN:VALARM',
        'TRIGGER:-PT1H',
        'ACTION:DISPLAY',
        'DESCRIPTION:' + calendarText(task.title),
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR',
        ''
    ].map(foldCalendarLine).join('\r\n');
}

async function exportAppointment(task) {
    const calendar = appointmentCalendar(task);
    if (!calendar) return;
    const file = new File([calendar], 'rantevou.ics', { type: 'text/calendar;charset=utf-8' });
    if (navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file] });
            return;
        } catch (error) {
            if (error.name === 'AbortError') return;
        }
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const storageKey = 'marmon-neo-data-v1';
const emptyData = () => ({ shopping: [], leaves: [], appointments: [], notes: [], entitlements: {} });
const screens = { today: 'Σήμερα', leave: 'Άδειες', appointments: 'Ραντεβού', shop: 'Ψώνια', notes: 'Σημειώσεις' };
const view = document.querySelector('#screen');
const dialog = document.querySelector('#editor');
const editor = document.querySelector('#editor-body');
let selectedTab = 'today';
let selectedYear = new Date().getFullYear();
let lastChecked = null;
let showChecked = false;
let data = loadData();

function loadData() {
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey));
        return validBackup(saved) ? saved : emptyData();
    } catch {
        return emptyData();
    }
}

function changeData(change, refresh = true) {
    const next = structuredClone(data);
    change(next);
    try {
        localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
        alert('Η αποθήκευση απέτυχε. Δοκίμασε μια μικρότερη φωτογραφία ή ελευθέρωσε χώρο.');
        return false;
    }
    data = next;
    if (refresh) render();
    return true;
}

function safe(value) {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value ?? '').replace(/[&<>"']/g, character => entities[character]);
}

function prettyDate(value) {
    const date = new Date(value.length === 10 ? value + 'T12:00' : value);
    if (Number.isNaN(date.getTime())) return '';
    const options = { dateStyle: 'medium' };
    if (value.includes('T')) options.timeStyle = 'short';
    return new Intl.DateTimeFormat('el-GR', options).format(date);
}

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

const shoppingCompounds = new Set(['τυρι κρεμα', 'ψωμι τοστ', 'γαλα κακαο', 'ζαχαρη αχνη', 'χυμος πορτοκαλι']);
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
        if (compound || shoppingQualifiers.has(qualifier)) continue;
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
        .map(item => item.trim()).filter(Boolean).flatMap(splitRecognizedProducts).map(correctShoppingSpelling);
}

function button(action, title, extra = '') {
    return '<button type="button" data-action="' + action + '" ' + extra + '>' + title + '</button>';
}

function renderShopping() {
    const pending = data.shopping.filter(item => !item.done);
    const completed = data.shopping.filter(item => item.done);
    const row = (item, checked) => button('check', '<span aria-hidden="true">' + (checked ? '✓' : '○') +
        '</span>' + safe(correctShoppingSpelling(item.text)), 'class="item' + (checked ? ' strike' : '') + '" data-id="' + safe(item.id) + '"');
    return '<form class="card" id="shopping-form">' +
        '<label for="shopping-input"><strong>Τι χρειάζεσαι;</strong></label>' +
        '<textarea id="shopping-input" name="items" spellcheck="true" placeholder="Γάλα πατάτες 6 αυγά" required></textarea>' +
        '<p class="muted">Γράψε ή πες «γάλα πατάτες 6 αυγά». Για προϊόντα που χρειάζονται σαφή διαχωρισμό, βάλε κόμμα ή πες «επόμενο».</p>' +
        '<button class="primary wide">Προσθήκη στη λίστα</button></form>' +
        '<h2>Στη λίστα απομένουν ' + pending.length + '</h2>' +
        (pending.map(item => row(item, false) + (splitShopping(item.text).length > 1 ?
            button('split-item', 'Διαχωρισμός προϊόντων', 'data-id="' + safe(item.id) + '" aria-label="Διαχωρισμός προϊόντων για ' + safe(item.text) + '"') : '')).join('') || '<p class="muted">Η λίστα σου είναι άδεια.</p>') +
        (lastChecked ? button('undo', 'Αναίρεση τελευταίου') : '') +
        (completed.length ? '<div class="card">' + button('completed', (showChecked ? 'Απόκρυψη' : 'Εμφάνιση') +
            ' τσεκαρισμένων (' + completed.length + ')', 'aria-expanded="' + showChecked + '"') +
            (showChecked ? completed.map(item => row(item, true)).join('') : '') + '</div>' : '');
}

function renderLeave() {
    const today = dateKey(new Date());
    const years = [...new Set([selectedYear, new Date().getFullYear(), new Date().getFullYear() + 1,
        new Date().getFullYear() - 1, ...Object.keys(data.entitlements).map(Number),
        ...data.leaves.flatMap(item => item.leaveDates.map(day => Number(day.slice(0, 4))))])].sort((a, b) => b - a);
    const { used, planned } = summarizeLeave(data.leaves, selectedYear, today);
    const entitlement = data.entitlements[selectedYear];
    const values = [['Δικαιούμαι', entitlement ?? '—'], ['Χρησιμοποιήθηκαν', used], ['Προγραμματισμένες', planned],
        ['Διαθέσιμες', entitlement === undefined ? '—' : entitlement - used - planned]];
    const entries = data.leaves.filter(item => item.leaveDates.some(day => day.startsWith(selectedYear + '-')));
    return '<div class="card"><label for="leave-year">Έτος άδειας</label><select id="leave-year">' +
        years.map(year => '<option' + (year === selectedYear ? ' selected' : '') + '>' + year + '</option>').join('') +
        '</select><div class="stats">' + values.map(([label, value]) => '<div><small>' + label +
            '</small><strong>' + value + '</strong></div>').join('') +
        '</div><form id="entitlement-form"><label for="entitlement">Ετήσιο δικαίωμα σε ημέρες</label>' +
        '<div class="split"><input id="entitlement" name="entitlement" type="number" min="0" max="366" required value="' +
        (entitlement ?? '') + '"><button>Αποθήκευση</button></div></form></div>' +
        button('new-leave', '+ Προσθήκη άδειας', 'class="primary wide"') +
        (entries.map(item => '<article class="card"><strong>' + safe(item.title) + '</strong><p>' +
            item.leaveDates.filter(day => day.startsWith(selectedYear + '-')).map(prettyDate).join(', ') +
            '</p>' + button('remove-leave', 'Διαγραφή', 'data-id="' + safe(item.id) + '"') + '</article>').join('') ||
            '<p class="muted">Δεν υπάρχουν καταχωρίσεις γι’ αυτό το έτος.</p>');
}

const calendarShortcutName = 'Marmon Calendar';
const calendarShortcutKey = 'marmon-neo-apple-calendar';

function appleCalendarShortcut(task) {
    const start = new Date(task.datetime);
    if (!task.datetime || Number.isNaN(start.getTime())) return null;
    const end = new Date(start.getTime() + 30 * 60000);
    const fields = { title: task.title, start: start.toISOString(), end: end.toISOString(), notes: task.comments || '' };
    const query = new URLSearchParams({ name: calendarShortcutName, input: 'text', text: JSON.stringify(fields) });
    return 'shortcuts://run-shortcut?' + query.toString().replace(/\+/g, '%20');
}

function calendarShortcutEnabled() {
    try { return localStorage.getItem(calendarShortcutKey) === 'enabled'; }
    catch { return false; }
}

function calendarSetup() {
    openEditor('Σύνδεση με το Ημερολόγιο Apple',
        '<p>Δημιούργησε μία φορά τη συντόμευση <strong>Marmon Calendar</strong> στο iPhone.</p>' +
        '<ol><li>Άνοιξε τις Συντομεύσεις και δημιούργησε νέα συντόμευση με αυτό ακριβώς το όνομα.</li>' +
        '<li>Πρόσθεσε την ενέργεια «Λήψη λεξικού από την είσοδο» (Get Dictionary from Input), με είσοδο την «Είσοδο συντόμευσης» (Shortcut Input).</li>' +
        '<li>Πρόσθεσε τρεις ενέργειες «Λήψη τιμής λεξικού» (Get Dictionary Value), για τα κλειδιά <code>title</code>, <code>start</code> και <code>end</code>. Σε καθεμία επίλεξε ως πηγή το ίδιο λεξικό από το προηγούμενο βήμα.</li>' +
        '<li>Πρόσθεσε «Νέο γεγονός» (Add New Event). Βάλε τα αποτελέσματα των τριών ενεργειών στον τίτλο, στην έναρξη και στη λήξη αντίστοιχα. Επίλεξε ειδοποίηση «1 ώρα πριν» και κράτησε ενεργή την εμφάνιση της φόρμας για επιβεβαίωση.</li></ol>' +
        button('calendar-enable', 'Η συντόμευση είναι έτοιμη', 'class="primary wide"') +
        (calendarShortcutEnabled() ? button('calendar-disable', 'Χρήση αρχείου ημερολογίου', 'class="wide"') : ''));
}

function calendarOptions(task) {
    const shortcut = appleCalendarShortcut(task);
    if (!shortcut) return;
    openEditor('Προσθήκη στο Ημερολόγιο',
        '<p>Το αρχείο ραντεβού περιλαμβάνει ειδοποίηση μία ώρα πριν.</p>' +
        button('calendar-file', 'Κοινοποίηση αρχείου ραντεβού', 'class="primary wide" data-id="' + safe(task.id) + '"') +
        '<p class="muted">Στο iPhone μπορείς να ανοίξεις το αρχείο .ics ως συνημμένο στο Mail και να το προσθέσεις στο Ημερολόγιο. Έλεγξε ότι εμφανίζεται η ειδοποίηση «1 ώρα πριν».</p>' +
        button('calendar-setup', 'Σύνδεση με Συντομεύσεις Apple', 'class="wide"'));
}

function calendarControl(item) {
    const shortcut = calendarShortcutEnabled() && appleCalendarShortcut(item);
    if (shortcut) return '<a class="calendar-link" href="' + safe(shortcut) + '">Προσθήκη στο Ημερολόγιο</a>';
    return button('calendar', 'Προσθήκη στο Ημερολόγιο', 'data-id="' + safe(item.id) + '"');
}

function appointmentCard(item) {
    return '<article class="card"><strong>' + safe(item.title) + '</strong><p>' + prettyDate(item.datetime) +
        '</p>' + (item.comments ? '<p class="note">' + safe(item.comments) + '</p>' : '') + '<div class="row">' +
        calendarControl(item) +
        button('edit-appointment', 'Επεξεργασία', 'data-id="' + safe(item.id) + '"') + '</div></article>';
}

function renderAppointments() {
    const appointments = [...data.appointments].sort((a, b) => a.datetime.localeCompare(b.datetime));
    return button('new-appointment', '+ Νέο ραντεβού', 'class="primary wide"') +
        (appointments.map(appointmentCard).join('') || '<p class="muted">Δεν υπάρχουν ραντεβού.</p>') +
        button('calendar-setup', 'Ρυθμίσεις Ημερολογίου Apple', 'class="wide"');
}

function noteCards(query = '') {
    return data.notes.filter(item => (item.title + ' ' + item.text).toLocaleLowerCase('el').includes(query))
        .map(item => '<article class="card"><strong>' + safe(item.title) + '</strong><p class="note">' +
            safe(item.text) + '</p>' + (validPhoto(item.photo) ? '<img src="' + safe(item.photo) + '" alt="Φωτογραφία σημείωσης">' : '') +
            '<div>' + button('edit-note', 'Επεξεργασία', 'data-id="' + safe(item.id) + '"') + '</div></article>').join('') ||
        '<p class="muted">Δεν βρέθηκαν σημειώσεις.</p>';
}

function renderToday() {
    const today = dateKey(new Date());
    const next = data.appointments.filter(item => +new Date(item.datetime) >= Date.now())
        .sort((a, b) => a.datetime.localeCompare(b.datetime))[0];
    const entitlement = data.entitlements[today.slice(0, 4)];
    const { used, planned } = summarizeLeave(data.leaves, today.slice(0, 4), today);
    return '<p class="muted">' + new Date().toLocaleDateString('el-GR', { dateStyle: 'full' }) + '</p>' +
        '<h2>Επόμενο ραντεβού</h2>' + (next ? appointmentCard(next) : '<p class="card">Δεν υπάρχει προγραμματισμένο ραντεβού.</p>') +
        '<section class="card"><strong>Διαθέσιμες μέρες άδειας</strong><p>' +
        (entitlement === undefined ? 'Όρισε το ετήσιο δικαίωμά σου στην καρτέλα Άδειες.' : entitlement - used - planned) +
        '</p></section><section class="card"><strong>Στη λίστα για ψώνια</strong><p>' +
        data.shopping.filter(item => !item.done).length + ' προϊόντα</p></section>';
}

function render() {
    document.querySelector('#heading').textContent = screens[selectedTab];
    document.querySelectorAll('[data-tab]').forEach(button => {
        if (button.dataset.tab === selectedTab) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    });
    const renderers = { today: renderToday, leave: renderLeave, shop: renderShopping, appointments: renderAppointments,
        notes: () => button('new-note', '+ Νέα σημείωση', 'class="primary wide"') +
            '<label for="note-search">Αναζήτηση</label><input id="note-search" type="search"><div id="note-cards">' +
            noteCards() + '</div>' };
    view.innerHTML = renderers[selectedTab]();
}

function openEditor(title, html) {
    document.querySelector('#editor-heading').textContent = title;
    editor.innerHTML = html;
    if (!dialog.open) dialog.showModal();
}

function editRecord(kind, item) {
    const appointment = kind === 'appointments';
    const title = appointment ? 'Ραντεβού' : 'Σημείωση';
    const content = appointment ?
        '<label>Ημερομηνία και ώρα<input type="datetime-local" name="datetime" required value="' + safe(item?.datetime) + '"></label>' :
        '<label>Φωτογραφία<input type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif"></label>';
    openEditor(title, '<form id="record-form"><label>Τίτλος<input name="title" required value="' + safe(item?.title) +
        '"></label>' + content + '<label>Σημείωση<textarea name="text">' + safe(appointment ? item?.comments : item?.text) +
        '</textarea></label><button class="primary wide">Αποθήκευση</button></form>' +
        (item ? button('remove-record', 'Διαγραφή', 'data-id="' + safe(item.id) + '" data-kind="' + kind + '"') : ''));
    editor.querySelector('form').onsubmit = async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const fields = new FormData(form);
        const id = item?.id || crypto.randomUUID();
        const title = fields.get('title').trim();
        if (!title) return;
        const text = fields.get('text').trim();
        let record = { id, title, datetime: fields.get('datetime'), comments: text };
        if (!appointment) {
            let photo = item?.photo || '';
            const file = fields.get('image');
            if (file.size) {
                try { photo = await photoData(file); }
                catch { alert('Η φωτογραφία δεν άνοιξε. Δοκίμασε ένα αρχείο JPG ή PNG.'); return; }
            }
            record = { id, title, text, photo };
        }
        if (changeData(next => { next[kind] = [...next[kind].filter(entry => entry.id !== id), record]; })) dialog.close();
    };
}

async function photoData(file) {
    const url = URL.createObjectURL(file);
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const scale = Math.min(1, 1400 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.85);
    } finally { URL.revokeObjectURL(url); }
}

function validPhoto(value) {
    return typeof value === 'string' && /^data:image\/(?:jpeg|png|webp|gif);base64,[a-z\d+/=]+$/i.test(value);
}

function openLeave() {
    openEditor('Προσθήκη άδειας', '<form id="leave-form"><label>Από<input name="from" type="date" required></label>' +
        '<label>Έως (προαιρετικό)<input name="to" type="date"></label><label>Σημείωση<input name="title"></label>' +
        '<p class="muted">Μετράμε Δευτέρα έως Παρασκευή. Για αργία, καταχώρισε τα διαστήματα πριν και μετά.</p>' +
        '<button class="primary wide">Αποθήκευση</button></form>');
    editor.querySelector('form').onsubmit = event => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const from = fields.get('from');
        const dates = leaveRange(from, fields.get('to') || from);
        if (!dates?.length) {
            alert('Επίλεξε έγκυρο διάστημα έως ενός έτους με τουλάχιστον μία εργάσιμη ημέρα.');
            return;
        }
        const entry = { id: crypto.randomUUID(), category: 'leaves', title: fields.get('title').trim() || 'Άδεια', leaveDates: dates };
        selectedYear = Number(dates[0].slice(0, 4));
        if (changeData(next => next.leaves.push(entry))) dialog.close();
    };
}

function validBackup(value) {
    if (!value || typeof value !== 'object') return false;
    const record = item => item && typeof item.id === 'string';
    return Array.isArray(value.shopping) && value.shopping.every(item => record(item) && typeof item.text === 'string') &&
        Array.isArray(value.leaves) && value.leaves.every(item => record(item) && item.category === 'leaves' &&
            Array.isArray(item.leaveDates) && item.leaveDates.every(day => typeof day === 'string' && parseLeaveDate(day))) &&
        Array.isArray(value.appointments) && value.appointments.every(item => record(item) &&
            typeof item.datetime === 'string' && !Number.isNaN(+new Date(item.datetime))) &&
        Array.isArray(value.notes) && value.notes.every(record) && !!value.entitlements &&
        Object.entries(value.entitlements).every(([year, days]) => /^\d{4}$/.test(year) && Number.isInteger(days) && days >= 0 && days <= 366);
}

function legacyBackup(records) {
    if (!records.every(item => item && typeof item.title === 'string')) throw Error('Invalid backup');
    const result = emptyData();
    records.forEach(item => {
        const id = crypto.randomUUID();
        if (item.category === 'leaves' && Array.isArray(item.leaveDates) && uniqueLeaveDates(item.leaveDates).length) {
            result.leaves.push({ id, title: item.title, category: 'leaves', leaveDates: uniqueLeaveDates(item.leaveDates) });
        } else if (item.category === 'doctors' && typeof item.datetime === 'string' && !Number.isNaN(+new Date(item.datetime))) {
            result.appointments.push({ id, title: item.title, datetime: item.datetime, comments: item.comments || '' });
        } else {
            const subtasks = Array.isArray(item.subtasks) ? item.subtasks.filter(subtask => typeof subtask?.text === 'string') : [];
            if (item.category === 'shopping') subtasks.forEach(subtask => result.shopping.push({
                id: crypto.randomUUID(), text: subtask.text, done: Boolean(subtask.isDone)
            }));
            result.notes.push({ id, title: item.title, photo: validPhoto(item.image) ? item.image : '',
                text: [item.datetime && prettyDate(String(item.datetime)), item.comments, ...subtasks.map(subtask => subtask.text)].filter(Boolean).join('\n') });
        }
    });
    return result;
}

function backupEditor() {
    openEditor('Αντίγραφα ασφαλείας', button('download', 'Εξαγωγή αντιγράφου', 'class="wide"') +
        '<label>Εισαγωγή αντιγράφου JSON<input id="backup-file" type="file" accept=".json,application/json"></label>' +
        '<p class="muted">Δέχεται και το αρχείο εξαγωγής του παλιού σημειωματαρίου.</p>');
    editor.querySelector('#backup-file').onchange = async event => {
        try {
            const parsed = JSON.parse(await event.target.files[0].text());
            const copy = Array.isArray(parsed) ? legacyBackup(parsed) : parsed;
            if (!validBackup(copy)) throw Error('Invalid backup');
            if (!confirm('Να αντικατασταθούν οι καταχωρίσεις αυτής της έκδοσης από το αντίγραφο;')) return;
            if (changeData(next => Object.assign(next, copy))) dialog.close();
        } catch { alert('Το αρχείο δεν αναγνωρίστηκε ως αντίγραφο του σημειωματαρίου.'); }
    };
}

function backupDownload() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'marmon-backup-' + dateKey(new Date()) + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

document.querySelector('#backup').onclick = backupEditor;
document.querySelector('#close-editor').onclick = () => dialog.close();
document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => {
    selectedTab = button.dataset.tab;
    render();
    document.querySelector('#heading').focus();
    window.scrollTo(0, 0);
});

view.addEventListener('input', event => {
    if (event.target.id === 'note-search') {
        document.querySelector('#note-cards').innerHTML = noteCards(event.target.value.toLocaleLowerCase('el'));
    }
});
view.addEventListener('change', event => {
    if (event.target.id === 'leave-year') {
        selectedYear = Number(event.target.value);
        render();
    }
});
view.addEventListener('submit', event => {
    event.preventDefault();
    const fields = new FormData(event.target);
    if (event.target.id === 'shopping-form') {
        const items = splitShopping(fields.get('items'));
        if (items.length) changeData(next => next.shopping.push(...items.map(text => ({ id: crypto.randomUUID(), text, done: false }))));
    } else if (event.target.id === 'entitlement-form') {
        changeData(next => { next.entitlements[selectedYear] = Number(fields.get('entitlement')); });
    }
});

document.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const { action, id, kind } = target.dataset;
    if (action === 'check' || action === 'undo') {
        const item = data.shopping.find(item => item.id === (action === 'undo' ? lastChecked : id));
        if (!item) return;
        const wasChecked = item.done;
        if (changeData(next => { next.shopping.find(entry => entry.id === item.id).done = !wasChecked; }, false)) {
            lastChecked = wasChecked ? null : item.id;
            render();
        }
    } else if (action === 'split-item') {
        const index = data.shopping.findIndex(item => item.id === id && !item.done);
        if (index === -1) return;
        const items = splitShopping(data.shopping[index].text);
        if (items.length > 1) changeData(next => {
            next.shopping.splice(index, 1, ...items.map(text => ({ id: crypto.randomUUID(), text, done: false })));
        });
    } else if (action === 'completed') {
        showChecked = !showChecked;
        render();
    } else if (action === 'new-leave') openLeave();
    else if (action === 'new-appointment' || action === 'edit-appointment') {
        editRecord('appointments', data.appointments.find(item => item.id === id));
    } else if (action === 'new-note' || action === 'edit-note') {
        editRecord('notes', data.notes.find(item => item.id === id));
    } else if (action === 'calendar') {
        const item = data.appointments.find(item => item.id === id);
        if (item) calendarOptions(item);
    } else if (action === 'calendar-file') {
        const item = data.appointments.find(item => item.id === id);
        if (item) exportAppointment(item);
    } else if (action === 'calendar-setup') calendarSetup();
    else if (action === 'calendar-enable' || action === 'calendar-disable') {
        try {
            if (action === 'calendar-enable') localStorage.setItem(calendarShortcutKey, 'enabled');
            else localStorage.removeItem(calendarShortcutKey);
            dialog.close();
            render();
        } catch {
            alert('Δεν ήταν δυνατή η αποθήκευση της ρύθμισης.');
        }
    } else if (action === 'download') backupDownload();
    else if (action === 'remove-leave' || action === 'remove-record') {
        if (!confirm('Να διαγραφεί αυτή η καταχώριση;')) return;
        const collection = action === 'remove-leave' ? 'leaves' : kind;
        if (changeData(next => { next[collection] = next[collection].filter(item => item.id !== id); }) && dialog.open) dialog.close();
    }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
render();
