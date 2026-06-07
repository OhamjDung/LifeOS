# LifeOS Architecture — Solution C: Progressive Enhancement
Approach: Ship CRUD first, AI never blocks core functionality

---

## Core Philosophy

Three layers, each independently valuable:

```
Layer 2 — AI Proactive  (smart nudges, suggestions, cross-feature insights)
Layer 1 — AI Async      (background embedding, categorization, dedup suggestions)
Layer 0 — CRUD Core     (always works, even when OpenAI is down)
```

Every feature works at Layer 0. AI at Layers 1 and 2 enhances but never gates. The app ships Layer 0 first — a clean, fast task manager + contact tracker + note store. Then AI gets layered on.

---

## System Overview

```
iPhone (SwiftUI)              Web (Next.js)
   │                              │
   └──────────────┬───────────────┘
                  │ Supabase client SDKs
                  │ (direct table access for Layer 0)
                  │ (Edge Function calls for Layer 1+2)
            Supabase Cloud
     ┌──────────────────────────────┐
     │ PostgreSQL + pgvector        │
     │ Auth                         │
     │ Storage                      │
     │ Realtime (CDC)               │
     │ Edge Functions               │
     │  └── called async by        │
     │       pg_cron + pg_net       │
     └──────────────────────────────┘
                  │
           OpenAI API (async only)
```

---

## Database Schema

### `processing_status` State Machine

Every AI-enhanced row follows this state machine:

```
pending ──► processing ──► done
   │              │
   └──► failed ◄──┘
         │
         └──► pending  (auto-retry after 5 min via pg_cron)
```

- **pending**: just created/modified, AI hasn't run yet
- **processing**: Edge Function is working on it
- **done**: AI enhancement complete
- **failed**: AI call errored; app shows data without AI enhancement (graceful)

UI behavior: show data immediately (Layer 0). Show AI enhancements (tags, categories, merged tasks) once `processing_status = 'done'`. A subtle "Categorizing..." badge shows while pending/processing.

---

### Full Schema

```sql
create extension if not exists "uuid-ossp";
create extension if not exists vector;

-- ============================================================
-- TASKS
-- ============================================================

create table tasks (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null,
  status          text not null default 'pending'
                  check (status in ('pending','done','rolled_over')),
  due_date        date not null default current_date,
  raw_source      text,                -- braindump transcript fragment
  mode_at_creation text,               -- which mode was active
  ai_merged_from  uuid references tasks(id), -- if this task was merged from another
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index on tasks(user_id, due_date);
create index on tasks(user_id, status);

create table braindump_jobs (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  audio_path        text,
  raw_transcript    text,              -- saved immediately from on-device speech (Layer 0)
  processing_status text not null default 'pending'
                    check (processing_status in ('pending','processing','done','failed')),
  retry_count       int not null default 0,
  last_error        text,
  created_at        timestamptz default now()
);

create table task_rollovers (
  id        uuid primary key default uuid_generate_v4(),
  task_id   uuid not null references tasks(id) on delete cascade,
  from_date date not null,
  to_date   date not null,
  rolled_at timestamptz default now()
);

-- ============================================================
-- MODES
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

-- ============================================================
-- CONTACTS / CRM
-- ============================================================

create table contacts (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  name              text not null,
  notes             text,              -- how we met, context
  relationship_tier text not null default 'acquaintance'
                    check (relationship_tier in ('family','close_friend','friend','acquaintance')),
  last_contacted_at timestamptz,
  avatar_path       text,
  apns_device_token text,             -- for push; updated on app launch
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- Tier → reminder interval (days)
-- family=2, close_friend=7, friend=14, acquaintance=30
-- This is Layer 0 logic — no AI needed for basic scheduling

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

-- Trigger: auto-update last_contacted_at on social events
create or replace function sync_last_contacted() returns trigger language plpgsql as $$
begin
  if new.event_type in ('photo_sent','message_sent','met') then
    update contacts set last_contacted_at = new.created_at, updated_at = now()
    where id = new.contact_id;
  end if;
  return new;
end;
$$;
create trigger trg_last_contacted
  after insert on contact_events
  for each row execute function sync_last_contacted();

-- ============================================================
-- NOTES + RAG
-- ============================================================

create table notes (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  title             text,
  content           text not null,
  category          text,             -- AI Layer 1 result
  tags              text[] default '{}', -- AI Layer 1 result
  source_platform   text default 'web',
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
  embedding   vector(1536),           -- text-embedding-3-small, 1536 dims
  created_at  timestamptz default now()
);

-- HNSW index: chosen over IVFFlat because:
-- 1. No training data needed (IVFFlat needs ~10x the row count to train)
-- 2. Better recall at small dataset sizes (personal notes = <10k vectors)
-- 3. m=16 and ef_construction=64 are recommended defaults for personal scale
create index note_chunks_hnsw on note_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
create index on note_chunks(note_id);

-- ============================================================
-- RLS
-- ============================================================

alter table tasks enable row level security;
create policy tasks_rls on tasks using (auth.uid() = user_id);

alter table braindump_jobs enable row level security;
create policy braindump_rls on braindump_jobs using (auth.uid() = user_id);

alter table task_rollovers enable row level security;
create policy rollovers_rls on task_rollovers
  using (task_id in (select id from tasks where user_id = auth.uid()));

alter table location_anchors enable row level security;
create policy anchors_rls on location_anchors using (auth.uid() = user_id);

alter table mode_history enable row level security;
create policy mode_rls on mode_history using (auth.uid() = user_id);

alter table contacts enable row level security;
create policy contacts_rls on contacts using (auth.uid() = user_id);

alter table contact_events enable row level security;
create policy events_rls on contact_events using (auth.uid() = user_id);

alter table notes enable row level security;
create policy notes_rls on notes using (auth.uid() = user_id);

alter table note_chunks enable row level security;
create policy chunks_rls on note_chunks
  using (note_id in (select id from notes where user_id = auth.uid()));
```

---

## AI Pipelines (Layer 1 — never blocking)

### Braindump Processing

**Layer 0 (immediate, no AI):**
1. iOS captures voice audio
2. Apple Speech framework transcribes on-device (no API cost, instant)
3. Raw transcript saved to `braindump_jobs.raw_transcript`
4. User sees raw text immediately — "Here's what I heard:"
5. INSERT into `braindump_jobs` with `processing_status='pending'`

**Layer 1 (async, within ~10 seconds):**
- pg_net POST to Edge Function `fn-process-braindump`
- Whisper API re-transcribes for higher accuracy (optional — can skip if on-device is good enough)
- GPT-4o extracts structured tasks + runs dedup against today's existing tasks
- Dedup algorithm:
  1. For each new candidate task, compute text-embedding-3-small embedding
  2. Compare cosine similarity against today's task embeddings (fetched from DB)
  3. If similarity > 0.85: merge (update existing task title to more complete version)
  4. If 0.65-0.85: flag as "possible duplicate" for user review (Layer 2 nudge)
  5. If < 0.65: create as new task
- Supabase Realtime notifies iOS → tasks list updates
- `processing_status` → 'done'

**Failure handling:**
- If OpenAI call fails: `processing_status='failed'`, `retry_count++`
- pg_cron retries failed jobs every 5 minutes (up to 3 retries)
- After 3 failures: stays in 'failed', raw transcript is preserved, user can manually create tasks

```sql
-- pg_cron: retry failed braindump jobs every 5 min
select cron.schedule('retry-braindumps', '*/5 * * * *', $$
  select net.http_post(
    url := current_setting('app.edge_function_url') || '/fn-process-braindump-retry',
    body := '{"retry": true}'::jsonb
  ) from braindump_jobs
  where processing_status = 'failed' and retry_count < 3
  limit 5;
$$);
```

### Note Embedding (Layer 1)

```
Note saved → processing_status='pending' → Supabase Realtime → 
  UI shows "Categorizing..." badge

pg_cron runs every 2 minutes:
  SELECT * FROM notes WHERE processing_status = 'pending' LIMIT 10

For each:
1. SET processing_status = 'processing'
2. Chunk content (paragraph-aware):
   - Split on double newlines
   - Max 300 tokens per chunk (≈1200 chars)
   - 50-token overlap for context continuity
   - Single chunk if < 300 tokens total
3. Embed all chunks: text-embedding-3-small → vector(1536)
4. DELETE old note_chunks, INSERT new ones
5. GPT-4o-mini: assign category + 3-5 tags
6. UPDATE notes: category, tags, processing_status='done'

Supabase Realtime → iOS/web shows tags/category appear on note card
```

### Semantic Search

```
User types search query on iOS (search bar) or web
→ Call fn-search-notes Edge Function
→ Embed query (text-embedding-3-small)
→ pgvector HNSW cosine search with similarity > 0.5 threshold
→ Return top 10 unique notes sorted by similarity
→ Display with similarity score hints (optional)

SQL:
SELECT n.id, n.title, nc.chunk_text,
       1 - (nc.embedding <=> $1) as similarity
FROM note_chunks nc
JOIN notes n ON n.id = nc.note_id
WHERE n.user_id = $2
  AND 1 - (nc.embedding <=> $1) > 0.5
ORDER BY nc.embedding <=> $1
LIMIT 10
```

### CRM Reminders (Layer 0 + Layer 1)

**Layer 0:** pg_cron daily scheduler — pure SQL, no AI:
```sql
-- Runs daily 9am UTC
-- Computes overdue contacts based on tier intervals
-- Inserts push notifications into a queue table
-- Sends via Supabase push (or pg_net to APNs directly)
```

**Layer 1 (on-demand):** User taps "Draft Message" on a contact → calls `fn-draft-catchup` Edge Function:
```
Input: contact_id + life_update_text (optional)
Fetch: contact name, tier, last 3 events from contact_events
Prompt: GPT-4o-mini
  System: "You are drafting a {tier} message. Be warm and personal. 1-2 sentences."
  User: "For {name}. Life update: {update}. Recent context: {events}"
Return: { draft: string }
```

---

## iOS App Architecture

### Structure
```
LifeOS/
  ├── App/
  │   ├── LifeOSApp.swift          -- entry, Supabase init, push token registration
  │   └── AppState.swift           -- @Observable: currentMode, userId
  ├── Core/
  │   ├── SupabaseManager.swift    -- singleton client
  │   └── PushNotificationHandler.swift
  ├── Braindump/
  │   ├── BraindumpView.swift      -- hold-to-record button
  │   ├── SpeechRecognizer.swift   -- SFSpeechRecognizer (on-device, Layer 0)
  │   └── TaskListView.swift       -- shows today's tasks
  ├── Modes/
  │   ├── GeofenceManager.swift    -- CLLocationManager, region monitoring
  │   └── LifeOSFocusFilter.swift  -- SetFocusFilterIntent
  ├── CRM/
  │   ├── ContactsView.swift
  │   └── ContactDetailView.swift
  ├── Notes/
  │   └── NoteSearchView.swift     -- phone: search-first UI
  └── WidgetExtension/
      └── TaskWidget.swift
```

### Voice Recording — Layer 0 (on-device, instant)

```swift
import Speech

class SpeechRecognizer: ObservableObject {
    private let recognizer = SFSpeechRecognizer(locale: .current)!
    private var recognitionTask: SFSpeechRecognitionTask?
    
    @Published var transcript = ""
    
    func startRecognition() {
        // On-device recognition: SFSpeechRecognizer with requiresOnDeviceRecognition = true
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true  // free, offline, private
        request.shouldReportPartialResults = true
        // User sees live transcription as they speak
    }
    
    func stopAndSubmit() async {
        // Layer 0: save raw transcript immediately
        let job = BraindumpJob(rawTranscript: transcript, processingStatus: .pending)
        try await supabase.from("braindump_jobs").insert(job)
        // Layer 1: Edge Function picks it up asynchronously via pg_cron
    }
}
```

### WidgetKit — Task Widget

**App Group:** `group.com.yourname.lifeos`

```swift
// Main app: update widget data when tasks change
class TaskSync {
    func syncToWidget(_ tasks: [Task]) {
        let defaults = UserDefaults(suiteName: "group.com.yourname.lifeos")!
        let data = try! JSONEncoder().encode(tasks.filter { $0.status == .pending }.prefix(5))
        defaults.set(data, forKey: "todayTasks")
        defaults.set(Date(), forKey: "lastSynced")
        WidgetCenter.shared.reloadTimelines(ofKind: "TaskWidget")
    }
}

// Widget extension: reads from App Group — zero network calls
struct TaskProvider: TimelineProvider {
    func getTimeline(in context: Context, completion: @escaping (Timeline<TaskEntry>) -> Void) {
        let defaults = UserDefaults(suiteName: "group.com.yourname.lifeos")!
        let tasks = decode(defaults.data(forKey: "todayTasks"))
        
        let now = Date()
        let midnight = Calendar.current.startOfDay(for: now.addingTimeInterval(86400))
        
        // Policy: .after(midnight) means WidgetKit won't budget-refresh before midnight.
        // Actual task changes trigger reloadTimelines() from the main app.
        // This conserves the daily widget refresh budget (40-70 refreshes/day).
        let timeline = Timeline(
            entries: [TaskEntry(date: now, tasks: tasks)],
            policy: .after(midnight)
        )
        completion(timeline)
    }
}
```

### Geofencing (CoreLocation)

```swift
class GeofenceManager: NSObject, CLLocationManagerDelegate {
    let lm = CLLocationManager()
    
    // iOS hard limit: 20 simultaneous monitored regions
    // Strategy: max 15 user anchors (leaves room for system + future)
    let MAX_REGIONS = 15
    
    func registerAnchors(_ anchors: [LocationAnchor]) {
        // Clear existing
        lm.monitoredRegions.forEach { lm.stopMonitoring(for: $0) }
        
        // Register up to MAX_REGIONS
        for anchor in anchors.prefix(MAX_REGIONS) {
            let region = CLCircularRegion(
                center: .init(latitude: anchor.latitude, longitude: anchor.longitude),
                radius: Double(anchor.radiusMeters),
                identifier: anchor.id.uuidString
            )
            region.notifyOnEntry = true
            region.notifyOnExit = true
            lm.startMonitoring(for: region)
        }
    }
    
    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        guard let anchor = anchors.first(where: { $0.id.uuidString == region.identifier }) else { return }
        AppState.shared.setMode(anchor.mode, trigger: .geofence)
        // Persist to Supabase mode_history
        Task { try await supabase.from("mode_history").insert([...]) }
    }
}
```

**Car mode:** No geofence needed. iOS's built-in Driving Focus Mode triggers our Focus Filter:

### Focus Filter (App Intents)

```swift
import AppIntents

struct LifeOSFocusFilter: SetFocusFilterIntent {
    static var title: LocalizedStringResource = "Set LifeOS Mode"
    static var description = IntentDescription("Set which mode LifeOS uses in this Focus.")
    
    @Parameter(title: "Mode")
    var mode: AppModeEntity   // AppModeEntity: home, work, car, gym, default
    
    func perform() async throws -> some IntentResult {
        AppState.shared.setMode(mode.mode, trigger: .focusFilter)
        return .result()
    }
}

// Entitlement required: com.apple.developer.usernotifications.focus-filter-intents
// Info.plist: NSFocusStatusUsageDescription
// User configures in Settings > Focus > [FocusName] > App Filters > LifeOS
```

---

## Next.js Web App (Computer = Input Layer)

**Asymmetric UX design:**
- Computer web app: note creation, long-form input, CRM management, settings
- Phone app: task capture (braindump), note retrieval/search, CRM reminders

```
app/
  ├── page.tsx                    -- today dashboard: tasks + CRM reminders
  ├── notes/
  │   ├── page.tsx                -- knowledge base browser (grid/list)
  │   ├── new/page.tsx            -- FULL RICH TEXT EDITOR
  │   │                              • TipTap with markdown support
  │   │                              • shows processing_status badge
  │   │                              • tags appear when done
  │   └── [id]/page.tsx
  ├── contacts/
  │   ├── page.tsx                -- CRM list with overdue indicators
  │   └── [id]/page.tsx           -- contact timeline + draft message
  ├── settings/
  │   └── locations/page.tsx      -- geofence anchor management
  └── lib/
      └── supabase.ts             -- createBrowserClient(@supabase/ssr)
```

**Note editor processing_status UX:**
```typescript
// After creating a note, subscribe to its update via Realtime
const noteChannel = supabase
  .channel(`note-${noteId}`)
  .on('postgres_changes', {
    event: 'UPDATE', schema: 'public', table: 'notes',
    filter: `id=eq.${noteId}`
  }, (payload) => {
    if (payload.new.processing_status === 'done') {
      setNote(prev => ({ ...prev, category: payload.new.category, tags: payload.new.tags }));
      // Shows tags appearing in real-time — Layer 1 magic
    }
  })
  .subscribe();
```

---

## OpenAI Cost Estimate

**Models:** GPT-4o ($5/$15 per M in/out), GPT-4o-mini ($0.15/$0.60 per M), Whisper ($0.006/min), text-embedding-3-small ($0.02/M tokens)

| Operation | Model | Daily | In tokens | Out tokens | Daily cost |
|---|---|---|---|---|---|
| Braindump transcription | Whisper | 2 × 3min | — | — | $0.036 |
| Task extraction + dedup | GPT-4o | 2 | 800 | 250 | $0.0116 |
| Note embedding | embed-3-small | 5 notes × 3 chunks | 300/chunk | — | $0.00009 |
| Note categorization | GPT-4o-mini | 5 | 600 | 100 | $0.0005 |
| Search queries (embed) | embed-3-small | 15 | 25 | — | $0.000008 |
| CRM draft (3/week) | GPT-4o-mini | 0.43 | 400 | 100 | $0.00009 |

**Daily total: ~$0.049 → ~$1.50/month**

**Progressive cost controls (matching the architecture's philosophy):**
- Layer 0 ships first — zero AI costs until Layer 1 is enabled
- On-device speech (SFSpeechRecognizer) replaces Whisper by default — add Whisper as opt-in upgrade
- GPT-4o-mini for everything except task extraction (where quality matters most)
- Batch embed jobs (pg_cron every 2 min) vs per-insert triggers — reduces cold-start overhead
- Future: cache category+tags and don't re-embed unless content changes (check hash)

---

## Phased Build Plan

### Phase 0 — CRUD Foundation (Week 1-2)
**Layer 0 only. No AI. No cost.**
- Supabase project, all tables, RLS, Supabase Auth
- iOS: task list, manual task creation, rollover button
- Web: basic note CRUD, contacts CRUD
- WidgetKit widget (reads from App Group)

**Deliverable:** Fast, reliable CRUD app. Validates schema before adding complexity.

### Phase 1 — Voice Braindump (Week 3)
- iOS: SFSpeechRecognizer on-device transcription (Layer 0 — free)
- Save raw transcript → tasks manually parsed (users sees text, creates tasks themselves)
- `processing_status` plumbing without AI (just 'pending' → 'done' with no AI step)

**Deliverable:** Voice-to-text. Users already get value. AI dedup comes later.

### Phase 2 — AI Layer 1: Task Extraction (Week 4)
- `fn-process-braindump` Edge Function + pg_cron retry logic
- Dedup algorithm (embedding similarity + GPT-4o function calling)
- Failure handling: raw transcript always preserved

**Deliverable:** Magic braindump-to-tasks with dedup. First AI cost appears (~$0.05/day).

### Phase 3 — Modes (Week 5-6)
- CoreLocation geofencing, GeofenceManager.swift
- Focus Filter App Intent
- Mode-aware task filtering (show mode-relevant tasks in widget)

**Deliverable:** App auto-switches by location and Focus Mode.

### Phase 4 — CRM (Week 7-8)
- Contacts + contact_events, last-contacted tracking (Layer 0)
- pg_cron daily reminder scheduler (Layer 0)
- `fn-draft-catchup` GPT-4o-mini (Layer 1)
- Push notifications via Supabase

**Deliverable:** Daily relationship reminders + one-tap AI message drafts.

### Phase 5 — Notes + RAG (Week 9-11)
- Next.js rich text editor (TipTap)
- `fn-embed-note` pg_cron pipeline
- `fn-search-notes` semantic search
- iOS search-first note retrieval view
- Auto-categorization + tags display

**Deliverable:** Full semantic knowledge base. Computer for input, phone for retrieval.

---

## Self-Verification

**Q1: What if OpenAI is down for a day?**
Layer 0 keeps working: tasks created manually or via raw transcript, notes saved without tags/category, CRM reminders still fire (pure SQL), geofencing still works. `processing_status='failed'` rows queue up and process when OpenAI recovers. No user-facing breakage.

**Q2: Does the widget work on first app launch before any Realtime sync?**
Yes — on app launch, the main app fetches today's tasks and writes to the App Group immediately. The widget reads the App Group data. If it's the first ever launch, the widget shows "No tasks yet" — correct behavior.

**Q3: Can this architecture support 20+ geofence anchors in the future?**
Not with CoreLocation (hard 20-region iOS limit). Mitigation: prioritize the 15 most recently visited anchors (tracked by mode_history). Or: detect significant location changes with `CLLocationManager.startMonitoringSignificantLocationChanges()` and batch-check which anchor the user is near — but this is less battery-efficient. This limit should be called out to the user in settings.

**Q4: How does the dedup algorithm avoid false merges?**
Three-tier approach: (1) cosine similarity > 0.85 = auto-merge (very high confidence, e.g., "buy milk" + "get milk from store"); (2) 0.65-0.85 = show user a "Did you mean to add X? It looks similar to Y" notification (Layer 2); (3) < 0.65 = create new. This prevents aggressive auto-merging while still catching obvious duplicates.

**Q5: Is there any sensitive data risk with sending braindump audio to OpenAI?**
Yes — voice memos can contain personal information. Mitigations: (1) use SFSpeechRecognizer on-device by default (no data leaves device); (2) only send to Whisper API if user opts in to "Enhanced accuracy mode"; (3) OpenAI API terms include data handling commitments; (4) audio is deleted from Supabase Storage after successful processing (30-day retention max via Storage lifecycle rules).
