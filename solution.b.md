# LifeOS Architecture — Solution B: Supabase-Direct BaaS (Thin Client)
Approach: Both clients talk directly to Supabase; Edge Functions handle all AI

---

## System Overview

```
iPhone (SwiftUI)              Web (Next.js)
   │                              │
   │ supabase-swift SDK           │ @supabase/supabase-js
   │ ─ direct table reads/writes  │ ─ direct table reads/writes
   │ ─ Realtime subscriptions     │ ─ Realtime subscriptions
   │ ─ Storage uploads            │ ─ Storage uploads
   └──────────────┬───────────────┘
                  │
            Supabase Cloud
     ┌──────────────────────────┐
     │ PostgreSQL + pgvector    │
     │ Auth (JWT)               │
     │ Storage (audio, photos)  │
     │ Realtime (Postgres CDC)  │
     │ Edge Functions (Deno)    │◄── called by DB webhooks
     │ pg_cron + pg_net         │
     └──────────────────────────┘
                  │
           OpenAI API
   (Whisper / GPT-4o / text-embedding-3-small)
```

**Core principle:** Clients are thin — they read/write rows. All intelligence lives in Edge Functions triggered by database events. No OpenAI keys in clients.

---

## Complete Database Schema

```sql
-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists vector;

-- ============================================================
-- TASKS DOMAIN
-- ============================================================

create table tasks (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null,
  raw_source_text text,
  status          text not null default 'pending'
                  check (status in ('pending','done','rolled_over','skipped')),
  due_date        date not null default current_date,
  mode_context    text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index on tasks(user_id, due_date, status);

create table task_rollovers (
  id          uuid primary key default uuid_generate_v4(),
  task_id     uuid not null references tasks(id) on delete cascade,
  from_date   date not null,
  to_date     date not null,
  created_at  timestamptz default now()
);

create table braindump_jobs (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  audio_path        text,           -- Supabase Storage object path
  raw_transcript    text,
  processing_status text not null default 'pending'
                    check (processing_status in ('pending','processing','done','failed')),
  error_message     text,
  created_at        timestamptz default now()
);

-- ============================================================
-- MODES DOMAIN
-- ============================================================

create table location_anchors (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  label          text not null,       -- 'Home', 'Office', 'Gym'
  mode           text not null        -- 'home' | 'work' | 'gym' | 'default'
                 check (mode in ('home','work','car','gym','default')),
  latitude       double precision not null,
  longitude      double precision not null,
  radius_meters  int not null default 150,
  created_at     timestamptz default now()
);
-- Max 19 anchors per user enforced app-side (iOS has 20 region limit, we keep 1 spare)

create table mode_log (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  mode        text not null,
  trigger     text not null check (trigger in ('geofence','focus_filter','manual')),
  entered_at  timestamptz default now(),
  exited_at   timestamptz
);

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
  device_token      text,            -- APNs device token stored here for push
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create table contact_events (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  contact_id  uuid not null references contacts(id) on delete cascade,
  event_type  text not null check (event_type in ('photo_sent','message_sent','met_in_person','life_update','other')),
  notes       text,
  media_path  text,
  created_at  timestamptz default now()
);
-- Inserting a contact_event with event_type in ('photo_sent','message_sent')
-- triggers a DB function to UPDATE contacts SET last_contacted_at = now()

create or replace function update_last_contacted()
returns trigger language plpgsql as $$
begin
  if new.event_type in ('photo_sent','message_sent','met_in_person') then
    update contacts set last_contacted_at = now(), updated_at = now()
    where id = new.contact_id;
  end if;
  return new;
end;
$$;
create trigger trg_update_last_contacted
  after insert on contact_events
  for each row execute function update_last_contacted();

-- ============================================================
-- NOTES + RAG DOMAIN
-- ============================================================

create table notes (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  title             text,
  content           text not null,
  category          text,            -- AI-assigned
  tags              text[] default '{}',
  source_platform   text default 'web' check (source_platform in ('web','ios','import')),
  processing_status text not null default 'pending'
                    check (processing_status in ('pending','processing','done','failed')),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create index on notes(user_id, processing_status);

create table note_chunks (
  id          uuid primary key default uuid_generate_v4(),
  note_id     uuid not null references notes(id) on delete cascade,
  chunk_index int not null,
  chunk_text  text not null,
  embedding   vector(1536),         -- text-embedding-3-small: 1536 dimensions
  created_at  timestamptz default now()
);
-- HNSW index: better recall than IVFFlat, no training needed, works well for personal-scale
create index note_chunks_embedding_idx on note_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
create index on note_chunks(note_id);

-- ============================================================
-- ROW LEVEL SECURITY (all tables)
-- ============================================================

alter table tasks enable row level security;
create policy tasks_user on tasks using (auth.uid() = user_id);

alter table task_rollovers enable row level security;
create policy rollovers_user on task_rollovers
  using (task_id in (select id from tasks where user_id = auth.uid()));

alter table braindump_jobs enable row level security;
create policy braindump_user on braindump_jobs using (auth.uid() = user_id);

alter table location_anchors enable row level security;
create policy anchors_user on location_anchors using (auth.uid() = user_id);

alter table mode_log enable row level security;
create policy mode_log_user on mode_log using (auth.uid() = user_id);

alter table contacts enable row level security;
create policy contacts_user on contacts using (auth.uid() = user_id);

alter table contact_events enable row level security;
create policy contact_events_user on contact_events using (auth.uid() = user_id);

alter table notes enable row level security;
create policy notes_user on notes using (auth.uid() = user_id);

alter table note_chunks enable row level security;
create policy chunks_user on note_chunks
  using (note_id in (select id from notes where user_id = auth.uid()));
```

---

## Edge Functions

### 1. `fn-process-braindump`
**Trigger:** DB webhook on `braindump_jobs` INSERT

```typescript
// Deno / Supabase Edge Function
Deno.serve(async (req) => {
  const { record } = await req.json();  // braindump_jobs row
  
  // 1. Mark as processing
  await supabase.from('braindump_jobs').update({ processing_status: 'processing' })
    .eq('id', record.id);

  // 2. Download audio from Storage
  const { data: audioData } = await supabase.storage
    .from('braindumps').download(record.audio_path);

  // 3. Transcribe via Whisper
  const formData = new FormData();
  formData.append('file', audioData, 'audio.m4a');
  formData.append('model', 'whisper-1');
  const whisperResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${Deno.env.get('OPENAI_KEY')}` },
    body: formData,
  });
  const { text: transcript } = await whisperResp.json();

  // 4. Fetch today's existing tasks
  const { data: existingTasks } = await supabase.from('tasks')
    .select('id,title').eq('user_id', record.user_id)
    .eq('due_date', new Date().toISOString().split('T')[0])
    .neq('status','done');

  // 5. Extract + dedup via GPT-4o (function calling)
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: `Extract actionable tasks. 
        Compare against existing tasks. 
        If semantically duplicate (>0.85 similarity in meaning), return action=merge with existing_id.
        If new, return action=create.
        Use function calling to return structured output.` },
      { role: 'user', content: `Transcript: ${transcript}\n\nExisting tasks: ${JSON.stringify(existingTasks)}` }
    ],
    tools: [{ type: 'function', function: {
      name: 'submit_tasks',
      parameters: {
        type: 'object',
        properties: {
          tasks: { type: 'array', items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['create','merge'] },
              title: { type: 'string' },
              existing_id: { type: 'string' }
            }, required: ['action','title']
          }}
        }
      }
    }}],
    tool_choice: { type: 'function', function: { name: 'submit_tasks' } }
  });

  const { tasks } = JSON.parse(
    completion.choices[0].message.tool_calls[0].function.arguments
  );

  // 6. Apply creates/merges
  for (const task of tasks) {
    if (task.action === 'create') {
      await supabase.from('tasks').insert({
        user_id: record.user_id, title: task.title,
        due_date: new Date().toISOString().split('T')[0], source: 'braindump'
      });
    } else {
      await supabase.from('tasks').update({ title: task.title })
        .eq('id', task.existing_id);
    }
  }

  // 7. Mark done + store transcript
  await supabase.from('braindump_jobs').update({
    processing_status: 'done', raw_transcript: transcript
  }).eq('id', record.id);
});
```

### 2. `fn-embed-note`
**Trigger:** DB webhook on `notes` INSERT or UPDATE WHERE processing_status = 'pending'

```typescript
// Chunking strategy: paragraph-aware with token limit
function chunkText(content: string): string[] {
  const paragraphs = content.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';
  
  for (const para of paragraphs) {
    const combined = current ? `${current}\n\n${para}` : para;
    // Rough token estimate: 1 token ≈ 4 chars
    if (combined.length / 4 > 300 && current) {
      chunks.push(current);
      current = para;
    } else {
      current = combined;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [content];
}

// Main flow:
// 1. Mark processing
// 2. Chunk content
// 3. Embed all chunks in parallel (Promise.all)
// 4. Delete old chunks for this note, insert new ones
// 5. Categorize with GPT-4o-mini (cheaper for simple classification)
// 6. Update note with category, tags, processing_status='done'
```

### 3. `fn-search-notes`
**Called directly by clients (HTTP POST)**

```typescript
// Input: { query: string, limit?: number }
// 1. Embed query with text-embedding-3-small
// 2. Run pgvector cosine search with user_id filter
// 3. Return top-N unique notes with similarity scores
const result = await supabase.rpc('search_notes', {
  query_embedding: embedding,
  match_count: limit ?? 10,
  user_id_filter: userId
});

// DB function:
create or replace function search_notes(
  query_embedding vector(1536),
  match_count int,
  user_id_filter uuid
) returns table (note_id uuid, title text, chunk_text text, similarity float)
language plpgsql as $$
begin
  return query
  select n.id, n.title, nc.chunk_text,
         1 - (nc.embedding <=> query_embedding) as similarity
  from note_chunks nc
  join notes n on nc.note_id = n.id
  where n.user_id = user_id_filter
    and 1 - (nc.embedding <=> query_embedding) > 0.5  -- threshold
  order by nc.embedding <=> query_embedding
  limit match_count;
end;
$$;
```

### 4. `fn-crm-scheduler` — pg_cron daily at 8am UTC

```typescript
// Tier → contact interval (days)
const TIER_INTERVALS = { family: 2, close_friend: 7, friend: 14, acquaintance: 30 };

// Query all users' overdue contacts
// For each overdue contact: send push notification via Supabase push
// (requires Supabase Push Notifications addon or use Expo Push / direct APNs)

// APNs payload:
{
  aps: { alert: { title: "Say hi to Sarah", body: "It's been 8 days" }, sound: "default" },
  data: { type: "crm_reminder", contact_id: "...", contact_name: "Sarah" }
}
```

### 5. `fn-draft-catchup`
**Called on-demand from client**

```typescript
// Input: { contact_id: string, life_update: string }
// 1. Fetch contact (name, tier, last 3 events)
// 2. GPT-4o-mini:
//    System: "Draft a warm {tier} message in 1-2 sentences based on this life update."
//    User: "Update: {life_update}\nFor: {name}"
// Returns: { draft: string }
```

---

## iOS App Architecture

### Key Files
```
LifeOS/
  ├── LifeOSApp.swift          -- app entry, Supabase init
  ├── Core/
  │   ├── Supabase.swift       -- SupabaseClient.shared singleton
  │   │                           let supabase = SupabaseClient(url: ..., key: ...)
  │   └── RealtimeManager.swift -- subscribe to tasks/notes channels
  ├── Braindump/
  │   ├── BraindumpViewModel.swift
  │   └── VoiceRecorder.swift   -- AVAudioSession + AVAudioRecorder
  │                                records → uploads to Storage → inserts braindump_job
  ├── Modes/
  │   ├── GeofenceManager.swift -- CLLocationManager, 19 region limit enforced
  │   └── FocusFilterIntent.swift -- SetFocusFilterIntent
  ├── CRM/
  │   └── ContactsViewModel.swift
  ├── Notes/
  │   └── NoteSearchViewModel.swift -- calls fn-search-notes Edge Function
  └── Widget/
      ├── LifeOSWidget.swift    -- WidgetKit TimelineProvider
      └── LifeOSWidgetExtension -- separate target, App Group access
```

### Voice Recording Flow (iOS)
```swift
// BraindumpViewModel.swift
func startRecording() {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.record, mode: .default)
    try session.setActive(true)
    // Records to temp file
    recorder = try AVAudioRecorder(url: tempURL, settings: audioSettings)
    recorder.record()
}

func stopAndSubmit() async throws {
    recorder.stop()
    // Upload audio to Supabase Storage
    let audioData = try Data(contentsOf: tempURL)
    let path = "\(userId)/\(UUID().uuidString).m4a"
    try await supabase.storage.from("braindumps").upload(path: path, file: audioData)
    // Insert braindump_job → triggers Edge Function
    try await supabase.from("braindump_jobs").insert([
        "user_id": userId, "audio_path": path
    ])
    // UI shows "Processing..." — Realtime subscription delivers tasks when done
}
```

### Background Execution
- **Geofencing**: runs in background automatically (CLLocationManager region monitoring is low-power, no BGTaskScheduler needed)
- **Realtime subscriptions**: only active when app is foregrounded; widgets refresh via `WidgetCenter.reloadAllTimelines()` called when app returns to foreground
- **Push notifications**: CRM reminders from pg_cron → APNs → iOS; no background fetch needed

### Focus Filter (Entitlements required)
```
// Entitlements file: add com.apple.developer.usernotifications.focus-filter-intents = true
// Info.plist: NSFocusStatusUsageDescription = "LifeOS uses Focus to switch modes"
```

---

## Next.js Web App (Computer = Input)

```
app/
  ├── page.tsx                  -- dashboard: tasks + recent notes
  ├── notes/
  │   ├── page.tsx              -- note list + full-text search
  │   └── new/page.tsx          -- RICH TEXT EDITOR (TipTap)
  │                                Auto-shows category/tags after processing_status=done
  ├── contacts/page.tsx         -- CRM management
  ├── settings/
  │   └── locations/page.tsx    -- manage geofence anchors
  └── lib/
      └── supabase.ts           -- createBrowserClient(@supabase/ssr)
```

**Realtime subscriptions (web):**
```typescript
// Subscribe to notes processing_status updates
supabase.channel('notes_updates')
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notes' },
    (payload) => {
      if (payload.new.processing_status === 'done') {
        // Update note card to show tags/category
      }
    })
  .subscribe();
```

---

## OpenAI Cost Estimate

**Pricing (as of mid-2025):** GPT-4o: $5/1M in, $15/1M out. GPT-4o-mini: $0.15/1M in, $0.6/1M out. Whisper: $0.006/min. text-embedding-3-small: $0.02/1M tokens.

**Daily usage assumptions:** 2 braindumps × 3 min, 5 notes × 500 words

| Operation | Model | Daily volume | Input tokens | Output tokens | Daily cost |
|---|---|---|---|---|---|
| Transcription | Whisper | 2 × 3min | — | — | $0.036 |
| Task extraction/dedup | GPT-4o | 2 calls | 800 | 250 | $0.011 |
| Note categorization | GPT-4o-mini | 5 calls | 600 | 80 | $0.00045 |
| Note embedding | text-embedding-3-small | 15 chunks | 300 | — | $0.00009 |
| Search embedding | text-embedding-3-small | 10 queries | 25 | — | $0.000005 |
| CRM drafts | GPT-4o-mini | ~0.5/day | 400 | 80 | $0.00008 |

**Total: ~$0.048/day → ~$1.45/month**

Cost controls:
- Use GPT-4o-mini for categorization + CRM drafts (only task extraction needs GPT-4o quality)
- Cache: don't re-embed notes that haven't changed
- Whisper-on-device (Apple Speech framework) optional fallback — free but lower accuracy
- Hard cap: Supabase Edge Function can check a daily_spend table and abort if over budget

---

## Phased Build Plan

### Phase 1 — Core Tasks + Widget (3 weeks)
- Week 1: Supabase setup (auth, tasks schema, RLS), SwiftUI task CRUD
- Week 2: WidgetKit widget + App Group data sharing; rollover button
- Week 3: Voice recording → Storage upload → `fn-process-braindump` Edge Function

**Ship:** Working task manager + widget + voice braindump

### Phase 2 — Modes (2 weeks)
- Week 4: location_anchors table, CoreLocation geofencing, GeofenceManager.swift
- Week 5: Focus Filter App Intent, Car mode, mode_log, mode-aware task filtering

**Ship:** Auto mode-switching by location + Focus

### Phase 3 — CRM (2 weeks)
- Week 6: contacts schema, ContactsView, contact_events, last-contacted tracking
- Week 7: `fn-crm-scheduler` pg_cron, push notifications, `fn-draft-catchup`

**Ship:** Daily relationship reminders + AI message drafting

### Phase 4 — Notes + RAG (3 weeks)
- Week 8: notes schema, Next.js note editor, `fn-embed-note`
- Week 9: pgvector HNSW index, `fn-search-notes`, iOS search view
- Week 10: Auto-categorization polish, tags display, computer↔phone UX

**Ship:** Full semantic knowledge base with asymmetric input/retrieval

**Total: ~10 weeks to feature-complete MVP**
