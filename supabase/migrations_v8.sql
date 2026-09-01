-- Run in Supabase SQL Editor after migrations_v7.sql

create table session_rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  round int not null,
  lockin_rating int check (lockin_rating between 1 and 5),
  created_at timestamptz not null default now()
);

alter table session_rounds enable row level security;
create policy session_rounds_rls on session_rounds using (auth.uid() = user_id);
