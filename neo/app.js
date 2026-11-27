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
let data = loadData();

function loadData() {
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey));
        return validBackup(saved) ? saved : emptyData();
    } catch {
        return emptyData();
    }
}

function changeData(change) {
    const next = structuredClone(data);
    change(next);
    try {
        localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
        alert('Η αποθήκευση απέτυχε. Δοκίμασε μια μικρότερη φωτογραφία ή ελευθέρωσε χώρο.');
        return false;
    }
    data = next;
    render();
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

function renderShoppingGroups(items, row) {
    const groups = new Map([...shoppingCategories.keys(), 'Λοιπά'].map(category => [category, []]));
    for (const item of items) groups.get(shoppingCategory(item.text)).push(item);
    return [...groups].filter(([, group]) => group.length).map(([category, group]) =>
        '<section class="shopping-group"><h3>' + category + '</h3>' + group.map(item =>
            '<div class="shopping-product-row">' + row(item) + shoppingPhotoButton(item) + '</div>' +
            (splitShopping(item.text).length > 1 ? button('split-item', 'Διαχωρισμός προϊόντων',
                'data-id="' + safe(item.id) + '" aria-label="Διαχωρισμός προϊόντων για ' + safe(item.text) + '"') : '')
        ).join('') + '</section>').join('');
}

function renderShopping() {
    const pending = data.shopping.filter(item => !item.done);
    const row = item => button('delete-shopping', '<span aria-hidden="true">✓</span>' +
        safe(correctShoppingSpelling(item.text)), 'class="item" data-id="' + safe(item.id) +
        '" aria-label="Διαγραφή προϊόντος: ' + safe(correctShoppingSpelling(item.text)) + '"');
    return '<form class="card" id="shopping-form">' +
        '<label for="shopping-input"><strong>Τι χρειάζεσαι;</strong></label>' +
        '<textarea id="shopping-input" name="items" spellcheck="true" placeholder="Γάλα πατάτες 6 αυγά" required></textarea>' +
        '<p class="muted">Γράψε ή πες «γάλα πατάτες 6 αυγά». Για προϊόντα που χρειάζονται σαφή διαχωρισμό, βάλε κόμμα ή πες «επόμενο».</p>' +
        '<button class="primary wide">Προσθήκη στη λίστα</button></form>' +
        '<h2>Στη λίστα απομένουν ' + pending.length + '</h2>' +
        (pending.length ? '<p class="muted">Πάτησε ένα προϊόν για να το διαγράψεις από τη λίστα.</p>' : '') +
        (renderShoppingGroups(pending, row) || '<p class="muted">Η λίστα σου είναι άδεια.</p>');
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
        '</p>' + (item.comments ? '<p class="note">' + safe(item.comments) + '</p>' : '') +
        (validPhoto(item.photo) ? '<img class="appointment-photo" src="' + safe(item.photo) + '" alt="Φωτογραφία ραντεβού" loading="lazy">' : '') +
        '<div class="row">' +
        calendarControl(item) +
        button('edit-appointment', 'Επεξεργασία', 'data-id="' + safe(item.id) + '"') + '</div></article>';
}

function upcomingAppointments(appointments, now = Date.now()) {
    return appointments.filter(item => +new Date(item.datetime) >= now);
}

function updateAppointmentBadge() {
    const count = upcomingAppointments(data.appointments).length;
    const label = count === 1 ? '1 προσεχές ραντεβού' : count + ' προσεχή ραντεβού';
    const badge = document.querySelector('#appointment-count');
    badge.hidden = count === 0;
    badge.textContent = count;
    badge.parentElement.setAttribute('aria-label', count ? 'Ραντεβού, ' + label : 'Ραντεβού');

    const summary = document.querySelector('#appointment-summary');
    if (summary) summary.textContent = count ? label : 'Δεν έχεις προσεχή ραντεβού.';

    if (typeof navigator.setAppBadge === 'function' && globalThis.Notification?.permission === 'granted') {
        void navigator.setAppBadge(count).catch(() => {});
    }
}

async function enableAppointmentBadge() {
    const status = document.querySelector('#appointment-badge-status');
    if (typeof navigator.setAppBadge !== 'function' || !globalThis.Notification?.requestPermission) {
        status.textContent = 'Άνοιξε το Σημειωματάριο από το εικονίδιό του στην αρχική οθόνη του iPhone και πάτησε ξανά εδώ.';
        return;
    }
    try {
        const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
        if (permission === 'granted') {
            await navigator.setAppBadge(upcomingAppointments(data.appointments).length);
            status.textContent = 'Ο αριθμός στο εικονίδιο ενημερώνεται κάθε φορά που ανοίγεις το Σημειωματάριο.';
        } else if (permission === 'denied') {
            status.textContent = 'Για να φαίνεται ο αριθμός, έλεγξε τις γνωστοποιήσεις και τα σήματα του Σημειωματαρίου στις Ρυθμίσεις του iPhone.';
        } else {
            status.textContent = 'Η άδεια εκκρεμεί. Μπορείς να δοκιμάσεις ξανά.';
        }
    } catch {
        status.textContent = 'Το σήμα στο εικονίδιο δεν μπόρεσε να ενημερωθεί σε αυτή τη συσκευή.';
    }
}

function renderAppointments() {
    const appointments = [...data.appointments].sort((a, b) => a.datetime.localeCompare(b.datetime));
    return '<p id="appointment-summary" class="muted"></p>' + button('new-appointment', '+ Νέο ραντεβού', 'class="primary wide"') +
        (appointments.map(appointmentCard).join('') || '<p class="muted">Δεν υπάρχουν ραντεβού.</p>') +
        button('calendar-setup', 'Ρυθμίσεις Ημερολογίου Apple', 'class="wide"') +
        button('enable-appointment-badge', 'Αριθμός στο εικονίδιο', 'class="wide"') +
        '<p id="appointment-badge-status" class="muted" role="status"></p>';
}

let noteSearch = '';
let activeNoteTag = '';

function noteTags(value) {
    const tags = Array.isArray(value) ? value : String(value || '').split(/[,;\n]/);
    const unique = new Map();
    for (const tag of tags) {
        if (typeof tag !== 'string' || !tag.trim()) continue;
        const label = tag.trim().replace(/\s+/g, ' ').slice(0, 40);
        const key = normalizeShoppingWord(label);
        if (!unique.has(key)) unique.set(key, label);
    }
    return [...unique.values()].slice(0, 12);
}

function availableNoteTags() {
    const tags = new Map();
    for (const note of data.notes) {
        for (const label of noteTags(note.tags)) tags.set(normalizeShoppingWord(label), label);
    }
    return [...tags].sort((a, b) => a[1].localeCompare(b[1], 'el'));
}

function noteCards() {
    const query = normalizeShoppingWord(noteSearch.trim());
    return data.notes.filter(item => {
        const tags = noteTags(item.tags);
        const matchesTag = !activeNoteTag || tags.some(tag => normalizeShoppingWord(tag) === activeNoteTag);
        return matchesTag && normalizeShoppingWord([item.title, item.text, ...tags].join(' ')).includes(query);
    }).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
        .map(item => {
            const id = 'data-id="' + safe(item.id) + '"';
            const tags = noteTags(item.tags).map(tag => '<span class="note-tag">' + safe(tag) + '</span>').join('');
            return '<article class="card"><div class="row"><strong>' + safe(item.title) + '</strong>' +
                (item.pinned ? '<small>Καρφιτσωμένη</small>' : '') + '</div>' +
                (tags ? '<div class="row note-tags">' + tags + '</div>' : '') + '<p class="note">' + safe(item.text) + '</p>' +
                (validPhoto(item.photo) ? '<img src="' + safe(item.photo) + '" alt="Φωτογραφία σημείωσης">' : '') +
                '<div class="row">' + button('edit-note', 'Επεξεργασία', id) +
                button('pin-note', item.pinned ? 'Ξεκαρφίτσωμα' : 'Καρφίτσωμα', id) +
                (validScanPdf(item.pdf) ? button('receipt-pdf', 'Απόδειξη PDF', id) : '') + '</div></article>';
        }).join('') || '<p class="muted">Δεν βρέθηκαν σημειώσεις.</p>';
}

function renderNotes() {
    const tags = availableNoteTags();
    if (!tags.some(([key]) => key === activeNoteTag)) activeNoteTag = '';
    const options = tags.map(([key, label]) => '<option value="' + safe(key) + '"' +
        (key === activeNoteTag ? ' selected' : '') + '>' + safe(label) + '</option>').join('');
    return button('new-note', '+ Νέα σημείωση', 'class="primary wide"') +
        '<div class="split note-capture-actions">' + button('quick-camera', 'Λήψη φωτογραφίας') +
        button('quick-library', 'Ανέβασμα αρχείου') + '</div>' +
        '<label for="note-search">Αναζήτηση</label><input id="note-search" type="search" value="' + safe(noteSearch) + '">' +
        (tags.length ? '<label for="note-tag-filter">Ετικέτα</label><select id="note-tag-filter">' +
            '<option value="">Όλες οι ετικέτες</option>' + options + '</select>' : '') +
        '<div id="note-cards">' + noteCards() + '</div>';
}

function renderToday() {
    const today = dateKey(new Date());
    const next = upcomingAppointments(data.appointments)
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
        notes: renderNotes };
    view.innerHTML = renderers[selectedTab]();
    updateAppointmentBadge();
}

function openEditor(title, html) {
    document.querySelector('#editor-heading').textContent = title;
    editor.innerHTML = html;
    if (!dialog.open) dialog.showModal();
}

function photoEditorMarkup() {
    return '<fieldset class="note-photo"><legend>Φωτογραφία</legend><div class="row">' +
        '<input id="note-camera" type="file" accept="image/*" capture="environment" class="visually-hidden">' +
        '<label class="photo-action" for="note-camera">Λήψη φωτογραφίας</label>' +
        '<input id="note-library" type="file" accept="image/*" class="visually-hidden">' +
        '<label class="photo-action" for="note-library">Ανέβασμα αρχείου</label></div>' +
        '<p id="photo-status" class="muted" role="status"></p>' +
        '<img id="photo-preview" hidden alt="Προεπισκόπηση φωτογραφίας">' +
        '<button type="button" id="clear-note-photo" hidden>Αφαίρεση φωτογραφίας</button></fieldset>';
}

function editShoppingPhoto(id) {
    const item = data.shopping.find(entry => entry.id === id && !entry.done);
    if (!item) return;
    openEditor(correctShoppingSpelling(item.text), '<form>' + photoEditorMarkup() +
        '<button class="primary wide">Αποθήκευση φωτογραφίας</button></form>');
    const form = editor.querySelector('form');
    const photo = setupRecordPhoto(form, item.photo);
    form.onsubmit = event => {
        event.preventDefault();
        if (photo.busy) return;
        if (changeData(next => {
            const entry = next.shopping.find(candidate => candidate.id === id);
            if (entry) entry.photo = photo.value;
        })) dialog.close();
    };
}

function shoppingPhotoButton(item) {
    const photo = validPhoto(item.photo);
    const title = photo ? 'Φωτογραφία' : '+ Φωτογραφία';
    const thumbnail = photo ? '<img src="' + safe(item.photo) + '" alt="" loading="lazy">' : '';
    return button('shopping-photo', thumbnail + title, 'class="shopping-photo-button" data-id="' + safe(item.id) +
        '" aria-label="' + (photo ? 'Προβολή φωτογραφίας: ' : 'Προσθήκη φωτογραφίας: ') +
        safe(correctShoppingSpelling(item.text)) + '"');
}

function editRecord(kind, item) {
    const appointment = kind === 'appointments';
    const title = appointment ? 'Ραντεβού' : 'Σημείωση';
    const dateFields = appointment ?
        '<label>Ημερομηνία και ώρα<input type="datetime-local" name="datetime" required value="' + safe(item?.datetime) + '"></label>' : '';
    openEditor(title, '<form id="record-form"><label>Τίτλος<input name="title" ' + (appointment ? 'required ' : '') +
        'value="' + safe(item?.title) + '"></label>' + dateFields + photoEditorMarkup() + '<label>Σημείωση<textarea name="text">' +
        safe(appointment ? item?.comments : item?.text) +
        '</textarea></label>' + (appointment ? '' : '<label>Ετικέτες<input name="tags" placeholder="Αυτοκίνητο, Σπίτι" value="' +
            safe(noteTags(item?.tags).join(', ')) + '"></label>' + scanEditorMarkup()) +
        '<button class="primary wide">Αποθήκευση</button></form>' +
        (item ? button('remove-record', 'Διαγραφή', 'data-id="' + safe(item.id) + '" data-kind="' + kind + '"') : ''));
    const form = editor.querySelector('form');
    const photo = setupRecordPhoto(form, item?.photo);
    const scan = appointment ? null : setupReceiptScan(form, item?.pdf);
    form.onsubmit = event => {
        event.preventDefault();
        if (photo?.busy || scan?.busy) return;
        if (scan?.pending) {
            alert('Πάτησε Δημιουργία PDF ή Ακύρωση περικοπής πριν αποθηκεύσεις τη σημείωση.');
            return;
        }
        const fields = new FormData(form);
        const id = item?.id || crypto.randomUUID();
        const title = fields.get('title').trim();
        const text = fields.get('text').trim();
        if (!title && (appointment || (!text && !photo.value && !scan.value))) {
            alert(appointment ? 'Γράψε έναν τίτλο για το ραντεβού.' : 'Πρόσθεσε τίτλο, κείμενο, φωτογραφία ή PDF.');
            return;
        }
        const record = appointment ?
            { id, title, datetime: fields.get('datetime'), comments: text, photo: photo.value } :
            { id, title: title || (scan.value ? 'Απόδειξη' : photo.value ? 'Φωτογραφία' : 'Σημείωση'), text, photo: photo.value,
                pdf: scan.value, tags: noteTags(fields.get('tags')), pinned: Boolean(item?.pinned) };
        if (changeData(next => { next[kind] = [...next[kind].filter(entry => entry.id !== id), record]; })) dialog.close();
    };
}

function setupRecordPhoto(form, savedPhoto) {
    const photo = { value: validPhoto(savedPhoto) ? savedPhoto : '', busy: false };
    const preview = form.querySelector('#photo-preview');
    const clear = form.querySelector('#clear-note-photo');
    const status = form.querySelector('#photo-status');
    const save = form.querySelector('button[type="submit"], button.primary');
    let selection = 0;

    function updatePreview() {
        if (photo.value) preview.src = photo.value;
        else preview.removeAttribute('src');
        preview.hidden = !photo.value;
        clear.hidden = !photo.value;
    }

    for (const picker of form.querySelectorAll('#note-camera, #note-library')) {
        picker.onchange = async () => {
            const file = picker.files[0];
            if (!file) return;
            picker.value = '';
            const selected = ++selection;
            photo.busy = save.disabled = true;
            status.textContent = 'Ετοιμάζεται η φωτογραφία…';
            try {
                const converted = await photoData(file);
                if (selected !== selection) return;
                if (!validPhoto(converted)) throw new Error('Image conversion failed');
                photo.value = converted;
                status.textContent = 'Έτοιμη. Πάτησε Αποθήκευση για να κρατήσεις τη φωτογραφία.';
                updatePreview();
            } catch {
                if (selected === selection) status.textContent = 'Η εικόνα δεν άνοιξε. Δοκίμασε μια λήψη από την κάμερα ή μια εικόνα JPG/PNG.';
            } finally {
                if (selected === selection) photo.busy = save.disabled = false;
            }
        };
    }
    clear.onclick = () => {
        ++selection;
        photo.value = '';
        photo.busy = save.disabled = false;
        status.textContent = '';
        updatePreview();
    };
    updatePreview();
    return photo;
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
            result.appointments.push({ id, title: item.title, datetime: item.datetime, comments: item.comments || '', photo: validPhoto(item.image) ? item.image : '' });
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

const appearanceKey = 'marmon-neo-appearance';
const palettes = { blue: 'Μπλε', green: 'Πράσινο', graphite: 'Γκρι' };
const appearanceModes = { system: 'Αυτόματο', light: 'Φωτεινό', dark: 'Σκούρο' };

function loadAppearance() {
    try {
        const saved = JSON.parse(localStorage.getItem(appearanceKey));
        if (Object.hasOwn(appearanceModes, saved?.mode)) {
            return { palette: Object.hasOwn(palettes, saved.palette) ? saved.palette : 'blue', mode: saved.mode };
        }
    } catch {}
    return { palette: 'blue', mode: 'system' };
}

function applyAppearance(appearance) {
    const root = document.documentElement;
    root.dataset.palette = appearance.palette;
    root.dataset.appearance = appearance.mode;
    const background = getComputedStyle(root).getPropertyValue('--bg').trim();
    document.querySelector('meta[name="theme-color"]').content = background;
}

function appearanceEditor() {
    const current = loadAppearance();
    const options = (values, selected) => Object.entries(values).map(([value, label]) =>
        '<option value="' + value + '"' + (selected === value ? ' selected' : '') + '>' + label + '</option>'
    ).join('');
    openEditor('Εμφάνιση', '<form id="appearance-form">' +
        '<label>Χρώμα<select name="palette">' + options(palettes, current.palette) + '</select></label>' +
        '<label>Θέμα<select name="mode">' + options(appearanceModes, current.mode) + '</select></label>' +
        '<p class="muted" role="status"></p></form>');
    const form = editor.querySelector('form');
    form.onchange = () => {
        const fields = new FormData(form);
        const next = { palette: fields.get('palette'), mode: fields.get('mode') };
        applyAppearance(next);
        try {
            localStorage.setItem(appearanceKey, JSON.stringify(next));
            form.querySelector('[role="status"]').textContent = 'Η εμφάνιση αποθηκεύτηκε.';
        } catch {
            form.querySelector('[role="status"]').textContent = 'Η εμφάνιση άλλαξε προσωρινά. Δεν αποθηκεύτηκε.';
        }
    };
}

document.querySelector('#appearance').onclick = appearanceEditor;
applyAppearance(loadAppearance());
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyAppearance(loadAppearance()));

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
        noteSearch = event.target.value;
        document.querySelector('#note-cards').innerHTML = noteCards();
    }
});
view.addEventListener('change', event => {
    if (event.target.id === 'note-tag-filter') {
        activeNoteTag = event.target.value;
        document.querySelector('#note-cards').innerHTML = noteCards();
    }
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
        if (items.length) changeData(next => next.shopping.push(...items.map(text => ({ id: crypto.randomUUID(), text }))));
    } else if (event.target.id === 'entitlement-form') {
        changeData(next => { next.entitlements[selectedYear] = Number(fields.get('entitlement')); });
    }
});

document.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const { action, id, kind } = target.dataset;
    if (action === 'delete-shopping') {
        changeData(next => {
            next.shopping = next.shopping.filter(item => item.id !== id);
        });
    } else if (action === 'shopping-photo') editShoppingPhoto(id);
    else if (action === 'split-item') {
        const index = data.shopping.findIndex(item => item.id === id && !item.done);
        if (index === -1) return;
        const items = splitShopping(data.shopping[index].text);
        if (items.length > 1) changeData(next => {
            const photo = next.shopping[index].photo;
            next.shopping.splice(index, 1, ...items.map((text, position) =>
                ({ id: crypto.randomUUID(), text, ...(position === 0 && validPhoto(photo) ? { photo } : {}) })));
        });
    } else if (action === 'quick-camera' || action === 'quick-library') {
        editRecord('notes');
        editor.querySelector(action === 'quick-camera' ? '#note-camera' : '#note-library').click();
    } else if (action === 'new-leave') openLeave();
    else if (action === 'new-appointment' || action === 'edit-appointment') {
        editRecord('appointments', data.appointments.find(item => item.id === id));
    } else if (action === 'new-note' || action === 'edit-note') {
        editRecord('notes', data.notes.find(item => item.id === id));
    } else if (action === 'pin-note') {
        changeData(next => {
            const item = next.notes.find(note => note.id === id);
            if (item) item.pinned = !item.pinned;
        });
    } else if (action === 'receipt-pdf') {
        downloadScanPdf(data.notes.find(note => note.id === id)?.pdf);
    } else if (action === 'calendar') {
        const item = data.appointments.find(item => item.id === id);
        if (item) calendarOptions(item);
    } else if (action === 'calendar-file') {
        const item = data.appointments.find(item => item.id === id);
        if (item) exportAppointment(item);
    } else if (action === 'enable-appointment-badge') enableAppointmentBadge();
    else if (action === 'calendar-setup') calendarSetup();
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

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') updateAppointmentBadge();
});
window.setInterval(() => {
    if (document.visibilityState === 'visible') updateAppointmentBadge();
}, 60000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
render();
