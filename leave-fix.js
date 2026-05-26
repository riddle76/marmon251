(() => {
    const STORAGE_KEY = 'ios_tasks';

    function getTasks() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
        } catch (e) {
            return [];
        }
    }

    function mergeDates(dates = []) {
        return [...new Set(dates.filter(Boolean))].sort();
    }

    function getLeaveInputs() {
        const container = document.getElementById('leaves-dates-container');
        return container ? Array.from(container.querySelectorAll('input[type="date"]')) : [];
    }

    function updateLeaveSummary() {
        const summary = document.getElementById('leave-count-summary');
        const daysInput = document.getElementById('task-days');
        const count = mergeDates(getLeaveInputs().map(input => input.value)).length;

        if (summary) summary.textContent = `${count} ${count === 1 ? 'ημέρα' : 'ημέρες'} άδειας`;
        if (daysInput) daysInput.value = count ? String(count) : '';
    }

    function addLeaveInput(value = '') {
        const container = document.getElementById('leaves-dates-container');
        if (!container) return;

        const input = document.createElement('input');
        input.type = 'date';
        input.className = 'input-datetime';
        input.value = value;
        input.addEventListener('input', updateLeaveSummary);
        container.appendChild(input);
        updateLeaveSummary();
        input.focus();
    }

    function setupLeaveControls() {
        const leavesGroup = document.getElementById('leaves-group');
        const daysInput = document.getElementById('task-days');
        if (!leavesGroup || !daysInput) return;

        daysInput.type = 'hidden';

        const label = leavesGroup.querySelector('label');
        if (label) label.textContent = 'Ημερομηνίες Άδειας';

        let addButton = document.getElementById('btn-add-leave-date');
        if (!addButton) {
            addButton = document.createElement('button');
            addButton.className = 'btn-secondary btn-add-leave-date';
            addButton.id = 'btn-add-leave-date';
            addButton.type = 'button';
            addButton.innerHTML = '<i class="ph ph-plus-circle"></i> Προσθήκη Άδειας';
            daysInput.insertAdjacentElement('afterend', addButton);
        }

        let summary = document.getElementById('leave-count-summary');
        if (!summary) {
            summary = document.createElement('div');
            summary.className = 'leave-count-summary';
            summary.id = 'leave-count-summary';
            summary.textContent = '0 ημέρες άδειας';
            addButton.insertAdjacentElement('afterend', summary);
        }

        if (!addButton.dataset.leaveFixBound) {
            addButton.dataset.leaveFixBound = '1';
            addButton.addEventListener('click', () => addLeaveInput(''));
        }

        getLeaveInputs().forEach(input => {
            if (!input.dataset.leaveFixBound) {
                input.dataset.leaveFixBound = '1';
                input.addEventListener('input', updateLeaveSummary);
            }
        });
        updateLeaveSummary();
    }

    function getTotalLeaveDays() {
        return getTasks().reduce((sum, task) => {
            if (!task || task.category !== 'leaves') return sum;
            return sum + mergeDates(task.leaveDates || []).length;
        }, 0);
    }

    function enhanceLeaveList() {
        const activeLeaves = document.querySelector('.category-btn[data-category="leaves"].active');
        const tasksList = document.getElementById('tasks-list');
        if (!activeLeaves || !tasksList) return;

        const existing = tasksList.querySelector('.leave-total-summary');
        if (existing) existing.remove();

        const total = getTotalLeaveDays();
        const totalDiv = document.createElement('div');
        totalDiv.className = 'leave-total-summary';
        totalDiv.innerHTML = `<i class="ph ph-calendar-check"></i> ${total} ${total === 1 ? 'ημέρα' : 'ημέρες'} άδειας συνολικά`;
        tasksList.insertBefore(totalDiv, tasksList.firstChild.nextSibling);
    }

    function prepareSave() {
        const saveBtn = document.getElementById('save-btn');
        const titleInput = document.getElementById('task-title');
        if (!saveBtn || !titleInput || saveBtn.dataset.leaveFixSaveBound) return;

        saveBtn.dataset.leaveFixSaveBound = '1';
        saveBtn.addEventListener('click', () => {
            const activeLeave = document.querySelector('.cat-option[data-val="leaves"].active');
            if (activeLeave && !titleInput.value.trim() && getLeaveInputs().some(input => input.value)) {
                titleInput.value = 'Άδειες';
            }
            updateLeaveSummary();
        }, true);
    }

    function boot() {
        setupLeaveControls();
        prepareSave();
        enhanceLeaveList();

        const originalRender = window.renderTasks;
        if (typeof originalRender === 'function' && !window.__leaveFixRenderWrapped) {
            window.__leaveFixRenderWrapped = true;
            window.renderTasks = function(...args) {
                const result = originalRender.apply(this, args);
                setTimeout(enhanceLeaveList, 0);
                return result;
            };
        }

        document.addEventListener('click', () => {
            setTimeout(() => {
                setupLeaveControls();
                enhanceLeaveList();
            }, 0);
        });

        const observer = new MutationObserver(() => {
            setupLeaveControls();
            enhanceLeaveList();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
