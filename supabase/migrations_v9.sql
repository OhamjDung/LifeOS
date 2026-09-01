-- Run in Supabase SQL Editor after migrations_v8.sql

-- ── Persistent task groups (replaces ephemeral client-only AI grouping state) ──
create table task_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  color text not null default 'indigo',
  created_at timestamptz not null default now()
);

alter table task_groups enable row level security;
create policy task_groups_rls on task_groups using (auth.uid() = user_id);

alter table tasks add column if not exists group_id uuid references task_groups(id) on delete set null;

-- ── Infinite-depth subtasks (self-referential parent) ──
alter table subtasks add column if not exists parent_subtask_id uuid references subtasks(id) on delete cascade;
create index if not exists idx_subtasks_parent on subtasks(parent_subtask_id);
