-- Run in Supabase SQL Editor after migrations_v15.sql

-- ── Several Google Calendar ICS feeds per user (e.g. personal + a second account) ──
-- ics_url is kept only so the pre-v16 code (tag baseline-pre-harness) still works; nothing reads it now.
alter table user_settings add column ics_urls text[] not null default '{}';
update user_settings set ics_urls = array[trim(ics_url)] where coalesce(trim(ics_url), '') <> '';

-- Which feeds (short URL hashes) the cached expansion was built from — a cache built
-- from a different feed set is never served.
alter table calendar_cache add column feeds text[] not null default '{}';
