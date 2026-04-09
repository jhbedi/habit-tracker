// Background service worker for getItRight Smart Tracker

let trackingActive = false;
let targetHostname = "";
let dashboardTabId = null;

// Listen for messages from the dashboard (via content.js)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "START_TRACKING") {
        console.log("Background received START_TRACKING for", message.targetUrl);
        trackingActive = true;

        try {
            const urlObj = new URL(message.targetUrl);
            targetHostname = urlObj.hostname.replace('www.', '');
        } catch (e) {
            targetHostname = message.targetUrl.replace('www.', '');
        }

        // Save the dashboard tab ID so we know where to send PAUSE/RESUME messages
        if (sender && sender.tab) {
            dashboardTabId = sender.tab.id;
        }
    }

    if (message.type === "STOP_TRACKING") {
        console.log("Background received STOP_TRACKING — resetting state.");
        trackingActive = false;
        targetHostname = "";
        dashboardTabId = null;
    }
});

// Check if the currently active tab matches our target hostname
async function checkActiveTab() {
    if (!trackingActive || !dashboardTabId || !targetHostname) return;

    try {
        // Get the currently active tab in the main window
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!activeTab || !activeTab.url) return;

        // Is the user on the target website right now?
        const isTrackingSite = activeTab.url.includes(targetHostname);

        // Remove isDashboard from resume logic so timer pauses when checking the dashboard
        const isDashboard = activeTab.id === dashboardTabId;

        if (isTrackingSite) {
            // User is focused on the target
            chrome.tabs.sendMessage(dashboardTabId, { type: "RESUME_TRACKER" }).catch(e => { });
        } else {
            // User switched to Youtube, Twitter, or the dashboard
            chrome.tabs.sendMessage(dashboardTabId, { type: "PAUSE_TRACKER" }).catch(e => { });
        }
    } catch (e) {
        console.error("Error checking active tab:", e);
    }
}

// Listen for tab switches
chrome.tabs.onActivated.addListener((activeInfo) => {
    // A slight delay ensures the new tab's URL is fully loaded/accessible
    setTimeout(checkActiveTab, 200);
});

// Listen for URL changes within the same tab (e.g., navigating away from LeetCode)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        checkActiveTab();
    }
});
