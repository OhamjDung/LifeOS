# LifeOS Architecture Proposals — Agent C
Date: 2026-06-03

## Problem Decomposition

**Core problem:** Build a personal "second brain" that captures life across all contexts (voice, text, location, relationships), makes it semantically searchable, and surfaces the right information at the right moment — without becoming a burden to maintain.

**Key constraints:**
- Must work on iPhone with WidgetKit, CoreLocation, and background restrictions
- Single Supabase instance — no additional managed databases
- Solo dev: prefer boring technology; avoid distributed systems complexity
- OpenAI API is the AI provider — no self-hosted models

**Fundamental tension:** The richer the AI pipeline, the slower and more expensive it gets. Every architectural decision is a tradeoff between AI quality and responsiveness/cost.

---

## Approach 1: Progressive Enhancement Architecture

**Summary:** Ship a simple CRUD app first, then progressively add AI layers on top — AI never blocks core functionality, it's always an enhancement.

**Description:**
The core of the app is a simple database-backed CRUD app: tasks are just rows, notes are just text, contacts are just records. Everything works without AI. Then AI is layered on top as non-blocking enhancements: a background job embeds notes after they're saved, a cron job runs dedup suggestions on tasks daily (not in real-time), CRM reminders are scheduled based on simple rules (lastContacted + tier = daysUntilReminder).

This means the app is always responsive. Adding a note is instant. Voice braindump works even if OpenAI is down (saves raw transcription for later processing). The AI layer improves the experience but never gates it.

The iOS app and Next.js web app both talk directly to Supabase. Supabase Edge Functions run AI processing in the background via `pg_net` HTTP calls or database triggers. The schema has a `processing_status` column on tasks and notes indicating whether AI has enhanced them yet.

**Key design decisions:**
- AI as enhancement layer, never in the critical path
- `processing_status` column on all AI-enhanced entities
- Background AI jobs via Supabase pg_cron + pg_net
- Schema is simple and correct first, AI-powered second

**Trade-offs:**
- Gain: Always works, never blocked, easy to test without AI, graceful degradation
- Sacrifice: Users may see "raw" tasks before dedup runs; note categories may lag by seconds; no streaming UX

**Probability:** 0.85
**Complexity:** Medium-Low
**Risks:** Dedup running asynchronously means user might see duplicates briefly; embedding lag means new notes aren't immediately searchable; background jobs via pg_cron have limited observability

---

## Approach 2: Supabase Edge Functions as API Gateway (Backend-for-Frontend Pattern)

**Summary:** Edge Functions serve as a proper BFF (Backend-for-Frontend) layer — all client requests go to typed Edge Functions, never directly to tables, providing a real API contract.

**Description:**
Instead of clients hitting Supabase tables directly (which is common but couples clients to schema), all reads and writes go through Edge Functions that act as a typed API. `POST /braindump` accepts audio, runs Whisper + GPT-4o, and returns structured tasks. `GET /tasks/today` returns today's tasks with all AI annotations. `POST /notes` saves and embeds synchronously (with a 10s timeout).

This gives a clean separation: Edge Functions define the app's API contract, clients are thin consumers. If the schema changes, only the Edge Functions need updating, not every client. TypeScript types can be shared between Edge Functions and the Next.js web app.

The iOS app uses URLSession to call Edge Functions — it doesn't use the Supabase Swift SDK for writes, only for realtime subscriptions (reads). This is a pragmatic inversion: writes go through the API, reads use realtime subscriptions directly.

**Key design decisions:**
- Edge Functions = the app's actual backend API
- Typed request/response contracts (TypeScript)
- iOS reads from Supabase Realtime, writes via Edge Function API
- Next.js types shared with Edge Functions via a shared types package

**Trade-offs:**
- Gain: Clean API contract, schema can evolve independently, testable functions, consistent validation
- Sacrifice: All writes go through Edge Functions (slower cold starts), more code to write than direct DB access, Deno Edge Function limitations

**Probability:** 0.80
**Complexity:** Medium
**Risks:** Supabase Edge Function cold starts (can be 200-500ms); Deno runtime has different npm compatibility than Node.js; managing TypeScript types across packages adds build complexity; 10s timeout on synchronous AI calls is tight

---

## Approach 3: Hybrid Local-First with Supabase as Backup

**Summary:** SwiftData as the primary iOS database (instant reads/writes), Supabase as cloud backup and web access — sync runs in the background continuously.

**Description:**
The iOS app's primary data store is SwiftData (Apple's new Core Data replacement). All reads and writes hit SwiftData instantly, so the app is always responsive regardless of network conditions. In the background, a sync engine pushes changes to Supabase and pulls remote changes.

WidgetKit reads from SwiftData via the App Group container — no network needed, always fresh. Voice braindumps write to SwiftData immediately and queue an AI processing job. When online, the job calls Whisper + GPT-4o and writes back to both SwiftData and Supabase.

The Next.js web app reads and writes directly to Supabase (the cloud copy). Conflict resolution is last-write-wins by `updated_at` timestamp. This works because there's effectively one user, one phone, and one web session — true conflicts are rare.

**Key design decisions:**
- SwiftData = iOS source of truth (not Supabase)
- Supabase = web source of truth + cross-device backup
- Background sync with conflict resolution
- Widgets always work offline via SwiftData

**Trade-offs:**
- Gain: Blazing fast iOS, widgets never stale, offline-capable, widget data always available
- Sacrifice: Complex sync implementation, two-source-of-truth is dangerous, SwiftData still has bugs in iOS 17/18, sync conflicts require careful handling

**Probability:** 0.72
**Complexity:** High
**Risks:** SwiftData is still maturing — memory issues and migration bugs in iOS 17; sync engine is the hardest part to get right; last-write-wins can silently lose data; debugging sync conflicts is painful

---

## Approach 4: Knowledge Graph as Primary Data Model (Neo4j + Supabase)

**Summary:** All entities (tasks, notes, contacts, locations, concepts) are nodes in a graph — relationships between them are first-class, enabling knowledge graph traversal for retrieval.

**Description:**
Instead of relational tables, the data model is a property graph. A note is a node. A person is a node. A location is a node. A concept extracted from a note is a node. Edges connect them: `NOTE-MENTIONS-PERSON`, `NOTE-ABOUT-CONCEPT`, `TASK-CREATED-AT-LOCATION`, `PERSON-MET-AT-EVENT`. 

For retrieval, instead of pure vector similarity search (RAG), you traverse the graph: "Find notes about travel near the time I met [contact]" becomes a graph query. This is true KAG (Knowledge-Augmented Generation) — the graph structure provides relational context that vectors can't.

Implementation: Neo4j AuraDB (managed cloud) for the graph, Supabase for auth and blob storage, pgvector for vector similarity within Supabase. iOS and web apps query both.

**Key design decisions:**
- Neo4j AuraDB as primary data store for all entities and relationships
- Supabase for auth, file storage, and push notifications only
- AI extracts entity relationships on every write
- Graph traversal + vector similarity for hybrid retrieval

**Trade-offs:**
- Gain: Genuinely powerful KAG, rich relationship queries, natural for a "second brain"
- Sacrifice: Two databases, Neo4j Cypher query language to learn, iOS Neo4j SDK is minimal, high complexity for solo dev

**Probability:** 0.04
**Complexity:** Very High
**Risks:** No mature Neo4j iOS SDK; managing two databases doubles migration risk; Cypher query language is another thing to learn; AuraDB free tier has limits; over-engineered for personal use

---

## Approach 5: Purely Reactive Architecture with Supabase Realtime as Event Bus

**Summary:** Supabase Realtime channels serve as a pub/sub event bus — every app event is a channel message, and AI agents subscribe and react to events asynchronously.

**Description:**
Instead of HTTP request/response for AI, the app uses Supabase Realtime as an event bus. When a user saves a voice braindump, the iOS app publishes a `braindump_created` event to a Realtime channel. An AI worker (running on a cloud VM or serverless function outside Supabase) subscribes to this channel, processes the audio, and publishes `tasks_extracted` events back. The iOS app subscribes to `tasks_extracted` events and updates its UI.

Every user action becomes an event. Every AI response is an event. The data model is append-only events, with the current state derived from the event stream. This is event-driven architecture applied to a personal app.

**Key design decisions:**
- Supabase Realtime as event bus
- AI workers as channel subscribers
- Append-only event log in Supabase
- iOS app subscribes to result events rather than polling

**Trade-offs:**
- Gain: Loose coupling, AI workers are swappable, excellent observability via event log
- Sacrifice: Complex for what is essentially a personal app, Realtime as event bus is non-standard usage, cold-start of AI workers, harder to debug

**Probability:** 0.04
**Complexity:** Very High
**Risks:** Supabase Realtime has message size limits and no guaranteed delivery; maintaining a separate AI worker process outside Supabase adds hosting complexity; event-sourcing for personal data is over-engineering; debugging async event chains is painful

---

## Approach 6: Convention-Over-Configuration "LifeOS Framework" Pattern

**Summary:** Define a shared LifeOS protocol — a convention for how all four features are structured, stored, and processed — so every feature is built the same way and the codebase is self-documenting.

**Description:**
Define a `LifeOSEntity` protocol: every entity (task, note, contact, mode) has the same lifecycle: `capture → process → store → surface`. Every entity has the same fields: `id`, `user_id`, `raw_content`, `processed_content`, `embedding_id`, `mode_context`, `created_at`, `processed_at`. AI processing is always a transform from `raw_content` to `processed_content`.

This convention means the same infrastructure handles all four features. A single Edge Function template handles all AI processing (parameterized by entity type). The iOS app has a generic `EntityListView` that adapts per entity type. The Next.js app has a generic table component.

The tradeoff: by forcing all four features into the same shape, some features lose expressiveness (contacts don't naturally fit the same shape as tasks). But the developer gains enormous speed — building feature #4 is as fast as feature #1 because the pattern is established.

**Key design decisions:**
- Unified `LifeOSEntity` protocol for all domain objects
- Same DB schema pattern per entity type
- Generic AI Edge Function template parameterized by type
- Convention = documentation

**Trade-offs:**
- Gain: Fastest to build, self-consistent codebase, adding new features is trivial, great for solo dev
- Sacrifice: Forces a common shape on naturally different domain objects, loses expressiveness (CRM contact is forced into note shape), potential abstraction mismatch

**Probability:** 0.06
**Complexity:** Medium
**Risks:** Forcing all entities into one shape may make CRM awkward (contacts have many-to-many relationships that don't fit a flat entity model); abstraction may leak badly as features diverge; premature generalization before understanding each feature deeply
