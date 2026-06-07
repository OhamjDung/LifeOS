# Pruning Selection — LifeOS Architecture
Date: 2026-06-03

## Vote Tallies (ranked choice: 1st=3pts, 2nd=2pts, 3rd=1pt)

| Proposal | Judge 1 | Judge 2 | Judge 3 | Total | Avg Score |
|---|---|---|---|---|---|
| B-1: Feature-Isolated Schema | 1st (3) | 3rd (1) | 1st (3) | **7** | 3.40 |
| A-1: Supabase-Direct BaaS | 2nd (2) | 1st (3) | 2nd (2) | **7** | 3.32 |
| C-1: Progressive Enhancement | 3rd (1) | 2nd (2) | 3rd (1) | **4** | 3.27 |
| B-3: Materialized AI | — | — | — | 0 | 2.50 |
| C-2: Edge Functions BFF | — | — | — | 0 | 2.93 |

## Selected Top 3

### 1. B-1: Feature-Isolated Schema with Shared Auth
**Source:** proposals.b.md, Approach 1
**Why selected:** Only proposal with concrete table names (`tasks`, `task_rollover_history`, `contacts`, `contact_events`, `contact_relationship_tiers`, `notes`, `note_embeddings`, `user_modes`, `location_anchors`). Best data model quality. RLS-per-domain stated. Maps cleanly to Swift modules.
**Concerns to address:**
- iOS specifics missing (WidgetKit App Group, CoreLocation region limits)
- No cost envelope
- Cross-feature note↔person relations need elaboration
- Phased MVP sequence needed
- Asymmetric "computer input / phone retrieval" UX needs explicit treatment

### 2. A-1: Supabase-Direct BaaS (Thin Client Architecture)
**Source:** proposals.a.md, Approach 1
**Why selected:** Best iOS/platform realism — names WidgetKit + App Group, CoreLocation, pg_cron, APNs. Concrete async AI flow via DB webhooks. Probability 0.87 well-calibrated.
**Concerns to address:**
- No table/schema sketch (must add)
- RAG pipeline detail missing (chunking strategy, index type)
- No cost envelope
- Phased MVP sequence needed

### 3. C-1: Progressive Enhancement Architecture
**Source:** proposals.c.md, Approach 1
**Why selected:** Best solo-developer realism. AI never blocks core functionality. `processing_status` column pattern. Graceful OpenAI degradation. Best risk awareness.
**Concerns to address:**
- iOS-specific APIs absent (WidgetKit/App Group, Focus Filter)
- Widget refresh strategy not specified
- No explicit RAG chunking or pgvector index type
- No cost envelope
- Phased MVP sequence needed

## Consensus Rationale

All three proposals are architecturally orthogonal and complementary:
- **B-1** contributes the **data model** (concrete schema, domain isolation)
- **A-1** contributes the **infrastructure/iOS runtime** (Edge Functions, App Group, pg_cron, APNs)
- **C-1** contributes the **execution philosophy** (AI as progressive enhancement, non-blocking, graceful degradation)

Synthesis of all three would combine B-1's schema + A-1's runtime topology + C-1's non-blocking AI execution model, potentially producing a stronger full architecture than any single proposal.

## Unanimously Rejected

All "very high complexity" proposals eliminated: A4 (offline SwiftData), A5 (event sourcing), A6 (Apache AGE graph), B4 (CRDT/Yjs — no Swift SDK), B5 (streaming SSE), B6 (multi-agent pipeline), C4 (Neo4j + Supabase — violates single-DB), C5 (Realtime event bus).

These were self-rated at probabilities ≤0.07 by their authors and triggered the over-engineering pitfall. They are fundamentally unsuited for a solo developer.
