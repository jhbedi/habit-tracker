-- =====================================================
-- getItRight - Supabase SQL Schema
-- Run ALL of this in Supabase SQL Editor
-- =====================================================

-- Drop existing tables and create fresh
DROP TABLE IF EXISTS task_logs;
DROP TABLE IF EXISTS goals;

CREATE TABLE goals (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT DEFAULT 'personal',
    priority TEXT DEFAULT 'medium',
    effort TEXT DEFAULT 'medium',
    start_date DATE,
    end_date DATE,
    time_per_day INTEGER DEFAULT 60,
    frequency INTEGER DEFAULT 7,
    daily_progress JSONB DEFAULT '[]',
    progress INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast user lookups
CREATE INDEX idx_goals_user_id ON goals(user_id);

-- RLS: Users can only see and modify their own goals
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own goals" ON goals
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- =====================================================
-- Task Logs - Detailed completion events for AI analysis
-- =====================================================

CREATE TABLE task_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    goal_id UUID REFERENCES goals(id) ON DELETE CASCADE,
    logged_at TIMESTAMPTZ DEFAULT NOW(),
    duration_minutes INTEGER,
    notes TEXT,
    mood TEXT DEFAULT 'neutral',
    productivity_score INTEGER DEFAULT 5
);

-- Indexes for optimized time-series queries
CREATE INDEX idx_task_logs_goal_id ON task_logs(goal_id);
CREATE INDEX idx_task_logs_logged_at ON task_logs(logged_at);

-- RLS: Users can only access task logs for their own goals
ALTER TABLE task_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own task_logs" ON task_logs
    FOR ALL
    USING (goal_id IN (SELECT id FROM goals WHERE user_id = auth.uid()))
    WITH CHECK (goal_id IN (SELECT id FROM goals WHERE user_id = auth.uid()));