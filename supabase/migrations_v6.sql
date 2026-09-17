-- Run in Supabase SQL Editor after migrations_v5.sql

-- ── Structured contact fields (populated manually or via braindump extraction) ──
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS education TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS why_good_contact TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS less_useful_for TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS rating TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS next_step TEXT;

-- ── Braindump job result snapshot, so the history panel survives reload ──
ALTER TABLE braindump_jobs ADD COLUMN IF NOT EXISTS result JSONB;
