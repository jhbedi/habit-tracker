/**
 * Goal Tracker - Tracking Page (tracking.js)
 */

// =====================================================
// State
// =====================================================

let goalsCache = [];
let weekOffset = 0;

// Priority order for sorting (higher = more important)
const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };

// =====================================================
// DOM Elements
// =====================================================

const goalsList = document.getElementById('goalsList');
const emptyState = document.getElementById('emptyState');
const daysHeader = document.getElementById('daysHeader');
const weekDisplay = document.getElementById('weekDisplay');
const prevWeekBtn = document.getElementById('prevWeek');
const nextWeekBtn = document.getElementById('nextWeek');
const toast = document.getElementById('toast');

// =====================================================
// Confetti Animation
// =====================================================

function triggerConfetti() {
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);

    const colors = ['#22c55e', '#10b981', '#6366f1', '#a855f7', '#ec4899', '#f59e0b', '#06b6d4'];
    const shapes = ['circle', 'square', 'triangle'];

    for (let i = 0; i < 100; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.animationDelay = Math.random() * 0.5 + 's';
        confetti.style.animationDuration = (2 + Math.random() * 2) + 's';

        const shape = shapes[Math.floor(Math.random() * shapes.length)];
        if (shape === 'circle') {
            confetti.style.borderRadius = '50%';
        } else if (shape === 'triangle') {
            confetti.style.width = '0';
            confetti.style.height = '0';
            confetti.style.borderLeft = '5px solid transparent';
            confetti.style.borderRight = '5px solid transparent';
            confetti.style.borderBottom = '10px solid ' + colors[Math.floor(Math.random() * colors.length)];
            confetti.style.backgroundColor = 'transparent';
        }

        container.appendChild(confetti);
    }

    // Remove container after animation
    setTimeout(() => container.remove(), 4000);
}

// =====================================================
// Date Utilities
// =====================================================

function getWeekDates(offset = 0) {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + (offset * 7));

    const dates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        dates.push(d.toISOString().split('T')[0]);
    }

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    return { dates, monday, sunday };
}

function formatWeekDisplay(monday, sunday) {
    const opts = { month: 'short', day: 'numeric' };
    return monday.toLocaleDateString('en-US', opts) + ' - ' + sunday.toLocaleDateString('en-US', opts);
}

function getDayLabel(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay();
    const labels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    return labels[day];
}

function isToday(dateStr) {
    return new Date(dateStr).toDateString() === new Date().toDateString();
}

function isInRange(dateStr, start, end) {
    const d = new Date(dateStr);
    const s = new Date(start);
    const e = new Date(end);
    d.setHours(0, 0, 0, 0);
    s.setHours(0, 0, 0, 0);
    e.setHours(0, 0, 0, 0);
    return d >= s && d <= e;
}

function isGoalCompleted(goal) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(goal.startDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(goal.endDate);
    endDate.setHours(0, 0, 0, 0);

    // Goal is completed if:
    // 1. End date has passed (yesterday or earlier), OR
    // 2. End date is today AND all days have been checked

    if (endDate < today) {
        return true; // Past end date
    }

    // Check if all days from start to end are completed
    const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    const daysCompleted = goal.dailyProgress ? goal.dailyProgress.length : 0;

    // All days checked means completed
    return daysCompleted >= totalDays;
}

// =====================================================
// Database Operations
// =====================================================

async function fetchGoals() {
    try {
        const { data, error } = await window.supabase
            .from('goals')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        goalsCache = data.map(g => ({
            id: g.id,
            title: g.title,
            category: g.category,
            priority: g.priority,
            effort: g.effort || 'medium',
            startDate: g.start_date,
            endDate: g.end_date,
            timePerDay: g.time_per_day || 60,
            dailyProgress: g.daily_progress || []
        }));

        // Sort: Active goals by priority first, completed goals at bottom
        goalsCache.sort((a, b) => {
            const aCompleted = isGoalCompleted(a);
            const bCompleted = isGoalCompleted(b);

            // Completed goals go to the bottom
            if (aCompleted && !bCompleted) return 1;
            if (!aCompleted && bCompleted) return -1;

            // Within same completion status, sort by priority
            return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
        });

        return goalsCache;
    } catch (error) {
        console.error('Error:', error);
        showToast('Error loading goals');
        return [];
    }
}

async function toggleDay(goalId, dateStr) {
    const goal = goalsCache.find(g => g.id === goalId);
    if (!goal) return;

    const progress = [...goal.dailyProgress];
    const idx = progress.indexOf(dateStr);
    const isChecking = idx === -1; // true = adding, false = removing

    if (idx > -1) {
        progress.splice(idx, 1);
    } else {
        progress.push(dateStr);
    }

    goal.dailyProgress = progress;

    try {
        const { error } = await window.supabase
            .from('goals')
            .update({ daily_progress: progress })
            .eq('id', goalId);

        if (error) throw error;

        // Log to task_logs when checking a day as completed
        if (isChecking && typeof logTaskEvent === 'function') {
            // Use the goal's timePerDay (stored in minutes in DB)
            // We need the raw goal data for timePerDay since tracking cache doesn't have it
            const timePerDay = goal.timePerDay || 60;
            logTaskEvent(goalId, timePerDay, `Daily check: ${dateStr}`, 'neutral');
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Error saving');
    }
}

// =====================================================
// Rendering
// =====================================================

function render() {
    const { dates, monday, sunday } = getWeekDates(weekOffset);

    // Update week display
    weekDisplay.textContent = formatWeekDisplay(monday, sunday);

    // Render days header
    daysHeader.innerHTML = dates.map(d => `
        <span class="day-label ${isToday(d) ? 'today' : ''}">${getDayLabel(d)}</span>
    `).join('');

    // Render goals
    if (goalsCache.length === 0) {
        goalsList.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    goalsList.innerHTML = goalsCache.map(goal => {
        const checkboxes = dates.map(d => {
            const inRange = isInRange(d, goal.startDate, goal.endDate);
            const checked = goal.dailyProgress.includes(d);
            const today = isToday(d);
            const dateLabel = new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

            if (!inRange) {
                return `<span class="checkbox disabled" aria-hidden="true"></span>`;
            }

            return `
                <span class="checkbox ${checked ? 'checked' : ''} ${today ? 'today' : ''}"
                      role="checkbox"
                      aria-checked="${checked}"
                      aria-label="${goal.title} - ${dateLabel}"
                      tabindex="0"
                      data-goal="${goal.id}" 
                      data-date="${d}">
                    ${checked ? '✓' : ''}
                </span>
            `;
        }).join('');

        const completed = isGoalCompleted(goal);

        return `
            <div class="goal-row ${completed ? 'completed' : ''}" data-goal-id="${goal.id}">
                <div class="goal-info">
                    <span class="goal-name">${goal.title}</span>
                    <div class="goal-tags">
                        <span class="tag priority-${goal.priority}">${goal.priority}</span>
                        <span class="tag effort-${goal.effort}">${goal.effort}</span>
                        ${completed ? '<span class="tag completed-tag">✓ Done</span>' : ''}
                    </div>
                </div>
                <div class="goal-actions">
                    <button class="action-btn edit" data-action="edit" data-goal-id="${goal.id}" title="Edit goal">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="action-btn reset" data-action="reset" data-goal-id="${goal.id}" title="Reset progress">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="1 4 1 10 7 10"></polyline>
                            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                        </svg>
                    </button>
                    <button class="action-btn delete" data-action="delete" data-goal-id="${goal.id}" title="Delete goal">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
                <div class="checkboxes">${checkboxes}</div>
            </div>
        `;
    }).join('');
}

// =====================================================
// Event Handlers
// =====================================================

goalsList.addEventListener('click', async (e) => {
    // Handle action buttons
    const actionBtn = e.target.closest('.action-btn');
    if (actionBtn) {
        const action = actionBtn.dataset.action;
        const goalId = actionBtn.dataset.goalId;

        if (action === 'edit') {
            openEditModal(goalId);
        } else if (action === 'reset') {
            showConfirmModal(
                'Reset Progress',
                'Are you sure you want to reset all progress for this goal? This action cannot be undone.',
                () => resetGoal(goalId)
            );
        } else if (action === 'delete') {
            showConfirmModal(
                'Delete Goal',
                'Are you sure you want to permanently delete this goal? This action cannot be undone.',
                () => deleteGoal(goalId)
            );
        }
        return;
    }

    // Handle checkboxes
    const checkbox = e.target.closest('.checkbox:not(.disabled)');
    if (!checkbox) return;

    const goalId = checkbox.dataset.goal;
    const dateStr = checkbox.dataset.date;

    // Toggle visually
    checkbox.classList.toggle('checked');
    const isChecked = checkbox.classList.contains('checked');
    checkbox.textContent = isChecked ? '✓' : '';
    checkbox.setAttribute('aria-checked', isChecked);

    // Check if this completes the goal
    const goal = goalsCache.find(g => g.id === goalId);
    const wasCompleted = goal ? isGoalCompleted(goal) : false;

    await toggleDay(goalId, dateStr);

    // If the goal is now completed, show celebration and re-render
    const updatedGoal = goalsCache.find(g => g.id === goalId);
    if (updatedGoal && !wasCompleted && isGoalCompleted(updatedGoal)) {
        triggerConfetti();
        showToast('🎉 Goal completed! Great job!');

        // Re-sort and re-render to move completed goal to bottom with strikethrough
        goalsCache.sort((a, b) => {
            const aCompleted = isGoalCompleted(a);
            const bCompleted = isGoalCompleted(b);
            if (aCompleted && !bCompleted) return 1;
            if (!aCompleted && bCompleted) return -1;
            return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
        });

        // Small delay to let confetti start before re-rendering
        setTimeout(() => render(), 500);
    }
});

// Keyboard accessibility: Enter/Space toggles checkboxes
goalsList.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        const checkbox = e.target.closest('.checkbox:not(.disabled)');
        if (checkbox) {
            e.preventDefault();
            checkbox.click();
        }
    }
});

prevWeekBtn.addEventListener('click', () => {
    weekOffset--;
    render();
});

nextWeekBtn.addEventListener('click', () => {
    weekOffset++;
    render();
});

// =====================================================
// Utility
// =====================================================

function showToast(message) {
    const toastMessage = toast.querySelector('.toast-message');
    toastMessage.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}

// =====================================================
// Modal Handling
// =====================================================

const confirmModal = document.getElementById('confirmModal');
const confirmTitle = document.getElementById('confirmTitle');
const confirmMessage = document.getElementById('confirmMessage');
const confirmActionBtn = document.getElementById('confirmAction');
const confirmCancelBtn = document.getElementById('confirmCancel');

const editModal = document.getElementById('editModal');
const editForm = document.getElementById('editForm');
const editCancelBtn = document.getElementById('editCancel');

let pendingAction = null;

function showConfirmModal(title, message, action) {
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    pendingAction = action;
    confirmModal.style.display = 'flex';
}

function hideConfirmModal() {
    confirmModal.style.display = 'none';
    pendingAction = null;
}

confirmActionBtn.addEventListener('click', async () => {
    if (pendingAction) {
        await pendingAction();
    }
    hideConfirmModal();
});

confirmCancelBtn.addEventListener('click', hideConfirmModal);
confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) hideConfirmModal();
});

// =====================================================
// Edit Modal
// =====================================================

function openEditModal(goalId) {
    const goal = goalsCache.find(g => g.id === goalId);
    if (!goal) return;

    document.getElementById('editGoalId').value = goal.id;
    document.getElementById('editTitle').value = goal.title;
    document.getElementById('editCategory').value = goal.category || 'personal';
    document.getElementById('editPriority').value = goal.priority || 'medium';
    document.getElementById('editEffort').value = goal.effort || 'medium';
    document.getElementById('editStartDate').value = goal.startDate;
    document.getElementById('editEndDate').value = goal.endDate;

    editModal.style.display = 'flex';
}

function hideEditModal() {
    editModal.style.display = 'none';
    editForm.reset();
}

editCancelBtn.addEventListener('click', hideEditModal);
editModal.addEventListener('click', (e) => {
    if (e.target === editModal) hideEditModal();
});

editForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const goalId = document.getElementById('editGoalId').value;
    const updates = {
        title: document.getElementById('editTitle').value.trim(),
        category: document.getElementById('editCategory').value,
        priority: document.getElementById('editPriority').value,
        effort: document.getElementById('editEffort').value,
        start_date: document.getElementById('editStartDate').value,
        end_date: document.getElementById('editEndDate').value
    };

    try {
        const { error } = await window.supabase
            .from('goals')
            .update(updates)
            .eq('id', goalId);

        if (error) throw error;

        // Update local cache
        const goal = goalsCache.find(g => g.id === goalId);
        if (goal) {
            goal.title = updates.title;
            goal.category = updates.category;
            goal.priority = updates.priority;
            goal.effort = updates.effort;
            goal.startDate = updates.start_date;
            goal.endDate = updates.end_date;
        }

        hideEditModal();
        render();
        showToast('Goal updated!');
    } catch (error) {
        console.error('Error updating goal:', error);
        showToast('Error updating goal');
    }
});

// =====================================================
// Goal Actions
// =====================================================

async function resetGoal(goalId) {
    try {
        const { error } = await window.supabase
            .from('goals')
            .update({ daily_progress: [] })
            .eq('id', goalId);

        if (error) throw error;

        // Update local cache
        const goal = goalsCache.find(g => g.id === goalId);
        if (goal) {
            goal.dailyProgress = [];
        }

        render();
        showToast('Progress reset!');
    } catch (error) {
        console.error('Error resetting goal:', error);
        showToast('Error resetting goal');
    }
}

async function deleteGoal(goalId) {
    try {
        const { error } = await window.supabase
            .from('goals')
            .delete()
            .eq('id', goalId);

        if (error) throw error;

        // Remove from local cache
        goalsCache = goalsCache.filter(g => g.id !== goalId);

        render();
        showToast('Goal deleted!');
    } catch (error) {
        console.error('Error deleting goal:', error);
        showToast('Error deleting goal');
    }
}

// =====================================================
// Initialize
// =====================================================

document.addEventListener('DOMContentLoaded', async () => {
    await fetchGoals();
    render();
});
