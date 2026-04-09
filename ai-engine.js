/**
 * AI Engine - Intelligent Habit Analysis Algorithms
 * =====================================================
 * Implements 4 ML algorithms in pure client-side JavaScript:
 *   1. K-Means Clustering      — Groups habits by behavioral similarity
 *   2. Collaborative Filtering — Intra-user goal similarity recommendations
 *   3. Time Series Forecasting — Predicts future habit adherence
 *   4. NLP Text Analysis        — Analyzes goal titles for SMART quality
 * =====================================================
 */

const AIEngine = (() => {

    // =====================================================
    // Utility Helpers
    // =====================================================

    function euclideanDistance(a, b) {
        let sum = 0;
        for (let i = 0; i < a.length; i++) {
            sum += (a[i] - b[i]) ** 2;
        }
        return Math.sqrt(sum);
    }

    function cosineSimilarity(a, b) {
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] ** 2;
            normB += b[i] ** 2;
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom === 0 ? 0 : dot / denom;
    }

    function normalize(values) {
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min;
        return range === 0 ? values.map(() => 0.5) : values.map(v => (v - min) / range);
    }

    function mean(arr) {
        return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
    }

    function stdDev(arr) {
        if (arr.length < 2) return 0;
        const m = mean(arr);
        return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
    }

    function linearRegression(ys) {
        const n = ys.length;
        if (n < 2) return { slope: 0, intercept: ys[0] || 0 };
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        for (let i = 0; i < n; i++) {
            sumX += i;
            sumY += ys[i];
            sumXY += i * ys[i];
            sumX2 += i * i;
        }
        const denom = n * sumX2 - sumX * sumX;
        const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
        const intercept = (sumY - slope * sumX) / n;
        return { slope, intercept };
    }

    // =====================================================
    // Feature Extraction from Goals
    // =====================================================

    function extractFeatures(goal) {
        const totalDays = calculateTotalDays(goal.startDate, goal.endDate);
        const completedDays = goal.dailyProgress.length;
        const completionRate = totalDays > 0 ? completedDays / totalDays : 0;

        // Consistency: how regular are completions (std dev of gaps between completions)
        const sortedDates = [...goal.dailyProgress].sort();
        const gaps = [];
        for (let i = 1; i < sortedDates.length; i++) {
            const diff = (new Date(sortedDates[i]) - new Date(sortedDates[i - 1])) / (1000 * 60 * 60 * 24);
            gaps.push(diff);
        }
        const consistency = gaps.length > 0 ? 1 / (1 + stdDev(gaps)) : 0;

        // Time investment ratio
        const timePerDayHours = (goal.timePerDay || 60) / 60;
        const totalHoursInvested = completedDays * timePerDayHours;
        const totalHoursTarget = totalDays * timePerDayHours;
        const timeInvestmentRate = totalHoursTarget > 0 ? totalHoursInvested / totalHoursTarget : 0;

        // Priority & effort as numeric scores
        const priorityMap = { low: 0.25, medium: 0.5, high: 0.75, critical: 1.0 };
        const effortMap = { easy: 0.25, medium: 0.5, hard: 1.0 };
        const priorityScore = priorityMap[goal.priority] || 0.5;
        const effortScore = effortMap[goal.effort] || 0.5;

        // Streak: longest consecutive completion streak
        let maxStreak = 0, currentStreak = 0;
        const allDates = generateDateRange(goal.startDate, goal.endDate);
        for (const date of allDates) {
            if (goal.dailyProgress.includes(date)) {
                currentStreak++;
                maxStreak = Math.max(maxStreak, currentStreak);
            } else {
                currentStreak = 0;
            }
        }
        const streakScore = totalDays > 0 ? maxStreak / totalDays : 0;

        // Day-of-week pattern (which days are most active)
        const dayOfWeekCounts = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
        goal.dailyProgress.forEach(d => {
            dayOfWeekCounts[new Date(d).getDay()]++;
        });

        return {
            completionRate,
            consistency,
            timeInvestmentRate,
            priorityScore,
            effortScore,
            streakScore,
            dayOfWeekCounts,
            featureVector: [completionRate, consistency, timeInvestmentRate, priorityScore, effortScore, streakScore]
        };
    }

    function calculateTotalDays(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        return Math.ceil(Math.abs(end - start) / (1000 * 60 * 60 * 24)) + 1;
    }

    function generateDateRange(startDate, endDate) {
        const dates = [];
        const current = new Date(startDate);
        const end = new Date(endDate);
        while (current <= end) {
            dates.push(current.toISOString().split('T')[0]);
            current.setDate(current.getDate() + 1);
        }
        return dates;
    }

    // =====================================================
    // 1. K-Means Clustering
    // =====================================================
    // Groups habits into behavioral clusters based on:
    // completionRate, consistency, timeInvestment, priority, effort, streak

    function kMeansClustering(goals, k = 3, maxIterations = 50) {
        if (goals.length < k) {
            // Not enough goals to cluster, assign all to one cluster
            return goals.map(goal => ({
                goal,
                cluster: 0,
                clusterLabel: 'Your Habits',
                features: extractFeatures(goal)
            }));
        }

        // Extract feature vectors
        const items = goals.map(goal => ({
            goal,
            features: extractFeatures(goal),
            vector: null,
            cluster: -1
        }));

        // Normalize each feature dimension
        const dimensions = items[0].features.featureVector.length;
        const columns = [];
        for (let d = 0; d < dimensions; d++) {
            columns.push(normalize(items.map(item => item.features.featureVector[d])));
        }
        items.forEach((item, i) => {
            item.vector = columns.map(col => col[i]);
        });

        // Initialize centroids using K-Means++ strategy
        const centroids = [];
        // Pick first centroid randomly
        centroids.push([...items[Math.floor(Math.random() * items.length)].vector]);

        for (let c = 1; c < k; c++) {
            const distances = items.map(item => {
                const minDist = Math.min(...centroids.map(cent => euclideanDistance(item.vector, cent)));
                return minDist * minDist;
            });
            const totalDist = distances.reduce((s, d) => s + d, 0);
            let r = Math.random() * totalDist;
            for (let i = 0; i < items.length; i++) {
                r -= distances[i];
                if (r <= 0) {
                    centroids.push([...items[i].vector]);
                    break;
                }
            }
            if (centroids.length <= c) {
                centroids.push([...items[Math.floor(Math.random() * items.length)].vector]);
            }
        }

        // Iterate
        for (let iter = 0; iter < maxIterations; iter++) {
            let changed = false;

            // Assign to nearest centroid
            items.forEach(item => {
                let minDist = Infinity;
                let bestCluster = 0;
                centroids.forEach((cent, ci) => {
                    const dist = euclideanDistance(item.vector, cent);
                    if (dist < minDist) {
                        minDist = dist;
                        bestCluster = ci;
                    }
                });
                if (item.cluster !== bestCluster) {
                    item.cluster = bestCluster;
                    changed = true;
                }
            });

            if (!changed) break;

            // Recompute centroids
            for (let c = 0; c < k; c++) {
                const members = items.filter(item => item.cluster === c);
                if (members.length === 0) continue;
                for (let d = 0; d < dimensions; d++) {
                    centroids[c][d] = mean(members.map(m => m.vector[d]));
                }
            }
        }

        // Label clusters based on average completion rate
        const clusterStats = [];
        for (let c = 0; c < k; c++) {
            const members = items.filter(item => item.cluster === c);
            const avgCompletion = mean(members.map(m => m.features.completionRate));
            const avgConsistency = mean(members.map(m => m.features.consistency));
            const avgStreak = mean(members.map(m => m.features.streakScore));
            clusterStats.push({ cluster: c, avgCompletion, avgConsistency, avgStreak, count: members.length });
        }

        // Sort clusters by performance
        clusterStats.sort((a, b) => b.avgCompletion - a.avgCompletion);
        const clusterLabels = {};
        const clusterDescriptions = {};
        const clusterColors = {};

        clusterStats.forEach((stat, rank) => {
            if (rank === 0) {
                clusterLabels[stat.cluster] = '🏆 Strong Habits';
                clusterDescriptions[stat.cluster] = `High performers — ${Math.round(stat.avgCompletion * 100)}% avg completion, great consistency`;
                clusterColors[stat.cluster] = '#22c55e';
            } else if (rank === clusterStats.length - 1) {
                clusterLabels[stat.cluster] = '⚠️ Needs Attention';
                clusterDescriptions[stat.cluster] = `Low adherence — ${Math.round(stat.avgCompletion * 100)}% avg completion, consider restructuring`;
                clusterColors[stat.cluster] = '#ef4444';
            } else {
                clusterLabels[stat.cluster] = '📈 Building Habits';
                clusterDescriptions[stat.cluster] = `Developing — ${Math.round(stat.avgCompletion * 100)}% avg completion, showing progress`;
                clusterColors[stat.cluster] = '#eab308';
            }
        });

        return items.map(item => ({
            goal: item.goal,
            cluster: item.cluster,
            clusterLabel: clusterLabels[item.cluster],
            clusterDescription: clusterDescriptions[item.cluster],
            clusterColor: clusterColors[item.cluster],
            features: item.features
        }));
    }

    // =====================================================
    // 2. Intra-User Collaborative Filtering
    // =====================================================
    // Compares user's goals against each other using cosine similarity
    // to find patterns and suggest strategies from high-performing goals

    function collaborativeFiltering(goals) {
        if (goals.length < 2) {
            return [{
                type: 'info',
                icon: '📝',
                title: 'Add More Goals',
                message: 'Add at least 2 goals to get personalized habit-building suggestions.',
                confidence: 0
            }];
        }

        const items = goals.map(goal => ({
            goal,
            features: extractFeatures(goal)
        }));

        // Build similarity matrix
        const similarities = [];
        for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
                const sim = cosineSimilarity(
                    items[i].features.featureVector,
                    items[j].features.featureVector
                );
                similarities.push({
                    goalA: items[i],
                    goalB: items[j],
                    similarity: sim
                });
            }
        }

        similarities.sort((a, b) => b.similarity - a.similarity);

        const suggestions = [];

        // Category-level analysis
        const categoryMap = {};
        items.forEach(item => {
            const cat = item.goal.category || 'personal';
            if (!categoryMap[cat]) categoryMap[cat] = [];
            categoryMap[cat].push(item);
        });

        // Find best & worst performing categories
        const categoryPerformance = Object.entries(categoryMap).map(([cat, catItems]) => ({
            category: cat,
            avgCompletion: mean(catItems.map(i => i.features.completionRate)),
            count: catItems.length
        }));
        categoryPerformance.sort((a, b) => b.avgCompletion - a.avgCompletion);

        if (categoryPerformance.length >= 2) {
            const best = categoryPerformance[0];
            const worst = categoryPerformance[categoryPerformance.length - 1];
            if (best.avgCompletion > worst.avgCompletion + 0.15) {
                suggestions.push({
                    type: 'category-insight',
                    icon: '🎯',
                    title: 'Category Performance Gap',
                    message: `Your "${best.category}" habits perform at ${Math.round(best.avgCompletion * 100)}% while "${worst.category}" is at ${Math.round(worst.avgCompletion * 100)}%. Try applying the same scheduling pattern from "${best.category}" goals to your "${worst.category}" goals.`,
                    confidence: Math.round(Math.min((best.avgCompletion - worst.avgCompletion) * 200, 95))
                });
            }
        }

        // Similar goal pair insights
        for (const pair of similarities.slice(0, 3)) {
            const better = pair.goalA.features.completionRate >= pair.goalB.features.completionRate
                ? pair.goalA : pair.goalB;
            const weaker = better === pair.goalA ? pair.goalB : pair.goalA;

            if (better.features.completionRate > weaker.features.completionRate + 0.1 && pair.similarity > 0.5) {
                // Analyze what makes the better one succeed
                const betterDays = getMostActiveDays(better.features.dayOfWeekCounts);
                const weakerDays = getMostActiveDays(weaker.features.dayOfWeekCounts);

                let strategy = '';
                if (better.features.consistency > weaker.features.consistency + 0.1) {
                    strategy = `"${better.goal.title}" succeeds because of more consistent daily practice. `;
                }
                if (betterDays.join(',') !== weakerDays.join(',')) {
                    strategy += `Try doing "${weaker.goal.title}" on ${betterDays.join(', ')} when you're already in a productive flow.`;
                } else {
                    strategy += `Stack "${weaker.goal.title}" right after "${better.goal.title}" to leverage your momentum.`;
                }

                suggestions.push({
                    type: 'habit-stack',
                    icon: '🔗',
                    title: `Link: ${truncate(weaker.goal.title, 20)} ↔ ${truncate(better.goal.title, 20)}`,
                    message: strategy,
                    confidence: Math.round(pair.similarity * 100),
                    similarity: pair.similarity
                });
            }
        }

        // Day-of-week pattern insights
        const globalDayCounts = [0, 0, 0, 0, 0, 0, 0];
        items.forEach(item => {
            item.features.dayOfWeekCounts.forEach((c, i) => globalDayCounts[i] += c);
        });
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const peakDayIndex = globalDayCounts.indexOf(Math.max(...globalDayCounts));
        const weakDayIndex = globalDayCounts.indexOf(Math.min(...globalDayCounts));

        if (globalDayCounts[peakDayIndex] > globalDayCounts[weakDayIndex] * 2) {
            suggestions.push({
                type: 'schedule',
                icon: '📅',
                title: 'Peak Productivity Day',
                message: `You're most productive on ${dayNames[peakDayIndex]}s and least active on ${dayNames[weakDayIndex]}s. Consider scheduling your hardest goals on ${dayNames[peakDayIndex]}s.`,
                confidence: 75
            });
        }

        // Effort-based insights
        const effortGroups = { easy: [], medium: [], hard: [] };
        items.forEach(item => {
            const effort = item.goal.effort || 'medium';
            if (effortGroups[effort]) effortGroups[effort].push(item);
        });

        const hardGoals = effortGroups.hard;
        const easyGoals = effortGroups.easy;
        if (hardGoals.length > 0 && easyGoals.length > 0) {
            const hardAvg = mean(hardGoals.map(g => g.features.completionRate));
            const easyAvg = mean(easyGoals.map(g => g.features.completionRate));
            if (easyAvg > hardAvg + 0.2) {
                suggestions.push({
                    type: 'effort-balance',
                    icon: '⚖️',
                    title: 'Effort Balance Insight',
                    message: `Your easy goals have ${Math.round(easyAvg * 100)}% completion vs ${Math.round(hardAvg * 100)}% for hard goals. Try breaking hard goals into smaller daily targets to improve adherence.`,
                    confidence: 80
                });
            }
        }

        // If no significant insights, provide generic encouragement
        if (suggestions.length === 0) {
            const overallCompletion = mean(items.map(i => i.features.completionRate));
            suggestions.push({
                type: 'general',
                icon: '✨',
                title: 'Good Consistency',
                message: `Your habits show balanced patterns with ${Math.round(overallCompletion * 100)}% average completion. Keep consistently tracking to unlock deeper insights!`,
                confidence: 60
            });
        }

        return suggestions;
    }

    function getMostActiveDays(dayOfWeekCounts) {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const avg = mean(dayOfWeekCounts);
        const activeDays = [];
        dayOfWeekCounts.forEach((count, i) => {
            if (count > avg) activeDays.push(dayNames[i]);
        });
        return activeDays.length > 0 ? activeDays : ['weekdays'];
    }

    function truncate(str, len) {
        return str.length > len ? str.substring(0, len) + '...' : str;
    }

    // =====================================================
    // 3. Time Series Forecasting
    // =====================================================
    // Uses Exponential Smoothing + Linear Trend to predict
    // next 7 days of habit adherence per goal

    function timeSeriesForecasting(goals) {
        return goals.map(goal => {
            const features = extractFeatures(goal);
            // Cap at today — don't include future dates in the series
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];
            const effectiveEnd = goal.endDate && goal.endDate < todayStr ? goal.endDate : todayStr;
            const allDates = generateDateRange(goal.startDate, effectiveEnd);

            // Build daily binary series (1 = completed, 0 = missed)
            const series = allDates.map(d => goal.dailyProgress.includes(d) ? 1 : 0);

            if (series.length < 3) {
                return {
                    goal,
                    forecast: [],
                    trend: 'insufficient-data',
                    trendLabel: 'Need More Data',
                    trendIcon: '📊',
                    habitStrength: 0,
                    historicalRates: [],
                    message: 'Track for at least 3 days to get forecasts.'
                };
            }

            // Calculate 7-day rolling completion rate
            const windowSize = Math.min(7, series.length);
            const rollingRates = [];
            for (let i = windowSize - 1; i < series.length; i++) {
                const window = series.slice(i - windowSize + 1, i + 1);
                rollingRates.push(mean(window));
            }

            // Exponential Smoothing (alpha = 0.3)
            const alpha = 0.3;
            const smoothed = [rollingRates[0]];
            for (let i = 1; i < rollingRates.length; i++) {
                smoothed.push(alpha * rollingRates[i] + (1 - alpha) * smoothed[i - 1]);
            }

            // Linear regression on smoothed values for trend
            const recentWindow = smoothed.slice(-Math.min(14, smoothed.length));
            const { slope, intercept } = linearRegression(recentWindow);

            // Forecast next 7 days
            const forecast = [];
            const forecastStart = new Date();
            for (let i = 1; i <= 7; i++) {
                const forecastDate = new Date(forecastStart);
                forecastDate.setDate(forecastStart.getDate() + i);
                const projectedValue = intercept + slope * (recentWindow.length + i - 1);
                forecast.push({
                    date: forecastDate.toISOString().split('T')[0],
                    dayLabel: forecastDate.toLocaleDateString('en-US', { weekday: 'short' }),
                    probability: Math.max(0, Math.min(1, projectedValue)),
                    confidence: Math.max(30, Math.round(100 - (i * 8))) // Confidence decreases with distance
                });
            }

            // Determine trend
            let trend, trendLabel, trendIcon;
            if (slope > 0.02) {
                trend = 'improving';
                trendLabel = 'Improving';
                trendIcon = '📈';
            } else if (slope < -0.02) {
                trend = 'declining';
                trendLabel = 'Declining';
                trendIcon = '📉';
            } else {
                trend = 'stable';
                trendLabel = 'Stable';
                trendIcon = '➡️';
            }

            // Habit Strength Score (0-100)
            const recentCompletion = mean(series.slice(-Math.min(7, series.length)));
            const habitStrength = Math.round(
                (features.completionRate * 30) +
                (features.consistency * 25) +
                (recentCompletion * 25) +
                (features.streakScore * 20)
            );

            // Build historical rate labels (last 14 data points for chart)
            const historicalRates = rollingRates.slice(-14).map((rate, i) => {
                const dateIndex = Math.max(0, allDates.length - 14 + i);
                return {
                    date: allDates[dateIndex] || '',
                    rate: Math.round(rate * 100)
                };
            });

            // Actionable message
            let message = '';
            if (trend === 'declining') {
                message = `Your adherence is trending down (${Math.round(slope * 100)}% per day). Consider reducing the daily commitment or focusing on just this goal for a few days.`;
            } else if (trend === 'improving') {
                message = `Great momentum! Your completion rate is increasing by ~${Math.round(slope * 100)}% per day. Keep this streak going!`;
            } else {
                message = `Your habit is stable at ${Math.round(recentCompletion * 100)}% daily completion. ${recentCompletion >= 0.7 ? 'Solid consistency!' : 'Try a small streak challenge to push higher.'}`;
            }

            return {
                goal,
                forecast,
                trend,
                trendLabel,
                trendIcon,
                habitStrength: Math.min(100, habitStrength),
                historicalRates,
                message,
                slope: Math.round(slope * 1000) / 1000
            };
        });
    }

    // =====================================================
    // 4. NLP-based Text Analysis
    // =====================================================
    // Lightweight AFINN-style scoring + SMART goal assessment

    // Compact AFINN-style sentiment dictionary
    const SENTIMENT_DICT = {
        // Positive words
        achieve: 3, accomplish: 3, success: 3, win: 3, excellent: 3, amazing: 3,
        great: 2, good: 2, better: 2, improve: 2, progress: 2, learn: 2, grow: 2,
        build: 2, master: 2, complete: 2, finish: 2, develop: 2, practice: 2,
        enjoy: 2, love: 2, happy: 2, strong: 2, healthy: 2, fit: 2, active: 2,
        read: 1, write: 1, study: 1, exercise: 1, meditate: 1, cook: 1, walk: 1,
        run: 1, stretch: 1, organize: 1, plan: 1, focus: 1, create: 1, start: 1,
        // Negative words
        stop: -1, quit: -1, avoid: -1, less: -1, reduce: -1, limit: -1,
        never: -2, fail: -2, struggle: -2, hard: -1, difficult: -1, boring: -2,
        hate: -3, terrible: -3, awful: -3, worst: -3, bad: -2, lazy: -2
    };

    // Action verbs that make goals specific
    const ACTION_VERBS = [
        'run', 'walk', 'read', 'write', 'study', 'exercise', 'meditate', 'cook',
        'practice', 'learn', 'build', 'create', 'complete', 'finish', 'develop',
        'achieve', 'master', 'improve', 'organize', 'plan', 'track', 'stretch',
        'train', 'eat', 'drink', 'sleep', 'wake', 'journal', 'code', 'draw',
        'paint', 'sing', 'play', 'swim', 'cycle', 'clean', 'save', 'invest',
        'call', 'connect', 'volunteer', 'teach', 'mentor', 'present', 'deliver'
    ];

    // Category keywords
    const CATEGORY_KEYWORDS = {
        health: ['exercise', 'workout', 'run', 'walk', 'gym', 'yoga', 'meditate', 'meditation',
            'sleep', 'diet', 'eat', 'healthy', 'water', 'stretch', 'weight', 'fit', 'fitness',
            'swim', 'cycle', 'jog', 'calories', 'nutrition', 'vitamin'],
        learning: ['read', 'study', 'learn', 'course', 'book', 'practice', 'code', 'language',
            'math', 'science', 'skill', 'tutorial', 'lecture', 'class', 'exam', 'certification'],
        work: ['project', 'deadline', 'meeting', 'presentation', 'report', 'email', 'client',
            'task', 'review', 'deliver', 'productivity', 'office', 'team', 'manage'],
        finance: ['save', 'invest', 'budget', 'money', 'expense', 'income', 'debt', 'financial',
            'bank', 'retirement', 'stocks', 'portfolio'],
        personal: ['journal', 'gratitude', 'family', 'friend', 'hobby', 'art', 'music', 'travel',
            'garden', 'cook', 'clean', 'organize', 'declutter', 'mindful', 'pray']
    };

    const STOPWORDS = new Set([
        'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
        'on', 'with', 'at', 'by', 'from', 'and', 'or', 'but', 'not', 'so',
        'if', 'then', 'than', 'that', 'this', 'it', 'its', 'my', 'i', 'me',
        'we', 'our', 'your', 'up', 'out', 'no', 'just', 'also', 'into',
        'about', 'more', 'some', 'very', 'each', 'every', 'per', 'day', 'daily'
    ]);

    function analyzeGoalText(goal) {
        const title = (goal.title || '').toLowerCase();
        const tokens = title.split(/[\s\-_,.:;!?()]+/).filter(t => t.length > 1);
        const contentTokens = tokens.filter(t => !STOPWORDS.has(t));

        // 1. Sentiment Score
        let sentimentScore = 0;
        let sentimentWords = [];
        tokens.forEach(token => {
            if (SENTIMENT_DICT[token] !== undefined) {
                sentimentScore += SENTIMENT_DICT[token];
                sentimentWords.push({ word: token, score: SENTIMENT_DICT[token] });
            }
        });
        const sentimentLabel = sentimentScore > 1 ? 'Positive' : sentimentScore < -1 ? 'Negative' : 'Neutral';

        // 2. SMART Goal Scoring (0-100)
        const smartScores = {
            specific: 0,    // Has action verbs?
            measurable: 0,  // Has numbers/quantities?
            achievable: 0,  // Reasonable effort level?
            relevant: 0,    // Has category keywords?
            timeBound: 0    // Has date references (handled by goal dates)?
        };

        // Specific: action verbs present
        const actionVerbsFound = contentTokens.filter(t => ACTION_VERBS.includes(t));
        smartScores.specific = Math.min(100, actionVerbsFound.length * 50);

        // Measurable: contains numbers
        const hasNumbers = /\d+/.test(title);
        const hasDuration = /\d+\s*(min|minute|hour|hr|page|km|mile|rep|set|chapter|book)/i.test(title);
        smartScores.measurable = hasDuration ? 100 : hasNumbers ? 60 : 0;

        // Achievable: based on effort field
        const effortScores = { easy: 90, medium: 70, hard: 50 };
        smartScores.achievable = effortScores[goal.effort] || 70;

        // Relevant: matches a category
        let maxCategoryMatch = 0;
        let suggestedCategory = goal.category || 'personal';
        for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
            const matchCount = contentTokens.filter(t => keywords.includes(t)).length;
            if (matchCount > maxCategoryMatch) {
                maxCategoryMatch = matchCount;
                suggestedCategory = cat;
            }
        }
        smartScores.relevant = maxCategoryMatch > 0 ? Math.min(100, maxCategoryMatch * 40 + 20) : 20;

        // Time-bound: has dates set
        smartScores.timeBound = (goal.startDate && goal.endDate) ? 100 : 0;

        const overallSmartScore = Math.round(
            (smartScores.specific * 0.25) +
            (smartScores.measurable * 0.25) +
            (smartScores.achievable * 0.15) +
            (smartScores.relevant * 0.15) +
            (smartScores.timeBound * 0.20)
        );

        // 3. Actionability Tips
        const tips = [];
        if (smartScores.specific < 50) {
            tips.push({
                icon: '🎯',
                text: `Start with an action verb like "${getRandomItem(ACTION_VERBS.slice(0, 10))}" to make this goal more specific.`
            });
        }
        if (smartScores.measurable < 50) {
            tips.push({
                icon: '📏',
                text: 'Add a measurable target like "30 minutes" or "5 pages" to track progress quantitatively.'
            });
        }
        if (smartScores.relevant < 40) {
            tips.push({
                icon: '🏷️',
                text: `Consider adding context words related to "${goal.category}" to stay focused on your intent.`
            });
        }
        if (contentTokens.length < 3) {
            tips.push({
                icon: '📝',
                text: 'Make your goal more descriptive. Longer, specific goals have higher completion rates.'
            });
        }
        if (sentimentScore < 0) {
            tips.push({
                icon: '💡',
                text: 'Reframe negatively-worded goals positively. Instead of "stop" or "avoid", use "replace with" or "choose".'
            });
        }
        if (tips.length === 0) {
            tips.push({
                icon: '✅',
                text: 'Great job! This is a well-formed, actionable goal.'
            });
        }

        // 4. Keyword extraction
        const keywords = contentTokens
            .filter(t => t.length > 2)
            .filter(t => SENTIMENT_DICT[t] !== undefined || ACTION_VERBS.includes(t) ||
                Object.values(CATEGORY_KEYWORDS).flat().includes(t));

        return {
            goal,
            sentiment: { score: sentimentScore, label: sentimentLabel, words: sentimentWords },
            smart: { scores: smartScores, overall: overallSmartScore },
            tips,
            keywords: [...new Set(keywords)],
            suggestedCategory,
            tokenCount: contentTokens.length
        };
    }

    function getRandomItem(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    function nlpAnalysis(goals) {
        return goals.map(goal => analyzeGoalText(goal));
    }

    // =====================================================
    // 5. Peak Productivity Analysis
    // =====================================================
    // Builds a day-of-week × time-of-day heatmap from completions

    function peakProductivityAnalysis(goals) {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayCounts = [0, 0, 0, 0, 0, 0, 0];
        const categoryDayCounts = {};
        let totalCompletions = 0;

        goals.forEach(goal => {
            const cat = goal.category || 'personal';
            if (!categoryDayCounts[cat]) categoryDayCounts[cat] = [0, 0, 0, 0, 0, 0, 0];

            goal.dailyProgress.forEach(dateStr => {
                const day = new Date(dateStr).getDay();
                dayCounts[day]++;
                categoryDayCounts[cat][day]++;
                totalCompletions++;
            });
        });

        // Find peak and low days
        const maxCount = Math.max(...dayCounts);
        const minCount = Math.min(...dayCounts);
        const peakDay = dayNames[dayCounts.indexOf(maxCount)];
        const lowDay = dayNames[dayCounts.indexOf(minCount)];

        // Calculate weekday vs weekend ratio
        const weekdayTotal = dayCounts[1] + dayCounts[2] + dayCounts[3] + dayCounts[4] + dayCounts[5];
        const weekendTotal = dayCounts[0] + dayCounts[6];
        const weekdayAvg = weekdayTotal / 5;
        const weekendAvg = weekendTotal / 2;

        let patternInsight = '';
        if (weekdayAvg > weekendAvg * 1.5) {
            patternInsight = 'You are significantly more productive on weekdays. Consider lighter goals for weekends or use them for recovery.';
        } else if (weekendAvg > weekdayAvg * 1.5) {
            patternInsight = 'You complete more goals on weekends! Try scheduling demanding goals for Saturday/Sunday when you have more momentum.';
        } else {
            patternInsight = 'Your productivity is fairly balanced across the week. Great consistency!';
        }

        // Heatmap data (normalized 0-1)
        const heatmap = dayNames.map((name, i) => ({
            day: name,
            count: dayCounts[i],
            intensity: maxCount > 0 ? dayCounts[i] / maxCount : 0
        }));

        // Category breakdown
        const categoryBreakdown = Object.entries(categoryDayCounts).map(([cat, counts]) => ({
            category: cat,
            peakDay: dayNames[counts.indexOf(Math.max(...counts))],
            counts
        }));

        return {
            heatmap,
            peakDay,
            lowDay,
            totalCompletions,
            weekdayAvg: Math.round(weekdayAvg * 10) / 10,
            weekendAvg: Math.round(weekendAvg * 10) / 10,
            patternInsight,
            categoryBreakdown
        };
    }

    // =====================================================
    // Master Analysis Runner
    // =====================================================

    function runFullAnalysis(goals) {
        // Transform goals to the format we need
        const processedGoals = goals.map(g => ({
            id: g.id,
            title: g.title,
            category: g.category || 'personal',
            priority: g.priority || 'medium',
            effort: g.effort || 'medium',
            startDate: g.start_date || g.startDate,
            endDate: g.end_date || g.endDate,
            timePerDay: g.time_per_day || g.timePerDay || 60,
            frequency: g.frequency || 7,
            dailyProgress: g.daily_progress || g.dailyProgress || []
        }));

        const k = Math.min(3, Math.max(1, processedGoals.length));

        return {
            clusters: kMeansClustering(processedGoals, k),
            suggestions: collaborativeFiltering(processedGoals),
            forecasts: timeSeriesForecasting(processedGoals),
            nlpResults: nlpAnalysis(processedGoals),
            productivity: peakProductivityAnalysis(processedGoals),
            analyzedAt: new Date().toISOString(),
            goalCount: processedGoals.length
        };
    }

    // Public API
    return {
        runFullAnalysis,
        kMeansClustering,
        collaborativeFiltering,
        timeSeriesForecasting,
        nlpAnalysis,
        peakProductivityAnalysis,
        extractFeatures
    };

})();
