/**
 * getItRight — AI Client via OpenRouter (gemini.js)
 * Calls Google Gemini 2.0 Flash through OpenRouter for intelligent habit coaching.
 *
 * SECURITY: When deploying to production, set GEMINI_PROXY_URL to your own
 * server-side proxy (e.g. Supabase Edge Function) so the API key is never
 * exposed in client code.
 */

// =====================================================
// Configuration
// =====================================================

/**
 * Set this to your server-side proxy URL to keep the API key safe.
 * Example: 'https://your-project.supabase.co/functions/v1/ai-proxy'
 * When set, all AI calls go through the proxy and no API key is sent client-side.
 * When null/empty, falls back to direct OpenRouter calls (dev mode only).
 */
const GEMINI_PROXY_URL = null;

// Direct-mode config (only used when GEMINI_PROXY_URL is not set)
const OPENROUTER_API_KEY = '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';
const AI_MODEL = 'google/gemini-2.0-flash-001';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Warn once about exposed key in direct mode
let _keyWarningShown = false;
function _warnDirectMode() {
    if (!_keyWarningShown && !GEMINI_PROXY_URL) {
        console.warn(
            '⚠️ [getItRight] AI calls are using a client-side API key (direct mode). ' +
            'For production, set GEMINI_PROXY_URL in gemini.js to route calls through a server-side proxy.'
        );
        _keyWarningShown = true;
    }
}

const SYSTEM_PROMPT = `You are the AI coach inside "getItRight", a personal habit tracker app. You help users understand and improve their habits.

RULES:
- Keep responses SHORT (2-4 sentences max). Be punchy and motivating.
- Use the habit data provided to give SPECIFIC, personalized advice.
- Reference actual habit names, completion rates, and trends from the data.
- Use bold (**text**) for habit names and key stats.
- Don't use markdown headers or bullet lists — keep it conversational.
- If asked something unrelated to habits, politely redirect.
- Be encouraging but honest about weak areas.`;

/**
 * Build a comprehensive summary of the user's habit data for AI context
 * Includes all analysis from ai-engine.js: clusters, forecasts, NLP, productivity
 */
function buildHabitContext(analysisResults) {
    if (!analysisResults) return 'No habit data available yet.';

    const { clusters, forecasts, productivity, suggestions, nlpResults } = analysisResults;

    // ── Detailed per-goal breakdown ──
    const goalDetails = clusters.map(c => {
        const f = c.features;
        const rate = Math.round(f.completionRate * 100);
        const consistency = Math.round((f.consistency || 0) * 100);
        const streak = f.currentStreak || 0;
        const trend = f.trendSlope > 0.01 ? 'improving' : f.trendSlope < -0.01 ? 'declining' : 'stable';
        return `• ${c.goal.title} [${c.goal.category}, ${c.goal.priority} priority, ${c.goal.effort} effort]
    Completion: ${rate}% | Consistency: ${consistency}% | Streak: ${streak}d | Trend: ${trend} | Cluster: "${c.clusterLabel}"
    Schedule: ${c.goal.timePerDay}min/day, ${c.goal.frequency}x/week | Total tracked days: ${(c.goal.dailyProgress || []).length}`;
    }).join('\n');

    // ── Productivity patterns ──
    let prodSection = '';
    if (productivity && productivity.peakDay && productivity.peakDay !== 'Unknown') {
        prodSection = `Peak day: ${productivity.peakDay} | Lowest day: ${productivity.lowDay}
${productivity.patternInsight || ''}`;
        if (productivity.dayBreakdown) {
            const days = Object.entries(productivity.dayBreakdown)
                .map(([day, count]) => `${day}: ${count}`)
                .join(', ');
            prodSection += `\nDay breakdown: ${days}`;
        }
    }

    // ── Forecasts ──
    const forecastLines = (forecasts || [])
        .filter(f => f.trend !== 'insufficient-data')
        .map(f => `• ${f.goal.title}: trend=${f.trendLabel}, habit strength=${f.habitStrength}/100, predicted next week: ${f.predictedCompletion || 'N/A'}%`)
        .join('\n');

    // ── NLP / SMART goal quality ──
    const nlpLines = (nlpResults || [])
        .map(r => `• ${r.goal.title}: SMART score=${r.smart?.overall || 'N/A'}/100, sentiment=${r.sentiment?.label || 'neutral'}${r.tips?.length ? ', tip: ' + r.tips[0]?.text : ''}`)
        .join('\n');

    // ── Suggestions from collaborative filtering ──
    const suggestionLines = (suggestions || []).slice(0, 5)
        .map(s => `• ${s.title}: ${s.message} (confidence: ${s.confidence}%)`)
        .join('\n');

    // ── Category distribution ──
    const categories = {};
    clusters.forEach(c => {
        const cat = c.goal.category || 'personal';
        categories[cat] = (categories[cat] || 0) + 1;
    });
    const catLine = Object.entries(categories).map(([k, v]) => `${k}: ${v}`).join(', ');

    return `FULL HABIT ANALYSIS (${clusters.length} goals, categories: ${catLine}):

GOALS:
${goalDetails}

PRODUCTIVITY:
${prodSection || 'Not enough data for day-of-week analysis yet'}

FORECASTS:
${forecastLines || 'Not enough tracking data for forecasts yet'}

GOAL QUALITY (NLP/SMART):
${nlpLines || 'No NLP data'}

AI SUGGESTIONS:
${suggestionLines || 'No suggestions generated yet'}`;
}

/**
 * Call AI via OpenRouter (or proxy) with the user's question + habit context.
 * Integrates with AIRateLimiter from shared.js when available.
 * Returns the AI response text, or null on failure.
 */
async function callGemini(userQuery, analysisResults) {
    // Rate limit check (shared.js must be loaded)
    if (typeof AIRateLimiter !== 'undefined') {
        const check = AIRateLimiter.check();
        if (!check.allowed) {
            console.warn('AI rate limited:', check.message);
            return null;
        }
    }

    const habitContext = buildHabitContext(analysisResults);

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${habitContext}\n\n---\nUser question: ${userQuery}` }
    ];

    try {
        let res;

        if (GEMINI_PROXY_URL) {
            // ── Proxy mode: send to your own server (no API key in client) ──
            res = await fetch(GEMINI_PROXY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages, max_tokens: 300, temperature: 0.7 })
            });
        } else {
            // ── Direct mode: call OpenRouter directly (dev only) ──
            _warnDirectMode();
            res = await fetch(OPENROUTER_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`
                },
                body: JSON.stringify({
                    model: AI_MODEL,
                    messages,
                    max_tokens: 300,
                    temperature: 0.7
                })
            });
        }

        if (!res.ok) {
            console.error('AI API error:', res.status, await res.text());
            return null;
        }

        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;

        // Record successful call with rate limiter
        if (typeof AIRateLimiter !== 'undefined') {
            AIRateLimiter.record();
        }

        return text || null;
    } catch (err) {
        console.error('AI fetch failed:', err);
        return null;
    }
}

/**
 * Convert markdown bold (**text**) to HTML <strong> tags
 */
function formatGeminiResponse(text) {
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
}
