-- Run in Supabase SQL Editor after migrations_v3.sql

-- ── Task description (content section, editable from the task detail pane) ─
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT;

-- ── Subtasks (grouped via optional group_name) ───────────────────────────
CREATE TABLE IF NOT EXISTS subtasks (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id     UUID REFERENCES tasks(id) ON DELETE CASCADE NOT NULL,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title       TEXT NOT NULL,
  group_name  TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id, sort_order);

ALTER TABLE subtasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subtasks_own" ON subtasks FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
