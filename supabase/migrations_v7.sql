-- Run in Supabase SQL Editor after migrations_v6.sql

create type session_status as enum ('active', 'ended');
create type timer_phase as enum ('work', 'break', 'idle');

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  title text,
  status session_status not null default 'active',
  work_minutes int not null default 25,
  break_minutes int not null default 5,
  phase timer_phase not null default 'work',
  phase_started_at timestamptz,
  phase_remaining_seconds int,
  round int not null default 1,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create table session_tasks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  is_session_created boolean not null default false,
  added_at timestamptz not null default now()
);

alter table sessions enable row level security;
create policy sessions_rls on sessions using (auth.uid() = user_id);

alter table session_tasks enable row level security;
create policy session_tasks_rls on session_tasks using (auth.uid() = user_id);
