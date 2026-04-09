/**
 * getItRight - Theme Switcher (theme-switch.js)
 * Handles toggling between the Minimal Light Theme and Deep Slate Dark Theme.
 * Includes local storage persistence and Chart.js reactivity.
 */

const THEME_STORAGE_KEY = 'getItRight_theme';
const DARK_THEME_CLASS = 'dark-theme';

// Initialize Theme on Load (prevents flashing)
(function initTheme() {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    // Explicitly check for 'dark', default to light if not explicitly set and OS doesn't prefer dark
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        document.documentElement.classList.add(DARK_THEME_CLASS);
    } else {
        document.documentElement.classList.remove(DARK_THEME_CLASS);
    }
})();

function toggleTheme() {
    const isDark = document.documentElement.classList.toggle(DARK_THEME_CLASS);
    localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');

    // Dispatch custom event so other scripts (like dashboard charts) can react
    const event = new CustomEvent('themeChanged', { detail: { isDark } });
    window.dispatchEvent(event);

    updateThemeIcon(isDark);
}

function updateThemeIcon(isDark) {
    const iconPath = document.querySelector('#themeToggleBtn svg path');
    if (!iconPath) return;

    if (isDark) {
        // Moon icon for dark theme
        iconPath.setAttribute('d', 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z');
    } else {
        // Sun icon for light theme
        iconPath.setAttribute('d', 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Inject the theme toggle button into the header nav if it exists, or bind to an existing one
    let toggleBtn = document.getElementById('themeToggleBtn');

    // Check if the current theme is dark to set the initial icon state correctly
    const isDark = document.documentElement.classList.contains(DARK_THEME_CLASS);

    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleTheme);
        updateThemeIcon(isDark);
    }
});
