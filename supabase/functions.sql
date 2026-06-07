-- Run this after schema.sql in Supabase SQL Editor

-- Helper: increment retry_count for braindump_jobs
create or replace function increment_retry(job_id uuid)
returns void language sql as $$
  update braindump_jobs set retry_count = retry_count + 1 where id = job_id;
$$;

-- Helper: increment retry_count for notes
create or replace function increment_note_retry(note_id uuid)
returns void language sql as $$
  update notes set retry_count = retry_count + 1 where id = note_id;
$$;

-- pg_cron: process braindumps every 2 minutes
-- Replace YOUR_SERVICE_ROLE_KEY with value from Supabase → Project Settings → API
select cron.schedule(
  'process-braindumps',
  '*/2 * * * *',
  $$
    select net.http_post(
      url := 'https://atokyvaqjvqkveqnfurg.supabase.co/functions/v1/fn-process-braindump',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
      body := '{}'::jsonb
    );
  $$
);

-- pg_cron: embed notes every 2 minutes
select cron.schedule(
  'embed-notes',
  '*/2 * * * *',
  $$
    select net.http_post(
      url := 'https://atokyvaqjvqkveqnfurg.supabase.co/functions/v1/fn-embed-note',
      headers := '{"Content-Type":"application/json","Authorization":"Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
      body := '{}'::jsonb
    );
  $$
);
