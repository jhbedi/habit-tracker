/**
 * getItRight - Authentication (auth.js)
 * Handles login, signup, logout with Supabase Auth
 */

// =====================================================
// Tab Switching
// =====================================================

function switchTab(tab) {
    const loginTab = document.getElementById('loginTab');
    const signupTab = document.getElementById('signupTab');
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');

    // Clear errors
    document.getElementById('loginError').textContent = '';
    document.getElementById('signupError').textContent = '';
    document.getElementById('signupSuccess').textContent = '';

    if (tab === 'login') {
        loginTab.classList.add('active');
        signupTab.classList.remove('active');
        loginForm.style.display = 'flex';
        signupForm.style.display = 'none';
    } else {
        signupTab.classList.add('active');
        loginTab.classList.remove('active');
        signupForm.style.display = 'flex';
        loginForm.style.display = 'none';
    }
}

// =====================================================
// Login
// =====================================================

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');

    errorEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try {
        const { data, error } = await window.supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) throw error;

        // Success — redirect to dashboard
        window.location.href = 'index.html';
    } catch (error) {
        errorEl.textContent = error.message || 'Login failed. Please try again.';
        btn.disabled = false;
        btn.textContent = 'Sign In';
    }
}

// =====================================================
// Signup
// =====================================================

async function handleSignup(e) {
    e.preventDefault();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const confirm = document.getElementById('signupConfirm').value;
    const errorEl = document.getElementById('signupError');
    const successEl = document.getElementById('signupSuccess');
    const btn = document.getElementById('signupBtn');

    errorEl.textContent = '';
    successEl.textContent = '';

    if (password !== confirm) {
        errorEl.textContent = 'Passwords do not match.';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Creating account...';

    try {
        const { data, error } = await window.supabase.auth.signUp({
            email,
            password
        });

        if (error) throw error;

        // Check if user needs email confirmation
        if (data.user && data.user.identities && data.user.identities.length === 0) {
            errorEl.textContent = 'An account with this email already exists.';
        } else {
            successEl.textContent = 'Account created! Check your email to confirm, then sign in.';
            document.getElementById('signupForm').reset();
        }
    } catch (error) {
        errorEl.textContent = error.message || 'Signup failed. Please try again.';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Create Account';
    }
}

// =====================================================
// Logout (called from any page)
// =====================================================

async function handleLogout() {
    await window.supabase.auth.signOut();
    window.location.href = 'login.html';
}

// =====================================================
// Check if already logged in (on login page only)
// =====================================================

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const { data: { user } } = await window.supabase.auth.getUser();
        if (user) {
            // Already logged in — go to dashboard
            window.location.href = 'index.html';
        }
    } catch (e) {
        // Not logged in — stay on login page
    }
});
