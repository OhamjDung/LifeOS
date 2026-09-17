-- Run in Supabase SQL Editor after migrations_v4.sql

-- ── Priority mode (multi-select "pin to top" flag, set via A-screen priority mode) ─
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_priority BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_tasks_is_priority ON tasks(is_priority);
