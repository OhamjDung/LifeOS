# LifeOS Architecture Proposals — Agent A
Date: 2026-06-03

## Problem Decomposition

**Core problem:** Build a personal productivity system that works seamlessly across iPhone and web, with AI-powered capture, organization, and retrieval — all backed by a single database.

**Key constraints:**
- Fixed stack: Supabase + SwiftUI + Next.js + OpenAI API
- Single developer — must be buildable and maintainable by one person
- Must handle: async AI processing, real-time sync, background location, offline-capable widgets

**Subproblems every solution must address:**
1. Data modeling — how to structure tasks, notes, contacts, modes in one schema
2. AI pipeline — where/when embeddings and GPT calls happen (sync vs async)
3. Widget data refresh — WidgetKit has limited network access
4. Background location — geofencing battery/permission tradeoffs
5. Real-time sync — Supabase Realtime channels between iOS and web

---

## Approach 1: Supabase-Direct BaaS (Thin Client Architecture)

**Summary:** Both iOS and web apps communicate directly with Supabase — no custom backend server. AI calls happen inside Supabase Edge Functions triggered by database webhooks.

**Description:**
The iOS app and Next.js web app both use the Supabase client SDK directly. All writes go straight to Supabase tables. When a new voice braindump is saved, a Supabase database webhook fires an Edge Function that calls OpenAI Whisper (transcription) → GPT-4o (task extraction + dedup) → writes tasks back to the DB. Similarly, when a note is saved, an Edge Function calls text-embedding-3-small and stores the vector in pgvector.

For widgets, the iOS WidgetKit extension reads from a shared App Group UserDefaults that gets updated by the main app via Supabase Realtime subscriptions. The main app subscribes to task changes and writes the widget snapshot to the shared container.

Geofencing uses CoreLocation in the iOS app, with mode state stored locally (UserDefaults) and synced to Supabase for cross-device awareness. CRM reminders use Supabase Edge Functions on a cron schedule (pg_cron) that push via APNs through Supabase's push notification integration.

**Key design decisions:**
- No custom backend — Supabase Edge Functions (Deno) handle all AI orchestration
- Direct DB access from clients (Row Level Security enforces data isolation)
- Async AI processing via DB webhooks (non-blocking UX)
- Widget data via App Group shared container, not direct network calls

**Trade-offs:**
- Gain: Minimal infrastructure, fast to build, low ops burden
- Sacrifice: Edge Functions have cold start latency, limited to Deno runtime, harder to debug complex AI pipelines

**Probability:** 0.87
**Complexity:** Medium
**Risks:** Edge Function cold starts can feel slow for voice braindump; pg_cron for CRM notifications is less reliable than dedicated schedulers; debugging Edge Functions requires Supabase CLI setup

---

## Approach 2: Next.js API Routes as AI Middleware

**Summary:** Next.js serves as both the web frontend AND the AI backend — iOS app calls Next.js API routes for all AI operations, then Next.js writes results to Supabase.

**Description:**
Instead of Edge Functions, all AI logic lives in Next.js API routes (or Route Handlers in App Router). The iOS app sends audio to `/api/braindump` which runs Whisper → GPT-4o → dedup logic → returns tasks and writes to Supabase. Similarly `/api/embed-note` handles embedding new notes. The web frontend calls these same endpoints.

This centralizes all AI logic in one codebase (the Next.js app), making it easy to iterate on prompts, add logging, and debug. The iOS app is a thin client that only knows about Supabase for reads and the Next.js API for AI-heavy writes.

Deployment: Next.js on Vercel (serverless functions), Supabase for data. WidgetKit still uses the App Group pattern. Push notifications go through Supabase or a simple APNs integration in a Next.js cron route (Vercel Cron).

**Key design decisions:**
- Next.js API routes = single source of truth for all AI logic
- iOS reads directly from Supabase, writes AI data via Next.js API
- Vercel Cron handles CRM reminder scheduling
- Prompt templates and AI config version-controlled with the Next.js codebase

**Trade-offs:**
- Gain: Single place to update AI prompts, full Node.js ecosystem for AI libs, easy local dev with `next dev`
- Sacrifice: iOS must call two different backends (Supabase + Next.js API), adds latency, Vercel cold starts on serverless functions

**Probability:** 0.82
**Complexity:** Medium
**Risks:** Two-backend complexity for iOS; Vercel function timeout limits for long Whisper transcriptions; must manage CORS and auth tokens across both backends

---

## Approach 3: Supabase + Dedicated Node.js AI Service

**Summary:** Three-tier architecture — Supabase for data, a lightweight Express/Fastify service for AI orchestration, and clients for UI.

**Description:**
A small Node.js service (hosted on Railway or Render) handles all AI calls. It exposes REST endpoints that both iOS and Next.js call. The service reads/writes to Supabase directly. This cleanly separates concerns: UI clients handle presentation, the AI service handles all OpenAI calls and business logic, and Supabase handles persistence and real-time.

The AI service uses a queue (Bull/BullMQ with Redis) for async processing of voice braindumps and embedding jobs — this ensures no timeouts and allows retry logic. For CRM reminders, the service runs a cron job that checks Supabase and sends APNs notifications.

**Key design decisions:**
- Dedicated service = best place for complex AI pipeline logic
- Queue-based processing for reliability and retry
- Supabase still handles auth, real-time, and storage
- Service scales independently of UI

**Trade-offs:**
- Gain: Clean separation, production-grade async processing, easy to add complex pipeline logic
- Sacrifice: More infrastructure to manage (service + Redis), higher ops complexity for a solo dev

**Probability:** 0.81
**Complexity:** High
**Risks:** Most infrastructure for a solo dev; Redis adds another service to manage; over-engineered for early stage; deployment complexity

---

## Approach 4: Offline-First Local LLM + Supabase Sync

**Summary:** On-device ML models handle real-time tasks (transcription, basic categorization) while cloud AI handles heavy lifting — sync happens lazily when online.

**Description:**
Use Apple's on-device models (CoreML, Apple Intelligence APIs available in iOS 18+) for immediate transcription and basic task extraction. The result is instantly available even offline. When the device comes online, the app syncs to Supabase and optionally sends to OpenAI for richer processing (better dedup, embeddings).

Notes are stored locally in SwiftData first, then synced to Supabase. The vector embeddings are generated server-side asynchronously. For widgets, this is ideal — they can read from local SwiftData without any network.

**Key design decisions:**
- SwiftData as local cache, Supabase as source of truth
- On-device transcription (Apple Speech framework) for instant feedback
- Cloud AI as enhancement layer, not blocker
- Conflict resolution: last-write-wins with timestamp

**Trade-offs:**
- Gain: Instant response, works offline, widgets never fail
- Sacrifice: Complex sync logic, potential conflicts, on-device models less capable than GPT-4o for task extraction quality

**Probability:** 0.07
**Complexity:** High
**Risks:** SwiftData + Supabase sync is complex to implement; conflict resolution edge cases; on-device ML quality may disappoint; SwiftData is still maturing

---

## Approach 5: Event Sourcing + CQRS Architecture

**Summary:** All state changes are immutable events stored in Supabase; current state is derived by replaying events, enabling full history and undo.

**Description:**
Instead of mutable rows, every action creates an immutable event record: `task_created`, `task_completed`, `task_rolled_over`, `note_added`, `contact_met`, etc. A materialized view (or denormalized read table) projects current state for fast reads. This gives a perfect audit trail — you can replay your day, undo task merges, or see exactly when something was created vs modified.

The AI pipeline subscribes to events via Supabase Realtime and processes them asynchronously. The iOS app writes events and subscribes to the read projections.

**Key design decisions:**
- Events table as source of truth
- Materialized views for current state
- AI as event consumer, not inline processor
- Full undo/redo capabilities

**Trade-offs:**
- Gain: Complete history, powerful undo, excellent for a "life log" use case
- Sacrifice: Complex query patterns, harder to explain to future self, overkill for personal app

**Probability:** 0.04
**Complexity:** Very High
**Risks:** Over-engineered for solo personal app; complex debugging; PostgreSQL materialized view refresh timing; steep learning curve for a solo dev

---

## Approach 6: Graph Database Hybrid (Knowledge Graph Native)

**Summary:** Use a graph data model (via Apache AGE or a dedicated graph DB) for the note/knowledge relationships, with Supabase for transactional data.

**Description:**
Notes and their relationships form a natural knowledge graph — tags, concepts, links between ideas. Apache AGE (PostgreSQL extension for graph queries) or a separate Neo4j instance provides native graph traversal for the knowledge base feature, while Supabase handles tasks, contacts, and modes.

The "Auto Note Categorizer" becomes a knowledge graph where AI identifies entities, concepts, and relationships between notes, building an actual graph rather than just a vector index. RAG still works but is augmented by graph traversal (KAG — Knowledge-Augmented Generation).

**Key design decisions:**
- Graph DB for notes/knowledge
- Supabase for everything else
- KAG = graph traversal + vector similarity combined
- AI extracts entities and relationships on note save

**Trade-offs:**
- Gain: True KAG capability, richer note relationships, genuinely novel for personal use
- Sacrifice: Two database paradigms, complex queries, limited tooling, Apache AGE is not production-stable

**Probability:** 0.03
**Complexity:** Very High
**Risks:** Apache AGE is experimental; managing two data stores multiplies complexity; graph schema design is non-trivial; very little community support for this combo
