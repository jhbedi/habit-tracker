/**
 * getItRight — Shared Utilities (shared.js)
 * Common functions used across multiple pages.
 * Include this AFTER supabase.js and auth-guard.js, BEFORE page-specific scripts.
 */

// =====================================================
// Toast Notification (shared across all pages)
// =====================================================

/**
 * Show a toast notification. Looks for a #toast element with a .toast-message child.
 * Falls back to creating a temporary toast if the element doesn't exist.
 */
function showToast(message) {
    const toastEl = document.getElementById('toast');
    if (toastEl) {
        const msg = toastEl.querySelector('.toast-message');
        if (msg) msg.textContent = message;
        toastEl.classList.add('show');
        setTimeout(() => toastEl.classList.remove('show'), 2500);
    } else {
        // Fallback: create a temporary toast
        const temp = document.createElement('div');
        temp.className = 'tracking-toast';
        temp.style.cssText = `
            position: fixed; bottom: 2rem; left: 50%; transform: translateX(-50%);
            background: var(--accent); color: #fff;
            padding: 0.75rem 1.5rem; border-radius: 8px; font-size: 0.85rem;
            font-weight: 600; z-index: 10000; box-shadow: 0 8px 25px rgba(0,0,0,0.3);
        `;
        temp.textContent = message;
        document.body.appendChild(temp);
        setTimeout(() => temp.remove(), 2500);
    }
}

// =====================================================
// Fetch Goals (shared Supabase query)
// =====================================================

/**
 * Fetches all goals from Supabase for the authenticated user.
 * Returns raw Supabase rows (snake_case fields).
 * Each page can transform them into its own cache format.
 */
async function fetchGoalsRaw() {
    const { data, error } = await window.supabase
        .from('goals')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
}

/**
 * Transform a raw Supabase goal row into the standard camelCase format
 * used throughout the app (dashboard, tracking, AI pages).
 */
function transformGoal(g) {
    return {
        id: g.id,
        title: g.title,
        category: g.category,
        priority: g.priority || 'medium',
        effort: g.effort || 'medium',
        startDate: g.start_date,
        endDate: g.end_date,
        timePerDay: g.time_per_day || 60,
        frequency: g.frequency || 7,
        dailyProgress: g.daily_progress || [],
        progress: g.progress || 0
    };
}

// =====================================================
// Goal Completion Check (shared logic)
// =====================================================

/**
 * Calculate total days between two dates (inclusive).
 */
function calculateTotalDaysShared(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    return Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Check if a goal is completed.
 * Works with both camelCase (startDate) and snake_case (start_date) fields.
 */
function isGoalCompletedShared(goal) {
    const startDate = goal.startDate || goal.start_date;
    const endDate = goal.endDate || goal.end_date;
    const dailyProgress = goal.dailyProgress || goal.daily_progress || [];
    const totalDays = calculateTotalDaysShared(startDate, endDate);
    return totalDays > 0 && dailyProgress.length >= totalDays;
}

// =====================================================
// Task Logs (shared logging helper)
// =====================================================

/**
 * Log a task completion event to the task_logs table.
 * @param {string} goalId - UUID of the goal
 * @param {number} durationMinutes - Duration in minutes
 * @param {string} [notes] - Optional notes
 * @param {string} [mood] - Optional mood (neutral, happy, motivated, tired, stressed)
 */
async function logTaskEvent(goalId, durationMinutes, notes, mood) {
    try {
        const { error } = await window.supabase
            .from('task_logs')
            .insert({
                goal_id: goalId,
                duration_minutes: durationMinutes,
                notes: notes || null,
                mood: mood || 'neutral',
                productivity_score: 5
            });

        if (error) {
            console.warn('Failed to log task event:', error.message);
        }
    } catch (err) {
        // Silent fail — task_logs is supplementary, not critical
        console.warn('Task log error:', err);
    }
}

// =====================================================
// AI Rate Limiter (shared across chat-widget + ai-insights)
// =====================================================

const AIRateLimiter = (() => {
    let lastCallTime = 0;
    let callCount = 0;
    const MIN_INTERVAL_MS = 3000;   // 3 seconds between calls
    const MAX_CALLS_PER_SESSION = 30;

    return {
        /**
         * Check if an AI call is allowed right now.
         * @returns {{ allowed: boolean, message?: string }}
         */
        check() {
            const now = Date.now();

            if (callCount >= MAX_CALLS_PER_SESSION) {
                return {
                    allowed: false,
                    message: `You've reached the limit of ${MAX_CALLS_PER_SESSION} AI queries this session. Refresh the page to reset.`
                };
            }

            const timeSinceLast = now - lastCallTime;
            if (timeSinceLast < MIN_INTERVAL_MS) {
                const waitSecs = Math.ceil((MIN_INTERVAL_MS - timeSinceLast) / 1000);
                return {
                    allowed: false,
                    message: `Please wait ${waitSecs}s before sending another message.`
                };
            }

            return { allowed: true };
        },

        /** Record that an AI call was made. */
        record() {
            lastCallTime = Date.now();
            callCount++;
        },

        /** Get remaining calls. */
        remaining() {
            return MAX_CALLS_PER_SESSION - callCount;
        }
    };
})();

// =====================================================
// Accessibility Helpers
// =====================================================

/**
 * Trap focus inside a modal element (Tab cycling).
 * Returns a cleanup function to remove the listener.
 */
function trapFocus(modalEl) {
    const focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    function handleKeydown(e) {
        if (e.key !== 'Tab') return;

        const focusable = modalEl.querySelectorAll(focusableSelectors);
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
            if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        } else {
            if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }

    modalEl.addEventListener('keydown', handleKeydown);

    // Focus the first focusable element
    const firstFocusable = modalEl.querySelector(focusableSelectors);
    if (firstFocusable) setTimeout(() => firstFocusable.focus(), 50);

    // Return cleanup function
    return () => modalEl.removeEventListener('keydown', handleKeydown);
}
