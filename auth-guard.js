/**
 * getItRight - Auth Guard (auth-guard.js)
 * Include this on every protected page BEFORE page-specific scripts.
 * Redirects to login.html if user is not authenticated.
 */

(async function authGuard() {
    try {
        const { data: { user } } = await window.supabase.auth.getUser();
        if (!user) {
            window.location.href = 'login.html';
        }
    } catch (e) {
        window.location.href = 'login.html';
    }
})();

// Logout function available on all protected pages
async function handleLogout() {
    await window.supabase.auth.signOut();
    window.location.href = 'login.html';
}
