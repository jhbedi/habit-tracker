/**
 * Goal Tracker - Dashboard (dashboard.js)
 * Charts and analytics visualization using Chart.js
 */

// =====================================================
// State
// =====================================================

let goalsCache = [];
let charts = {};
let trendViewMode = 'weekly-daily';
let showAllGoals = false;
let showCompletedGoals = false;

// Smart Link Tracking State
let trackingWindow = null;
let trackingInterval = null;
let trackingStartTime = null;
let trackingHabitId = null;
let trackingUrl = null;
let trackingAccumulatedSeconds = 0;
let isTrackingPaused = false;
let extensionInstalled = false;

// Task Logs Cache (for actual duration tracking)
let taskLogsCache = [];

// Extension handshake — content.js fires this event when it loads
document.addEventListener('getItRight_EXTENSION_READY', () => {
    extensionInstalled = true;
    console.log('getItRight Extension detected and ready.');
});

function isGoalCompleted(goal) {
    const totalDays = calculateTotalDays(goal.startDate, goal.endDate);
    return totalDays > 0 && goal.dailyProgress.length >= totalDays;
}

// Sort: most incomplete first → recent activity → completed last
function getSortedGoals() {
    return [...goalsCache].sort((a, b) => {
        const aCompleted = isGoalCompleted(a);
        const bCompleted = isGoalCompleted(b);
        // Completed goals always go last
        if (aCompleted !== bCompleted) return aCompleted ? 1 : -1;

        // Among incomplete: lower progress first
        const aDays = calculateTotalDays(a.startDate, a.endDate);
        const bDays = calculateTotalDays(b.startDate, b.endDate);
        const aProgress = aDays > 0 ? a.dailyProgress.length / aDays : 0;
        const bProgress = bDays > 0 ? b.dailyProgress.length / bDays : 0;
        if (Math.abs(aProgress - bProgress) > 0.05) return aProgress - bProgress;

        // Tiebreak: recent activity on top
        const aLast = a.dailyProgress.length > 0 ? new Date(a.dailyProgress[a.dailyProgress.length - 1]).getTime() : 0;
        const bLast = b.dailyProgress.length > 0 ? new Date(b.dailyProgress[b.dailyProgress.length - 1]).getTime() : 0;
        return bLast - aLast;
    });
}

function getVisibleGoals() {
    let sorted = getSortedGoals();
    // Filter out completed goals if toggle is off
    if (!showCompletedGoals) {
        sorted = sorted.filter(g => !isGoalCompleted(g));
    }
    return showAllGoals ? sorted : sorted.slice(0, 7);
}

function toggleShowMore() {
    showAllGoals = !showAllGoals;
    const btn = document.getElementById('showMoreBtn');
    if (btn) {
        const total = goalsCache.length;
        btn.textContent = showAllGoals ? 'Show Less' : `Show More (${total - 7} hidden)`;
        btn.style.display = total <= 7 ? 'none' : 'inline-flex';
    }
    renderCharts();
}

function toggleCompletedGoals() {
    showCompletedGoals = !showCompletedGoals;
    const btn = document.getElementById('toggleCompletedBtn');
    if (btn) {
        btn.textContent = showCompletedGoals ? 'Hide Completed' : 'Show Completed';
        btn.classList.toggle('active', showCompletedGoals);
    }
    updateStats();
    renderCharts();
}

// Chart color palette
const colors = {
    primary: '#3b82f6',     /* Blue 500 */
    success: '#10b981',     /* Emerald 500 */
    warning: '#f59e0b',     /* Amber 500 */
    error: '#ef4444',       /* Red 500 */
    orange: '#f97316',      /* Orange 500 */
    sky: '#0ea5e9',         /* Sky 500 */
    indigo: '#6366f1',      /* Indigo 500 */
    teal: '#14b8a6',        /* Teal 500 */
    gray: '#64748b'         /* Slate 500 */
};

const priorityColors = {
    critical: colors.orange,
    high: colors.warning,
    medium: colors.success,
    low: colors.teal
};

const effortColors = {
    hard: colors.indigo,
    medium: colors.sky,
    easy: colors.teal
};

// =====================================================
// DOM Elements
// =====================================================

// Weekly Stats
const weeklyDaysCompletedEl = document.getElementById('weeklyDaysCompleted');
const weeklyDaysTargetEl = document.getElementById('weeklyDaysTarget');
const weeklyProgressEl = document.getElementById('weeklyProgress');
const weeklyHoursEl = document.getElementById('weeklyHours');

// Overall Stats
const overallDaysCompletedEl = document.getElementById('overallDaysCompleted');
const overallDaysBarEl = document.getElementById('overallDaysBar');
const overallDaysPercentEl = document.getElementById('overallDaysPercent');
const overallHoursCompletedEl = document.getElementById('overallHoursCompleted');
const overallHoursBarEl = document.getElementById('overallHoursBar');
const overallHoursPercentEl = document.getElementById('overallHoursPercent');

const chartsGrid = document.getElementById('chartsGrid');
const emptyState = document.getElementById('emptyState');

// =====================================================
// Data Fetching
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
            priority: g.priority || 'medium',
            effort: g.effort || 'medium',
            startDate: g.start_date,
            endDate: g.end_date,
            timePerDay: g.time_per_day || 60,
            frequency: g.frequency || 7,
            dailyProgress: g.daily_progress || []
        }));

        await ensureUnproductiveGoal();

        // Also fetch task_logs for actual duration data
        await fetchTaskLogs();

        return goalsCache;
    } catch (error) {
        console.error('Error fetching goals:', error);
        return [];
    }
}

// =====================================================
// Task Logs — Actual Duration Tracking
// =====================================================

async function fetchTaskLogs() {
    try {
        const { data, error } = await window.supabase
            .from('task_logs')
            .select('*')
            .order('logged_at', { ascending: false });

        if (error) throw error;
        taskLogsCache = data || [];
    } catch (err) {
        console.warn('Could not fetch task logs:', err);
        taskLogsCache = [];
    }
}

/**
 * Get total actual tracked minutes for a goal (all time).
 * Falls back to estimate if no task_logs exist for the goal.
 */
function getActualMinutesForGoal(goalId, fallbackPerDay, daysCompleted) {
    const logs = taskLogsCache.filter(log => log.goal_id === goalId);
    if (logs.length === 0) {
        return daysCompleted * fallbackPerDay; // estimate
    }
    return logs.reduce((sum, log) => sum + (log.duration_minutes || 0), 0);
}

/**
 * Get actual tracked minutes for a goal within a date range.
 * Falls back to estimate if no task_logs exist for the goal in that range.
 */
function getActualMinutesInRange(goalId, startDate, endDate, fallbackPerDay, daysInRange) {
    const logs = taskLogsCache.filter(log => {
        if (log.goal_id !== goalId) return false;
        const logDate = new Date(log.logged_at);
        return logDate >= startDate && logDate <= endDate;
    });
    if (logs.length === 0) {
        return daysInRange * fallbackPerDay; // estimate
    }
    return logs.reduce((sum, log) => sum + (log.duration_minutes || 0), 0);
}

/**
 * Check if a goal has any task_logs (meaning actual tracking data exists).
 */
function goalHasTaskLogs(goalId) {
    return taskLogsCache.some(log => log.goal_id === goalId);
}

// =====================================================
// Calculations
// =====================================================

function calculateTotalDays(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

function isGoalActive(goal) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(goal.endDate);
    end.setHours(0, 0, 0, 0);
    return end >= today;
}

function calculateWeeklyStats() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    let weeklyDaysCompleted = 0;
    let weeklyDaysTarget = 0;
    let weeklyTimeMinutes = 0;

    goalsCache.forEach(goal => {
        const goalStart = new Date(goal.startDate);
        const goalEnd = new Date(goal.endDate);
        goalStart.setHours(0, 0, 0, 0);
        goalEnd.setHours(23, 59, 59, 999);

        // Calculate days this week that overlap with goal
        const weekStart = new Date(Math.max(monday.getTime(), goalStart.getTime()));
        const weekEnd = new Date(Math.min(sunday.getTime(), goalEnd.getTime()));

        if (weekStart <= weekEnd) {
            // Count target days this week based on frequency
            const daysInWeek = Math.min(7, Math.ceil((weekEnd - weekStart) / (1000 * 60 * 60 * 24)) + 1);
            const targetDays = Math.min(daysInWeek, goal.frequency || 7);
            weeklyDaysTarget += targetDays;

            // Count completed days this week
            let weeklyDaysInRange = 0;
            goal.dailyProgress.forEach(dateStr => {
                const date = new Date(dateStr);
                if (date >= monday && date <= sunday) {
                    weeklyDaysCompleted++;
                    weeklyDaysInRange++;
                }
            });

            // Use actual tracked time from task_logs, fallback to estimate
            weeklyTimeMinutes += getActualMinutesInRange(
                goal.id, monday, sunday, goal.timePerDay, weeklyDaysInRange
            );
        }
    });

    const weeklyProgress = weeklyDaysTarget > 0
        ? Math.round((weeklyDaysCompleted / weeklyDaysTarget) * 100)
        : 0;
    const weeklyHours = Math.round(weeklyTimeMinutes / 60 * 10) / 10;

    return { weeklyDaysCompleted, weeklyDaysTarget, weeklyProgress, weeklyHours };
}

function calculateOverallStats() {
    let totalDaysCompleted = 0;
    let totalDaysTarget = 0;
    let totalHoursCompleted = 0;
    let totalHoursTarget = 0;

    goalsCache.forEach(goal => {
        const goalDays = calculateTotalDays(goal.startDate, goal.endDate);
        const daysCompleted = goal.dailyProgress.length;

        totalDaysTarget += goalDays;
        totalDaysCompleted += daysCompleted;

        // Hours: use actual tracked time from task_logs when available
        totalHoursTarget += (goalDays * goal.timePerDay) / 60;
        totalHoursCompleted += getActualMinutesForGoal(goal.id, goal.timePerDay, daysCompleted) / 60;
    });

    const daysPercent = totalDaysTarget > 0
        ? Math.round((totalDaysCompleted / totalDaysTarget) * 100)
        : 0;
    const hoursPercent = totalHoursTarget > 0
        ? Math.round((totalHoursCompleted / totalHoursTarget) * 100)
        : 0;

    return {
        totalDaysCompleted,
        totalDaysTarget,
        daysPercent,
        totalHoursCompleted: Math.round(totalHoursCompleted),
        totalHoursTarget: Math.round(totalHoursTarget),
        hoursPercent
    };
}

function calculateGoalProgress() {
    return getVisibleGoals().map(goal => {
        const totalDays = calculateTotalDays(goal.startDate, goal.endDate);
        const completed = goal.dailyProgress.length;
        const progress = Math.round((completed / totalDays) * 100);
        return {
            title: goal.title.length > 15 ? goal.title.substring(0, 15) + '...' : goal.title,
            progress: Math.min(progress, 100),
            remaining: Math.max(100 - progress, 0)
        };
    });
}

function calculateTimeInvested() {
    return getVisibleGoals().map(goal => {
        const actualMinutes = getActualMinutesForGoal(goal.id, goal.timePerDay, goal.dailyProgress.length);
        return {
            title: goal.title.length > 15 ? goal.title.substring(0, 15) + '...' : goal.title,
            hours: Math.round(actualMinutes / 60 * 10) / 10
        };
    });
}

function calculatePriorityDistribution() {
    const distribution = { critical: 0, high: 0, medium: 0, low: 0 };

    goalsCache.forEach(goal => {
        const minutes = getActualMinutesForGoal(goal.id, goal.timePerDay, goal.dailyProgress.length);
        const priority = goal.priority || 'medium';
        distribution[priority] = (distribution[priority] || 0) + minutes;
    });

    return distribution;
}

function calculateEffortDistribution() {
    const distribution = { hard: 0, medium: 0, easy: 0 };

    goalsCache.forEach(goal => {
        const minutes = getActualMinutesForGoal(goal.id, goal.timePerDay, goal.dailyProgress.length);
        const effort = goal.effort || 'medium';
        distribution[effort] = (distribution[effort] || 0) + minutes;
    });

    return distribution;
}

// View-specific calculations
function getViewStats(viewMode) {
    let dateRange = {};

    if (viewMode === 'weekly-daily') {
        // Current week
        const today = new Date();
        const dayOfWeek = today.getDay();
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        startOfWeek.setHours(0, 0, 0, 0);

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        dateRange = { start: startOfWeek, end: endOfWeek };
    } else if (viewMode === 'monthly-daily') {
        // Current month
        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        endOfMonth.setHours(23, 59, 59, 999);

        dateRange = { start: startOfMonth, end: endOfMonth };
    } else if (viewMode === 'monthly-weekly') {
        // Last 8 weeks
        const today = new Date();
        const start = new Date(today);
        start.setDate(today.getDate() - (7 * 7));
        start.setHours(0, 0, 0, 0);

        const end = new Date(today);
        end.setHours(23, 59, 59, 999);

        dateRange = { start, end };
    } else if (viewMode === 'yearly') {
        // Current year
        const today = new Date();
        const startOfYear = new Date(today.getFullYear(), 0, 1);
        const endOfYear = new Date(today.getFullYear(), 11, 31);
        endOfYear.setHours(23, 59, 59, 999);

        dateRange = { start: startOfYear, end: endOfYear };
    }

    let daysCompleted = 0;
    let daysTarget = 0;
    let timeMinutes = 0;

    goalsCache.forEach(goal => {
        const goalStart = new Date(goal.startDate);
        const goalEnd = new Date(goal.endDate);
        goalStart.setHours(0, 0, 0, 0);
        goalEnd.setHours(23, 59, 59, 999);

        const rangeStart = new Date(Math.max(dateRange.start.getTime(), goalStart.getTime()));
        const rangeEnd = new Date(Math.min(dateRange.end.getTime(), goalEnd.getTime()));

        if (rangeStart <= rangeEnd) {
            const daysInRange = Math.ceil((rangeEnd - rangeStart) / (1000 * 60 * 60 * 24)) + 1;
            daysTarget += daysInRange;

            let daysInRangeCount = 0;
            goal.dailyProgress.forEach(dateStr => {
                const date = new Date(dateStr);
                if (date >= dateRange.start && date <= dateRange.end) {
                    daysCompleted++;
                    daysInRangeCount++;
                }
            });

            // Use actual tracked time from task_logs, fallback to estimate
            timeMinutes += getActualMinutesInRange(
                goal.id, dateRange.start, dateRange.end, goal.timePerDay, daysInRangeCount
            );
        }
    });

    const progress = daysTarget > 0 ? Math.round((daysCompleted / daysTarget) * 100) : 0;
    const hours = Math.round(timeMinutes / 60 * 10) / 10;

    return { daysCompleted, daysTarget, progress, hours };
}

function getViewGoalProgress(viewMode) {
    let dateRange = {};

    if (viewMode === 'weekly-daily') {
        const today = new Date();
        const dayOfWeek = today.getDay();
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        startOfWeek.setHours(0, 0, 0, 0);

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        dateRange = { start: startOfWeek, end: endOfWeek };
    } else if (viewMode === 'monthly-daily') {
        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        endOfMonth.setHours(23, 59, 59, 999);

        dateRange = { start: startOfMonth, end: endOfMonth };
    } else if (viewMode === 'monthly-weekly') {
        const today = new Date();
        const start = new Date(today);
        start.setDate(today.getDate() - (7 * 7));
        start.setHours(0, 0, 0, 0);

        const end = new Date(today);
        end.setHours(23, 59, 59, 999);

        dateRange = { start, end };
    } else if (viewMode === 'yearly') {
        const today = new Date();
        const startOfYear = new Date(today.getFullYear(), 0, 1);
        const endOfYear = new Date(today.getFullYear(), 11, 31);
        endOfYear.setHours(23, 59, 59, 999);

        dateRange = { start: startOfYear, end: endOfYear };
    }

    return getVisibleGoals().map(goal => {
        const goalStart = new Date(goal.startDate);
        const goalEnd = new Date(goal.endDate);
        goalStart.setHours(0, 0, 0, 0);
        goalEnd.setHours(23, 59, 59, 999);

        const rangeStart = new Date(Math.max(dateRange.start.getTime(), goalStart.getTime()));
        const rangeEnd = new Date(Math.min(dateRange.end.getTime(), goalEnd.getTime()));

        let completed = 0;
        let totalDays = 0;

        if (rangeStart <= rangeEnd) {
            totalDays = Math.ceil((rangeEnd - rangeStart) / (1000 * 60 * 60 * 24)) + 1;

            goal.dailyProgress.forEach(dateStr => {
                const date = new Date(dateStr);
                if (date >= dateRange.start && date <= dateRange.end) {
                    completed++;
                }
            });
        }

        const progress = totalDays > 0 ? Math.round((completed / totalDays) * 100) : 0;

        return {
            title: goal.title.length > 15 ? goal.title.substring(0, 15) + '...' : goal.title,
            progress: Math.min(progress, 100),
            remaining: Math.max(100 - progress, 0)
        };
    });
}

function getViewTimeInvested(viewMode) {
    let dateRange = {};

    if (viewMode === 'weekly-daily') {
        const today = new Date();
        const dayOfWeek = today.getDay();
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        startOfWeek.setHours(0, 0, 0, 0);

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        dateRange = { start: startOfWeek, end: endOfWeek };
    } else if (viewMode === 'monthly-daily') {
        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        endOfMonth.setHours(23, 59, 59, 999);

        dateRange = { start: startOfMonth, end: endOfMonth };
    } else if (viewMode === 'monthly-weekly') {
        const today = new Date();
        const start = new Date(today);
        start.setDate(today.getDate() - (7 * 7));
        start.setHours(0, 0, 0, 0);

        const end = new Date(today);
        end.setHours(23, 59, 59, 999);

        dateRange = { start, end };
    } else if (viewMode === 'yearly') {
        const today = new Date();
        const startOfYear = new Date(today.getFullYear(), 0, 1);
        const endOfYear = new Date(today.getFullYear(), 11, 31);
        endOfYear.setHours(23, 59, 59, 999);

        dateRange = { start: startOfYear, end: endOfYear };
    }

    return getVisibleGoals().map(goal => {
        let daysInRangeCount = 0;

        goal.dailyProgress.forEach(dateStr => {
            const date = new Date(dateStr);
            if (date >= dateRange.start && date <= dateRange.end) {
                daysInRangeCount++;
            }
        });

        const actualMinutes = getActualMinutesInRange(
            goal.id, dateRange.start, dateRange.end, goal.timePerDay, daysInRangeCount
        );

        return {
            title: goal.title.length > 15 ? goal.title.substring(0, 15) + '...' : goal.title,
            hours: Math.round(actualMinutes / 60 * 10) / 10
        };
    });
}

function calculateWeeklyDaily() {
    // Get 7 days of current week
    const days = [];
    const today = new Date();
    const dayOfWeek = today.getDay();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));

    for (let i = 0; i < 7; i++) {
        const date = new Date(startOfWeek);
        date.setDate(startOfWeek.getDate() + i);

        days.push({
            date: date,
            label: date.toLocaleDateString('en-US', { weekday: 'short' }),
            dayNum: date.getDate().toString(),
            count: 0
        });
    }

    // Count completed goals per day
    goalsCache.forEach(goal => {
        goal.dailyProgress.forEach(dateStr => {
            const date = new Date(dateStr);
            days.forEach(day => {
                if (date.toDateString() === day.date.toDateString()) {
                    day.count++;
                }
            });
        });
    });

    return days;
}

function calculateMonthlyWeekly() {
    // Get last 8 weeks of data
    const weeks = [];
    const today = new Date();

    for (let i = 7; i >= 0; i--) {
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - (i * 7) - today.getDay() + 1);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);

        weeks.push({
            start: weekStart,
            end: weekEnd,
            label: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            count: 0
        });
    }

    // Count completed days per week
    goalsCache.forEach(goal => {
        goal.dailyProgress.forEach(dateStr => {
            const date = new Date(dateStr);
            weeks.forEach(week => {
                if (date >= week.start && date <= week.end) {
                    week.count++;
                }
            });
        });
    });

    return weeks;
}

function calculateMonthlyDaily() {
    // Get all days of the current month
    const days = [];
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);

    for (let i = 1; i <= lastDay.getDate(); i++) {
        const date = new Date(currentYear, currentMonth, i);

        days.push({
            date: date,
            label: date.getDate().toString(),
            month: date.toLocaleDateString('en-US', { month: 'long' }),
            count: 0
        });
    }

    // Count completed goals per day
    goalsCache.forEach(goal => {
        goal.dailyProgress.forEach(dateStr => {
            const date = new Date(dateStr);
            days.forEach(day => {
                if (date.toDateString() === day.date.toDateString()) {
                    day.count++;
                }
            });
        });
    });

    return days;
}

function calculateYearlyView() {
    // Get 12 months of current year
    const months = [];
    const today = new Date();
    const currentYear = today.getFullYear();

    for (let i = 0; i < 12; i++) {
        const monthDate = new Date(currentYear, i, 1);
        const monthName = monthDate.toLocaleDateString('en-US', { month: 'short' });

        months.push({
            month: i,
            year: currentYear,
            label: monthName,
            count: 0
        });
    }

    // Count completed goals per month
    goalsCache.forEach(goal => {
        goal.dailyProgress.forEach(dateStr => {
            const date = new Date(dateStr);
            if (date.getFullYear() === currentYear) {
                months[date.getMonth()].count++;
            }
        });
    });

    return months;
}

// =====================================================
// Chart Configuration
// =====================================================

function getThemeColors() {
    const isDark = document.documentElement.classList.contains('dark-theme');
    return {
        text: isDark ? '#f8fafc' : '#64748b',
        grid: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
        tooltipBg: isDark ? 'rgba(30, 41, 59, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        tooltipTitle: isDark ? '#f8fafc' : '#1e293b',
        tooltipBody: isDark ? '#cbd5e1' : '#475569',
        tooltipBorder: isDark ? 'rgba(99, 102, 241, 0.5)' : 'rgba(99, 102, 241, 0.3)'
    };
}

function getChartDefaults() {
    const theme = getThemeColors();
    return {
        responsive: true,
        maintainAspectRatio: false,
        color: theme.text,
        font: {
            family: "'Inter', sans-serif"
        },
        plugins: {
            legend: {
                display: false
            }
        }
    };
}

function createBarChart(ctx, labels, data, label, baseColor) {
    // Generate gradient colors based on value - higher = more rewarding color
    const maxValue = Math.max(...data, 1);
    const barColors = data.map(value => {
        const ratio = value / maxValue;
        if (ratio >= 0.8) return '#22c55e';      // Green - excellent!
        if (ratio >= 0.6) return '#10b981';      // Teal - great
        if (ratio >= 0.4) return '#6366f1';      // Purple - good
        if (ratio >= 0.2) return '#8b5cf6';      // Violet - some effort
        return '#a855f7';                         // Light purple - just started
    });

    const theme = getThemeColors();
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: data,
                backgroundColor: barColors,
                borderColor: 'transparent',
                borderWidth: 0,
                borderRadius: {
                    topLeft: 8,
                    topRight: 8,
                    bottomLeft: 8,
                    bottomRight: 8
                },
                barThickness: 20,
                borderSkipped: false
            }]
        },
        options: {
            ...getChartDefaults(),
            indexAxis: 'y',
            animation: {
                duration: 1000,
                easing: 'easeOutQuart',
                delay: (context) => context.dataIndex * 100
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: theme.tooltipBg,
                    titleColor: theme.tooltipTitle,
                    bodyColor: theme.tooltipBody,
                    borderColor: theme.tooltipBorder,
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: (context) => {
                            const hours = context.raw;
                            let emoji = hours >= 5 ? '🏆' : hours >= 2 ? '⭐' : '🌱';
                            let message = hours >= 5 ? 'Amazing dedication!' : hours >= 2 ? 'Great commitment!' : 'Keep building!';
                            return `${emoji} ${hours}h invested - ${message}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: {
                        color: theme.grid
                    },
                    ticks: {
                        color: theme.text,
                        callback: value => value + 'h'
                    }
                },
                y: {
                    categoryPercentage: 0.7,
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: theme.text,
                        font: {
                            size: 11,
                            weight: '500'
                        }
                    }
                }
            }
        }
    });
}

function createStackedBarChart(ctx, labels, completedData, remainingData) {
    // Generate dynamic colors based on progress - dopamine colors for high, regret colors for low
    const getProgressColor = (progress) => {
        if (progress >= 80) return { main: '#22c55e', glow: 'rgba(34, 197, 94, 0.4)' };  // Bright green - great!
        if (progress >= 60) return { main: '#10b981', glow: 'rgba(16, 185, 129, 0.3)' }; // Teal green - good
        if (progress >= 40) return { main: '#eab308', glow: 'rgba(234, 179, 8, 0.3)' };  // Yellow - okay
        if (progress >= 20) return { main: '#f97316', glow: 'rgba(249, 115, 22, 0.3)' }; // Orange - needs work
        return { main: '#ef4444', glow: 'rgba(239, 68, 68, 0.4)' };                       // Red - urgent!
    };

    const completedColors = completedData.map(p => getProgressColor(p).main);
    const glowColors = completedData.map(p => getProgressColor(p).glow);

    const theme = getThemeColors();
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Completed',
                    data: completedData,
                    backgroundColor: completedColors,
                    borderColor: 'transparent',
                    borderWidth: 0,
                    borderRadius: {
                        topLeft: 8,
                        topRight: 8,
                        bottomLeft: 8,
                        bottomRight: 8
                    },
                    barThickness: 20,
                    hoverBackgroundColor: completedColors.map(c => c),
                    borderSkipped: false
                },
                {
                    label: 'Remaining',
                    data: remainingData,
                    backgroundColor: remainingData.map((r, i) => {
                        if (completedData[i] < 30) return 'rgba(239, 68, 68, 0.15)';
                        if (completedData[i] < 50) return 'rgba(249, 115, 22, 0.12)';
                        return 'rgba(100, 116, 139, 0.2)';
                    }),
                    borderRadius: {
                        topLeft: 8,
                        topRight: 8,
                        bottomLeft: 8,
                        bottomRight: 8
                    },
                    barThickness: 20,
                    borderSkipped: false
                }
            ]
        },
        options: {
            ...getChartDefaults(),
            indexAxis: 'y',
            animation: {
                duration: 1200,
                easing: 'easeOutQuart',
                delay: (context) => context.dataIndex * 150
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        color: theme.text,
                        boxWidth: 12,
                        padding: 15,
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    backgroundColor: theme.tooltipBg,
                    titleColor: theme.tooltipTitle,
                    bodyColor: theme.tooltipBody,
                    borderColor: theme.tooltipBorder,
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: (context) => {
                            const progress = completedData[context.dataIndex];
                            let emoji = progress >= 70 ? '🔥' : progress >= 40 ? '💪' : '⚠️';
                            let message = progress >= 70 ? 'Great progress!' : progress >= 40 ? 'Keep going!' : 'Needs attention!';
                            return `${emoji} ${progress}% complete - ${message}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    beginAtZero: true,
                    max: 100,
                    grid: {
                        color: theme.grid
                    },
                    ticks: {
                        color: theme.text,
                        callback: value => value + '%'
                    }
                },
                y: {
                    stacked: true,
                    categoryPercentage: 0.7,
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: theme.text,
                        font: {
                            size: 11,
                            weight: '500'
                        }
                    }
                }
            }
        }
    });
}

function createPieChart(ctx, labels, data, backgroundColors) {
    const theme = getThemeColors();
    return new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: backgroundColors,
                borderColor: 'transparent',
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            ...getChartDefaults(),
            cutout: '65%',
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        color: theme.text,
                        padding: 20,
                        usePointStyle: true,
                        pointStyle: 'circle',
                        font: {
                            size: 11
                        },
                        generateLabels: function (chart) {
                            const data = chart.data;
                            const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
                            return data.labels.map((label, i) => {
                                const value = data.datasets[0].data[i];
                                const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                                return {
                                    text: `${label} (${percentage}%)`,
                                    fillStyle: data.datasets[0].backgroundColor[i],
                                    fontColor: theme.text,
                                    hidden: false,
                                    index: i
                                };
                            });
                        }
                    }
                }
            }
        }
    });
}

function createLineChart(ctx, labels, data) {
    const theme = getThemeColors();
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Days Completed',
                data: data,
                borderColor: colors.primary,
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: colors.primary,
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            ...getChartDefaults(),
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    grid: {
                        color: theme.grid
                    },
                    ticks: {
                        color: theme.text,
                        font: { size: 10 }
                    }
                },
                y: {
                    beginAtZero: true,
                    grid: {
                        color: theme.grid
                    },
                    ticks: {
                        color: theme.text,
                        stepSize: 1
                    }
                }
            }
        }
    });
}

// =====================================================
// Rendering
// =====================================================

function updateStats() {
    // Get stats based on current view mode
    const stats = getViewStats(trendViewMode);
    weeklyDaysCompletedEl.textContent = stats.daysCompleted;
    weeklyDaysTargetEl.textContent = stats.daysTarget;
    weeklyProgressEl.textContent = stats.progress + '%';
    weeklyHoursEl.textContent = stats.hours + 'h';

    // Overall Stats (always show full stats)
    const overall = calculateOverallStats();
    overallDaysCompletedEl.textContent = overall.totalDaysCompleted + ' / ' + overall.totalDaysTarget;
    overallDaysBarEl.style.width = Math.min(overall.daysPercent, 100) + '%';
    overallDaysPercentEl.textContent = overall.daysPercent + '% of your total goal';

    overallHoursCompletedEl.textContent = overall.totalHoursCompleted + 'h / ' + overall.totalHoursTarget + 'h';
    overallHoursBarEl.style.width = Math.min(overall.hoursPercent, 100) + '%';
    overallHoursPercentEl.textContent = overall.hoursPercent + '% of your time goal';
}

function renderCharts() {
    // Destroy existing charts
    Object.values(charts).forEach(chart => chart.destroy());
    charts = {};

    if (goalsCache.length === 0) {
        chartsGrid.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    chartsGrid.style.display = 'grid';
    emptyState.style.display = 'none';

    // Trend Line Chart with multiple view modes
    let trendData, trendSubtitle, trendTitle, monthLabel = '';

    if (trendViewMode === 'weekly-daily') {
        trendData = calculateWeeklyDaily();
        trendTitle = 'Weekly Progress Trend';
        trendSubtitle = 'Goals completed per day this week';
    } else if (trendViewMode === 'monthly-weekly') {
        trendData = calculateMonthlyWeekly();
        trendTitle = 'Monthly Progress Trend';
        trendSubtitle = 'Days completed per week over time';
    } else if (trendViewMode === 'monthly-daily') {
        trendData = calculateMonthlyDaily();
        trendTitle = 'Monthly Progress Trend';
        trendSubtitle = 'Goals completed per day over the last 30 days';
        const months = [...new Set(trendData.map(d => d.month))];
        monthLabel = months.length > 1 ? months.join(' - ') : months[0];
    } else if (trendViewMode === 'yearly') {
        trendData = calculateYearlyView();
        trendTitle = 'Yearly Progress Trend';
        trendSubtitle = 'Goals completed per month in ' + new Date().getFullYear();
    }

    const trendHeading = document.querySelector('.chart-card.full-width h3');
    if (trendHeading) {
        trendHeading.textContent = trendTitle;
    }
    document.getElementById('trendSubtitle').textContent = trendSubtitle;
    const monthDisplay = document.getElementById('trendMonthLabel');
    if (monthDisplay && monthLabel) {
        monthDisplay.textContent = monthLabel;
    } else if (monthDisplay) {
        monthDisplay.textContent = '';
    }

    const trendCtx = document.getElementById('trendChart').getContext('2d');
    charts.trend = createLineChart(
        trendCtx,
        trendData.map(w => w.label),
        trendData.map(w => w.count)
    );

    // Goal Progress Chart (Stacked Bar) - view-based
    const progressData = getViewGoalProgress(trendViewMode);
    const progressCtx = document.getElementById('progressChart').getContext('2d');
    charts.progress = createStackedBarChart(
        progressCtx,
        progressData.map(d => d.title),
        progressData.map(d => d.progress),
        progressData.map(d => d.remaining)
    );

    // Show/hide "Show More" button
    const showMoreBtn = document.getElementById('showMoreBtn');
    if (showMoreBtn) {
        if (goalsCache.length > 7) {
            showMoreBtn.style.display = 'block';
            showMoreBtn.textContent = showAllGoals ? 'Show Less' : `Show More (${goalsCache.length - 7} more)`;
        } else {
            showMoreBtn.style.display = 'none';
        }
    }

    // Time Invested Chart (Bar) - view-based
    const timeData = getViewTimeInvested(trendViewMode);
    const timeCtx = document.getElementById('timeChart').getContext('2d');
    charts.time = createBarChart(
        timeCtx,
        timeData.map(d => d.title),
        timeData.map(d => d.hours),
        'Hours',
        colors.primary
    );

    // Priority Distribution (Pie)
    const priorityData = calculatePriorityDistribution();
    const priorityLabels = Object.keys(priorityData).filter(k => priorityData[k] > 0);
    const priorityValues = priorityLabels.map(k => Math.round(priorityData[k] / 60 * 10) / 10);
    const priorityCtx = document.getElementById('priorityChart').getContext('2d');

    if (priorityLabels.length > 0) {
        charts.priority = createPieChart(
            priorityCtx,
            priorityLabels.map(l => l.charAt(0).toUpperCase() + l.slice(1)),
            priorityValues,
            priorityLabels.map(l => priorityColors[l])
        );
    }

    // Effort Distribution (Pie)
    const effortData = calculateEffortDistribution();
    const effortLabels = Object.keys(effortData).filter(k => effortData[k] > 0);
    const effortValues = effortLabels.map(k => Math.round(effortData[k] / 60 * 10) / 10);
    const effortCtx = document.getElementById('effortChart').getContext('2d');

    if (effortLabels.length > 0) {
        charts.effort = createPieChart(
            effortCtx,
            effortLabels.map(l => l.charAt(0).toUpperCase() + l.slice(1)),
            effortValues,
            effortLabels.map(l => effortColors[l])
        );
    }
}
// =====================================================
// Tracking History (localStorage-backed)
// =====================================================

const TRACKING_HISTORY_KEY = 'getItRight_trackingHistory';

/**
 * Save a completed Smart Link session to localStorage.
 */
function saveTrackingToLocalHistory(url, goalName, minutes) {
    try {
        const history = JSON.parse(localStorage.getItem(TRACKING_HISTORY_KEY) || '[]');
        history.unshift({
            url: url || 'unknown',
            goal: goalName,
            minutes: minutes,
            timestamp: new Date().toISOString()
        });
        // Keep only last 20 entries
        if (history.length > 20) history.length = 20;
        localStorage.setItem(TRACKING_HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
        console.warn('Could not save tracking history:', e);
    }
}

/**
 * Get tracking history — merges localStorage + task_logs, deduplicates, returns latest 5.
 */
function getTrackingHistory() {
    let entries = [];

    // 1) Pull from localStorage (always available)
    try {
        const local = JSON.parse(localStorage.getItem(TRACKING_HISTORY_KEY) || '[]');
        local.forEach(item => {
            entries.push({
                url: item.url,
                goal: item.goal,
                minutes: item.minutes,
                timestamp: item.timestamp
            });
        });
    } catch (e) { /* ignore */ }

    // 2) Merge from task_logs if available (in case localStorage was cleared)
    if (taskLogsCache && taskLogsCache.length > 0) {
        taskLogsCache
            .filter(log => log.notes && log.notes.startsWith('Smart Link session:'))
            .forEach(log => {
                const urlStr = log.notes.replace('Smart Link session: ', '').trim();
                const goal = goalsCache.find(g => g.id === log.goal_id);
                const ts = log.logged_at;

                // Skip if already in entries (same timestamp within 60s)
                const isDuplicate = entries.some(e => {
                    return Math.abs(new Date(e.timestamp) - new Date(ts)) < 60000;
                });
                if (!isDuplicate) {
                    entries.push({
                        url: urlStr,
                        goal: goal ? goal.title : 'Unknown',
                        minutes: log.duration_minutes || 0,
                        timestamp: ts
                    });
                }
            });
    }

    // Sort by timestamp (newest first) and limit to 5
    entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return entries.slice(0, 5);
}

function renderTrackingHistory() {
    const section = document.getElementById('trackingHistorySection');
    const list = document.getElementById('trackingHistoryList');
    const countEl = document.getElementById('historyCount');
    if (!section || !list) return;

    section.style.display = 'block';

    const entries = getTrackingHistory();

    if (entries.length === 0) {
        if (countEl) countEl.textContent = '';
        list.innerHTML = `
            <div class="history-empty">
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="margin-bottom:0.5rem;opacity:0.4;">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <div>No tracking sessions yet</div>
                <div style="font-size:0.7rem;margin-top:0.25rem;">Paste a link above and hit "Launch & Track" to start</div>
            </div>
        `;
        return;
    }

    if (countEl) countEl.textContent = `${entries.length} session${entries.length !== 1 ? 's' : ''}`;

    list.innerHTML = entries.map(entry => {
        // Parse hostname
        let hostname = entry.url;
        let fullUrl = entry.url;
        try {
            const urlObj = new URL(entry.url.startsWith('http') ? entry.url : 'https://' + entry.url);
            hostname = urlObj.hostname.replace('www.', '');
            fullUrl = urlObj.href;
        } catch (e) {
            hostname = entry.url || 'unknown';
        }

        const goalName = entry.goal || 'Unknown';
        const isUnproductive = goalName.toLowerCase() === 'unproductive';

        // Duration formatting
        const mins = entry.minutes || 0;
        let durationStr;
        if (mins >= 60) {
            const h = Math.floor(mins / 60);
            const m = mins % 60;
            durationStr = m > 0 ? `${h}h ${m}m` : `${h}h`;
        } else {
            durationStr = `${mins}m`;
        }

        const durClass = isUnproductive ? 'unproductive' : (mins > 0 ? 'productive' : 'neutral');
        const timeAgo = getRelativeTime(new Date(entry.timestamp));

        // Favicon
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
        const domainInitial = hostname.charAt(0).toUpperCase();

        return `
            <div class="history-item">
                <div class="history-favicon">
                    <img src="${faviconUrl}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                    <span class="favicon-fallback" style="display:none;">${domainInitial}</span>
                </div>
                <div class="history-details">
                    <div class="history-domain" title="${fullUrl}">${hostname}</div>
                    <div class="history-goal">${goalName}</div>
                </div>
                <div class="history-duration ${durClass}">${durationStr}</div>
                <div class="history-time">${timeAgo}</div>
            </div>
        `;
    }).join('');
}

function getRelativeTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// =====================================================
// Initialize
// =====================================================

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await fetchGoals();
        updateStats();
        renderCharts();
    } catch (err) {
        console.error('Dashboard init error:', err);
    }
    // Always render tracking history (uses localStorage, doesn't need Supabase)
    if (!localStorage.getItem(TRACKING_HISTORY_KEY)) {
        const dummyHistory = [
            {url: 'leetcode.com', goal: 'Study DSA', minutes: 45, timestamp: new Date(Date.now() - 3600000).toISOString()},
            {url: 'github.com', goal: 'Build Projects', minutes: 120, timestamp: new Date(Date.now() - 7200000).toISOString()},
            {url: 'instagram.com', goal: 'Unproductive', minutes: 15, timestamp: new Date(Date.now() - 10800000).toISOString()},
            {url: 'coursera.org', goal: 'Learn Web Dev', minutes: 65, timestamp: new Date(Date.now() - 86400000).toISOString()},
            {url: 'youtube.com', goal: 'Unproductive', minutes: 30, timestamp: new Date(Date.now() - 172800000).toISOString()}
        ];
        localStorage.setItem(TRACKING_HISTORY_KEY, JSON.stringify(dummyHistory));
    }
    renderTrackingHistory();

    // Custom dropdown functionality
    const customDropdown = document.getElementById('customTrendDropdown');
    const dropdownButton = customDropdown?.querySelector('.dropdown-button');
    const dropdownMenu = customDropdown?.querySelector('.dropdown-menu');
    const dropdownOptions = customDropdown?.querySelectorAll('.dropdown-option');
    const hiddenInput = document.getElementById('trendViewDropdown');

    // Toggle dropdown menu
    dropdownButton?.addEventListener('click', () => {
        dropdownMenu?.classList.toggle('open');
    });

    // Handle option selection
    dropdownOptions?.forEach(option => {
        option.addEventListener('click', () => {
            const value = option.getAttribute('data-value');
            const label = option.textContent;

            // Update hidden input
            if (hiddenInput) hiddenInput.value = value;

            // Update button text
            if (dropdownButton) dropdownButton.textContent = label;

            // Close menu
            dropdownMenu?.classList.remove('open');

            // Update view mode and re-render
            trendViewMode = value;
            renderCharts();
        });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!customDropdown?.contains(e.target)) {
            dropdownMenu?.classList.remove('open');
        }
    });

    // Fallback for hidden input change (in case other code updates it)
    const trendDropdown = document.getElementById('trendViewDropdown');
    if (trendDropdown) {
        trendDropdown.addEventListener('change', (e) => {
            trendViewMode = e.target.value;
            renderCharts();
        });
    }
});

// Re-render charts when theme changes to update text colors
window.addEventListener('themeChanged', () => {
    if (typeof renderCharts === 'function') {
        renderCharts();
    }
});

// =====================================================
// Smart Link Launcher & Time Tracking
// =====================================================

// Check for and create "Unproductive" goal if missing
async function ensureUnproductiveGoal() {
    const hasUnproductive = goalsCache.find(g => g.title.toLowerCase() === 'unproductive');
    if (hasUnproductive) return;

    try {
        const { data: { user } } = await window.supabase.auth.getUser();
        if (!user) return;

        const newGoal = {
            user_id: user.id,
            title: 'Unproductive',
            category: 'health', // or personal
            priority: 'low',
            effort: 'easy',
            start_date: new Date().toISOString().split('T')[0],
            end_date: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0],
            time_per_day: 120, // default budget for unproductive
            frequency: 7,
            daily_progress: []
        };

        const { data, error } = await window.supabase
            .from('goals')
            .insert([newGoal])
            .select()
            .single();

        if (error) throw error;

        // Add to cache immediately so dropdowns find it
        goalsCache.push({
            id: data.id,
            title: data.title,
            category: data.category,
            priority: data.priority,
            effort: data.effort,
            startDate: data.start_date,
            endDate: data.end_date,
            timePerDay: data.time_per_day,
            frequency: data.frequency,
            dailyProgress: data.daily_progress || []
        });

    } catch (error) {
        console.error('Failed to auto-create Unproductive goal', error);
    }
}

function handleSmartLinkEnter(e) {
    if (e.key === 'Enter') {
        openSmartLinkModal();
    }
}

// =====================================================
// Smart Domain Categorization
// =====================================================

/**
 * Domain → category + keywords map.
 * category: maps to goal categories in the app (work, health, personal, etc.)
 * keywords: words to match against goal titles for smarter auto-selection
 * type: 'productive' | 'unproductive' | 'neutral'
 */
const domainCategoryMap = {
    // ── Distracting / Unproductive ──
    'instagram.com':    { category: 'personal', type: 'unproductive', keywords: ['social', 'media', 'distraction'] },
    'facebook.com':     { category: 'personal', type: 'unproductive', keywords: ['social', 'media', 'distraction'] },
    'twitter.com':      { category: 'personal', type: 'unproductive', keywords: ['social', 'media', 'distraction'] },
    'x.com':            { category: 'personal', type: 'unproductive', keywords: ['social', 'media', 'distraction'] },
    'tiktok.com':       { category: 'personal', type: 'unproductive', keywords: ['social', 'media', 'distraction'] },
    'snapchat.com':     { category: 'personal', type: 'unproductive', keywords: ['social', 'media', 'distraction'] },
    'pinterest.com':    { category: 'personal', type: 'unproductive', keywords: ['social', 'media', 'distraction'] },
    'tumblr.com':       { category: 'personal', type: 'unproductive', keywords: ['social', 'media', 'distraction'] },
    'netflix.com':      { category: 'personal', type: 'unproductive', keywords: ['entertainment', 'streaming', 'movies'] },
    'primevideo.com':   { category: 'personal', type: 'unproductive', keywords: ['entertainment', 'streaming', 'movies'] },
    'disneyplus.com':   { category: 'personal', type: 'unproductive', keywords: ['entertainment', 'streaming', 'movies'] },
    'hulu.com':         { category: 'personal', type: 'unproductive', keywords: ['entertainment', 'streaming', 'movies'] },
    'twitch.tv':        { category: 'personal', type: 'unproductive', keywords: ['gaming', 'streaming', 'entertainment'] },
    'reddit.com':       { category: 'personal', type: 'unproductive', keywords: ['social', 'forum', 'distraction'] },
    '9gag.com':         { category: 'personal', type: 'unproductive', keywords: ['memes', 'distraction'] },

    // ── Coding / Development ──
    'github.com':       { category: 'work', type: 'productive', keywords: ['coding', 'programming', 'development', 'project', 'code'] },
    'gitlab.com':       { category: 'work', type: 'productive', keywords: ['coding', 'programming', 'development', 'code'] },
    'bitbucket.org':    { category: 'work', type: 'productive', keywords: ['coding', 'programming', 'development'] },
    'stackoverflow.com':{ category: 'work', type: 'productive', keywords: ['coding', 'programming', 'debug', 'problem'] },
    'codepen.io':       { category: 'work', type: 'productive', keywords: ['coding', 'frontend', 'css', 'web'] },
    'replit.com':       { category: 'work', type: 'productive', keywords: ['coding', 'programming', 'practice'] },
    'codesandbox.io':   { category: 'work', type: 'productive', keywords: ['coding', 'frontend', 'web'] },
    'vercel.com':       { category: 'work', type: 'productive', keywords: ['deployment', 'web', 'project'] },
    'netlify.com':      { category: 'work', type: 'productive', keywords: ['deployment', 'web', 'hosting'] },
    'npmjs.com':        { category: 'work', type: 'productive', keywords: ['coding', 'packages', 'javascript'] },
    'developer.mozilla.org': { category: 'work', type: 'productive', keywords: ['web', 'documentation', 'learning', 'mdn'] },

    // ── Competitive Programming / DSA ──
    'leetcode.com':     { category: 'work', type: 'productive', keywords: ['dsa', 'coding', 'algorithm', 'problem', 'practice', 'leetcode', 'competitive'] },
    'hackerrank.com':   { category: 'work', type: 'productive', keywords: ['dsa', 'coding', 'algorithm', 'practice', 'competitive'] },
    'codeforces.com':   { category: 'work', type: 'productive', keywords: ['dsa', 'coding', 'algorithm', 'competitive', 'contest'] },
    'codechef.com':     { category: 'work', type: 'productive', keywords: ['dsa', 'coding', 'algorithm', 'competitive'] },
    'atcoder.jp':       { category: 'work', type: 'productive', keywords: ['dsa', 'coding', 'algorithm', 'competitive'] },
    'geeksforgeeks.org':{ category: 'work', type: 'productive', keywords: ['dsa', 'coding', 'algorithm', 'learning', 'study'] },
    'neetcode.io':      { category: 'work', type: 'productive', keywords: ['dsa', 'coding', 'algorithm', 'practice', 'leetcode'] },

    // ── Learning / Education ──
    'coursera.org':     { category: 'work', type: 'productive', keywords: ['learning', 'course', 'study', 'education', 'online'] },
    'udemy.com':        { category: 'work', type: 'productive', keywords: ['learning', 'course', 'study', 'education'] },
    'edx.org':          { category: 'work', type: 'productive', keywords: ['learning', 'course', 'study', 'education'] },
    'khanacademy.org':  { category: 'work', type: 'productive', keywords: ['learning', 'study', 'math', 'education'] },
    'freecodecamp.org': { category: 'work', type: 'productive', keywords: ['learning', 'coding', 'web', 'study'] },
    'w3schools.com':    { category: 'work', type: 'productive', keywords: ['learning', 'web', 'reference', 'study'] },
    'brilliant.org':    { category: 'work', type: 'productive', keywords: ['learning', 'math', 'science', 'study'] },
    'duolingo.com':     { category: 'personal', type: 'productive', keywords: ['learning', 'language', 'study', 'practice'] },
    'skillshare.com':   { category: 'work', type: 'productive', keywords: ['learning', 'creative', 'course', 'design'] },

    // ── Reading / Knowledge ──
    'medium.com':       { category: 'personal', type: 'neutral', keywords: ['reading', 'blog', 'learning', 'article'] },
    'dev.to':           { category: 'work', type: 'productive', keywords: ['reading', 'coding', 'blog', 'learning', 'tech'] },
    'hashnode.com':     { category: 'work', type: 'productive', keywords: ['reading', 'coding', 'blog', 'learning'] },
    'wikipedia.org':    { category: 'personal', type: 'neutral', keywords: ['research', 'reading', 'learning', 'reference'] },

    // ── YouTube (special case — can be productive or not) ──
    'youtube.com':      { category: 'personal', type: 'neutral', keywords: ['video', 'tutorial', 'learning', 'entertainment'] },

    // ── Health & Fitness ──
    'strava.com':       { category: 'health', type: 'productive', keywords: ['fitness', 'exercise', 'running', 'cycling', 'workout'] },
    'myfitnesspal.com': { category: 'health', type: 'productive', keywords: ['fitness', 'nutrition', 'diet', 'health', 'tracking'] },
    'headspace.com':    { category: 'health', type: 'productive', keywords: ['meditation', 'mindfulness', 'mental', 'health'] },
    'calm.com':         { category: 'health', type: 'productive', keywords: ['meditation', 'sleep', 'mindfulness', 'health'] },

    // ── Work / Productivity Tools ──
    'notion.so':        { category: 'work', type: 'productive', keywords: ['notes', 'planning', 'productivity', 'work', 'writing'] },
    'trello.com':       { category: 'work', type: 'productive', keywords: ['planning', 'tasks', 'project', 'management'] },
    'figma.com':        { category: 'work', type: 'productive', keywords: ['design', 'ui', 'ux', 'creative', 'prototype'] },
    'docs.google.com':  { category: 'work', type: 'productive', keywords: ['writing', 'document', 'work', 'study'] },
    'kaggle.com':       { category: 'work', type: 'productive', keywords: ['data', 'machine learning', 'ai', 'science', 'analysis'] },

    // ── Finance / Professional ──
    'linkedin.com':     { category: 'work', type: 'neutral', keywords: ['networking', 'career', 'professional', 'job'] },
};

/**
 * Score how well a goal matches domain keywords. Higher = better match.
 * Uses both category matching and keyword overlap with goal title.
 */
function scoreGoalForDomain(goal, domainInfo, hostname) {
    let score = 0;
    const titleLower = goal.title.toLowerCase();
    const categoryLower = (goal.category || '').toLowerCase();

    // Exact "Unproductive" match for unproductive domains
    if (domainInfo.type === 'unproductive' && titleLower === 'unproductive') {
        return 100;
    }

    // Category match (work → work, health → health, etc.)
    if (domainInfo.category === categoryLower) {
        score += 15;
    }

    // Keyword matching: check if any domain keywords appear in the goal title
    const keywords = domainInfo.keywords || [];
    keywords.forEach(keyword => {
        if (titleLower.includes(keyword)) {
            score += 20; // Strong signal
        }
    });

    // Domain name in title (e.g., goal "LeetCode practice" matches leetcode.com)
    const domainBase = hostname.split('.')[0]; // "leetcode" from "leetcode.com"
    if (domainBase.length > 3 && titleLower.includes(domainBase)) {
        score += 30; // Very strong signal
    }

    // Penalize "Unproductive" goal for productive domains
    if (domainInfo.type === 'productive' && titleLower === 'unproductive') {
        score -= 50;
    }

    return score;
}

/**
 * Find the best matching domain info. Checks exact matches and partial matches
 * (e.g., "docs.google.com" → "google.com").
 */
function getDomainInfo(hostname) {
    // Exact match first
    if (domainCategoryMap[hostname]) return domainCategoryMap[hostname];

    // Partial match: check if any known domain is a suffix of the hostname
    for (const [domain, info] of Object.entries(domainCategoryMap)) {
        if (hostname.endsWith(domain) || hostname.includes(domain.split('.')[0])) {
            return info;
        }
    }

    return null; // Unknown domain
}

function openSmartLinkModal() {
    const input = document.getElementById('smartLinkInput');
    let url = input.value.trim();

    if (!url) {
        alert("Please enter a URL first.");
        return;
    }

    // Auto-prepend https if missing
    if (!url.startsWith('http')) {
        url = 'https://' + url;
    }

    try {
        const urlObj = new URL(url);
        trackingUrl = urlObj.href;
        const hostname = urlObj.hostname.replace('www.', '');

        document.getElementById('smartLinkDisplayUrl').textContent = hostname;

        // Smart domain analysis
        const domainInfo = getDomainInfo(hostname);

        // Score all goals against this domain
        let scoredGoals = goalsCache.map(goal => ({
            goal,
            score: domainInfo ? scoreGoalForDomain(goal, domainInfo, hostname) : 0
        }));

        // Sort by score (highest first), then by title
        scoredGoals.sort((a, b) => b.score - a.score || a.goal.title.localeCompare(b.goal.title));

        // Populate dropdown with scored order
        const select = document.getElementById('smartLinkHabitSelect');
        select.innerHTML = '<option value="">Select a habit...</option>';

        const bestMatch = scoredGoals[0];
        const hasGoodMatch = bestMatch && bestMatch.score >= 15;

        scoredGoals.forEach(({ goal, score }) => {
            const option = document.createElement('option');
            option.value = goal.id;
            option.textContent = goal.title;

            // Auto-select the best match if score is high enough
            if (hasGoodMatch && goal.id === bestMatch.goal.id) {
                option.selected = true;
            }

            select.appendChild(option);
        });

        // Set hint message based on detection
        const hint = document.getElementById('smartLinkHint');

        if (domainInfo && domainInfo.type === 'unproductive') {
            hint.textContent = `⚠️ Distraction detected! Auto-selected 'Unproductive'. Time will be tracked as unproductive browsing.`;
            hint.style.color = "var(--warning)";

        } else if (domainInfo && domainInfo.type === 'productive' && hasGoodMatch) {
            hint.textContent = `✅ Productive site detected → auto-matched to "${bestMatch.goal.title}". Change if needed.`;
            hint.style.color = "var(--success, #22c55e)";

        } else if (domainInfo && domainInfo.type === 'neutral') {
            hint.textContent = `ℹ️ This site could be productive or a distraction. We suggested the closest match — adjust if needed.`;
            hint.style.color = "var(--text-muted)";

        } else if (!domainInfo) {
            hint.textContent = `Unknown site. Select which habit this browsing session counts towards.`;
            hint.style.color = "var(--text-muted)";

        } else {
            hint.textContent = `Select which habit this browsing session counts towards.`;
            hint.style.color = "var(--text-muted)";
        }

        document.getElementById('smartLinkModal').classList.add('active');
    } catch (e) {
        alert("Please enter a valid URL (e.g. leetcode.com)");
    }
}

function closeSmartLinkModal() {
    document.getElementById('smartLinkModal').classList.remove('active');
}

// Extension listeners for auto-pausing
document.addEventListener('getItRight_PAUSE', () => {
    if (trackingHabitId && !isTrackingPaused) {
        console.log("Auto-pausing timer (Tab switched)");
        isTrackingPaused = true;

        // Accumulate time so far
        if (trackingStartTime) {
            const now = new Date();
            trackingAccumulatedSeconds += Math.floor((now - trackingStartTime) / 1000);
            trackingStartTime = null; // stop accumulating
        }

        // Visual indicator that it's paused
        const bannerContent = document.querySelector('.tracking-banner-content');
        if (bannerContent) bannerContent.style.opacity = '0.5';
    }
});

document.addEventListener('getItRight_RESUME', () => {
    if (trackingHabitId && isTrackingPaused) {
        console.log("Auto-resuming timer (Tab focused)");
        isTrackingPaused = false;

        // Reset start time to now
        trackingStartTime = new Date();

        // Visual indicator
        const bannerContent = document.querySelector('.tracking-banner-content');
        if (bannerContent) bannerContent.style.opacity = '1';
    }
});

// Visibilitychange-based auto-pause (works WITHOUT the extension)
// This fires when the user leaves/returns to the dashboard tab itself.
// It does NOT fire when switching between two OTHER tabs (e.g. leetcode → youtube).
// For cross-tab detection, the Chrome extension is required.
let trackingIgnoreVisibility = false; // suppress during startup race

document.addEventListener('visibilitychange', () => {
    if (!trackingHabitId || trackingIgnoreVisibility) return;
    // Only use this fallback if the extension is NOT installed
    if (extensionInstalled) return;

    if (document.hidden) {
        // Dashboard tab lost focus — if the tracked window is still open,
        // the user likely switched TO it (good), so DON'T pause.
        if (trackingWindow && !trackingWindow.closed) return;
        // If tracked window is closed and user left dashboard, pause.
        document.dispatchEvent(new CustomEvent('getItRight_PAUSE'));
    } else {
        // User came back to dashboard tab
        document.dispatchEvent(new CustomEvent('getItRight_RESUME'));
    }
});

function startSmartLinkTracking() {
    const select = document.getElementById('smartLinkHabitSelect');
    trackingHabitId = select.value;
    const selectedHabitName = select.options[select.selectedIndex]?.text;

    if (!trackingHabitId) {
        alert("Please select a habit to track this time under.");
        return;
    }

    closeSmartLinkModal();

    // Suppress visibilitychange race during tab open
    trackingIgnoreVisibility = true;

    // Setup state BEFORE opening tab to avoid race conditions
    trackingAccumulatedSeconds = 0;
    isTrackingPaused = false;
    trackingStartTime = new Date();
    document.getElementById('smartLinkInput').value = '';

    // Open in new tab
    trackingWindow = window.open(trackingUrl, '_blank');
    if (!trackingWindow) {
        alert("Popup blocked! Please allow popups for this site to use Smart Link Tracking.");
        trackingHabitId = null;
        trackingStartTime = null;
        return;
    }

    // Tell Chrome Extension to start monitoring this URL
    document.dispatchEvent(new CustomEvent('getItRight_START_TRACKING', {
        detail: trackingUrl
    }));

    // Re-enable visibilitychange after a short delay (let the tab switch settle)
    setTimeout(() => { trackingIgnoreVisibility = false; }, 1500);

    // Warn user if extension is not installed
    if (!extensionInstalled) {
        console.warn('getItRight Extension not detected. Auto-pause on tab switch will not work.');
        // Show a subtle warning on the tracking banner
        setTimeout(() => {
            const banner = document.getElementById('activeTrackingBanner');
            if (banner) {
                let warn = banner.querySelector('.extension-warning');
                if (!warn) {
                    warn = document.createElement('div');
                    warn.className = 'extension-warning';
                    warn.style.cssText = 'font-size: 0.7rem; opacity: 0.6; margin-top: 0.25rem; text-align: center;';
                    warn.textContent = '⚠ Extension not detected — auto-pause on tab switch is disabled.';
                    banner.appendChild(warn);
                }
            }
        }, 500);
    }

    document.querySelector('.smart-launcher-card').style.display = 'none';
    const banner = document.getElementById('activeTrackingBanner');
    banner.style.display = 'flex';
    const bannerContent = document.querySelector('.tracking-banner-content');
    if (bannerContent) bannerContent.style.opacity = '1';

    try {
        const hostname = new URL(trackingUrl).hostname.replace('www.', '');
        document.getElementById('trackingStatusText').innerHTML = `Tracking time on <strong>${hostname}</strong> for <strong>${selectedHabitName}</strong>`;
    } catch (e) { }

    // Start UI update & tab monitor interval
    let trackingElapsedTicks = 0; // counts seconds since tracking started
    let totalElapsedSeconds = 0;  // always increments (for display)
    trackingInterval = setInterval(() => {
        trackingElapsedTicks++;
        totalElapsedSeconds++;

        // 1) Total elapsed time (always ticks — user can see the timer move)
        const totalMins = String(Math.floor(totalElapsedSeconds / 60)).padStart(2, '0');
        const totalSecs = String(totalElapsedSeconds % 60).padStart(2, '0');
        document.getElementById('trackingTimerDisplay').textContent = `${totalMins}:${totalSecs}`;

        // 2) Active-only time (pauses when tab is unfocused — this is what gets saved)
        let activeSecs = trackingAccumulatedSeconds;
        if (!isTrackingPaused && trackingStartTime) {
            const now = new Date();
            activeSecs += Math.floor((now - trackingStartTime) / 1000);
        }
        const activeMins = String(Math.floor(activeSecs / 60)).padStart(2, '0');
        const activeSecsStr = String(activeSecs % 60).padStart(2, '0');
        const activeDisplay = document.getElementById('trackingActiveDisplay');
        if (activeDisplay) {
            activeDisplay.textContent = `Active: ${activeMins}:${activeSecsStr}`;
        }

        // 3) Update status badge
        const badge = document.getElementById('trackingStatusBadge');
        if (badge) {
            if (isTrackingPaused) {
                badge.textContent = '⏸ PAUSED';
                badge.className = 'tracking-status-badge paused';
            } else {
                badge.textContent = '● ACTIVE';
                badge.className = 'tracking-status-badge active';
            }
        }

        // Check if tracked tab was closed (grace period: skip first 5 seconds)
        if (trackingElapsedTicks > 5) {
            try {
                if (trackingWindow && trackingWindow.closed) {
                    stopSmartLinkTracking(false);
                }
            } catch (e) {
                // Cross-origin reference error — window still exists
            }
        }

        // Built-in focus-based auto-pause (works WITHOUT extension)
        // Logic: if the DASHBOARD has focus, the user is NOT on the tracked site → pause
        //        if the dashboard does NOT have focus, the user is elsewhere → if tracked window
        //        is still open, assume they're on it → resume
        if (!extensionInstalled && trackingHabitId) {
            if (document.hasFocus()) {
                // User is looking at the dashboard, not the tracked site
                if (!isTrackingPaused && trackingElapsedTicks > 3) {
                    document.dispatchEvent(new CustomEvent('getItRight_PAUSE'));
                }
            } else {
                // Dashboard doesn't have focus
                if (isTrackingPaused && trackingWindow && !trackingWindow.closed) {
                    // Tracked window is still open and user is not on dashboard → resume
                    document.dispatchEvent(new CustomEvent('getItRight_RESUME'));
                }
            }
        }
    }, 1000);
}

async function stopSmartLinkTracking(manual) {
    if (!trackingHabitId) return;

    // Tell the extension to stop monitoring tabs
    document.dispatchEvent(new CustomEvent('getItRight_STOP_TRACKING'));

    // Cleanup interval and window
    clearInterval(trackingInterval);

    // Final accumulation
    if (!isTrackingPaused && trackingStartTime) {
        const now = new Date();
        trackingAccumulatedSeconds += Math.floor((now - trackingStartTime) / 1000);
    }
    const minutesTracked = Math.round(trackingAccumulatedSeconds / 60);

    // Reset UI
    document.getElementById('activeTrackingBanner').style.display = 'none';
    const bannerContent = document.querySelector('.tracking-banner-content');
    if (bannerContent) bannerContent.style.opacity = '1';
    // Remove extension warning if present
    const extWarn = document.querySelector('.extension-warning');
    if (extWarn) extWarn.remove();

    document.querySelector('.smart-launcher-card').style.display = 'flex';
    document.getElementById('trackingTimerDisplay').textContent = '00:00';
    const activeTimeEl = document.getElementById('trackingActiveDisplay');
    if (activeTimeEl) activeTimeEl.textContent = 'Active: 00:00';
    const badgeEl = document.getElementById('trackingStatusBadge');
    if (badgeEl) {
        badgeEl.textContent = '● ACTIVE';
        badgeEl.className = 'tracking-status-badge active';
    }

    if (minutesTracked < 1) {
        showTrackingToast("Tracking stopped. Session was less than a minute — no time logged.", "warning");
    } else {
        // Log to database
        try {
            const today = new Date().toISOString().split('T')[0];
            const goal = goalsCache.find(g => g.id === trackingHabitId);
            if (!goal) return;

            // Add today as a flat date string (matching the format used everywhere else)
            let dailyProgress = [...goal.dailyProgress];
            if (!dailyProgress.includes(today)) {
                dailyProgress.push(today);
            }

            const { error } = await window.supabase
                .from('goals')
                .update({ daily_progress: dailyProgress })
                .eq('id', trackingHabitId);

            if (error) throw error;

            // Log to task_logs table for detailed analytics
            if (typeof logTaskEvent === 'function') {
                logTaskEvent(
                    trackingHabitId,
                    minutesTracked,
                    `Smart Link session: ${trackingUrl || 'unknown'}`,
                    'neutral'
                );
            }

            // Save to localStorage for instant history rendering
            saveTrackingToLocalHistory(trackingUrl, goal.title, minutesTracked);

            showTrackingToast(`Logged ${minutesTracked} min to "${goal.title}" ✓`, "success");

            // Reload dashboard
            fetchGoals().then(() => {
                updateStats();
                renderCharts();
                renderTrackingHistory();
            });

        } catch (error) {
            console.error("Failed to log tracked time:", error);
            showTrackingToast("Error saving tracked time.", "error");
        }
    }

    // Reset state
    trackingWindow = null;
    trackingInterval = null;
    trackingStartTime = null;
    trackingHabitId = null;
    trackingUrl = null;
    trackingAccumulatedSeconds = 0;
    isTrackingPaused = false;
}

// Non-blocking toast notification (replaces alert() which blocks on background tabs)
function showTrackingToast(message, type = "info") {
    // Remove existing toast
    const existing = document.querySelector('.tracking-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'tracking-toast';
    const colors = { success: '#22c55e', warning: '#f59e0b', error: '#ef4444', info: 'var(--accent)' };
    toast.style.cssText = `
        position: fixed; bottom: 2rem; left: 50%; transform: translateX(-50%);
        background: ${colors[type] || colors.info}; color: #fff;
        padding: 0.75rem 1.5rem; border-radius: 8px; font-size: 0.85rem;
        font-weight: 600; z-index: 10000; box-shadow: 0 8px 25px rgba(0,0,0,0.3);
        animation: toastSlideIn 0.3s ease-out;
        cursor: pointer;
    `;
    toast.textContent = message;
    toast.onclick = () => toast.remove();
    document.body.appendChild(toast);

    // Auto-dismiss after 5 seconds
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 5000);
}

// Inject toast animation keyframes
(function() {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes toastSlideIn {
            from { opacity: 0; transform: translateX(-50%) translateY(20px); }
            to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
    `;
    document.head.appendChild(style);
})();

