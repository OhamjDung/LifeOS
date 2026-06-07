# LifeOS — Final Architecture Plan
**Date:** 2026-06-03  
**Strategy:** Progressive Enhancement (AI never blocks core functionality)  
**Stack:** SwiftUI iOS + Next.js web + Supabase (PostgreSQL + pgvector) + OpenAI API  
**Builder:** Solo developer

---

## The Big Idea

Three layers, each independently valuable:

```
Layer 2 — AI Proactive   nudges, cross-feature insights, suggestions
Layer 1 — AI Async       background embed/categorize/dedup (non-blocking)
Layer 0 — CRUD Core      always works, even when OpenAI is down
```

**Why this matters:** You can ship Phase 0 in Week 2 and have a working app. Each subsequent AI layer adds magic without breaking what already works. Voice braindumps save their raw transcript immediately (Layer 0 via on-device speech). AI dedup runs in the background (Layer 1). You never stare at a spinner waiting for OpenAI.

---

## System Architecture

```
┌─────────────────────┐     ┌─────────────────────┐
│   iPhone (SwiftUI)  │     │   Web (Next.js)      │
│                     │     │                      │
│  Layer 0: CRUD      │     │  Computer-focused:   │
│  Layer 1: Realtime  │     │  - Rich note editor  │
│           subs      │     │  - CRM management    │
│  Widget: App Group  │     │  - Task dashboard    │
└────────┬────────────┘     └──────────┬───────────┘
         │  Supabase Swift SDK         │  @supabase/supabase-js
         └──────────────┬──────────────┘
                        │
               ┌────────▼────────┐
               │  Supabase Cloud │
               │                 │
               │  PostgreSQL     │◄── ONE database
               │  + pgvector     │    both clients share
               │  Auth (JWT)     │
               │  Storage        │    (audio, photos)
               │  Realtime (CDC) │◄── live sync
               │  Edge Functions │◄── ALL AI calls
               │  pg_cron        │◄── scheduled jobs
               └────────┬────────┘
                        │
                   OpenAI API
              (async only, never blocking)
```

**Security principle:** OpenAI API key stored as Supabase Edge Function secret. Never in iOS binary or Next.js client. All AI calls originate server-side.

---

## Database Schema

### Setup

```sql
create extension if not exists "uuid-ossp";
create extension if not exists vector;
```

---

### Domain 1: Tasks + Braindump

```sql
create table tasks (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  title            text not null,
  status           text not null default 'pending'
                   check (status in ('pending','done','rolled_over')),
  due_date         date not null default current_date,
  raw_source       text,                  -- braindump fragment that generated this
  mode_at_creation text,                  -- which mode was active
  ai_merged_from   uuid references tasks(id),  -- if merged from another task
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
create index on tasks(user_id, due_date, status);  -- composite for widget queries

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
  audio_path        text,                  -- Supabase Storage path (optional — if Whisper used)
  raw_transcript    text,                  -- saved immediately from on-device speech
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
```

---

### Domain 2: Contextual Modes

```sql
create table location_anchors (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  label         text not null,         -- "Home", "Office", "Gym"
  mode          text not null check (mode in ('home','work','car','gym','default')),
  latitude      double precision not null,
  longitude     double precision not null,
  radius_meters int not null default 150,
  created_at    timestamptz default now()
);
-- iOS enforces max 15 anchors per user (CoreLocation hard limit = 20 regions)

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
```

---

### Domain 3: Personal CRM

```sql
create table contacts (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  name              text not null,
  how_we_met        text,
  relationship_tier text not null default 'acquaintance'
                    check (relationship_tier in ('family','close_friend','friend','acquaintance')),
  last_contacted_at timestamptz,   -- auto-updated by trigger below
  avatar_path       text,          -- Supabase Storage
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
  media_path  text,   -- Supabase Storage
  created_at  timestamptz default now()
);

-- Auto-update last_contacted_at when social events are logged
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

-- CRM reminder intervals by tier (enforced in pg_cron scheduler):
-- family=2 days, close_friend=7, friend=14, acquaintance=30

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
```

---

### Domain 4: Notes + RAG

```sql
create table notes (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  title             text,
  content           text not null,
  category          text,               -- AI Layer 1 result
  tags              text[] default '{}', -- AI Layer 1 result
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
  embedding   vector(1536),   -- text-embedding-3-small: 1536 dimensions
  created_at  timestamptz default now()
);

-- HNSW index chosen over IVFFlat because:
-- 1. No training data needed (IVFFlat needs ~10x row count to train)
-- 2. Better recall at small scale (<10k personal notes)
-- 3. m=16, ef_construction=64 are recommended defaults for personal scale
create index note_chunks_hnsw on note_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
create index on note_chunks(note_id);

-- Search function (called by fn-search-notes Edge Function)
create or replace function search_notes(
  query_embedding vector(1536),
  match_count     int,
  p_user_id       uuid,
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
```

---

## Edge Functions (All AI Lives Here)

### 1. `fn-process-braindump`
**Trigger:** pg_cron polls `braindump_jobs WHERE processing_status='pending'` every 2 minutes

```typescript
// Dedup algorithm — three-tier cosine similarity:
// 1. Embed each candidate task with text-embedding-3-small
// 2. Fetch today's existing task embeddings (or compute on-the-fly)
// 3. Cosine similarity comparison:
//    > 0.85 → auto-merge (e.g., "buy milk" ≈ "get milk from store")
//    0.65–0.85 → flag as possible duplicate for user review (Layer 2 nudge)  
//    < 0.65 → create as new task

// GPT-4o function-calling schema for task extraction:
const extractionTool = {
  type: "function",
  function: {
    name: "submit_tasks",
    description: "Submit extracted and deduplicated tasks",
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["create", "merge", "possible_duplicate"] },
              title: { type: "string" },
              existing_id: { type: "string", description: "UUID of task to merge into" }
            },
            required: ["action", "title"]
          }
        }
      },
      required: ["tasks"]
    }
  }
};

// Failure handling:
// - On OpenAI error: UPDATE processing_status='failed', retry_count++
// - pg_cron retries failed jobs every 5 min (up to 3 retries)
// - After 3 retries: stays 'failed', raw_transcript preserved
// - User still has their raw transcript — zero data loss
```

### 2. `fn-embed-note`
**Trigger:** pg_cron polls `notes WHERE processing_status='pending'` every 2 minutes

```
Chunking strategy:
  1. Split on double newlines (paragraph boundaries)
  2. Max 300 tokens per chunk (≈1200 chars)
  3. 50-token overlap between adjacent chunks for context continuity
  4. Single chunk if entire note < 300 tokens

Pipeline:
  1. SET processing_status = 'processing'
  2. Chunk content per strategy above
  3. Embed all chunks in parallel → vector(1536) each
  4. DELETE old note_chunks WHERE note_id = this note (handles re-edits)
  5. INSERT new note_chunks with embeddings
  6. GPT-4o-mini: assign category + 3-5 tags
  7. UPDATE notes SET category, tags, processing_status='done'
  8. On failure: SET processing_status='failed', retry_count++
```

### 3. `fn-search-notes` (called by client HTTP POST)
```
Input: { query: string, limit?: number }
1. Embed query with text-embedding-3-small
2. Call search_notes() DB function (cosine similarity > 0.5)
3. Return top-N unique notes sorted by similarity
```

### 4. `fn-crm-scheduler` (pg_cron daily 9am UTC)
```sql
-- Pure SQL Layer 0 scheduler — no AI required
select cron.schedule('crm-daily', '0 9 * * *', $$
  -- Insert push notifications for overdue contacts
  with overdue as (
    select c.id, c.name, c.user_id,
           upt.device_token,
           case c.relationship_tier
             when 'family' then 2
             when 'close_friend' then 7
             when 'friend' then 14
             else 30
           end as interval_days
    from contacts c
    join user_push_tokens upt on upt.user_id = c.user_id
    where c.last_contacted_at < now() - (
      case c.relationship_tier
        when 'family' then interval '2 days'
        when 'close_friend' then interval '7 days'
        when 'friend' then interval '14 days'
        else interval '30 days'
      end
    )
    or c.last_contacted_at is null
  )
  select net.http_post(
    url := current_setting('app.edge_url') || '/fn-send-push',
    body := json_build_object(
      'device_token', device_token,
      'title', 'Say hi to ' || name,
      'body', 'Keep in touch — send a photo or message',
      'data', json_build_object('type','crm_reminder','contact_id',id)
    )::jsonb
  ) from overdue;
$$);
```

### 5. `fn-draft-catchup` (on-demand from client)
```
Input: { contact_id, life_update_text? }
1. Fetch contact: name, tier, last 3 contact_events
2. GPT-4o-mini prompt:
   System: "Draft a warm, casual {tier} message. 1-2 sentences max."
   User: "For {name}. Update: {life_update}. Recent context: {events}"
3. Return: { draft: string }
Cost: ~$0.0001 per draft (GPT-4o-mini)
```

---

## iOS App Architecture (SwiftUI)

### Module Structure
```
LifeOS/
├── App/
│   ├── LifeOSApp.swift           -- entry, Supabase init, push registration
│   └── AppState.swift            -- @Observable: currentMode, userId
├── Core/
│   ├── SupabaseClient.swift      -- singleton: SupabaseClient(url:, key: anon_key)
│   └── RealtimeManager.swift    -- task + note subscriptions
├── Braindump/
│   ├── BraindumpView.swift       -- hold-to-record button
│   ├── SpeechRecognizer.swift    -- SFSpeechRecognizer on-device (Layer 0, free)
│   └── TaskListView.swift        -- today's tasks + rollover button
├── Modes/
│   ├── GeofenceManager.swift     -- CLLocationManager, max 15 CLCircularRegions
│   └── LifeOSFocusFilter.swift   -- SetFocusFilterIntent
├── CRM/
│   ├── ContactsView.swift
│   └── ContactDetailView.swift   -- timeline + "Draft Message" button
├── Notes/
│   └── NoteSearchView.swift      -- search-first UI, calls fn-search-notes
└── WidgetExtension/              -- separate Xcode target
    └── TaskWidget.swift
```

### Voice Braindump — Layer 0 (instant, on-device, free)

```swift
import Speech

class SpeechRecognizer {
    private let recognizer = SFSpeechRecognizer()!

    func transcribeAndSave() async {
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true  // private, offline, zero cost
        request.shouldReportPartialResults = true
        
        // User sees live transcription as they speak
        // On stop:
        let job = BraindumpJob(
            userId: AppState.shared.userId,
            rawTranscript: transcript,   // saved immediately — Layer 0
            processingStatus: .pending   // AI picks up async — Layer 1
        )
        try await supabase.from("braindump_jobs").insert(job)
        // Realtime subscription delivers tasks when Edge Function finishes
    }
}
```

**Required permissions:** `NSSpeechRecognitionUsageDescription`, `NSMicrophoneUsageDescription`

### WidgetKit — Task Widget

**App Group ID:** `group.com.yourname.lifeos`

```swift
// Main app: write to App Group when tasks change (driven by Realtime)
func syncTasksToWidget(_ tasks: [Task]) {
    let defaults = UserDefaults(suiteName: "group.com.yourname.lifeos")!
    let data = try! JSONEncoder().encode(tasks.filter { $0.status == .pending }.prefix(5))
    defaults.set(data, forKey: "todayTasks")
    WidgetCenter.shared.reloadTimelines(ofKind: "TaskWidget")
    // reloadTimelines is cheap — doesn't consume the 40-70/day budget
    // Budget refreshes (policy: .after(midnight)) happen once/day
}

// Widget extension: reads App Group — ZERO network calls in widget
struct TaskProvider: TimelineProvider {
    func getTimeline(in context: Context, completion: @escaping (Timeline<TaskEntry>) -> Void) {
        let defaults = UserDefaults(suiteName: "group.com.yourname.lifeos")!
        let tasks = decode(defaults.data(forKey: "todayTasks"))
        let midnight = Calendar.current.startOfDay(for: Date().addingTimeInterval(86400))
        // .after(midnight) = WidgetKit won't budget-consume a refresh before midnight
        // Task changes trigger reloadTimelines() from main app instead
        completion(Timeline(entries: [TaskEntry(date: .now, tasks: tasks)], policy: .after(midnight)))
    }
}
```

**Entitlements:** Add App Group `group.com.yourname.lifeos` to both main target and widget extension.

### Geofencing (CoreLocation)

```swift
class GeofenceManager: NSObject, CLLocationManagerDelegate {
    let lm = CLLocationManager()
    let MAX_REGIONS = 15  // iOS hard limit = 20; keep 5 spare for safety

    func registerAnchors(_ anchors: [LocationAnchor]) {
        lm.monitoredRegions.forEach { lm.stopMonitoring(for: $0) }
        for anchor in anchors.prefix(MAX_REGIONS) {
            let region = CLCircularRegion(
                center: CLLocationCoordinate2D(latitude: anchor.latitude, longitude: anchor.longitude),
                radius: Double(anchor.radiusMeters),
                identifier: anchor.id.uuidString
            )
            region.notifyOnEntry = true
            region.notifyOnExit = true
            lm.startMonitoring(for: region)
        }
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        guard let anchor = findAnchor(by: region.identifier) else { return }
        AppState.shared.setMode(anchor.mode, trigger: .geofence)
        Task { try await supabase.from("mode_history").insert([...]) }
    }
}
```

**Required permission:** `NSLocationAlwaysAndWhenInUseUsageDescription` (Always required for background geofencing)  
**Car mode:** no GPS anchor — uses iOS Driving Focus → triggers LifeOS Focus Filter

### iOS Focus Modes — App Intent

```swift
import AppIntents

struct LifeOSFocusFilter: SetFocusFilterIntent {
    static var title: LocalizedStringResource = "Set LifeOS Mode"
    
    @Parameter(title: "Mode") var mode: AppModeEntity
    
    func perform() async throws -> some IntentResult {
        AppState.shared.setMode(mode.mode, trigger: .focusFilter)
        return .result()
    }
}
```

**Required entitlement:** `com.apple.developer.usernotifications.focus-filter-intents = true`  
**Info.plist:** `NSFocusStatusUsageDescription`  
**User setup:** Settings → Focus → [FocusName] → App Filters → LifeOS → Mode = Work/Car/etc.

### Background Execution Notes
- **Geofencing:** runs passively — no BGTaskScheduler needed. CoreLocation wakes app on region entry/exit.
- **Realtime subscriptions:** active only when app is foregrounded. Widget updates via push notification on CRM reminders.
- **Voice recording:** AVAudioSession with `.record` category, active only during braindump session.

---

## Next.js Web App — Computer-Input Layer

**Asymmetric UX design:**
- Computer: rich note creation, CRM management, task review
- Phone: task capture, note retrieval search, CRM reminders

```
app/
├── page.tsx                      -- dashboard: today's tasks + overdue contacts
├── notes/
│   ├── page.tsx                  -- knowledge base grid/list
│   ├── new/page.tsx              -- RICH TEXT EDITOR (TipTap)
│   │                                shows "Categorizing..." → tags appear via Realtime
│   └── [id]/page.tsx
├── contacts/
│   ├── page.tsx                  -- CRM list, color-coded overdue indicator
│   └── [id]/page.tsx            -- timeline + AI draft message
├── settings/
│   └── locations/page.tsx       -- manage geofence anchors
└── lib/
    └── supabase.ts               -- createBrowserClient(@supabase/ssr)
```

**Note editor — Realtime tag update:**
```typescript
// After saving a note, subscribe to its processing_status update
supabase.channel(`note-${noteId}`)
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notes',
      filter: `id=eq.${noteId}` },
    (payload) => {
      if (payload.new.processing_status === 'done') {
        setNote(n => ({ ...n, category: payload.new.category, tags: payload.new.tags }));
        // Tags/category appear on the note card in real-time — Layer 1 magic
      }
    })
  .subscribe();
```

---

## OpenAI Cost Estimate

**Model pricing (mid-2025):** GPT-4o: $5/$15 per M tokens in/out. GPT-4o-mini: $0.15/$0.60 per M. Whisper: $0.006/min. text-embedding-3-small: $0.02/M tokens.

**Daily usage assumptions:** 2 braindumps (on-device speech = free by default), 5 notes × 500 words, 10 searches, 3 CRM drafts/week.

| Operation | Model | Daily calls | In tokens | Out tokens | Daily cost |
|---|---|---|---|---|---|
| Braindump transcription | Whisper (opt-in) | 0* | — | — | $0 default |
| Task extraction + dedup | GPT-4o | 2 | 900 | 250 | $0.0123 |
| Note categorization | GPT-4o-mini | 5 | 600 | 80 | $0.0005 |
| Note embedding | embed-3-small | 5 notes × 3 chunks | 300 | — | $0.00009 |
| Search embedding | embed-3-small | 10 | 25 | — | $0.000005 |
| CRM draft (3/week) | GPT-4o-mini | 0.43 | 400 | 100 | $0.00009 |

**Default total: ~$0.013/day → ~$0.40/month**  
**With Whisper opt-in (2 × 3min): +$0.036/day → ~$1.50/month**

**Cost controls:**
- On-device SFSpeechRecognizer is default (free, private, zero latency)
- Whisper API is opt-in "Enhanced Accuracy" toggle in settings
- GPT-4o-mini for categorization + CRM drafts (10x cheaper than GPT-4o)
- Only task extraction uses GPT-4o (where quality matters most for dedup)
- Don't re-embed notes on minor edits (compare content hash before triggering)
- Hard cap: track daily spend in a `daily_usage` table; Edge Function aborts if over limit

---

## Phased Build Plan

### Phase 0 — CRUD Foundation (Weeks 1-2)
**Zero AI. Zero OpenAI cost. Validate schema.**
- Week 1: Supabase project, all 4 domain schemas + RLS, Supabase Auth, SwiftUI task CRUD
- Week 2: WidgetKit widget + App Group, rollover button, basic Next.js note + contact CRUD

**Ship:** Working task manager + widget. Real data, real schema. You'll use this daily.

### Phase 1 — Voice Braindump (Week 3)
**Layer 0 still. Free.**
- iOS: SFSpeechRecognizer on-device transcription
- Save raw transcript → user sees text immediately
- Tasks created manually from transcript (no AI yet — validates the flow)
- `processing_status` column plumbed but AI step is a no-op

**Ship:** Voice-to-text braindump. Already valuable. Proves the widget integration works.

### Phase 2 — AI Task Extraction + Dedup (Week 4)
**First AI. ~$0.40/month.**
- `fn-process-braindump` Edge Function with GPT-4o function-calling
- Cosine dedup algorithm (0.85/0.65 thresholds)
- pg_cron retry logic (every 5 min, max 3 retries)
- Failure handling: raw transcript always preserved

**Ship:** Magic braindump-to-tasks with intelligent dedup.

### Phase 3 — Contextual Modes (Weeks 5-6)
**No AI cost.**
- CoreLocation geofencing, GeofenceManager.swift (≤15 anchors)
- Focus Filter App Intent (entitlement + Info.plist)
- Mode-aware task filtering (widget shows mode-relevant tasks)
- mode_history logging + location anchor settings UI on web

**Ship:** App auto-switches Home/Work/Gym/Car modes.

### Phase 4 — Personal CRM (Weeks 7-8)
**~$0.00/month for reminders (pure SQL), $0.0001/draft on-demand.**
- Contacts + contact_events, last_contacted_at trigger
- pg_cron daily reminder scheduler (pure SQL — Layer 0)
- Push notifications via Supabase + APNs
- `fn-draft-catchup` GPT-4o-mini (Layer 1, on-demand only)

**Ship:** Daily relationship reminders + one-tap AI message drafts.

### Phase 5 — Notes + Semantic Search (Weeks 9-11)
**~$1.50/month total with all features.**
- Next.js TipTap rich text editor
- `fn-embed-note` pg_cron pipeline (paragraph chunking, HNSW index)
- `fn-search-notes` semantic search
- iOS search-first note retrieval view
- Auto-categorization + tags via Realtime

**Ship:** Full semantic knowledge base. Computer for input, phone for retrieval.

---

## Key Design Decisions Justified

| Decision | Why |
|---|---|
| On-device SFSpeechRecognizer as default | Free, private, zero latency. Whisper is opt-in for accuracy. |
| pg_cron for AI jobs (not DB webhooks) | Webhooks are synchronous in the write path. pg_cron is truly async. |
| HNSW over IVFFlat | No training data needed; better recall at <10k vector scale. |
| Paragraph-aware chunking | Preserves semantic units better than fixed-char splits. |
| Cosine 0.85/0.65 dedup thresholds | Avoids false merges (auto-merge only on near-exact duplicates). |
| App Group for widgets | WidgetKit cannot make network calls directly — App Group is the iOS-native pattern. |
| Focus Filter App Intent | The correct iOS API for programmatic Focus Mode integration (SetFocusFilterIntent). |
| GPT-4o-mini for categorization | Classification is a simple task. GPT-4o-mini is 10x cheaper with adequate quality. |
| `retry_count` + max 3 retries | Prevents infinite retry loops while surviving transient OpenAI outages. |
| Layer 0 ships first | De-risks schema design before AI complexity is added. Always usable. |
