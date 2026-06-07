# LifeOS Architecture Proposals — Pruning Round 2

Date: 2026-06-03
Judge: Critical evaluator applying meta-judge specification.

## Top 3 Selection

```yaml
TOP_3_VOTES:
  - rank: 1
    proposal: "A-1"
    name: "Supabase-Direct BaaS (Thin Client Architecture)"
    score: 3.6
  - rank: 2
    proposal: "C-1"
    name: "Progressive Enhancement Architecture"
    score: 3.5
  - rank: 3
    proposal: "B-1"
    name: "Feature-Isolated Schema with Shared Auth"
    score: 3.5
ALL_SCORES:
  A1: 3.6
  A2: 3.1
  A3: 2.25
  A4: 2.2
  A5: 1.55
  A6: 1.5   # capped: violates ONE Supabase constraint
  B1: 3.5
  B2: 2.8
  B3: 2.6
  B4: 1.7
  B5: 2.0
  B6: 1.55
  C1: 3.5
  C2: 3.2
  C3: 2.7
  C4: 1.5   # capped: violates ONE Supabase constraint
  C5: 1.65
  C6: 2.4
```

## Hard-rule failures (essential)

- **A6 (Graph Hybrid via Apache AGE/Neo4j)** — introduces a second graph DB paradigm, violating the explicit "ONE Supabase" constraint. Score capped, further reduced by pitfall (unrealistic scope, Apache AGE not production-stable).
- **C4 (Neo4j AuraDB primary)** — Neo4j AuraDB as primary data store + Supabase only for auth/storage. Explicit dual-database design violates the unified DB requirement.

## Rationale for top 3

### Rank 1 — A1: Supabase-Direct BaaS (3.6)

Strongest mechanism specificity per token. Concretely names:
- WidgetKit + App Group shared container for widget data (correct iOS idiom)
- Supabase Realtime subscription pushing widget snapshots to App Group
- CoreLocation for geofencing with mode state synced to Supabase
- Edge Functions for Whisper → GPT-4o → dedup → pgvector pipeline
- pg_cron + APNs for CRM reminders
- Row Level Security explicitly mentioned

Probability 0.87 is slightly aggressive but is paired with real risk discussion (Edge Function cold starts, pg_cron reliability, debug ergonomics). Lowest infrastructure burden for a solo developer — no extra services beyond Supabase and Vercel.

**Weaknesses:** Edge Function cold starts on voice braindump path; iOS Focus Modes integration (Focus Filter / Intents) not explicitly named; cost envelope not quantified.

### Rank 2 — C1: Progressive Enhancement Architecture (3.5)

Best solo-developer realism and risk calibration of the set:
- `processing_status` column is a clean, observable state model for async AI
- AI explicitly off the critical path → app always responsive
- Graceful degradation when OpenAI is down (raw transcription saved)
- pg_cron + pg_net is the correct Supabase-idiomatic background-job mechanism
- Probability 0.85 is well-calibrated against explicit risks (dedup lag, search lag, pg_cron observability)

**Weaknesses:** Widget powering mechanism, Focus Modes integration, and RAG pipeline depth are all under-specified at the mechanism level — these need to be filled in during full development. CRM specifics (relationship tiers, AI catch-up prompt) only sketched.

### Rank 3 — B1: Feature-Isolated Schema with Shared Auth (3.5)

Best data-model articulation of the set:
- Explicit table list per domain (`tasks`, `task_rollover_history`, `contacts`, `contact_events`, `contact_relationship_tiers`, `notes`, `note_embeddings`, `user_modes`, `location_anchors`)
- RLS policies per domain
- Maps cleanly onto Swift modules and Next.js route groups (solo-dev win)
- Probability 0.86 with reasonable schema-evolution risks called out

**Weaknesses:** Widget mechanism, geofencing details, and iOS Focus Modes integration not addressed at the mechanism level. Cross-domain AI context noted but not designed.

## Why these three together

The three winners are complementary blueprints rather than overlapping ones, which gives the next development phase the most signal:

- **A1** anchors the *infrastructure topology* (thin clients + Edge Functions + Realtime)
- **C1** anchors the *AI sequencing strategy* (always-on enhancement, never blocking)
- **B1** anchors the *data model* (feature-isolated schema with shared auth)

A synthesized full architecture would plausibly combine: B1's schema + A1's runtime/widget/geofence topology + C1's AI sequencing discipline.

## Notable rejections

- **A2, C2** (3.1, 3.2): solid but add iOS-side complexity (two backends for A2; cold-start sync write tax for C2) without clear payoff over A1.
- **B3 (Materialized AI, 2.6):** synchronous Whisper+GPT-4o in the write path likely exceeds Edge Function timeouts; UX cost (3–5s waits) is real.
- **C3 (SwiftData local-first, 2.7):** SwiftData maturity risks acknowledged; two-source-of-truth sync engine is the single hardest thing to get right and not worth it for a solo dev at MVP.
- **A3 (dedicated Node.js + Redis, 2.25):** over-infrastructured; pitfall penalty applied.
- **A4, B4, B5, B6, A5, C5, C6, A6, C4:** all triggered solo-dev over-engineering pitfalls or hard-rule violations; self-reported probabilities (≤0.07) corroborate.

## Self-verification

| # | Question | Answer | Adjustment |
|---|----------|--------|------------|
| 1 | Did I miss any pillar coverage in top 3? | A1, B1, C1 each touch all 4 pillars; depth varies. None are missing pillars. | None |
| 2 | Length/tone bias? | A1 and C1 are similar length; B1 is shorter than B2 but scored higher — judged on content. | None |
| 3 | Rubric fidelity? | Applied default-2 baseline; moved up only where mechanism specificity warranted. | None |
| 4 | Reference-result drift? | My reference expected: explicit widget mechanism, geofence mechanism, RAG pipeline, dedup logic, RLS, schema, probability with risks. A1 hits the most; B1 hits schema best; C1 hits sequencing best. | None |
| 5 | Proportionality? | A1/B1/C1 cluster at 3.5–3.6; weaker proposals cluster 1.5–2.8; capped proposals at 1.5. Distribution is proportional and not uniformly harsh. | None |

## Confidence

- Level: High
- Evidence strength: Strong (direct quotes/mechanisms in proposals)
- Specification quality: Complete
- Caveat: Proposals are sketches, not full architectures; many "principle" checklist items are partially addressed across the board. Top 3 are selected on *relative* mechanism specificity and solo-dev fit, not absolute completeness.
