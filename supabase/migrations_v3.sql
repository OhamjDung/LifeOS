-- Run this in Supabase SQL Editor after migrations_v2.sql

-- ── Braindump job categories (Tasks / Notes / Contacts) ─────────────────────
ALTER TABLE braindump_jobs ADD COLUMN IF NOT EXISTS categories TEXT[] DEFAULT '{Tasks}';
