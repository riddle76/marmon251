const taskStates = { open: 'Προς ενέργεια', waiting: 'Περιμένω απάντηση', done: 'Ολοκληρώθηκε' };
const taskViews = { all: 'Ανοιχτές', today: 'Με προθεσμία έως σήμερα', waiting: 'Περιμένω απάντηση', done: 'Ολοκληρωμένες' };
let taskView = 'all', taskTag = '';

function validOrganizerData(value) {
    const list = (items, valid) => items === undefined || Array.isArray(items) && items.every(valid);
    const record = item => item && typeof item.id === 'string' && typeof item.title === 'string';
    const mileage = number => number === null || Number.isSafeInteger(number) && number >= 0;
    const date = value => value === '' || typeof value === 'string' && !!parseLeaveDate(value);
    return list(value.tasks, task => record(task) && Object.hasOwn(taskStates, task.status) && date(task.due)) &&
        list(value.vehicles, vehicle => record(vehicle) && mileage(vehicle.km) && Array.isArray(vehicle.services) &&
            list(vehicle.services, service => record(service) && typeof service.date === 'string' &&
                !!parseLeaveDate(service.date) && date(service.nextDate) && mileage(service.km) && mileage(service.nextKm)));
}

function pendingTasks(tasks, today) {
    return tasks.filter(task => task.status !== 'done' && task.due && task.due <= today)
        .sort((a, b) => Number(Boolean(b.important)) - Number(Boolean(a.important)) || a.due.localeCompare(b.due));
}

function currentServicePlans(vehicle) {
    const latest = new Map();
    for (const service of [...vehicle.services].sort((a, b) => a.date.localeCompare(b.date))) {
        latest.set(normalizeShoppingWord(service.title.trim()), service);
    }
    return [...latest.values()].filter(service => service.nextDate || service.nextKm !== null);
}

function serviceDue(vehicle, service, today) {
    return Boolean(service.nextDate && service.nextDate <= today) ||
        (service.nextKm !== null && vehicle.km !== null && vehicle.km >= service.nextKm);
}

function dashboardOrganizer(today) {
    const tasks = pendingTasks(data.tasks, today);
    const services = data.vehicles.flatMap(vehicle => currentServicePlans(vehicle)
        .filter(service => serviceDue(vehicle, service, today))
        .map(service => vehicle.title + ' · ' + service.title));
    const first = tasks.slice(0, 3).map(task => '<li>' + safe(task.title) + '</li>').join('');
    return '<section class="card organizer-dashboard"><div class="row organizer-heading"><h2>Εκκρεμότητες</h2><strong>' +
        tasks.length + '</strong></div>' +
        (first ? '<ul>' + first + '</ul>' : '<p class="muted">Καμία προθεσμία έως σήμερα.</p>') +
        '<div class="row">' + button('tasks-page', 'Όλες οι εκκρεμότητες') +
        button('task-new', '+ Εκκρεμότητα') + '</div></section>' +
        '<section class="card"><h2>Οχήματα</h2>' +
        (services.length ? '<p>' + safe(services.slice(0, 3).join(' · ')) + '</p>' :
            '<p class="muted">' + (data.vehicles.length ? 'Καμία ληξιπρόθεσμη συντήρηση.' : 'Ιστορικό σέρβις και επόμενη συντήρηση.') + '</p>') +
        button('vehicles-page', 'Άνοιγμα οχημάτων') + '</section>';
}

function taskOptions(values, selected) {
    return Object.entries(values).map(([value, label]) =>
        '<option value="' + safe(value) + '"' + (value === selected ? ' selected' : '') + '>' + safe(label) + '</option>'
    ).join('');
}

function renderTasks() {
    const today = dateKey(new Date());
    const tags = new Map();
    for (const task of data.tasks) {
        for (const label of noteTags(task.tags)) tags.set(normalizeShoppingWord(label), label);
    }
    if (!tags.has(taskTag)) taskTag = '';
    const tasks = data.tasks.filter(task => {
        const status = taskView === 'done' ? task.status === 'done' :
            task.status !== 'done' && (taskView === 'all' ||
                taskView === 'waiting' && task.status === 'waiting' ||
                taskView === 'today' && task.due && task.due <= today);
        return status && (!taskTag || noteTags(task.tags).some(label => normalizeShoppingWord(label) === taskTag));
    }).sort((a, b) => Number(Boolean(b.important)) - Number(Boolean(a.important)) ||
        (a.due || '9999').localeCompare(b.due || '9999'));

    return button('organizer-home', '‹ Σήμερα') + '<form id="quick-task" class="card">' +
        '<label>Γρήγορη καταχώριση<input name="title" required maxlength="140" placeholder="Τι χρειάζεται να κάνεις;"></label>' +
        '<button class="primary wide">Προσθήκη εκκρεμότητας</button></form>' +
        '<label for="task-view">Προβολή</label><select id="task-view">' + taskOptions(taskViews, taskView) + '</select>' +
        (tags.size ? '<label for="task-tag">Ετικέτα</label><select id="task-tag">' +
            taskOptions(Object.fromEntries([['', 'Όλες οι ετικέτες'], ...tags]), taskTag) + '</select>' : '') +
        (tasks.map(task => {
            const id = 'data-id="' + safe(task.id) + '"';
            const labels = noteTags(task.tags);
            const due = task.due ? (task.status === 'waiting' ? 'Επανέλεγχος ' : 'Προθεσμία ') + prettyDate(task.due) : '';
            return '<article class="card"><strong>' + (task.important ? '★ ' : '') + safe(task.title) + '</strong><p class="muted">' +
                [taskStates[task.status], due, ...labels].filter(Boolean).map(safe).join(' · ') + '</p><div class="row">' +
                button('task-edit', 'Επεξεργασία', id) +
                button('task-toggle', task.status === 'done' ? 'Επαναφορά' : 'Ολοκλήρωση', id) + '</div></article>';
        }).join('') || '<p class="muted">Δεν υπάρχουν εκκρεμότητες σε αυτή την προβολή.</p>');
}

function addQuickTask(form) {
    const title = new FormData(form).get('title').trim();
    if (!title) return;
    taskView = 'all';
    taskTag = '';
    changeData(next => next.tasks.unshift({ id: crypto.randomUUID(), title, due: '', status: 'open', important: false, tags: [] }));
}

function editTask(item) {
    openEditor(item ? 'Επεξεργασία εκκρεμότητας' : 'Νέα εκκρεμότητα', '<form><label>Τίτλος<input name="title" required maxlength="140" value="' +
        safe(item?.title) + '"></label><label>Κατάσταση<select name="status">' + taskOptions(taskStates,item?.status || 'open') +
        '</select></label><label><span id="task-date-label"></span><input type="date" name="due" value="' + safe(item?.due) +
        '"></label><label>Ετικέτες<input name="tags" placeholder="Σπίτι, Πρόσκοποι" value="' + safe(noteTags(item?.tags).join(', ')) +
        '"></label><label class="task-check"><input type="checkbox" name="important"' + (item?.important ? ' checked' : '') +
        '> Υψηλή προτεραιότητα</label><button class="primary wide">Αποθήκευση</button></form>' +
        (item ? button('task-delete', 'Διαγραφή εκκρεμότητας', 'data-id="' + safe(item.id) + '"') : ''));
    const form = editor.querySelector('form');
    const status = form.elements.namedItem('status');
    const updateLabel = () => {
        form.querySelector('#task-date-label').textContent = status.value === 'waiting' ? 'Ημερομηνία επανελέγχου' : 'Προθεσμία';
    };
    status.onchange = updateLabel;
    updateLabel();
    form.onsubmit = event => {
        event.preventDefault();
        const fields = new FormData(form);
        const title = fields.get('title').trim();
        if (!title) return;
        const entry = { id: item?.id || crypto.randomUUID(), title, due: fields.get('due'), status: fields.get('status'),
            important: fields.has('important'), tags: noteTags(fields.get('tags')) };
        if (changeData(next => {
            const index = next.tasks.findIndex(task => task.id === entry.id);
            if (index < 0) next.tasks.unshift(entry);
            else next.tasks[index] = entry;
        })) dialog.close();
    };
}

function kmText(value) {
    return value === null ? '' : new Intl.NumberFormat('el-GR').format(value) + ' χλμ.';
}

function renderVehicles() {
    const today = dateKey(new Date());
    return '<div class="row">' + button('organizer-home', '‹ Σήμερα') +
        button('vehicle-new', '+ Όχημα', 'class="primary"') + '</div>' +
        (data.vehicles.map(vehicle => {
            const id = 'data-id="' + safe(vehicle.id) + '"';
            const plans = currentServicePlans(vehicle).map(service => {
                const due = [service.nextDate && prettyDate(service.nextDate), kmText(service.nextKm)].filter(Boolean).join(' ή ');
                return '<li>' + safe(service.title) + ' · ' + due +
                    (serviceDue(vehicle, service, today) ? ' <strong>Έφτασε η προθεσμία</strong>' : '') + '</li>';
            }).join('');
            const history = [...vehicle.services].reverse().sort((a, b) => b.date.localeCompare(a.date)).map(service =>
                '<li><strong>' + safe(service.title) + '</strong><p class="muted">' +
                [prettyDate(service.date), kmText(service.km)].filter(Boolean).join(' · ') + '</p>' +
                button('service-edit', 'Επεξεργασία', id + ' data-service="' + safe(service.id) + '"') + '</li>'
            ).join('');
            return '<article class="card"><h2>' + safe(vehicle.title) + '</h2><p class="muted">' +
                (kmText(vehicle.km) || 'Δεν έχει καταχωριστεί ένδειξη χιλιομετρητή.') + '</p><div class="row">' +
                button('vehicle-edit', 'Στοιχεία και χιλιόμετρα', id) + button('service-new', '+ Σέρβις', id) + '</div>' +
                (plans ? '<h3>Επόμενη συντήρηση</h3><ul>' + plans + '</ul>' : '') +
                (history ? '<details><summary>Ιστορικό σέρβις (' + vehicle.services.length + ')</summary><ul class="service-history">' +
                    history + '</ul></details>' : '') + '</article>';
        }).join('') || '<p class="muted">Πρόσθεσε όχημα για να κρατάς ιστορικό σέρβις.</p>');
}

function mileageField(name, label, value) {
    return '<label>' + label + '<input name="' + name + '" type="number" inputmode="numeric" min="0" max="100000000" step="1" value="' +
        safe(value) + '"></label>';
}

function optionalNumber(value) {
    return value === '' ? null : Number(value);
}

function editVehicle(vehicle) {
    openEditor(vehicle ? 'Στοιχεία οχήματος' : 'Νέο όχημα', '<form><label>Όνομα οχήματος<input name="title" required maxlength="80" placeholder="π.χ. Opel Astra" value="' +
        safe(vehicle?.title) + '"></label>' + mileageField('km', 'Τρέχουσα ένδειξη χιλιομετρητή', vehicle?.km) +
        '<button class="primary wide">Αποθήκευση</button></form>' +
        (vehicle ? button('vehicle-delete', 'Διαγραφή οχήματος', 'data-id="' + safe(vehicle.id) + '"') : ''));
    const form = editor.querySelector('form');
    form.onsubmit = event => {
        event.preventDefault();
        const fields = new FormData(form);
        const title = fields.get('title').trim();
        if (!title) return;
        const km = optionalNumber(fields.get('km'));
        if (changeData(next => {
            const existing = next.vehicles.find(item => item.id === vehicle?.id);
            if (existing) Object.assign(existing, { title, km });
            else next.vehicles.push({ id: crypto.randomUUID(), title, km, services: [] });
        })) dialog.close();
    };
}

function editService(vehicle, service) {
    const today = dateKey(new Date());
    openEditor(service ? 'Επεξεργασία σέρβις' : 'Καταχώριση σέρβις', '<form><label>Εργασία<input name="title" list="service-names" required maxlength="100" value="' +
        safe(service?.title) + '" placeholder="π.χ. Αλλαγή λαδιών"></label><datalist id="service-names">' +
        [...new Set(vehicle.services.map(item => item.title))].map(title => '<option value="' + safe(title) + '"></option>').join('') +
        '</datalist><label>Ημερομηνία εργασίας<input name="date" type="date" required value="' + (service?.date || today) + '"></label>' +
        mileageField('km', 'Χιλιόμετρα στο σέρβις', service ? service.km : vehicle.km) +
        '<label>Επόμενο σέρβις έως<input name="nextDate" type="date" value="' + safe(service?.nextDate) + '"></label>' +
        mileageField('nextKm', 'Ή όταν το όχημα φτάσει στα χλμ.', service?.nextKm) +
        '<button class="primary wide">Αποθήκευση σέρβις</button></form>' +
        (service ? button('service-delete', 'Διαγραφή σέρβις', 'data-id="' + safe(vehicle.id) +
            '" data-service="' + safe(service.id) + '"') : ''));
    const form = editor.querySelector('form');
    form.onsubmit = event => {
        event.preventDefault();
        const fields = new FormData(form);
        const title = fields.get('title').trim();
        if (!title) return;
        const item = { id: service?.id || crypto.randomUUID(), title, date: fields.get('date'),
            km: optionalNumber(fields.get('km')), nextDate: fields.get('nextDate'), nextKm: optionalNumber(fields.get('nextKm')) };
        if (item.nextDate && item.nextDate < item.date || item.km !== null && item.nextKm !== null && item.nextKm < item.km) {
            alert('Η επόμενη συντήρηση πρέπει να έχει μεταγενέστερη ημερομηνία ή μεγαλύτερη ένδειξη χιλιομετρητή.');
            return;
        }
        if (changeData(next => {
            const entry = next.vehicles.find(candidate => candidate.id === vehicle.id);
            if (!entry) return;
            const index = entry.services.findIndex(candidate => candidate.id === item.id);
            if (index < 0) entry.services.push(item);
            else entry.services[index] = item;
            if (item.km !== null && (entry.km === null || item.km > entry.km)) entry.km = item.km;
        })) dialog.close();
    };
}

function organizerAction(action, {id, service}) {
    switch (action) {
        case 'organizer-home': navigateNotebook('today'); return true;
        case 'tasks-page': navigateNotebook('tasks'); return true;
        case 'vehicles-page': navigateNotebook('vehicles'); return true;
        case 'task-new':
        case 'task-edit':
            editTask(data.tasks.find(task => task.id === id));
            return true;
        case 'task-toggle':
            changeData(next => {
                const item = next.tasks.find(task => task.id === id);
                if (!item) return;
                if (item.status === 'done') item.status = item.previousStatus === 'waiting' ? 'waiting' : 'open';
                else {
                    item.previousStatus = item.status;
                    item.status = 'done';
                }
            });
            return true;
        case 'task-delete':
            if (confirm('Να διαγραφεί η εκκρεμότητα;') &&
                changeData(next => { next.tasks = next.tasks.filter(task => task.id !== id); })) dialog.close();
            return true;
        case 'vehicle-new':
        case 'vehicle-edit':
            editVehicle(data.vehicles.find(vehicle => vehicle.id === id));
            return true;
        case 'service-new':
        case 'service-edit': {
            const vehicle = data.vehicles.find(entry => entry.id === id);
            if (vehicle) editService(vehicle, vehicle.services.find(entry => entry.id === service));
            return true;
        }
        case 'vehicle-delete':
            if (confirm('Να διαγραφεί το όχημα μαζί με το ιστορικό του;') &&
                changeData(next => { next.vehicles = next.vehicles.filter(vehicle => vehicle.id !== id); })) dialog.close();
            return true;
        case 'service-delete':
            if (confirm('Να διαγραφεί αυτή η καταχώριση σέρβις;') && changeData(next => {
                const vehicle = next.vehicles.find(entry => entry.id === id);
                if (vehicle) vehicle.services = vehicle.services.filter(entry => entry.id !== service);
            })) dialog.close();
            return true;
        default: return false;
    }
}
