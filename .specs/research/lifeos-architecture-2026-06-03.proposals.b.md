# LifeOS Architecture Proposals — Agent B
Date: 2026-06-03

## Problem Decomposition

**Core problem:** A personal OS that unifies task management, relationship tracking, context-aware UX, and knowledge retrieval across phone and computer — with AI augmenting every layer.

**Key constraints:**
- One Supabase instance: auth + DB + storage + realtime + edge functions
- SwiftUI + Next.js clients — can't share code between them
- Background processing on iOS is heavily restricted
- Solo dev: complexity budget is finite

**Critical subproblems:**
1. Schema design — how 4 distinct feature domains share tables without becoming a mess
2. AI timing — blocking vs non-blocking OpenAI calls and their UX impact  
3. Widget reliability — WidgetKit's 40KB data limit and no direct network calls
4. Geofence accuracy — battery vs precision tradeoffs for mode switching
5. CRM notification reliability — push at right time without annoying the user

---

## Approach 1: Feature-Isolated Schema with Shared Auth

**Summary:** Each of the 4 features owns its own set of tables with minimal cross-table joins; shared auth and user_id foreign keys tie everything together.

**Description:**
The Supabase schema is organized into four "domains" — tasks, modes, contacts, and notes — each with their own table groups. Tasks have `tasks`, `task_rollover_history`. Contacts have `contacts`, `contact_events`, `contact_relationship_tiers`. Notes have `notes`, `note_embeddings`. Modes have `user_modes`, `location_anchors`. The only shared column is `user_id` referencing `auth.users`.

This domain isolation means the iOS app, Next.js app, and Edge Functions can work on features independently without touching each other's tables. RLS policies are defined per domain. AI processing (embeddings, task extraction) happens via Supabase Edge Functions triggered by DB inserts.

For the iOS app, this translates naturally to Swift modules — one per feature domain. Each module has its own Supabase query layer. The Next.js app has the same structure with separate route groups.

**Key design decisions:**
- Feature-isolated tables, not a unified "items" table
- RLS per feature domain
- Each domain has its own Edge Function for AI processing
- Cross-domain queries only happen for "context" (AI needs all domains as context)

**Trade-offs:**
- Gain: Clean separation, easy to reason about, easy to add/remove features
- Sacrifice: Slightly more tables, no unified "everything" feed without joins

**Probability:** 0.86
**Complexity:** Medium
**Risks:** Schema migrations need care as features evolve; no unified activity feed without complex joins; feature isolation may feel artificial as features interact more

---

## Approach 2: Unified "Items" Table with Type Discriminator

**Summary:** All user data (tasks, notes, contacts, events) flows through one `items` table with a `type` column and JSONB `data` field — flexible but schema-less.

**Description:**
Inspired by how Notion and Linear model data — everything is an "item" with a type. A task is `{type: "task", data: {title, due_date, status, mode}}`. A note is `{type: "note", data: {content, category, embedding_id}}`. A contact event is `{type: "contact_event", data: {contact_id, event_type, media_url}}`.

This gives extreme flexibility — adding a new data type is just defining a new `type` string. The iOS app and web app render differently based on type. AI processing is unified: one Edge Function handles all item types, routing to the right OpenAI call.

Supabase's JSONB querying with GIN indexes handles structured queries inside `data`. pgvector is a separate table referenced by `embedding_id`.

**Key design decisions:**
- Single `items` table with JSONB `data`
- Type-driven rendering on clients
- Unified AI pipeline — one Edge Function, routes by type
- Great for a "unified feed" / life log view

**Trade-offs:**
- Gain: Ultimate flexibility, easy to add types, natural for a life log, simple RLS
- Sacrifice: Loses type safety, complex JSONB queries harder to optimize, harder to reason about as the schema evolves

**Probability:** 0.75
**Complexity:** Medium
**Risks:** JSONB queries harder to debug; loses Postgres type safety; can become a ball of mud as data types proliferate; harder to write correct TypeScript types

---

## Approach 3: Supabase with Pre-computed AI Responses (Materialized AI)

**Summary:** Run AI processing eagerly at write time and store pre-computed results alongside raw data, so reads are always fast and no client-side AI latency.

**Description:**
Every write triggers an AI processing pipeline that runs to completion before acknowledging success. For a braindump: save audio → transcribe → extract tasks → dedup → save final tasks. The client shows a "processing" state. For a note: save text → embed → categorize → save with tags and embedding. The database always has complete, AI-processed data.

This is opposed to lazy/async AI processing where embeddings and categorization happen in the background. The trade-off is slightly slower writes but zero latency reads. The iOS widget always shows fully-processed tasks. Semantic search is always ready.

For deduplication specifically, this approach runs GPT-4o synchronously before committing new tasks, so the user immediately sees merged results rather than duplicates that get cleaned up later.

**Key design decisions:**
- Synchronous AI processing in the write path (via Edge Functions in transaction)
- Pre-computed embeddings and categories stored with source data
- "Processing" UI state while AI runs
- Read path is always clean, no lazy evaluation

**Trade-offs:**
- Gain: Consistent read state, no "pending" states in the DB, widgets always accurate
- Sacrifice: Write latency (Whisper + GPT-4o can take 3-5 seconds), Edge Function timeout risk

**Probability:** 0.78
**Complexity:** Medium
**Risks:** Edge Function timeout (default 2s, max 10s) — Whisper on large audio files may exceed; user waits 3-5s to see tasks; retry logic needed if AI call fails mid-transaction

---

## Approach 4: CRDTs for Conflict-Free Multi-Device Sync

**Summary:** Use Conflict-free Replicated Data Types (CRDTs) to handle simultaneous edits from phone and web without conflicts.

**Description:**
Using a CRDT library (Yjs or Automerge), all shared state (tasks, notes) is represented as conflict-free data structures. The iOS app and Next.js app each maintain local CRDT documents. Changes are broadcast via Supabase Realtime channels. No server-side merge logic needed — CRDT math handles conflicts deterministically.

For the task list specifically, an ordered set CRDT prevents duplicates and handles concurrent additions/completions. For notes, a text CRDT enables real-time collaborative editing between phone and web.

Supabase stores CRDT deltas (operation log) rather than current state. The current state is derived by replaying/merging deltas.

**Key design decisions:**
- Yjs documents for all mutable state
- Supabase stores CRDT deltas, not current values
- Realtime channels broadcast delta updates
- Both clients merge locally

**Trade-offs:**
- Gain: Zero conflicts, works offline, elegant eventual consistency
- Sacrifice: Complex to implement in Swift (Yjs is JS-native), CRDT overhead, harder to query server-side

**Probability:** 0.05
**Complexity:** Very High
**Risks:** No mature Yjs/Automerge Swift SDK; can't do server-side SQL queries on CRDT data; over-engineered for personal use where conflicts are rare; debugging CRDT state is very hard

---

## Approach 5: Serverless AI with Streaming Responses

**Summary:** AI operations use streaming HTTP responses (SSE) so the user sees tasks appearing in real-time as GPT-4o generates them, rather than waiting for the full response.

**Description:**
For the braindump flow specifically: the user records audio, it's sent to a Next.js API route (or Edge Function) that streams the OpenAI response back. As GPT-4o generates each task in JSON, the task appears in the UI immediately. This makes the AI feel responsive and alive rather than showing a loading spinner for 3-5 seconds.

The Next.js streaming API route pipes the OpenAI stream to the HTTP response using SSE. The iOS app uses URLSession with delegate callbacks to handle streaming. Tasks are inserted to Supabase as they stream in.

**Key design decisions:**
- Streaming OpenAI responses via SSE
- iOS URLSession streaming delegate
- Optimistic UI with progressive task insertion
- Supabase inserts happen per-task as stream arrives

**Trade-offs:**
- Gain: Magical UX, feels fast, progressive disclosure
- Sacrifice: Complex streaming implementation on iOS, harder error handling, partial inserts if stream fails mid-way

**Probability:** 0.06
**Complexity:** High
**Risks:** iOS streaming URLSession is finicky; partial task inserts if connection drops; harder to implement deduplication (must buffer stream); no SwiftUI built-in support for SSE

---

## Approach 6: Multi-Agent AI Pipeline (Orchestrator Pattern)

**Summary:** Use multiple specialized AI agents chained together — a transcription agent, a task extraction agent, a dedup agent, a context agent — each with a specific role.

**Description:**
Instead of one big GPT-4o prompt that does everything, use a pipeline of specialized agents. For braindump: Agent 1 (Whisper) transcribes → Agent 2 extracts candidate tasks → Agent 3 deduplicates against existing tasks → Agent 4 assigns priorities and tags. Each agent has a narrow, well-defined role and can be swapped/improved independently.

For notes: Agent 1 extracts key concepts → Agent 2 finds related existing notes → Agent 3 generates tags and category → Agent 4 creates graph edges to related content.

This is orchestrated by a Supabase Edge Function that chains the calls with intermediate state stored in a `pipeline_jobs` table.

**Key design decisions:**
- Specialized agents per processing step
- Pipeline state persisted in Supabase between agent calls
- Each agent is a reusable function
- Parallel agents where possible (e.g., tag extraction + embedding in parallel)

**Trade-offs:**
- Gain: Each step improvable independently, better quality by specialization, observable pipeline state
- Sacrifice: More API calls = higher cost and latency, complex orchestration logic, more failure points

**Probability:** 0.04
**Complexity:** Very High
**Risks:** Each additional OpenAI call adds 1-3s latency; cost multiplies with agents; harder to debug multi-step failures; significant over-engineering for a personal app
