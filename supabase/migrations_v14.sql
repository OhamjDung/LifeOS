-- Run in Supabase SQL Editor after migrations_v13.sql

-- ── Chat harness: one thread per local day, messages, long-term memories ──
create table chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  thread_date date not null,
  summary text,                          -- rolling summary of compacted older turns
  compacted_through timestamptz,         -- messages created at/before this are covered by summary
  created_at timestamptz not null default now(),
  unique (user_id, thread_date)
);
alter table chat_threads enable row level security;
create policy chat_threads_rls on chat_threads using (auth.uid() = user_id);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  -- read-tool calls made during the turn: [{name, args, summary}] (debug panel)
  tool_trace jsonb,
  -- write proposals awaiting confirm: [{id, tool, args, title, lines, choices?, status, result?}]
  proposals jsonb,
  -- memories auto-saved during the turn (shown as chips)
  remembered jsonb,
  model text,
  prompt_tokens int,
  completion_tokens int,
  cost_usd numeric not null default 0,
  created_at timestamptz not null default now()
);
create index idx_chat_messages_thread on chat_messages (thread_id, created_at);
create index idx_chat_messages_user_created on chat_messages (user_id, created_at);
alter table chat_messages enable row level security;
create policy chat_messages_rls on chat_messages using (auth.uid() = user_id);

create table chat_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  content text not null,
  source text not null default 'auto' check (source in ('auto', 'user')),
  created_at timestamptz not null default now()
);
alter table chat_memories enable row level security;
create policy chat_memories_rls on chat_memories using (auth.uid() = user_id);

-- ── Contacts: coarse category the chat (and UI) can set ──
alter table contacts add column if not exists category text
  check (category in ('family', 'work', 'friend', 'other'));
