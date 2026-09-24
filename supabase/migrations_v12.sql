-- Run in Supabase SQL Editor after migrations_v11.sql

-- ── Planner: year → month → week goals (one table, all levels) ──
create type goal_level as enum ('year', 'month', 'week');
create type goal_status as enum ('not_started', 'in_progress', 'done');

create table plan_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  level goal_level not null,
  title text not null,
  description text,
  category text,
  status goal_status not null default 'not_started',
  -- year: Jan 1 · month: 1st of month · week: Monday. period_end = period_start
  -- unless a month goal spans several months (then 1st of its last month).
  period_start date not null,
  period_end date not null,
  -- week → month goal, month → year goal
  parent_id uuid references plan_goals(id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create index idx_plan_goals_user_level_period on plan_goals (user_id, level, period_start);
create index idx_plan_goals_parent on plan_goals (parent_id);

alter table plan_goals enable row level security;
create policy plan_goals_rls on plan_goals using (auth.uid() = user_id);
