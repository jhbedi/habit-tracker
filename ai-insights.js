/**
 * AI Insights - Page Controller (ai-insights.js)
 * Clean, minimal rendering of AI analysis results
 */

let goalsCache = [];
let analysisResults = null;
let forecastCharts = {};
let showCompletedAI = false;

function isGoalCompletedAI(goal) {
    const start = new Date(goal.startDate || goal.start_date);
    const end = new Date(goal.endDate || goal.end_date);
    const totalDays = Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24)) + 1;
    const dp = goal.dailyProgress || goal.daily_progress || [];
    return totalDays > 0 && dp.length >= totalDays;
}

function toggleCompletedAI() {
    showCompletedAI = !showCompletedAI;
    const btn = document.getElementById('toggleCompletedAIBtn');
    if (btn) {
        btn.textContent = showCompletedAI ? 'Hide Completed' : 'Show Completed';
        btn.classList.toggle('active', showCompletedAI);
    }
    if (!analysisResults) return;
    // Destroy old forecast charts
    Object.values(forecastCharts).forEach(c => c.destroy());
    forecastCharts = {};
    // Re-render filtered sections
    renderClusters(analysisResults.clusters);
    renderForecasts(analysisResults.forecasts);
    renderNLP(analysisResults.nlpResults);
}

const toast = document.getElementById('toast');

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
        goalsCache = data || [];
        return goalsCache;
    } catch (error) {
        console.error('Error fetching goals:', error);
        showToast('Error loading goals');
        return [];
    }
}

// =====================================================
// Sync & Analyze
// =====================================================

async function syncAndAnalyze() {
    const syncBtn = document.getElementById('syncBtn');
    const statusEl = document.getElementById('syncStatus');

    syncBtn.disabled = true;
    syncBtn.classList.add('loading');
    statusEl.textContent = 'Analyzing...';

    try {
        await fetchGoals();

        if (goalsCache.length === 0) {
            document.querySelectorAll('.ai-card').forEach(s => s.style.display = 'none');
            document.getElementById('aiStatsRow').style.display = 'none';
            document.getElementById('emptyState').style.display = 'block';
            return;
        }

        // Destroy old charts
        Object.values(forecastCharts).forEach(c => c.destroy());
        forecastCharts = {};

        // Run analysis
        analysisResults = AIEngine.runFullAnalysis(goalsCache);

        // Render
        renderOverviewStats(analysisResults);
        renderClusters(analysisResults.clusters);
        renderProductivity(analysisResults.productivity);
        setupAssistant();
        renderForecasts(analysisResults.forecasts);
        renderNLP(analysisResults.nlpResults);

        const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        statusEl.textContent = `Last analyzed at ${time} · ${goalsCache.length} goals`;
        showToast('Analysis complete');

    } catch (error) {
        console.error('Analysis error:', error);
        showToast('Error during analysis');
    } finally {
        syncBtn.disabled = false;
        syncBtn.classList.remove('loading');
    }
}

// =====================================================
// Overview Stats
// =====================================================

function renderOverviewStats(results) {
    const goals = results.clusters;
    const avgCompletion = Math.round(
        goals.reduce((s, g) => s + g.features.completionRate, 0) / goals.length * 100
    );

    // Find strongest habit
    const sorted = [...goals].sort((a, b) => b.features.completionRate - a.features.completionRate);
    const top = sorted[0];
    const topName = top.goal.title.length > 12 ? top.goal.title.substring(0, 12) + '…' : top.goal.title;

    document.getElementById('statGoals').textContent = goals.length;
    document.getElementById('statAvgCompletion').textContent = avgCompletion + '%';
    document.getElementById('statPeakDay').textContent = results.productivity.peakDay;
    document.getElementById('statTopHabit').textContent = topName;
}

// =====================================================
// Clusters (K-Means) - Clean grouped list
// =====================================================

function renderClusters(clusters) {
    const container = document.getElementById('clusterContent');

    // Filter completed goals if toggle is off
    const filtered = showCompletedAI ? clusters : clusters.filter(item => !isGoalCompletedAI(item.goal));

    // Group by cluster
    const groups = {};
    filtered.forEach(item => {
        if (!groups[item.cluster]) {
            groups[item.cluster] = {
                label: item.clusterLabel.replace(/[🏆📈⚠️]/g, '').trim(),
                color: item.clusterColor,
                goals: []
            };
        }
        groups[item.cluster].goals.push(item);
    });

    container.innerHTML = Object.values(groups).map(group => `
        <div class="cluster-group">
            <div class="cluster-group-header">
                <span class="cluster-dot" style="background:${group.color}"></span>
                <span class="cluster-group-name">${group.label}</span>
                <span class="cluster-group-count">${group.goals.length}</span>
            </div>
            ${group.goals.map(item => `
                <div class="cluster-row">
                    <span class="cluster-row-name">${item.goal.title}</span>
                    <div class="cluster-row-bar">
                        <div class="cluster-row-fill" style="width:${Math.round(item.features.completionRate * 100)}%; background:${group.color}"></div>
                    </div>
                    <span class="cluster-row-pct">${Math.round(item.features.completionRate * 100)}%</span>
                </div>
            `).join('')}
        </div>
    `).join('');
}

// =====================================================
// Productivity Heatmap - Clean bar chart
// =====================================================

function renderProductivity(productivity) {
    const container = document.getElementById('productivityContent');
    const max = Math.max(...productivity.heatmap.map(h => h.count), 1);

    container.innerHTML = `
        <div class="heatmap-clean">
            ${productivity.heatmap.map(h => `
                <div class="heatmap-col">
                    <span class="heatmap-val">${h.count}</span>
                    <div class="heatmap-bar-wrap">
                        <div class="heatmap-bar-inner" style="height:${Math.max(6, (h.count / max) * 100)}%; background:${h.count === Math.max(...productivity.heatmap.map(x => x.count)) ? '#7c3aed' : 'rgba(99,102,241,0.35)'}"></div>
                    </div>
                    <span class="heatmap-label">${h.day}</span>
                </div>
            `).join('')}
        </div>
        <p class="ai-insight-text">${productivity.patternInsight}</p>
    `;
}

// =====================================================
// AI Assistant — On-demand suggestions via chat
// =====================================================

function setupAssistant() {
    const input = document.getElementById('assistantInput');
    if (input) {
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleAssistantQuery();
            }
        });
    }
}

async function handleAssistantQuery() {
    const input = document.getElementById('assistantInput');
    const query = input.value.trim();
    if (!query || !analysisResults) return;

    // Rate limit check
    if (typeof AIRateLimiter !== 'undefined') {
        const check = AIRateLimiter.check();
        if (!check.allowed) {
            addMessage('user', query);
            input.value = '';
            addMessage('bot', check.message);
            return;
        }
    }

    // Add user message
    addMessage('user', query);
    input.value = '';
    input.disabled = true;

    // Show thinking indicator
    const thinkingId = addThinking();

    try {
        // Call Gemini API
        const aiResponse = await callGemini(query, analysisResults);

        // Remove thinking indicator
        removeThinking(thinkingId);

        if (aiResponse) {
            addMessage('bot', formatGeminiResponse(aiResponse));
        } else {
            // Fallback to local keyword matcher
            addMessage('bot', generateResponse(query));
        }
    } catch (err) {
        removeThinking(thinkingId);
        addMessage('bot', generateResponse(query));
    }

    input.disabled = false;
    input.focus();
}

function addMessage(type, content) {
    const container = document.getElementById('assistantMessages');
    const msg = document.createElement('div');
    msg.className = `assistant-msg ${type}`;

    if (type === 'user') {
        msg.innerHTML = `
            <div class="msg-content user-msg"><p>${escapeHtml(content)}</p></div>
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

let thinkingCounter = 0;

function addThinking() {
    const id = 'thinking-' + (++thinkingCounter);
    const container = document.getElementById('assistantMessages');
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

function removeThinking(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function generateResponse(query) {
    const q = query.toLowerCase();
    const clusters = analysisResults.clusters;
    const suggestions = analysisResults.suggestions;
    const forecasts = analysisResults.forecasts;
    const productivity = analysisResults.productivity;
    const nlp = analysisResults.nlpResults;

    // Sort goals by completion
    const sorted = [...clusters].sort((a, b) => a.features.completionRate - b.features.completionRate);
    const weakest = sorted[0];
    const strongest = sorted[sorted.length - 1];

    // --- Intent matching ---

    // Suggestions / recommend
    if (q.includes('suggest') || q.includes('recommend') || q.includes('advice') || q.includes('tip')) {
        const top3 = suggestions.slice(0, 3);
        const items = top3.map(s => `<strong>${s.title}</strong> — ${s.message} <em>(${s.confidence}% confidence)</em>`).join('<br><br>');
        return `Here are my top suggestions based on your habit patterns:<br><br>${items}`;
    }

    // Weakest / worst / struggling
    if (q.includes('weak') || q.includes('worst') || q.includes('struggl') || q.includes('attention') || q.includes('behind')) {
        const needsAttention = sorted.slice(0, 3);
        const list = needsAttention.map(g =>
            `<strong>${g.goal.title}</strong> — ${Math.round(g.features.completionRate * 100)}% completion`
        ).join('<br>');
        return `These habits need the most attention:<br><br>${list}<br><br>Consider breaking them into smaller daily targets or pairing them with an existing strong habit.`;
    }

    // Strongest / best
    if (q.includes('strong') || q.includes('best') || q.includes('top') || q.includes('doing well')) {
        const topGoals = sorted.slice(-3).reverse();
        const list = topGoals.map(g =>
            `<strong>${g.goal.title}</strong> — ${Math.round(g.features.completionRate * 100)}% completion`
        ).join('<br>');
        return `Your strongest habits are:<br><br>${list}<br><br>Great consistency! Try to replicate the strategies from these into your weaker habits.`;
    }

    // Improve
    if (q.includes('improv') || q.includes('better') || q.includes('how can i')) {
        const key = suggestions[0] || { title: 'Focus', message: 'Start with your weakest habit and track it daily.' };
        return `To improve, my top recommendation is:<br><br><strong>${key.title}</strong> — ${key.message}<br><br>Also, your weakest habit is <strong>${weakest.goal.title}</strong> at ${Math.round(weakest.features.completionRate * 100)}%. Focus on building a daily streak there first.`;
    }

    // Schedule / when / peak / productive
    if (q.includes('when') || q.includes('schedule') || q.includes('peak') || q.includes('productive') || q.includes('day')) {
        return `Your most productive day is <strong>${productivity.peakDay}</strong>, and your lowest is <strong>${productivity.lowDay}</strong>.<br><br>${productivity.patternInsight}<br><br>Try scheduling difficult habits on ${productivity.peakDay}s when your momentum is highest.`;
    }

    // Forecast / predict / future
    if (q.includes('forecast') || q.includes('predict') || q.includes('future') || q.includes('trend')) {
        const meaningful = forecasts.filter(f => f.trend !== 'insufficient-data');
        if (meaningful.length === 0) {
            return `I need at least 3 days of tracking data to forecast your habits. Keep tracking and ask me again later!`;
        }
        const lines = meaningful.slice(0, 3).map(f =>
            `<strong>${f.goal.title}</strong> — ${f.trendLabel} (strength: ${f.habitStrength}/100)`
        ).join('<br>');
        return `Here's the outlook for your tracked habits:<br><br>${lines}<br><br>Check the Habit Forecast section below for detailed charts.`;
    }

    // Category / balance
    if (q.includes('category') || q.includes('balance') || q.includes('work') || q.includes('personal')) {
        const catSugg = suggestions.find(s => s.type === 'category' || s.title.toLowerCase().includes('category'));
        if (catSugg) {
            return `<strong>${catSugg.title}</strong><br><br>${catSugg.message}`;
        }
        return `Your habits seem evenly distributed. Try adding more variety if you feel stuck in one area.`;
    }

    // Goal quality
    if (q.includes('smart') || q.includes('quality') || q.includes('goal name') || q.includes('title')) {
        const lowQuality = nlp.filter(r => r.smart.overall < 50).slice(0, 3);
        if (lowQuality.length > 0) {
            const list = lowQuality.map(r =>
                `<strong>${r.goal.title}</strong> — SMART score: ${r.smart.overall}/100. ${r.tips[0]?.text || ''}`
            ).join('<br><br>');
            return `Some of your goal titles could be more specific:<br><br>${list}<br><br>Well-defined goals with clear metrics are easier to stick to.`;
        }
        return `Your goals are well-written! Most score above 50 on the SMART framework. Check the Goal Quality table below for details.`;
    }

    // Fallback — give overview
    const avgCompletion = Math.round(clusters.reduce((s, g) => s + g.features.completionRate, 0) / clusters.length * 100);
    return `I'm not sure what you're asking, but here's a quick overview:<br><br>You're tracking <strong>${clusters.length} goals</strong> with an average completion of <strong>${avgCompletion}%</strong>. Your peak day is <strong>${productivity.peakDay}</strong> and your strongest habit is <strong>${strongest.goal.title}</strong>.<br><br>Try asking: <em>"Give me suggestions"</em>, <em>"What's my weakest habit?"</em>, <em>"When am I most productive?"</em>, or <em>"How can I improve?"</em>`;
}

// =====================================================
// Forecasts - Only goals with data, cleaner layout
// =====================================================

function renderForecasts(forecasts) {
    const container = document.getElementById('forecastContent');

    // Filter to only goals that have enough data and are not completed
    let meaningful = forecasts.filter(f => f.trend !== 'insufficient-data');
    if (!showCompletedAI) {
        meaningful = meaningful.filter(f => !isGoalCompletedAI(f.goal));
    }
    const noData = forecasts.filter(f => f.trend === 'insufficient-data');

    if (meaningful.length === 0) {
        container.innerHTML = `<p class="ai-empty-note">Track your goals for at least 3 days to see forecasts here.</p>`;
        return;
    }

    container.innerHTML = `
        <div class="forecast-clean-grid">
            ${meaningful.map((f, i) => `
                <div class="forecast-clean-card">
                    <div class="forecast-clean-header">
                        <span class="forecast-clean-title">${f.goal.title}</span>
                        <span class="trend-pill trend-${f.trend}">${f.trendLabel}</span>
                    </div>
                    <div class="forecast-strength-row">
                        <div class="strength-track">
                            <div class="strength-fill" style="width:${f.habitStrength}%; background:${f.habitStrength >= 70 ? '#22c55e' : f.habitStrength >= 40 ? '#eab308' : '#ef4444'}"></div>
                        </div>
                        <span class="strength-num">${f.habitStrength}</span>
                    </div>
                    <div class="forecast-chart-wrap">
                        <canvas id="fc${i}"></canvas>
                    </div>
                    <p class="forecast-note">${f.message}</p>
                </div>
            `).join('')}
        </div>
        ${noData.length > 0 ? `
            <p class="ai-muted-note">${noData.length} goal${noData.length > 1 ? 's' : ''} need more tracking data for forecasting.</p>
        ` : ''}
    `;

    // Draw charts
    meaningful.forEach((f, i) => {
        const canvas = document.getElementById(`fc${i}`);
        if (!canvas || !f.forecast.length) return;

        const hLabels = f.historicalRates.map(h => {
            const d = new Date(h.date);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        });
        const hData = f.historicalRates.map(h => h.rate);
        const fLabels = f.forecast.map(fc => fc.dayLabel);
        const fData = f.forecast.map(fc => Math.round(fc.probability * 100));

        const labels = [...hLabels, '', ...fLabels];
        const hist = [...hData, null, ...Array(fData.length).fill(null)];
        const fore = [...Array(hData.length).fill(null), hData[hData.length - 1] || 0, ...fData];

        forecastCharts[`c${i}`] = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'History',
                        data: hist,
                        borderColor: '#7c3aed',
                        backgroundColor: 'rgba(99,102,241,0.06)',
                        borderWidth: 2, fill: true, tension: 0.4,
                        pointRadius: 2, pointBackgroundColor: '#7c3aed'
                    },
                    {
                        label: 'Forecast',
                        data: fore,
                        borderColor: '#22c55e',
                        backgroundColor: 'rgba(34,197,94,0.04)',
                        borderWidth: 2, borderDash: [5, 3], fill: true, tension: 0.4,
                        pointRadius: 3, pointBackgroundColor: '#22c55e',
                        pointBorderColor: '#0a0a0f', pointBorderWidth: 1.5
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#111118',
                        titleColor: '#f1f5f9',
                        bodyColor: '#94a3b8',
                        borderColor: 'rgba(99,102,241,0.2)',
                        borderWidth: 1, padding: 8,
                        displayColors: false,
                        callbacks: { label: c => `${c.dataset.label}: ${c.raw}%` }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#475569', font: { size: 9 }, maxRotation: 0 } },
                    y: { beginAtZero: true, max: 100, grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#475569', font: { size: 9 }, callback: v => v + '%', stepSize: 25 } }
                }
            }
        });
    });
}

// =====================================================
// NLP - Clean table layout
// =====================================================

function renderNLP(nlpResults) {
    const container = document.getElementById('nlpContent');

    container.innerHTML = `
        <div class="nlp-table">
            <div class="nlp-table-head">
                <span class="nlp-th goal-col">Goal</span>
                <span class="nlp-th">S</span>
                <span class="nlp-th">M</span>
                <span class="nlp-th">A</span>
                <span class="nlp-th">R</span>
                <span class="nlp-th">T</span>
                <span class="nlp-th score-col">Score</span>
                <span class="nlp-th tip-col">Suggestion</span>
            </div>
            ${(showCompletedAI ? nlpResults : nlpResults.filter(r => !isGoalCompletedAI(r.goal))).map(r => {
        const s = r.smart.scores;
        const tip = r.tips[0] || { text: 'Well-formed goal' };
        return `
                    <div class="nlp-table-row">
                        <span class="nlp-td goal-col">${r.goal.title}</span>
                        <span class="nlp-td"><span class="smart-dot" style="background:${dotColor(s.specific)}"></span></span>
                        <span class="nlp-td"><span class="smart-dot" style="background:${dotColor(s.measurable)}"></span></span>
                        <span class="nlp-td"><span class="smart-dot" style="background:${dotColor(s.achievable)}"></span></span>
                        <span class="nlp-td"><span class="smart-dot" style="background:${dotColor(s.relevant)}"></span></span>
                        <span class="nlp-td"><span class="smart-dot" style="background:${dotColor(s.timeBound)}"></span></span>
                        <span class="nlp-td score-col"><strong style="color:${dotColor(r.smart.overall)}">${r.smart.overall}</strong></span>
                        <span class="nlp-td tip-col">${tip.text}</span>
                    </div>
                `;
    }).join('')}
        </div>
        <div class="nlp-legend">
            <span><span class="smart-dot" style="background:#22c55e"></span> 70+ Good</span>
            <span><span class="smart-dot" style="background:#eab308"></span> 40-69 Fair</span>
            <span><span class="smart-dot" style="background:#ef4444"></span> 0-39 Weak</span>
            <span class="nlp-legend-label">S=Specific M=Measurable A=Achievable R=Relevant T=Time-bound</span>
        </div>
    `;
}

function dotColor(score) {
    if (score >= 70) return '#22c55e';
    if (score >= 40) return '#eab308';
    return '#ef4444';
}

// =====================================================
// Utilities
// =====================================================

function showToast(message) {
    const msg = toast.querySelector('.toast-message');
    msg.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}

// =====================================================
// Init
// =====================================================

document.addEventListener('DOMContentLoaded', () => syncAndAnalyze());
