-- LifeOS Database Schema
-- Run this in Supabase SQL Editor (Project > SQL Editor > New query)

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists vector;

-- ============================================================
-- TASKS DOMAIN
-- ============================================================

create table tasks (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  title            text not null,
  status           text not null default 'pending'
                   check (status in ('pending','done','rolled_over')),
  due_date         date not null default current_date,
  raw_source       text,
  mode_at_creation text,
  ai_merged_from   uuid references tasks(id),
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
create index on tasks(user_id, due_date, status);

create table task_rollovers (
  id        uuid primary key default uuid_generate_v4(),
  task_id   uuid not null references tasks(id) on delete cascade,
  from_date date not null,
  to_date   date not null,
  rolled_at timestamptz default now()
);

create table braindump_jobs (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  audio_path        text,
  raw_transcript    text,
  processing_status text not null default 'pending'
                    check (processing_status in ('pending','processing','done','failed')),
  retry_count       int not null default 0,
  last_error        text,
  created_at        timestamptz default now()
);

-- RLS
alter table tasks enable row level security;
create policy tasks_rls on tasks using (auth.uid() = user_id);

alter table task_rollovers enable row level security;
create policy rollovers_rls on task_rollovers
  using (task_id in (select id from tasks where user_id = auth.uid()));

alter table braindump_jobs enable row level security;
create policy braindump_rls on braindump_jobs using (auth.uid() = user_id);

-- ============================================================
-- MODES DOMAIN
-- ============================================================

create table location_anchors (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  label         text not null,
  mode          text not null check (mode in ('home','work','car','gym','default')),
  latitude      double precision not null,
  longitude     double precision not null,
  radius_meters int not null default 150,
  created_at    timestamptz default now()
);

create table mode_history (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  mode       text not null,
  trigger    text not null check (trigger in ('geofence','focus_filter','manual')),
  entered_at timestamptz default now(),
  exited_at  timestamptz
);

alter table location_anchors enable row level security;
create policy anchors_rls on location_anchors using (auth.uid() = user_id);

alter table mode_history enable row level security;
create policy mode_history_rls on mode_history using (auth.uid() = user_id);

-- ============================================================
-- CRM DOMAIN
-- ============================================================

create table contacts (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  name              text not null,
  how_we_met        text,
  relationship_tier text not null default 'acquaintance'
                    check (relationship_tier in ('family','close_friend','friend','acquaintance')),
  last_contacted_at timestamptz,
  avatar_path       text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create table contact_events (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  contact_id  uuid not null references contacts(id) on delete cascade,
  event_type  text not null
              check (event_type in ('photo_sent','message_sent','met','life_update','note')),
  body        text,
  media_path  text,
  created_at  timestamptz default now()
);

-- Auto-update last_contacted_at when social events logged
create or replace function sync_last_contacted()
returns trigger language plpgsql as $$
begin
  if new.event_type in ('photo_sent','message_sent','met') then
    update contacts
    set last_contacted_at = new.created_at, updated_at = now()
    where id = new.contact_id;
  end if;
  return new;
end;
$$;

create trigger trg_last_contacted
  after insert on contact_events
  for each row execute function sync_last_contacted();

create table user_push_tokens (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  device_token text not null,
  platform     text default 'ios',
  updated_at   timestamptz default now(),
  unique(user_id, device_token)
);

alter table contacts enable row level security;
create policy contacts_rls on contacts using (auth.uid() = user_id);

alter table contact_events enable row level security;
create policy events_rls on contact_events using (auth.uid() = user_id);

alter table user_push_tokens enable row level security;
create policy tokens_rls on user_push_tokens using (auth.uid() = user_id);

-- ============================================================
-- NOTES + RAG DOMAIN
-- ============================================================

create table notes (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  title             text,
  content           text not null,
  category          text,
  tags              text[] default '{}',
  source_platform   text default 'web' check (source_platform in ('web','ios','import')),
  processing_status text not null default 'pending'
                    check (processing_status in ('pending','processing','done','failed')),
  retry_count       int not null default 0,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create index on notes(user_id, processing_status);
create index on notes(user_id, created_at desc);

create table note_chunks (
  id          uuid primary key default uuid_generate_v4(),
  note_id     uuid not null references notes(id) on delete cascade,
  chunk_index int not null,
  chunk_text  text not null,
  embedding   vector(1536),
  created_at  timestamptz default now()
);

-- HNSW index for fast approximate nearest-neighbor search
create index note_chunks_hnsw on note_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
create index on note_chunks(note_id);

-- Search function (called by Edge Function)
create or replace function search_notes(
  query_embedding   vector(1536),
  match_count       int,
  p_user_id         uuid,
  similarity_threshold float default 0.5
) returns table (note_id uuid, title text, chunk_text text, similarity float)
language plpgsql as $$
begin
  return query
  select n.id, n.title, nc.chunk_text,
         1 - (nc.embedding <=> query_embedding) as similarity
  from note_chunks nc
  join notes n on n.id = nc.note_id
  where n.user_id = p_user_id
    and 1 - (nc.embedding <=> query_embedding) > similarity_threshold
  order by nc.embedding <=> query_embedding
  limit match_count;
end;
$$;

alter table notes enable row level security;
create policy notes_rls on notes using (auth.uid() = user_id);

alter table note_chunks enable row level security;
create policy chunks_rls on note_chunks
  using (note_id in (select id from notes where user_id = auth.uid()));
