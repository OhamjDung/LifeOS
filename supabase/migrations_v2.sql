-- Run in Supabase SQL Editor after migrations.sql

-- ── Tags ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tags (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tags_own" ON tags FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Task ↔ Tag junction ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_tags (
  task_id UUID REFERENCES tasks(id)   ON DELETE CASCADE NOT NULL,
  tag_id  UUID REFERENCES tags(id)    ON DELETE CASCADE NOT NULL,
  PRIMARY KEY (task_id, tag_id)
);
ALTER TABLE task_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_tags_own" ON task_tags FOR ALL
  USING  (EXISTS (SELECT 1 FROM tasks WHERE tasks.id = task_id AND tasks.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM tasks WHERE tasks.id = task_id AND tasks.user_id = auth.uid()));

-- ── Contact ↔ Tag junction ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_tags (
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE NOT NULL,
  tag_id     UUID REFERENCES tags(id)     ON DELETE CASCADE NOT NULL,
  PRIMARY KEY (contact_id, tag_id)
);
ALTER TABLE contact_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contact_tags_own" ON contact_tags FOR ALL
  USING  (EXISTS (SELECT 1 FROM contacts WHERE contacts.id = contact_id AND contacts.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM contacts WHERE contacts.id = contact_id AND contacts.user_id = auth.uid()));

-- ── Contact tier (replaces relationship_tier for priority/countdown logic) ─
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_tier TEXT NOT NULL DEFAULT 'weekly'
  CHECK (contact_tier IN ('daily', 'weekly', 'biweekly', 'monthly'));

-- ── Audio URL for braindump jobs (uploaded recordings) ────────────────────
ALTER TABLE braindump_jobs ADD COLUMN IF NOT EXISTS audio_url TEXT;

-- ── Storage bucket (run in Supabase Dashboard → Storage → New bucket) ─────
-- Bucket name: recordings
-- Public: false
-- File size limit: 50MB
-- Allowed MIME types: audio/*
