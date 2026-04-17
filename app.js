// Service Worker Registration for Offline Support
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker Registered'))
            .catch(err => console.log('Service Worker Registration Failed', err));
    });
}

// App State

let tasks = JSON.parse(localStorage.getItem('ios_tasks')) || [];
let activeCategory = 'all';
let editingTaskId = null; // Track if we are editing an existing task

// Global Error Handling for Mobile Debugging
window.onerror = function(msg, url, line, col, error) {
    console.error("Global Error:", msg, "at", line, ":", col);
    // Silent for now unless we want to alert the user
    return false;
};


// Audio & Animations Setup
let audioCtx = null;
function initAudio() {
    if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(audioCtx.state === 'suspended') audioCtx.resume();
}
function playPop() {
    if(!window.AudioContext && !window.webkitAudioContext) return;
    try {
        initAudio();
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.05);
        gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.01);
        gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.1);
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
    } catch(e) {}
}

function provideHapticSuccess() {
    try {
        if (navigator.vibrate) navigator.vibrate(50);
    } catch(e) {}
}

// DOM Elements
const tasksList = document.getElementById('tasks-list');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('search-input');
const addBtn = document.getElementById('add-btn');
const modal = document.getElementById('add-modal');
const cancelBtn = document.getElementById('cancel-btn');
const saveBtn = document.getElementById('save-btn');
const modalHeaderTitle = document.querySelector('.modal-header h2');

// Form Inputs
const titleInput = document.getElementById('task-title');
const itemsInput = document.getElementById('task-items');
const dateInput = document.getElementById('task-date');
const timeInput = document.getElementById('task-time');
const btnPriority = document.getElementById('btn-priority');
const photoInput = document.getElementById('task-photo');
const btnPhoto = document.getElementById('btn-photo');
const photoPreview = document.getElementById('photo-preview');
const photoPreviewContainer = document.getElementById('photo-preview-container');
const btnRemovePhoto = document.getElementById('btn-remove-photo');
const commentsInput = document.getElementById('task-comments');
const leavesGroup = document.getElementById('leaves-group');
const leavesDaysInput = document.getElementById('task-days');
const leavesDatesContainer = document.getElementById('leaves-dates-container');

// Pro Elements
const geoInput = document.getElementById('task-geo');
const btnGeo = document.getElementById('btn-geo');
const geoStatus = document.getElementById('geo-status');
const btnMic = document.getElementById('btn-mic');
let selectedGeoTrigger = null;

const catOptions = document.querySelectorAll('.cat-option');
const filterBtns = document.querySelectorAll('.category-btn');
const dashCards = document.querySelectorAll('.dash-card');
const dateHeader = document.getElementById('current-date');

let activeDashFilter = 'all';

// Form state
let selectedPhotoBase64 = null;
let isModalPriority = false;
let selectedModalCat = 'personal';

// Scroll behavior
let lastScrollY = 0;
tasksList.addEventListener('scroll', () => {
    const currentScrollY = tasksList.scrollTop;
    if (currentScrollY > lastScrollY && currentScrollY > 50) {
        addBtn.classList.add('fab-hidden');
    } else {
        addBtn.classList.remove('fab-hidden');
    }
    lastScrollY = currentScrollY;
});

// Photo Logic
btnPhoto.onclick = () => photoInput.click();
btnRemovePhoto.onclick = () => {
    selectedPhotoBase64 = null;
    photoPreview.src = '';
    photoPreviewContainer.style.display = 'none';
    photoInput.value = '';
};
photoInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width, h = img.height;
                const MAX_W = 800;
                if(w > MAX_W) { h = Math.round((h * MAX_W) / w); w = MAX_W; }
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                selectedPhotoBase64 = canvas.toDataURL('image/jpeg', 0.6);
                photoPreview.src = selectedPhotoBase64;
                photoPreviewContainer.style.display = 'block';
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    }
};

// Priority Logic
btnPriority.onclick = () => {
    isModalPriority = !isModalPriority;
    if(isModalPriority) btnPriority.classList.add('active');
    else btnPriority.classList.remove('active');
};

// Themes Logic
const btnTheme = document.getElementById('btn-theme');
const themeMenu = document.getElementById('theme-menu');
const themeOpts = document.querySelectorAll('.theme-option');

let currentTheme = localStorage.getItem('ios_theme') || 'dark';
document.body.className = currentTheme === 'dark' ? '' : `theme-${currentTheme}`;

btnTheme.onclick = (e) => {
    e.stopPropagation();
    themeMenu.classList.toggle('show');
};

document.addEventListener('click', () => {
    if(themeMenu) themeMenu.classList.remove('show')
});

themeOpts.forEach(opt => {
    opt.onclick = () => {
        currentTheme = opt.dataset.theme;
        document.body.className = currentTheme === 'dark' ? '' : `theme-${currentTheme}`;
        localStorage.setItem('ios_theme', currentTheme);
    };
});

// Search Logic
searchInput.addEventListener('input', () => renderTasks());

// Set Current Date in Header
const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
dateHeader.innerText = new Date().toLocaleDateString('el-GR', options);

function updateAppBadge() {
    if ('setAppBadge' in navigator) {
        const now = new Date();
        const todayNum = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        
        let dueTasks = tasks.filter(t => {
            if (t.isDone || !t.datetime) return false;
            const taskObj = new Date(t.datetime);
            const taskDayNum = new Date(taskObj.getFullYear(), taskObj.getMonth(), taskObj.getDate()).getTime();
            return taskDayNum <= todayNum;
        }).length;
        
        if (dueTasks > 0) {
            navigator.setAppBadge(dueTasks).catch(() => {});
        } else {
            navigator.clearAppBadge().catch(() => {});
        }
    }
}

function saveTasks() {
    try {
        localStorage.setItem('ios_tasks', JSON.stringify(tasks));
        updateAppBadge();
        updateDaySummary();
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.message.toLowerCase().includes('quota')) {
            alert('Σφάλμα: Η μνήμη γέμισε! Η φωτογραφία είναι πολύ μεγάλη ή έχετε πάρα πολλές σημειώσεις. Αδυναμία αποθήκευσης.');
        } else {
            console.error(e);
        }
    }
}

// Day Summary Widget
function updateDaySummary() {
    const el = document.getElementById('day-summary');
    const txt = document.getElementById('day-summary-text');
    const ico = document.getElementById('day-summary-icon');
    if (!el || !txt) return;
    
    const now = new Date();
    const todayNum = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    
    const pending = tasks.filter(t => !t.isDone);
    const todayTasks = pending.filter(t => {
        if (!t.datetime) return false;
        const taskDay = new Date(new Date(t.datetime).getFullYear(), new Date(t.datetime).getMonth(), new Date(t.datetime).getDate()).getTime();
        return taskDay <= todayNum;
    });
    const urgent = todayTasks.filter(t => t.isPriority);
    
    el.className = 'day-summary';
    if (pending.length === 0) {
        ico.className = 'ph ph-confetti';
        txt.textContent = 'Τα έχεις καθαρίσει όλα! Περίφημος! 🎉';
        el.classList.add('all-done');
    } else if (urgent.length > 0) {
        ico.className = 'ph ph-warning-circle';
        txt.textContent = `${urgent.length} επείγουσες · ${pending.length} συνολικά εκκρεμούν`;
        el.classList.add('has-urgent');
    } else if (todayTasks.length > 0) {
        ico.className = 'ph ph-calendar-check';
        txt.textContent = `Έχεις ${todayTasks.length} για σήμερα · ${pending.length} συνολικά`;
    } else {
        ico.className = 'ph ph-sparkle';
        txt.textContent = `${pending.length} εκκρεμότητες — καλή δύναμη!`;
    }
}

// Relative Time Helper
function getRelativeTime(datetimeStr) {
    if (!datetimeStr) return null;
    const taskDate = new Date(datetimeStr);
    const now = new Date();
    const diffMs = taskDate - now;
    const diffMins = Math.round(diffMs / 60000);
    const diffHours = Math.round(diffMs / 3600000);
    const diffDays = Math.round(diffMs / 86400000);
    
    if (diffMins < -1440) return { text: `πριν ${Math.abs(diffDays)} μέρες`, cls: 'overdue-time' };
    if (diffMins < -60) return { text: `πριν ${Math.abs(diffHours)} ώρες`, cls: 'overdue-time' };
    if (diffMins < -1) return { text: `πριν ${Math.abs(diffMins)} λεπτά`, cls: 'overdue-time' };
    if (diffMins < 30) return { text: 'Σε λίγο!', cls: 'soon-time' };
    if (diffMins < 90) return { text: `Σε ${diffMins} λεπτά`, cls: 'soon-time' };
    if (diffHours < 24) return { text: `Σε ${diffHours} ώρες`, cls: '' };
    if (diffDays === 1) return { text: 'Αύριο', cls: '' };
    if (diffDays < 7) return { text: `Σε ${diffDays} μέρες`, cls: '' };
    return null; // fallback to static date string
}

const catConfig = {
    personal: { label: 'Προσωπικά', icon: 'ph-user' },
    doctors: { label: 'Γιατροί', icon: 'ph-stethoscope' },
    bills: { label: 'Λογαριασμοί', icon: 'ph-receipt' },
    shopping: { label: 'Ψώνια', icon: 'ph-shopping-bag' },
    leaves: { label: 'Άδειες', icon: 'ph-airplane-tilt' }
};

/* --- Geo API Fetch --- */
btnGeo.onclick = async () => {
    const q = geoInput.value.trim();
    if(!q) {
        if ("geolocation" in navigator) {
            geoStatus.style.display = 'block';
            geoStatus.style.color = 'var(--text-muted)';
            geoStatus.innerText = 'Λήψη GPS... (Συναινέστε αν ζητηθεί)';
            navigator.geolocation.getCurrentPosition(async (pos) => {
                const { latitude, longitude } = pos.coords;
                try {
                    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=el`);
                    const data = await res.json();
                    let placeName = data && data.display_name ? data.display_name.substring(0, 40) + '...' : 'Τρέχουσα Τοποθεσία';
                    selectedGeoTrigger = { lat: latitude, lon: longitude, raw: placeName };
                    geoInput.value = placeName;
                    geoStatus.style.color = 'var(--cat-shopping)';
                    geoStatus.innerText = '📍 Κλείδωσε: ' + placeName;
                } catch(e) {
                    selectedGeoTrigger = { lat: latitude, lon: longitude, raw: 'Τρέχουσα Τοποθεσία' };
                    geoInput.value = 'Τρέχουσα Τοποθεσία (Συντεταγμένες)';
                    geoStatus.style.color = 'var(--cat-shopping)';
                    geoStatus.innerText = '📍 Κλείδωσε: ' + latitude.toFixed(4) + ', ' + longitude.toFixed(4);
                }
            }, (err) => {
                console.error(err);
                geoStatus.style.display = 'block';
                geoStatus.style.color = 'var(--cat-doctors)';
                geoStatus.innerText = 'Αποτυχία GPS. Ενεργοποιήστε την Τοποθεσία.';
            });
        }
        return;
    }
    
    geoStatus.style.display = 'block';
    geoStatus.style.color = 'var(--text-muted)';
    geoStatus.innerText = 'Αναζήτηση Διεύθυνσης...';
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&accept-language=el`);
        const data = await res.json();
        if(data && data.length > 0) {
            selectedGeoTrigger = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), raw: q };
            geoStatus.style.color = 'var(--cat-shopping)';
            geoStatus.innerText = '📍 Κλείδωσε: ' + data[0].display_name.substring(0, 40) + '...';
        } else {
            geoStatus.style.color = 'var(--cat-doctors)';
            geoStatus.innerText = 'Δεν βρέθηκε η τοποθεσία.';
        }
    } catch (e) {
        geoStatus.innerText = 'Σφάλμα δικτύου. Ελέγξτε τη σύνδεσή σας.';
    }
};

/* --- Voice AI API --- */
const SpeechRecog = window.SpeechRecognition || window.webkitSpeechRecognition;
let isRecording = false;
let accumulatedSpeech = '';

if(SpeechRecog) {
    const recognition = new SpeechRecog();
    recognition.lang = 'el-GR';
    recognition.interimResults = true;
    recognition.continuous = true;
    
    btnMic.onclick = () => {
        if(isRecording) {
            isRecording = false;
            recognition.stop();
            btnMic.classList.remove('recording');
            titleInput.placeholder = 'Τίτλος (ή πατήστε το μικρόφωνο)...';
            if (accumulatedSpeech.trim()) parseAI(accumulatedSpeech.trim());
            accumulatedSpeech = '';
        } else {
            // Trigger explicit iOS permission popup natively
            navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop())).catch(e=>{});
            
            isRecording = true;
            accumulatedSpeech = '';
            btnMic.classList.add('recording');
            titleInput.placeholder = 'Ακούω...';
            try { recognition.start(); } catch(e){}
        }
    };

    recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                // By injecting a newline here, we naturally separate items if the user paused!
                accumulatedSpeech += event.results[i][0].transcript.trim() + '\n';
            } else {
                interim += event.results[i][0].transcript;
            }
        }
        if (interim) titleInput.placeholder = '...' + interim;
        else if (accumulatedSpeech) titleInput.placeholder = accumulatedSpeech.replace(/\n/g, ' ');
    };

    recognition.onend = () => {
        if (isRecording) {
            try { recognition.start(); } 
            catch(e) { 
                isRecording = false; 
                btnMic.classList.remove('recording');
                titleInput.placeholder = 'Τίτλος (ή πατήστε το μικρόφωνο)...';
                if (accumulatedSpeech.trim()) parseAI(accumulatedSpeech.trim());
                accumulatedSpeech = '';
            }
        }
    };
} else {
    btnMic.style.display = 'none'; 
}

function parseAI(text) {
    let t = text.toLowerCase();
    
    // 1. NLP Category Mapping (No automatic forceful fallback to keep explicit user selection)
    if(t.includes('γιατρ') || t.includes('φαρμακ') || t.includes('εξετασ')) document.querySelector('.cat-option[data-val="doctors"]').click();
    else if(t.includes('ψων') || t.includes('σουπερ') || t.includes('αγορ')) document.querySelector('.cat-option[data-val="shopping"]').click();
    else if(t.includes('λογαρ') || t.includes('ρευμα') || t.includes('δεη') || t.includes('οτε') || t.includes('εφορι')) document.querySelector('.cat-option[data-val="bills"]').click();
    else if(t.includes('αδεια') || t.includes('άδεια') || t.includes('ρεπο')) document.querySelector('.cat-option[data-val="leaves"]').click();


    // 2. NLP Date Mapping
    let now = new Date();
    let timeChanged = false;
    if(t.includes('αύριο') || t.includes('αυριο')) { now.setDate(now.getDate() + 1); timeChanged = true; }
    else if(t.includes('μεθαύριο') || t.includes('μεθαυριο')) { now.setDate(now.getDate() + 2); timeChanged = true; }

    // 3. NLP Time Mapping
    const match = t.match(/στις\s(\d{1,2})/);
    if(match) {
        let h = parseInt(match[1]);
        if((t.includes('απόγευμα') || t.includes('απογευμα') || t.includes('βράδυ')) && h < 12) h += 12;
        now.setHours(h, 0, 0);
        timeChanged = true;
    }
    
    if (timeChanged) {
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        dateInput.value = `${yyyy}-${mm}-${dd}`;
        timeInput.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
    
    // Inject logic: If we are in Shopping, split items smartly
    if (selectedModalCat === 'shopping') {
        // Ensure we catch everything flawlessly without relying on Unicode /i flag
        let normalized = text.replace(/,/g, '\n').replace(/\./g, '\n');
        // Replace 'και', 'κι' and all caps variations with newlines
        normalized = normalized.replace(/(^|\s+)(και|κι|ΚΑΙ|Κι|ΚΙ|Και)(\s+|$)/g, '\n');
        
        let items = normalized.split('\n').map(i => i.trim()).filter(i => i);
        
        items = items.map(i => i.charAt(0).toUpperCase() + i.slice(1));
        let newItemsText = items.join('\n');
        
        const prefix = itemsInput.value.trim();
        itemsInput.value = prefix ? prefix + '\n' + newItemsText : newItemsText;
    } else {
        const finalTxt = text.charAt(0).toUpperCase() + text.slice(1);
        const prevTitle = titleInput.value.trim();
        titleInput.value = prevTitle ? prevTitle + ' ' + finalTxt : finalTxt;
    }
}

// Global Background Geo
if ("geolocation" in navigator && "Notification" in window) {
    addBtn.addEventListener('click', () => {
        if(Notification.permission === 'default') Notification.requestPermission();
    });

    navigator.geolocation.watchPosition(pos => {
        const { latitude, longitude } = pos.coords;
        tasks.forEach(t => {
            if(!t.isDone && t.geoTrigger && !t.geoNotified) {
                const dist = calculateDistance(latitude, longitude, t.geoTrigger.lat, t.geoTrigger.lon);
                if(dist < 300) { 
                    if(Notification.permission === "granted") {
                        new Notification("📍 Σημειωματάριο: Φτάσατε!", { body: t.title });
                    }
                    t.geoNotified = true;
                    saveTasks();
                }
            }
        });
    }, err => {}, { enableHighAccuracy: false, maximumAge: 60000 });
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Render Tasks
function renderTasks() {
    tasksList.innerHTML = `<div class="empty-state" id="empty-state">
        <i class="ph ph-check-circle" style="font-size: 48px; color: var(--text-muted);"></i>
        <p>Δεν υπάρχουν υπενθυμίσεις</p>
    </div>`;
    const curEmptyState = document.getElementById('empty-state');

    const query = searchInput.value.trim().toLowerCase();
    
    // Stats Computation
    const now = new Date();
    const todayNum = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    
    let stats = { today: 0, scheduled: 0, all: 0, flagged: 0 };
    
    tasks.forEach(t => {
        if (!t.isDone) {
            stats.all++;
            if (t.isPriority) stats.flagged++;
            if (t.datetime) {
                const taskObj = new Date(t.datetime);
                const taskDayNum = new Date(taskObj.getFullYear(), taskObj.getMonth(), taskObj.getDate()).getTime();
                if (taskDayNum === todayNum) stats.today++;
                else if (taskDayNum > todayNum) stats.scheduled++;
            }
        }
    });

    document.getElementById('count-today').innerText = stats.today;
    document.getElementById('count-scheduled').innerText = stats.scheduled;
    document.getElementById('count-all').innerText = stats.all;
    document.getElementById('count-flagged').innerText = stats.flagged;

    let filtered = tasks.filter(t => {
        const matchCat = activeCategory === 'all' || t.category === activeCategory;
        const matchTitle = t.title.toLowerCase().includes(query) || (t.subtasks && t.subtasks.find(s => s.text.toLowerCase().includes(query)));
        
        let matchDash = true;
        if (activeDashFilter === 'today') {
            if (!t.datetime) matchDash = false;
            else {
                const taskObj = new Date(t.datetime);
                const taskDayNum = new Date(taskObj.getFullYear(), taskObj.getMonth(), taskObj.getDate()).getTime();
                matchDash = (taskDayNum === todayNum);
            }
        } else if (activeDashFilter === 'upcoming') {
            if (!t.datetime) matchDash = false;
            else {
                const taskObj = new Date(t.datetime);
                const taskDayNum = new Date(taskObj.getFullYear(), taskObj.getMonth(), taskObj.getDate()).getTime();
                matchDash = (taskDayNum > todayNum);
            }
        } else if (activeDashFilter === 'priority') {
            matchDash = t.isPriority;
        }

        return matchCat && matchTitle && matchDash;
    });

    if (filtered.length === 0) {
        curEmptyState.classList.add('show');
        return;
    }
    
    curEmptyState.classList.remove('show');


    const groups = {
        overdue: { title: 'Εκπρόθεσμα', cls: 'overdue', items: [] },
        today: { title: 'Σήμερα', cls: '', items: [] },
        upcoming: { title: 'Προσεχώς', cls: '', items: [] },
        nodate: { title: 'Χωρίς Ημερομηνία', cls: '', items: [] },
        completed: { title: 'Ολοκληρωμένα', cls: 'completed', items: [] }
    };

    filtered.forEach(task => {
        if (task.isDone) {
            groups.completed.items.push(task);
        } else if (!task.datetime) {
            groups.nodate.items.push(task);
        } else {
            const taskObj = new Date(task.datetime);
            const taskDayNum = new Date(taskObj.getFullYear(), taskObj.getMonth(), taskObj.getDate()).getTime();
            
            if (taskDayNum === todayNum) {
                groups.today.items.push(task);
            } else if (taskDayNum < todayNum) {
                groups.overdue.items.push(task);
            } else {
                groups.upcoming.items.push(task);
            }
        }
    });

    const sortPriorityDate = (a, b) => {
        if (a.isPriority && !b.isPriority) return -1;
        if (!a.isPriority && b.isPriority) return 1;
        return new Date(a.datetime || "2099") - new Date(b.datetime || "2099");
    };

    Object.keys(groups).forEach(key => {
        groups[key].items.sort(sortPriorityDate);
        if (groups[key].items.length > 0) {
            const h4 = document.createElement('h4');
            h4.className = `group-header ${groups[key].cls}`;
            h4.innerText = groups[key].title;
            tasksList.appendChild(h4);

            groups[key].items.forEach(task => {
                try {
                    const timeObj = task.datetime ? new Date(task.datetime) : null;
                    const staticTimeStr = timeObj ? timeObj.toLocaleString('el-GR', {day: 'numeric', month: 'short', hour: '2-digit', minute:'2-digit', hour12: false}) : 'Χωρίς ημερομηνία';
                    const relTime = !task.isDone && task.datetime ? getRelativeTime(task.datetime) : null;
                    const timeStr = relTime ? relTime.text : staticTimeStr;
                    const timeClass = relTime ? relTime.cls : '';
                    
                    const config = catConfig[task.category] || { label: task.category, icon: 'ph-question' };

                
                let innerContent = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
                    <h3 class="task-title" style="margin: 0; padding-right: 8px;">
                        ${task.isPriority ? '<i class="ph-fill ph-star" style="color: var(--cat-bills); font-size: 16px;"></i>' : ''}
                        ${escapeHTML(task.title)}
                    </h3>
                    <div class="task-actions-inline">
                        <button class="btn-icon-action edit" onclick="event.stopPropagation(); window.editTask('${task.id}')" aria-label="Επεξεργασία">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
                        <button class="btn-icon-action delete" onclick="event.stopPropagation(); window.deleteTask('${task.id}')" aria-label="Διαγραφή">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </div>`;
                
                
                if (task.subtasks && task.subtasks.length > 0) {
                    const allSubDone = task.subtasks.every(s => s.isDone);
                    innerContent += `<div class="subtasks-list">`;
                    task.subtasks.forEach(st => {
                        innerContent += `
                        <div class="subtask-item ${st.isDone ? 'done' : ''}" onclick="event.stopPropagation(); window.toggleSubtask('${task.id}', '${st.id}')">
                            <div class="task-checkbox"><i class="ph ph-check" style="font-weight: bold;"></i></div>
                            <span>${escapeHTML(st.text)}</span>
                        </div>`;
                    });
                    // "Complete All" button for lists that aren't all done yet
                    if (!allSubDone && !task.isDone) {
                        innerContent += `<button class="btn-complete-all" onclick="event.stopPropagation(); window.completeAllSubtasks('${task.id}')">
                            <i class="ph ph-check-circle"></i> Ολοκλήρωση Όλων
                        </button>`;
                    }
                    innerContent += `</div>`;
                }
                
                if (task.comments) {
                    innerContent += `<div class="task-comments-display" style="font-size: 0.9em; color: var(--text-muted); margin-top: 6px; font-style: italic;">${escapeHTML(task.comments)}</div>`;
                }

                if (task.leaveDates && task.leaveDates.length > 0) {
                    innerContent += `<div class="leave-dates-list" style="margin-top: 8px;">`;
                    task.leaveDates.forEach(ld => {
                        if(ld) {
                            const ldObj = new Date(ld);
                            const ldStr = ldObj.toLocaleString('el-GR', {day: 'numeric', month: 'short', year: 'numeric'});
                            innerContent += `
                            <div class="subtask-item">
                                <div class="task-checkbox" style="opacity: 0.5;"><i class="ph ph-calendar-blank"></i></div>
                                <span>${ldStr}</span>
                            </div>`;
                        }
                    });
                    innerContent += `</div>`;
                }

                if (task.image) innerContent += `<img src="${task.image}" class="task-image" />`;

                const wrapper = document.createElement('div');
                wrapper.className = 'task-item-wrapper';
                
                wrapper.innerHTML = `
                    <div class="task-delete-bg-btn" onclick="deleteTask('${task.id}')">
                        <i class="ph ph-trash"></i>
                    </div>
                    <div class="task-priority-bg-btn" onclick="togglePriority('${task.id}')">
                        <i class="ph-fill ph-flag"></i>
                    </div>
                    <div class="task-item ${task.isDone ? 'done' : ''} ${task.isPriority ? 'is-priority' : ''}" data-id="${task.id}">
                        <div class="task-checkbox toggle-main-btn">
                            <i class="ph ph-check" style="font-weight: bold;"></i>
                        </div>
                        <div class="task-content" style="flex: 1; min-width: 0;">
                            <div class="task-content-inner">
                                ${innerContent}
                            </div>
                            <div class="task-meta" style="${(task.subtasks || task.image || task.geoTrigger || task.comments || (task.leaveDates && task.leaveDates.length > 0)) ? 'margin-top: 10px;' : ''}">
                                <div class="cat-tag" data-cat="${task.category}">
                                    <i class="ph ${config.icon}"></i>
                                    ${config.label}
                                </div>
                                ${task.datetime ? `
                                <div class="time-tag ${timeClass}">
                                    <i class="ph ph-clock"></i>
                                    ${escapeHTML(timeStr)}
                                </div>` : ''}
                                ${task.geoTrigger ? `
                                <div class="geo-tag" style="color: var(--cat-shopping); display: flex; align-items: center; gap: 4px;">
                                    <i class="ph ph-map-pin"></i> <span>${escapeHTML(task.geoTrigger.raw).substring(0, 20)}...</span>
                                </div>` : ''}
                            </div>
                        </div>
                    </div>
                `;
                
                tasksList.appendChild(wrapper);

                const itemDiv = wrapper.querySelector('.task-item');
                wrapper.querySelector('.toggle-main-btn').onclick = () => toggleTask(task.id);
                
                // Swipe & Long Press Logic
                let startX = 0;
                let startY = 0;
                let pressTimer = null;
                
                itemDiv.addEventListener('touchstart', e => {
                    startX = e.touches[0].clientX;
                    startY = e.touches[0].clientY;
                    document.querySelectorAll('.task-item.swiped').forEach(el => {
                        if(el !== itemDiv) el.classList.remove('swiped');
                    });
                    
                    pressTimer = setTimeout(() => {
                        showContextMenu(task.id, wrapper);
                    }, 500); // 500ms long press
                }, {passive: true});
                
                itemDiv.addEventListener('touchmove', e => {
                    if(pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
                    
                    const walkX = e.touches[0].clientX - startX;
                    const walkY = e.touches[0].clientY - startY;
                    
                    // Allow simple vertical scrolling without triggering horizontal swipe easily
                    if (Math.abs(walkY) > Math.abs(walkX)) return; 
                    
                    if (walkX < 0 && walkX > -80) { // swipe left (delete)
                        itemDiv.style.transform = `translateX(${walkX}px)`;
                        itemDiv.style.transition = 'none';
                    } else if (walkX > 0 && walkX < 80) { // swipe right (priority)
                        itemDiv.style.transform = `translateX(${walkX}px)`;
                        itemDiv.style.transition = 'none';
                    }
                }, {passive: true});
                
                itemDiv.addEventListener('touchend', e => {
                    if(pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
                    
                    itemDiv.style.transition = '';
                    itemDiv.style.transform = '';
                    const walkX = e.changedTouches[0].clientX - startX;
                    
                    if (walkX < -50) {
                        itemDiv.classList.add('swiped');
                    } else if (walkX > 60) {
                        togglePriority(task.id);
                        provideHapticSuccess();
                    } else {
                        itemDiv.classList.remove('swiped');
                    }
                }, {passive: true});
                } catch (e) {
                    console.error("Error rendering task:", task.id, e);
                }
            });
        }
    });

    document.addEventListener('click', (e) => {
        if(!e.target.closest('.task-item-wrapper')) {
            document.querySelectorAll('.task-item.swiped').forEach(el => el.classList.remove('swiped'));
        }
    });
}

function escapeHTML(str) {
    if(!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

window.toggleTask = function(id) {
    const task = tasks.find(t => t.id === id);
    if(task) { 
        task.isDone = !task.isDone; 
        saveTasks(); 
        renderTasks();
        if (task.isDone) {
            playPop();
            provideHapticSuccess();
        }
    }
}
window.toggleSubtask = function(taskId, subId) {
    const task = tasks.find(t => t.id === taskId);
    if(task && task.subtasks) {
        task.subtasks = task.subtasks.filter(s => s.id !== subId);
        saveTasks(); 
        renderTasks();
        playPop();
        provideHapticSuccess();
    }
}
// Snackbar Undo Logic
let snackbarTimer = null;
let lastDeletedTask = null;
let lastDeletedIndex = -1;
const snackbar = document.getElementById('snackbar');
const snackbarUndo = document.getElementById('snackbar-undo');

function showSnackbar(msg) {
    document.getElementById('snackbar-msg').textContent = msg;
    snackbar.classList.add('show');
    if (snackbarTimer) clearTimeout(snackbarTimer);
    snackbarTimer = setTimeout(() => {
        snackbar.classList.remove('show');
        lastDeletedTask = null;
    }, 4000);
}

snackbarUndo.onclick = () => {
    if (lastDeletedTask) {
        if (lastDeletedIndex >= 0 && lastDeletedIndex <= tasks.length) {
            tasks.splice(lastDeletedIndex, 0, lastDeletedTask);
        } else {
            tasks.push(lastDeletedTask);
        }
        lastDeletedTask = null;
        saveTasks();
        renderTasks();
        snackbar.classList.remove('show');
        clearTimeout(snackbarTimer);
    }
};

window.deleteTask = function(id) {
    const idx = tasks.findIndex(t => t.id === id);
    if (idx !== -1) {
        lastDeletedTask = tasks[idx];
        lastDeletedIndex = idx;
        tasks.splice(idx, 1);
        saveTasks();
        renderTasks();
        provideHapticSuccess();
        showSnackbar(`"​${lastDeletedTask.title.substring(0, 22)}​" διαγράφηκε`);
    }
}

window.editTask = function(id) {
    const task = tasks.find(t => t.id === id);
    if(!task) return;
    editingTaskId = id;

    // Load Title & Category
    titleInput.value = task.title;
    document.querySelector(`.cat-option[data-val="${task.category}"]`).click();

    // Load Date/Time
    if(task.datetime) {
        const parts = task.datetime.split('T');
        dateInput.value = parts[0];
        timeInput.value = parts[1];
    } else {
        dateInput.value = '';
        timeInput.value = '';
    }

    // Load Priority
    isModalPriority = task.isPriority || false;
    if(isModalPriority) btnPriority.classList.add('active');
    else btnPriority.classList.remove('active');

    // Load Subtasks Text
    if(task.subtasks && task.subtasks.length > 0) {
        itemsInput.value = task.subtasks.map(s => s.text).join('\n');
    } else {
        itemsInput.value = '';
    }

    // Load Comments
    commentsInput.value = task.comments || '';

    // Load Leaves
    if(task.category === 'leaves') {
        leavesDaysInput.value = task.leavesDays || '';
        leavesDatesContainer.innerHTML = '';
        if(task.leaveDates) {
            task.leaveDates.forEach(d => {
                const inp = document.createElement('input');
                inp.type = 'date';
                inp.className = 'input-datetime';
                inp.value = d;
                leavesDatesContainer.appendChild(inp);
            });
        }
    } else {
        leavesDaysInput.value = '';
        leavesDatesContainer.innerHTML = '';
    }

    // Load Photo
    selectedPhotoBase64 = task.image || null;
    if(selectedPhotoBase64) {
        photoPreview.src = selectedPhotoBase64;
        photoPreviewContainer.style.display = 'block';
    } else {
        photoPreviewContainer.style.display = 'none';
        photoInput.value = '';
    }

    // Load Geo
    selectedGeoTrigger = task.geoTrigger || null;
    if(selectedGeoTrigger) {
        geoInput.value = selectedGeoTrigger.raw;
        geoStatus.style.display = 'block';
        geoStatus.style.color = 'var(--cat-shopping)';
        geoStatus.innerText = '📍 Κλείδωσε: ' + selectedGeoTrigger.raw;
    } else {
        geoInput.value = '';
        geoStatus.style.display = 'none';
    }

    // Configure Modal
    modalHeaderTitle.innerText = 'Επεξεργασία Σημείωσης';
    saveBtn.innerText = 'Αποθήκευση';
    modal.classList.add('open');
};

addBtn.onclick = () => {
    editingTaskId = null;
    titleInput.value = '';
    itemsInput.value = '';
    commentsInput.value = '';
    geoInput.value = '';
    selectedGeoTrigger = null;
    geoStatus.style.display = 'none';
    
    leavesDaysInput.value = '';
    leavesDatesContainer.innerHTML = '';
    
    isModalPriority = false;
    btnPriority.classList.remove('active');
    
    selectedPhotoBase64 = null;
    photoPreview.src = '';
    photoPreviewContainer.style.display = 'none';
    photoInput.value = '';

    let now = new Date();
    now.setHours(now.getHours() + 1);
    now.setMinutes(0);
    
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    dateInput.value = `${yyyy}-${mm}-${dd}`;
    
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    timeInput.value = `${hh}:${min}`;

    itemsInput.style.display = selectedModalCat === 'shopping' ? 'block' : 'none';

    modalHeaderTitle.innerText = 'Νέα Σημείωση';
    saveBtn.innerText = 'Προσθήκη';
    
    modal.classList.add('open');
    setTimeout(() => {
        if(selectedModalCat === 'shopping') itemsInput.focus();
        else titleInput.focus();
    }, 300);
};

cancelBtn.onclick = () => modal.classList.remove('open');

catOptions.forEach(opt => {
    opt.onclick = () => {
        catOptions.forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        selectedModalCat = opt.dataset.val;
        
        if (selectedModalCat === 'shopping') {
            itemsInput.style.display = 'block';
            titleInput.placeholder = 'Τίτλος (π.χ. Σούπερ Μάρκετ)';
        } else {
            itemsInput.style.display = 'none';
            titleInput.placeholder = 'Τίτλος (ή πατήστε το μικρόφωνο)...';
        }

        if (selectedModalCat === 'leaves') {
            leavesGroup.style.display = 'block';
        } else {
            leavesGroup.style.display = 'none';
        }
    };
});

// Dynamic Leaves Dates
leavesDaysInput.oninput = () => {
    const num = parseInt(leavesDaysInput.value) || 0;
    if(num > 30) { alert('Μέγιστη διάρκεια 30 ημέρες'); leavesDaysInput.value = 30; return; }
    
    const currentDates = Array.from(leavesDatesContainer.querySelectorAll('input')).map(i => i.value);
    leavesDatesContainer.innerHTML = '';
    for(let i = 0; i < num; i++) {
        const inp = document.createElement('input');
        inp.type = 'date';
        inp.className = 'input-datetime';
        inp.value = currentDates[i] || dateInput.value || ''; 
        leavesDatesContainer.appendChild(inp);
    }
};

saveBtn.onclick = () => {
    let title = titleInput.value.trim();
    
    let subtasks = [];
    if (selectedModalCat === 'shopping') {
        const texts = itemsInput.value.split('\n').map(t => t.trim()).filter(t => t);
        subtasks = texts.map((t, idx) => ({ id: 'sub_' + Date.now() + '_' + idx, text: t, isDone: false }));
    }
    
    const comments = commentsInput.value.trim();
    let leaveDates = [];
    let leavesDays = null;
    if(selectedModalCat === 'leaves') {
        leavesDays = leavesDaysInput.value;
        leaveDates = Array.from(leavesDatesContainer.querySelectorAll('input')).map(i => i.value);
    }
    
    if (!title && subtasks.length > 0) title = 'Λίστα Ψωνίων';
    else if (!title) { alert('Παρακαλώ εισάγετε τίτλο'); return; }
    
    const dt = (dateInput.value && timeInput.value) ? `${dateInput.value}T${timeInput.value}` : null;

    if (editingTaskId) {
        const idx = tasks.findIndex(t => t.id === editingTaskId);
        if (idx !== -1) {
            // Restore checking status for subtasks that match their original text
            const oldSubtasks = tasks[idx].subtasks || [];
            subtasks = subtasks.map(newS => {
                const oldMatch = oldSubtasks.find(os => os.text === newS.text);
                if(oldMatch) newS.isDone = oldMatch.isDone;
                return newS;
            });

            tasks[idx] = {
                ...tasks[idx],
                title: title,
                category: selectedModalCat,
                datetime: dt,
                subtasks: subtasks,
                image: selectedPhotoBase64,
                isPriority: isModalPriority,
                geoTrigger: selectedGeoTrigger,
                comments: comments,
                leaveDates: leaveDates,
                leavesDays: leavesDays
            };
        }
    } else {
        const newTask = {
            id: 'task_' + Date.now(),
            title: title,
            category: selectedModalCat,
            datetime: dt,
            subtasks: subtasks,
            image: selectedPhotoBase64,
            isPriority: isModalPriority,
            geoTrigger: selectedGeoTrigger,
            geoNotified: false,
            isDone: false,
            createdAt: new Date().toISOString(),
            comments: comments,
            leaveDates: leaveDates,
            leavesDays: leavesDays
        };
        tasks.push(newTask);
    }

    saveTasks();
    modal.classList.remove('open');
    
    if(activeCategory !== 'all' && activeCategory !== selectedModalCat) {
        document.querySelector('.category-btn[data-category="all"]').click();
    } else {
        renderTasks();
    }
};

window.addEventListener('keydown', e => {
    if(e.key === 'Enter' && modal.classList.contains('open')) {
        if(e.target.tagName !== 'TEXTAREA') {
            e.preventDefault();
            saveBtn.click();
        }
    }
});

filterBtns.forEach(btn => {
    btn.onclick = () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeCategory = btn.dataset.category;
        renderTasks();
    };
});

dashCards.forEach(card => {
    card.onclick = () => {
        dashCards.forEach(c => c.classList.remove('active-dash'));
        card.classList.add('active-dash');
        activeDashFilter = card.dataset.dash;
        renderTasks();
    };
});

window.togglePriority = function(id) {
    const task = tasks.find(t => t.id === id);
    if(task) { 
        task.isPriority = !task.isPriority; 
        saveTasks(); 
        renderTasks();
        provideHapticSuccess();
    }
}

const contextOverlay = document.getElementById('context-menu-overlay');
const contextWrapper = document.getElementById('context-menu-wrapper');
const contextActions = document.getElementById('context-actions');

window.showContextMenu = function(id, wrapperEl) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    
    provideHapticSuccess();
    
    const cloned = wrapperEl.cloneNode(true);
    cloned.style.margin = '0';
    // Remove swipe listeners and absolute bg buttons for the clone if needed, but it works as visual.
    
    contextWrapper.innerHTML = '';
    contextWrapper.appendChild(cloned);
    
    contextActions.innerHTML = `
        <button class="ctx-btn" onclick="editTask('${task.id}'); window.closeContextMenu();">
            <span>Επεξεργασία</span> <i class="ph ph-pencil-simple"></i>
        </button>
        <button class="ctx-btn" onclick="togglePriority('${task.id}'); window.closeContextMenu();">
            <span>${task.isPriority ? 'Αφαίρεση Σημαίας' : 'Σήμανση ως Επείγον'}</span> <i class="ph-fill ph-flag" style="color:var(--cat-bills);"></i>
        </button>
        <button class="ctx-btn danger" onclick="deleteTask('${task.id}'); window.closeContextMenu();">
            <span>Διαγραφή</span> <i class="ph ph-trash"></i>
        </button>
    `;
    
    contextOverlay.classList.add('active');
}

window.closeContextMenu = function() {
    contextOverlay.classList.remove('active');
    setTimeout(() => {
        contextWrapper.innerHTML = '';
        contextActions.innerHTML = '';
    }, 200);
}

contextOverlay.addEventListener('click', (e) => {
    if (e.target === contextOverlay) window.closeContextMenu();
});

document.addEventListener('contextmenu', e => {
    if (e.target.closest('.task-item')) e.preventDefault();
});

renderTasks();

// Briefing Logic
function showDailyBriefing() {
    const todayString = new Date().toLocaleDateString('el-GR');
    if(localStorage.getItem('ios_briefing_date') === todayString) return; 
    
    let uncmp = tasks.filter(t => !t.isDone);
    if(uncmp.length === 0) return; 
    
    const prio = uncmp.find(t => t.isPriority);
    const shop = uncmp.filter(t => t.category === 'shopping');
    
    let text = `Έχεις <b>${uncmp.length}</b> εκκρεμότητες συνολικά σήμερα.`;
    if(prio) text += `<br><br>🚨 Μην ξεχάσεις πως το πιο σημαντικό είναι: "<b>${prio.title}</b>".`;
    if(shop.length > 0) text += `<br><br>🛒 Έχεις επίσης ${shop.length} ${shop.length>1?'λίστες':'λίστα'} αγορών!`;
    
    const hour = new Date().getHours();
    let greeting = 'Καλημέρα!';
    let icon = 'ph-sun';
    if(hour >= 14 && hour < 19) { greeting = 'Καλό Απόγευμα!'; icon = 'ph-cloud-sun'; }
    else if(hour >= 19 || hour < 4) { greeting = 'Καλησπέρα!'; icon = 'ph-moon-stars'; }
    
    const briefModal = document.getElementById('briefing-modal');
    if (!briefModal) return;
    
    document.getElementById('brief-title').innerText = greeting;
    document.getElementById('brief-icon').className = `ph ${icon}`;
    document.getElementById('brief-text').innerHTML = text;
    
    briefModal.classList.add('open');
    document.getElementById('briefing-close').onclick = () => briefModal.classList.remove('open');
    
    localStorage.setItem('ios_briefing_date', todayString);
}
setTimeout(showDailyBriefing, 800);

// Export & Import Logic
const btnExport = document.getElementById('btn-export');
const btnImport = document.getElementById('btn-import');

if (btnExport && btnImport) {
    btnExport.onclick = () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tasks, null, 2));
        const dlAnchorElem = document.createElement('a');
        dlAnchorElem.setAttribute("href", dataStr);
        dlAnchorElem.setAttribute("download", `marmon_tasks_${new Date().toISOString().slice(0,10)}.json`);
        document.body.appendChild(dlAnchorElem);
        dlAnchorElem.click();
        dlAnchorElem.remove();
    };

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    btnImport.onclick = () => fileInput.click();

    fileInput.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const imported = JSON.parse(ev.target.result);
                if (Array.isArray(imported)) {
                    if(confirm(`Βρέθηκαν ${imported.length} σημειώσεις. Είστε σίγουρος ότι θέλετε να αντικαταστήσετε τις υπάρχουσες;`)) {
                        tasks = imported;
                        saveTasks();
                        renderTasks();
                        alert('Η εισαγωγή έγινε με επιτυχία!');
                    }
                } else {
                    alert('Μη έγκυρο αρχείο (Δεν βρέθηκε δομή λίστας).');
                }
            } catch (err) {
                alert('Σφάλμα Ανάγνωσης: ' + err.message);
            }
        };
        reader.readAsText(file);
        fileInput.value = '';
    };
}

// === QUICK-ADD BAR ===
const quickAddInput = document.getElementById('quick-add-input');
const quickAddMore = document.getElementById('quick-add-more');
const quickAddBar = document.getElementById('quick-add-bar');

if (quickAddInput) {
    quickAddInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const title = quickAddInput.value.trim();
            if (!title) return;
            const newTask = {
                id: 'task_' + Date.now(),
                title: title,
                category: 'personal',
                datetime: null,
                subtasks: [],
                image: null,
                isPriority: false,
                geoTrigger: null,
                geoNotified: false,
                isDone: false,
                createdAt: new Date().toISOString(),
                comments: '',
                leaveDates: [],
                leavesDays: null
            };
            tasks.unshift(newTask); // add to top
            quickAddInput.value = '';
            quickAddInput.blur();
            saveTasks();
            renderTasks();
            provideHapticSuccess();
            
            // Flash the new task
            setTimeout(() => {
                const firstItem = document.querySelector('.task-item');
                if (firstItem) {
                    firstItem.style.transition = 'background 0.4s';
                    firstItem.style.background = 'rgba(99,102,241,0.1)';
                    setTimeout(() => { firstItem.style.background = ''; }, 600);
                }
            }, 50);
        }
    });
}

if (quickAddMore) {
    quickAddMore.onclick = () => {
        // Pre-fill title if already typed, then open full modal
        if (quickAddInput && quickAddInput.value.trim()) {
            addBtn.click();
            setTimeout(() => {
                titleInput.value = quickAddInput.value.trim();
                quickAddInput.value = '';
            }, 100);
        } else {
            addBtn.click();
        }
    };
}

// === COMPLETE ALL SUBTASKS ===
window.completeAllSubtasks = function(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (task && task.subtasks) {
        task.subtasks.forEach(s => s.isDone = true);
        saveTasks();
        renderTasks();
        playPop();
        provideHapticSuccess();
    }
};

// Initial Call
updateDaySummary();

