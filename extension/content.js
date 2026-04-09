// Bridge between the getItRight web dashboard and the Chrome Extension background worker

console.log("getItRight Smart Tracker Extension loaded.");

// Announce to the dashboard that the extension is ready.
// Retry a few times in case dashboard.js hasn't set up listeners yet.
function announceReady() {
    document.dispatchEvent(new CustomEvent('getItRight_EXTENSION_READY'));
}
announceReady();
setTimeout(announceReady, 500);
setTimeout(announceReady, 1500);
setTimeout(announceReady, 3000);

// 1. Listen for START_TRACKING from the dashboard UI
document.addEventListener('getItRight_START_TRACKING', (e) => {
    const targetUrl = e.detail; // e.g., "https://leetcode.com"
    console.log("Extension received START_TRACKING for:", targetUrl);

    // Send to background service worker to monitor
    chrome.runtime.sendMessage({
        type: "START_TRACKING",
        targetUrl: targetUrl
    });
});

// 2. Listen for STOP_TRACKING from the dashboard UI
document.addEventListener('getItRight_STOP_TRACKING', () => {
    console.log("Extension received STOP_TRACKING");
    chrome.runtime.sendMessage({ type: "STOP_TRACKING" });
});

// 3. Listen for PAUSE / RESUME messages from the background service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "PAUSE_TRACKER") {
        console.log("Extension passing PAUSE to dashboard");
        document.dispatchEvent(new CustomEvent('getItRight_PAUSE'));
    }
    else if (message.type === "RESUME_TRACKER") {
        console.log("Extension passing RESUME to dashboard");
        document.dispatchEvent(new CustomEvent('getItRight_RESUME'));
    }
});
