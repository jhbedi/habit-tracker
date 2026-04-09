/**
 * Goal Tracker - Add Goal Page (app.js)
 */

// =====================================================
// DOM Elements
// =====================================================

const goalForm = document.getElementById('goalForm');
const toast = document.getElementById('toast');

// =====================================================
// Utility Functions
// =====================================================

function showToast(message) {
    const toastMessage = toast.querySelector('.toast-message');
    toastMessage.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}

function setLoading(isLoading) {
    const submitBtn = goalForm.querySelector('button[type="submit"]');
    submitBtn.disabled = isLoading;
    submitBtn.textContent = isLoading ? 'Adding...' : 'Add Goal';
}

// =====================================================
// Form Submission
// =====================================================

goalForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData(goalForm);

    const title = formData.get('goalTitle').trim();
    const startDate = formData.get('goalStartDate');
    const endDate = formData.get('goalEndDate');

    if (!title) {
        showToast('Please enter a goal title');
        return;
    }

    if (!startDate || !endDate) {
        showToast('Please select dates');
        return;
    }

    if (new Date(endDate) < new Date(startDate)) {
        showToast('End date must be after start date');
        return;
    }

    setLoading(true);

    try {
        // Get authenticated user
        const { data: { user } } = await window.supabase.auth.getUser();
        if (!user) {
            showToast('Please sign in first');
            setLoading(false);
            return;
        }

        const { error } = await window.supabase
            .from('goals')
            .insert({
                user_id: user.id,
                title: title,
                category: formData.get('goalCategory'),
                priority: formData.get('goalPriority'),
                effort: formData.get('goalEffort'),
                start_date: startDate,
                end_date: endDate,
                time_per_day: Math.round(parseFloat(formData.get('timePerDay')) * 60),
                frequency: parseInt(formData.get('daysPerWeek')),
                daily_progress: [],
                progress: 0
            });

        if (error) throw error;

        showToast('Goal added!');
        goalForm.reset();
        initDates();

    } catch (error) {
        console.error('Error:', error);
        showToast('Error: ' + (error.message || 'Failed to add goal'));
    }

    setLoading(false);
});

// =====================================================
// Initialize
// =====================================================

function initDates() {
    const startDateInput = document.getElementById('goalStartDate');
    const endDateInput = document.getElementById('goalEndDate');

    const today = new Date().toISOString().split('T')[0];
    startDateInput.value = today;
    startDateInput.setAttribute('min', today);

    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    endDateInput.value = nextWeek.toISOString().split('T')[0];

    startDateInput.addEventListener('change', () => {
        endDateInput.setAttribute('min', startDateInput.value);
        if (endDateInput.value < startDateInput.value) {
            endDateInput.value = startDateInput.value;
        }
    });
}

document.addEventListener('DOMContentLoaded', initDates);
