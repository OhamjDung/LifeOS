-- Run in Supabase SQL Editor after migrations_v12.sql

-- ── Per-user settings (ICS URL is a secret: owner-only via RLS, never logged) ──
create table user_settings (
  user_id uuid primary key references auth.users(id),
  ics_url text,
  chat_model text not null default 'deepseek-v4-flash',
  chat_budget_usd numeric not null default 5,
  updated_at timestamptz not null default now()
);
alter table user_settings enable row level security;
create policy user_settings_rls on user_settings using (auth.uid() = user_id);

-- ── Expanded ICS occurrences, written only by fn-calendar-events (service role) ──
create table calendar_cache (
  user_id uuid primary key references auth.users(id),
  fetched_at timestamptz not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  events jsonb not null default '[]',
  last_error text
);
alter table calendar_cache enable row level security;
create policy calendar_cache_read on calendar_cache for select using (auth.uid() = user_id);

-- ── Time blocks on the week grid; tasks get dragged onto them ──
create table time_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  title text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  color text not null default 'indigo',
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index idx_time_blocks_user_start on time_blocks (user_id, start_at);
alter table time_blocks enable row level security;
create policy time_blocks_rls on time_blocks using (auth.uid() = user_id);

create table time_block_tasks (
  block_id uuid not null references time_blocks(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (block_id, task_id)
);
create index idx_time_block_tasks_task on time_block_tasks (task_id);
alter table time_block_tasks enable row level security;
create policy time_block_tasks_rls on time_block_tasks using (auth.uid() = user_id);
