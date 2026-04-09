/**
 * getItRight — Floating AI Chat Widget (chat-widget.js)
 * Self-contained: injects the floating icon + popup chat into any page.
 * Requires gemini.js and ai-engine.js to be loaded before this script.
 */

(function () {
    // =====================================================
    // State
    // =====================================================
    let chatOpen = false;
    let chatReady = false;
    let chatAnalysis = null;

    // =====================================================
    // Inject HTML
    // =====================================================
    function injectWidget() {
        const widget = document.createElement('div');
        widget.id = 'chatWidget';
        widget.innerHTML = `
            <!-- Floating Button -->
            <button class="chat-fab" id="chatFab" title="Ask AI Coach">
                <svg class="chat-fab-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <circle cx="12" cy="12" r="6"/>
                    <circle cx="12" cy="12" r="2"/>
                </svg>
                <svg class="chat-fab-close" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>

            <!-- Chat Popup -->
            <div class="chat-popup" id="chatPopup">
                <div class="chat-popup-header">
                    <div class="chat-popup-title">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <circle cx="12" cy="12" r="6"/>
                            <circle cx="12" cy="12" r="2"/>
                        </svg>
                        <span>AI Coach</span>
                        <span class="chat-popup-badge">Gemini</span>
                    </div>
                    <button class="chat-popup-close" id="chatPopupClose">×</button>
                </div>
                <div class="chat-popup-messages" id="chatMessages">
                    <div class="assistant-msg bot">
                        <div class="msg-avatar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></div>
                        <div class="msg-content"><p>Hi! I'm your AI habit coach powered by Gemini. Ask me anything about your habits! 🎯</p></div>
                    </div>
                </div>
                <div class="chat-popup-input">
                    <input type="text" id="chatInput" placeholder="Ask about your habits..." autocomplete="off">
                    <button class="chat-popup-send" id="chatSend">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                        </svg>
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(widget);
    }

    // =====================================================
    // Toggle Chat
    // =====================================================
    function toggleChat() {
        chatOpen = !chatOpen;
        const popup = document.getElementById('chatPopup');
        const iconOpen = document.querySelector('.chat-fab-icon');
        const iconClose = document.querySelector('.chat-fab-close');
        const fab = document.getElementById('chatFab');

        popup.classList.toggle('open', chatOpen);
        fab.classList.toggle('active', chatOpen);
        iconOpen.style.display = chatOpen ? 'none' : 'block';
        iconClose.style.display = chatOpen ? 'block' : 'none';

        if (chatOpen && !chatReady) {
            loadHabitData();
        }

        if (chatOpen) {
            setTimeout(() => document.getElementById('chatInput').focus(), 200);
        }
    }

    // =====================================================
    // Load Habit Data for Context
    // =====================================================
    async function loadHabitData() {
        try {
            const { data, error } = await window.supabase
                .from('goals')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            const goals = data.map(g => ({
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

            // Run full AI engine analysis (5 algorithms)
            if (typeof AIEngine !== 'undefined' && AIEngine.runFullAnalysis) {
                chatAnalysis = AIEngine.runFullAnalysis(goals);
            } else {
                // Build a simple analysis object
                chatAnalysis = buildSimpleAnalysis(goals);
            }
            chatReady = true;
        } catch (err) {
            console.error('Chat widget: failed to load goals:', err);
            chatReady = true; // Allow chatting even without data
        }
    }

    function buildSimpleAnalysis(goals) {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayCounts = [0, 0, 0, 0, 0, 0, 0];

        const clusters = goals.map(g => {
            const totalDays = Math.ceil(Math.abs(new Date(g.endDate) - new Date(g.startDate)) / 86400000) + 1;
            const completionRate = totalDays > 0 ? g.dailyProgress.length / totalDays : 0;

            // Count activity per day of week
            g.dailyProgress.forEach(d => {
                const day = new Date(d).getDay();
                dayCounts[day]++;
            });

            return {
                goal: g,
                features: { completionRate, currentStreak: 0 },
                clusterLabel: completionRate > 0.7 ? 'Strong' : completionRate > 0.4 ? 'Building' : 'Needs Attention'
            };
        });

        const maxDay = dayCounts.indexOf(Math.max(...dayCounts));
        const minDay = dayCounts.indexOf(Math.min(...dayCounts));
        const totalActivity = dayCounts.reduce((a, b) => a + b, 0);

        return {
            clusters,
            forecasts: [],
            suggestions: [],
            productivity: {
                peakDay: totalActivity > 0 ? dayNames[maxDay] : 'Unknown',
                lowDay: totalActivity > 0 ? dayNames[minDay] : 'Unknown',
                patternInsight: totalActivity > 0
                    ? `You complete the most habits on ${dayNames[maxDay]}s (${dayCounts[maxDay]} times) and fewest on ${dayNames[minDay]}s (${dayCounts[minDay]} times).`
                    : ''
            },
            nlpResults: []
        };
    }

    // =====================================================
    // Chat Messages
    // =====================================================
    function addChatMsg(type, content) {
        const container = document.getElementById('chatMessages');
        const msg = document.createElement('div');
        msg.className = `assistant-msg ${type}`;

        if (type === 'user') {
            msg.innerHTML = `
                <div class="msg-content user-msg"><p>${escapeHtmlChat(content)}</p></div>
                <div class="msg-avatar user-avatar">You</div>
            `;
        } else {
            msg.innerHTML = `
                <div class="msg-avatar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></div>
                <div class="msg-content"><p>${content}</p></div>
            `;
        }

        container.appendChild(msg);
        container.scrollTop = container.scrollHeight;
    }

    function escapeHtmlChat(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    let thinkingId = 0;

    function showThinking() {
        const id = 'chat-thinking-' + (++thinkingId);
        const container = document.getElementById('chatMessages');
        const msg = document.createElement('div');
        msg.className = 'assistant-msg bot';
        msg.id = id;
        msg.innerHTML = `
            <div class="msg-avatar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></div>
            <div class="msg-content thinking"><p><span class="thinking-dots">Thinking<span>.</span><span>.</span><span>.</span></span></p></div>
        `;
        container.appendChild(msg);
        container.scrollTop = container.scrollHeight;
        return id;
    }

    function hideThinking(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    // =====================================================
    // Handle Send
    // =====================================================
    async function handleSend() {
        const input = document.getElementById('chatInput');
        const query = input.value.trim();
        if (!query) return;

        addChatMsg('user', query);
        input.value = '';
        input.disabled = true;

        const tid = showThinking();

        try {
            let response = null;
            if (typeof callGemini === 'function' && chatAnalysis) {
                response = await callGemini(query, chatAnalysis);
            }

            hideThinking(tid);

            if (response) {
                addChatMsg('bot', typeof formatGeminiResponse === 'function'
                    ? formatGeminiResponse(response) : response);
            } else {
                addChatMsg('bot', 'I couldn\'t process that right now. Please try again!');
            }
        } catch (err) {
            hideThinking(tid);
            addChatMsg('bot', 'Something went wrong. Please try again!');
        }

        input.disabled = false;
        input.focus();
    }

    // =====================================================
    // Initialize
    // =====================================================
    function init() {
        injectWidget();

        // FAB click
        document.getElementById('chatFab').addEventListener('click', toggleChat);
        document.getElementById('chatPopupClose').addEventListener('click', toggleChat);

        // Send message
        document.getElementById('chatSend').addEventListener('click', handleSend);
        document.getElementById('chatInput').addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        });
    }

    // Wait for DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
