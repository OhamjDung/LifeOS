# LifeOS Architecture — Solution A: Feature-Isolated Schema
Approach: Domain-Isolated Schema with Shared Auth

---

## System Overview

```
iPhone (SwiftUI)          Web (Next.js / Vercel)
      │                           │
      │ Supabase Swift SDK        │ Supabase JS SDK
      │ (reads via Realtime)      │ (reads + writes)
      │ (writes direct)           │
      └─────────────┬─────────────┘
                    │
              Supabase Cloud
          ┌────────────────────┐
          │ PostgreSQL + pgvector│
          │ Auth                 │
          │ Storage              │
          │ Realtime             │
          │ Edge Functions (Deno)│
          │ pg_cron              │
          └────────────────────┘
                    │
              OpenAI API
          (Whisper, GPT-4o, embeddings)
```

All AI calls originate from Supabase Edge Functions. Clients never call OpenAI directly — no API key exposure risk.

---

## Database Schema (PostgreSQL + pgvector)

### Bootstrap

```sql
create extension if not exists "uuid-ossp";
create extension if not exists vector;
```

### Auth — uses Supabase built-in `auth.users`

---

### Domain 1: Tasks

```sql
create table tasks (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  raw_text    text,                    -- original braindump fragment that generated this task
  status      text not null default 'pending'  -- pending | done | rolled_over
               check (status in ('pending','done','rolled_over')),
  source      text default 'manual',  -- 'braindump' | 'manual'
  mode_context text,                  -- which mode was active when task was created
  due_date    date not null default current_date,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table task_rollover_history (
  id          uuid primary key default uuid_generate_v4(),
  task_id     uuid not null references tasks(id) on delete cascade,
  from_date   date not null,
  to_date     date not null,
  rolled_at   timestamptz default now()
);

create table braindump_sessions (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  audio_storage_path text,            -- Supabase Storage path
  raw_transcript  text,
  processing_status text default 'pending'  -- pending | processing | done | failed
                   check (processing_status in ('pending','processing','done','failed')),
  created_at      timestamptz default now()
);

-- RLS
alter table tasks enable row level security;
create policy "user tasks" on tasks using (auth.uid() = user_id);

alter table task_rollover_history enable row level security;
create policy "user rollover" on task_rollover_history
  using (task_id in (select id from tasks where user_id = auth.uid()));

alter table braindump_sessions enable row level security;
create policy "user braindumps" on braindump_sessions using (auth.uid() = user_id);
```

---

### Domain 2: Contextual Modes

```sql
create table location_anchors (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,           -- 'Home', 'Office', 'Gym', 'Car' (virtual)
  latitude    double precision,
  longitude   double precision,
  radius_meters int default 150,       -- geofence radius
  mode        text not null,           -- 'home' | 'work' | 'car' | 'gym' | 'default'
  is_active   boolean default true,
  created_at  timestamptz default now()
);

create table user_mode_sessions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  mode        text not null,
  trigger     text not null,           -- 'geofence' | 'focus' | 'manual'
  started_at  timestamptz default now(),
  ended_at    timestamptz
);

-- RLS
alter table location_anchors enable row level security;
create policy "user anchors" on location_anchors using (auth.uid() = user_id);

alter table user_mode_sessions enable row level security;
create policy "user mode sessions" on user_mode_sessions using (auth.uid() = user_id);
```

---

### Domain 3: Personal CRM

```sql
create table contacts (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  notes           text,               -- how we met, context
  relationship_tier text default 'acquaintance'
                  check (relationship_tier in ('family','close_friend','friend','acquaintance')),
  last_contacted_at timestamptz,
  photo_url       text,               -- Supabase Storage
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create table contact_events (
  id          uuid primary key default uuid_generate_v4(),
  contact_id  uuid not null references contacts(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  event_type  text not null,          -- 'photo_sent' | 'message_sent' | 'met' | 'life_update'
  notes       text,
  media_url   text,                   -- Supabase Storage for photos
  created_at  timestamptz default now()
);

create table contact_reminders (
  id          uuid primary key default uuid_generate_v4(),
  contact_id  uuid not null references contacts(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  remind_at   timestamptz not null,
  message_type text not null,         -- 'photo' | 'catchup'
  status      text default 'pending', -- pending | sent | dismissed
  created_at  timestamptz default now()
);

-- Tier → days interval mapping
-- family: 2 days, close_friend: 7 days, friend: 14 days, acquaintance: 30 days

-- RLS
alter table contacts enable row level security;
create policy "user contacts" on contacts using (auth.uid() = user_id);

alter table contact_events enable row level security;
create policy "user contact events" on contact_events using (auth.uid() = user_id);

alter table contact_reminders enable row level security;
create policy "user reminders" on contact_reminders using (auth.uid() = user_id);
```

---

### Domain 4: Notes + RAG

```sql
create table notes (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text,
  content         text not null,
  category        text,               -- AI-assigned: 'learning' | 'idea' | 'reference' | 'meeting' | ...
  tags            text[],             -- AI-assigned tags
  source          text default 'web', -- 'web' | 'ios' | 'import'
  processing_status text default 'pending'
                  check (processing_status in ('pending','processing','done','failed')),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create table note_embeddings (
  id          uuid primary key default uuid_generate_v4(),
  note_id     uuid not null references notes(id) on delete cascade,
  chunk_index int not null default 0, -- for multi-chunk notes
  chunk_text  text not null,
  embedding   vector(1536),           -- text-embedding-3-small outputs 1536 dims
  created_at  timestamptz default now()
);

-- HNSW index for fast approximate nearest-neighbor search
create index on note_embeddings using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Also index by note_id for lookups
create index on note_embeddings (note_id);

-- RLS
alter table notes enable row level security;
create policy "user notes" on notes using (auth.uid() = user_id);

alter table note_embeddings enable row level security;
create policy "user embeddings" on note_embeddings
  using (note_id in (select id from notes where user_id = auth.uid()));
```

---

## Supabase Edge Functions

### 1. `process-braindump` — triggered via DB webhook on `braindump_sessions` insert

```
Trigger: INSERT on braindump_sessions WHERE processing_status = 'pending'

Flow:
1. Download audio from Supabase Storage
2. POST audio to OpenAI Whisper API → get transcript
3. Fetch user's existing pending tasks for today (today's date, status=pending)
4. POST to GPT-4o with prompt:
   System: "Extract actionable tasks from the transcript. 
            For each candidate task, check if it semantically duplicates 
            an existing task from the list provided. 
            If duplicate: merge (update existing). If new: create new.
            Return JSON: {tasks: [{action: 'create'|'merge', 
                          existing_id?: string, title: string}]}"
   User: transcript + existing tasks JSON
5. For 'create' actions: INSERT into tasks
6. For 'merge' actions: UPDATE tasks SET title = merged_title WHERE id = existing_id
7. UPDATE braindump_sessions SET processing_status = 'done'
8. Notify iOS via Supabase Realtime (broadcast to user channel)
```

### 2. `embed-note` — triggered via DB webhook on `notes` INSERT/UPDATE

```
Trigger: INSERT or UPDATE on notes WHERE processing_status = 'pending'

Flow:
1. UPDATE notes SET processing_status = 'processing'
2. Chunk note content:
   - If content < 400 tokens: single chunk
   - If content >= 400 tokens: split by paragraph boundaries, 
     max 300 tokens per chunk, 50-token overlap
3. For each chunk: POST to text-embedding-3-small → get vector[1536]
4. DELETE existing note_embeddings WHERE note_id = this note (re-embed on update)
5. INSERT note_embeddings for each chunk
6. POST to GPT-4o:
   System: "Assign a category and 3-5 tags to this note."
   User: note content (first 500 tokens if long)
   Returns: {category: string, tags: string[]}
7. UPDATE notes SET category, tags, processing_status = 'done'
```

### 3. `crm-reminder-scheduler` — pg_cron, runs daily at 9am user's timezone

```sql
-- pg_cron job
select cron.schedule('crm-daily', '0 9 * * *', $$
  select net.http_post(
    url := 'https://[project].supabase.co/functions/v1/crm-scheduler',
    headers := '{"Authorization": "Bearer [service_key]"}'::jsonb
  );
$$);
```

```
Edge Function flow:
1. Query contacts grouped by tier
   - family: last_contacted > 2 days ago
   - close_friend: > 7 days ago
   - friend: > 14 days ago
   - acquaintance: > 30 days ago
2. For each overdue contact: INSERT contact_reminders
3. Send push via Supabase push notifications to user's device token
   Payload: {"type": "crm_reminder", "contact_id": "...", "name": "..."}
```

### 4. `draft-catchup-message` — called on-demand from client

```
Input: {contact_id, life_update_text}
Flow:
1. Fetch contact record (name, relationship_tier, recent events)
2. POST to GPT-4o:
   System: "Draft a warm, casual {tier} message. Under 2 sentences."
   User: "Life update: {life_update}. For: {contact_name}"
3. Return: {draft: string}
```

---

## iOS App Architecture

### Module Structure
```
LifeOSApp/
  ├── Core/
  │   ├── SupabaseClient.swift       -- singleton Supabase client
  │   ├── AuthManager.swift
  │   └── AppState.swift             -- current mode, user prefs
  ├── Features/
  │   ├── Braindump/
  │   │   ├── BraindumpView.swift
  │   │   ├── VoiceRecorder.swift    -- AVAudioRecorder + Speech
  │   │   └── TaskListView.swift
  │   ├── Modes/
  │   │   ├── GeofenceManager.swift  -- CLLocationManager
  │   │   ├── FocusManager.swift     -- App Intents / Focus Filter
  │   │   └── ModeView.swift
  │   ├── CRM/
  │   │   ├── ContactsView.swift
  │   │   └── CatchupView.swift
  │   └── Notes/
  │       └── NoteSearchView.swift   -- phone: search/retrieve only
  └── Widget/
      └── TaskWidget.swift           -- WidgetKit extension
```

### WidgetKit — Task Widget

**App Group ID:** `group.com.yourname.lifeos`

```swift
// In main app: TaskListView subscribes to Supabase Realtime
// On tasks change → write to App Group

func updateWidgetData(tasks: [Task]) {
    let container = UserDefaults(suiteName: "group.com.yourname.lifeos")!
    let encoded = try! JSONEncoder().encode(tasks.prefix(5)) // max 5 tasks
    container.set(encoded, forKey: "todayTasks")
    WidgetCenter.shared.reloadAllTimelines() // triggers widget refresh
}

// Widget extension reads from same App Group
struct TaskProvider: TimelineProvider {
    func getTimeline(in context: Context, completion: @escaping (Timeline<TaskEntry>) -> Void) {
        let defaults = UserDefaults(suiteName: "group.com.yourname.lifeos")!
        let data = defaults.data(forKey: "todayTasks") ?? Data()
        let tasks = (try? JSONDecoder().decode([Task].self, from: data)) ?? []
        let entry = TaskEntry(date: .now, tasks: tasks)
        // Refresh timeline at midnight for next day's tasks
        let midnight = Calendar.current.startOfDay(for: .now.addingTimeInterval(86400))
        let timeline = Timeline(entries: [entry], policy: .after(midnight))
        completion(timeline)
    }
}
```

Widget refresh budget: ~40-70 refreshes/day. Strategy: only call `reloadAllTimelines()` when tasks actually change (driven by Realtime subscription), not on a timer. Plus daily midnight refresh.

### CoreLocation — Geofencing

```swift
class GeofenceManager: NSObject, CLLocationManagerDelegate {
    let locationManager = CLLocationManager()
    
    // iOS limit: 20 simultaneous regions
    // Strategy: Home, Office, Gym = 3 regions. Car = Focus Mode only (no GPS anchor)
    
    func setupGeofences(anchors: [LocationAnchor]) {
        // Stop monitoring existing regions first
        locationManager.monitoredRegions.forEach { locationManager.stopMonitoring(for: $0) }
        
        // Register up to 19 user anchors (leave 1 slot for system use)
        for anchor in anchors.prefix(19) {
            let region = CLCircularRegion(
                center: CLLocationCoordinate2D(latitude: anchor.latitude, longitude: anchor.longitude),
                radius: Double(anchor.radiusMeters),
                identifier: anchor.id.uuidString
            )
            region.notifyOnEntry = true
            region.notifyOnExit = true
            locationManager.startMonitoring(for: region)
        }
    }
    
    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        // Look up mode from region identifier → anchor → mode
        // Update AppState.currentMode
        // Sync to Supabase (user_mode_sessions INSERT)
    }
}
```

Required permissions: `NSLocationAlwaysAndWhenInUseUsageDescription` (Always permission required for background geofencing).

### iOS Focus Modes — App Intents

```swift
// Requires: Supported Intents in App Target entitlements
// Info.plist: NSFocusStatusUsageDescription

import AppIntents

struct LifeOSFocusFilter: SetFocusFilterIntent {
    static var title: LocalizedStringResource = "LifeOS Mode"
    
    @Parameter(title: "App Mode")
    var mode: AppMode   // AppMode: home | work | car | gym | default
    
    func perform() async throws -> some IntentResult {
        AppState.shared.setMode(mode, trigger: .focus)
        return .result()
    }
}

// User sets up: "When Work Focus is on → LifeOS mode = Work"
// via Settings > Focus > Work > App Filters > LifeOS
```

Car mode: no GPS anchor needed. User sets up an iOS Focus Mode called "Driving" (or uses Apple's built-in Driving mode) → maps to Car mode in LifeOS via the Focus Filter.

---

## Next.js Web App Architecture

**Purpose: Input-focused for notes, review for tasks and contacts.**

```
app/
  ├── (auth)/
  │   └── login/page.tsx
  ├── dashboard/page.tsx         -- today's tasks + mode status
  ├── braindump/page.tsx         -- web braindump (text input)
  ├── notes/
  │   ├── page.tsx               -- all notes, search
  │   ├── new/page.tsx           -- COMPUTER INPUT: rich text editor
  │   └── [id]/page.tsx
  ├── contacts/page.tsx          -- CRM overview
  └── api/
      └── (none — all AI via Supabase Edge Functions)
```

**Computer-input UX (Asymmetric design):**
- `notes/new`: Full rich text editor (TipTap/Slate), long-form note creation
- After save → shows "Categorizing..." badge while `processing_status = 'processing'`
- Once done → tags and category appear automatically

**Phone UX:**
- Notes tab: search bar front and center, "What do I know about [X]?" input
- Results ranked by semantic similarity (calls Supabase Edge Function `search-notes`)

### `search-notes` Edge Function

```
Input: {query: string, limit: number = 10}
Flow:
1. Embed query with text-embedding-3-small → vector[1536]
2. pgvector cosine similarity search:
   SELECT n.*, ne.chunk_text,
          1 - (ne.embedding <=> $query_vector) AS similarity
   FROM note_embeddings ne
   JOIN notes n ON ne.note_id = n.id
   WHERE n.user_id = auth.uid()
   ORDER BY ne.embedding <=> $query_vector
   LIMIT $limit
3. Group results by note_id, return top unique notes
```

---

## OpenAI Cost Estimate

**Assumptions:** 2 braindumps/day (avg 3 min audio each), 5 notes/day added on computer, 3 CRM AI drafts/week

| Operation | Model | Units/day | Tokens/call | Cost/call | Daily cost |
|---|---|---|---|---|---|
| Whisper transcription | Whisper | 2 | 3 min audio | $0.018 | $0.036 |
| Task extraction + dedup | GPT-4o | 2 | ~800 in, 200 out | $0.008 | $0.016 |
| Note embedding | text-embedding-3-small | 5 | ~500 tokens | $0.0001 | $0.0005 |
| Note categorization | GPT-4o | 5 | ~600 in, 50 out | $0.0062 | $0.031 |
| Search queries | text-embedding-3-small | 10 | ~20 tokens | $0.000004 | $0.00004 |
| CRM drafts (3/week) | GPT-4o | 0.43 | ~300 in, 100 out | $0.004 | $0.0017 |

**Daily total: ~$0.085 / day → ~$2.60/month**

**Cost controls:**
- Cache GPT-4o note categorization: run only once per note (not on every search)
- Use `text-embedding-3-small` (not large) — 20x cheaper, quality sufficient for personal notes
- GPT-4o-mini for categorization (fine for simple tag/category tasks) → reduces cost 10x
- Whisper on-device (Apple Speech framework) as fallback when offline — no API cost

---

## Phased Build Plan

### Phase 1 — MVP: Tasks + Widgets (Weeks 1-4)
**Goal:** Replace Notion with an on-phone task tracker + widget

1. Week 1: Supabase project setup, auth, tasks table + RLS
2. Week 2: iOS SwiftUI task list, manual task creation, rollover button
3. Week 3: WidgetKit widget showing today's tasks (App Group)
4. Week 4: Braindump Edge Function (Whisper + GPT-4o), iOS voice recording UI

**Deliverable:** Working daily task tracker with voice braindump + home screen widget

### Phase 2 — Modes + CRM (Weeks 5-9)
**Goal:** Context-aware switching + relationship tracking

5. Week 5: CoreLocation geofencing, location_anchors table, mode switching UI
6. Week 6: iOS Focus Filter App Intent, Car mode via Driving Focus
7. Week 7: Contacts table, basic CRM list, last-contacted tracking
8. Week 8: pg_cron CRM reminders, push notifications
9. Week 9: AI catch-up message drafting Edge Function + UI

**Deliverable:** App auto-switches modes, sends daily CRM reminders

### Phase 3 — Notes + RAG (Weeks 10-14)
**Goal:** Semantic knowledge base

10. Week 10: notes table, Next.js note editor, basic CRUD
11. Week 11: embed-note Edge Function, pgvector HNSW index
12. Week 12: search-notes Edge Function, iOS search UI
13. Week 13: Auto-categorization, tags, computer-input UX polish
14. Week 14: Integration testing, Obsidian export (optional: markdown export endpoint)

**Deliverable:** Full semantic note search on phone, rich input on computer

---

## Self-Verification

**Q1: Can widgets display today's tasks without network access?**
Yes — the main app writes to the App Group shared UserDefaults whenever Supabase Realtime delivers a task update. WidgetKit reads from the App Group. No direct network call in the widget extension.

**Q2: What happens if OpenAI is down during a braindump?**
The audio is stored in Supabase Storage. The `braindump_sessions` row stays at `processing_status = 'pending'`. The Edge Function retries via pg_cron every 5 minutes. The user sees "Processing..." on the task list. Tasks still appear once AI comes back.

**Q3: Can iOS geofence more than 4 places?**
Yes — iOS supports up to 20 CLCircularRegion regions simultaneously. We use up to 19 user anchors. Car mode doesn't need a geofence (it uses the Driving Focus Mode).

**Q4: Do clients ever call OpenAI directly?**
No — only Supabase Edge Functions call OpenAI. The OpenAI API key is stored as a Supabase secret (environment variable in Edge Functions), never in the iOS binary or Next.js client.

**Q5: How does semantic search work on phone with no server?**
Search queries go to the `search-notes` Edge Function. The phone sends a text query, the Edge Function embeds it and runs pgvector similarity search server-side, returns top 10 note chunks. The phone receives pre-ranked results instantly. No vector computation on-device.
