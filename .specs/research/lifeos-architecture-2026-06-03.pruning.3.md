# LifeOS Architecture Proposals — Pruning Round 3
Date: 2026-06-03

## Top 3 Selected

```yaml
TOP_3_VOTES:
  - rank: 1
    proposal: "B-1"
    name: "Feature-Isolated Schema with Shared Auth"
    score: 3.6
  - rank: 2
    proposal: "A-1"
    name: "Supabase-Direct BaaS (Thin Client Architecture)"
    score: 3.3
  - rank: 3
    proposal: "C-1"
    name: "Progressive Enhancement Architecture"
    score: 3.3

ALL_SCORES:
  A1: 3.3
  A2: 2.9
  A3: 2.4
  A4: 2.1
  A5: 1.9
  A6: 1.8
  B1: 3.6
  B2: 3.0
  B3: 2.4
  B4: 1.4
  B5: 2.0
  B6: 2.0
  C1: 3.3
  C2: 2.9
  C3: 2.4
  C4: 1.3
  C5: 1.9
  C6: 2.6
```

## Rationale

**B-1 (Feature-Isolated Schema)** — Only proposal with an explicit, concrete data model naming actual tables (`tasks`, `task_rollover_history`, `contacts`, `contact_events`, `contact_relationship_tiers`, `notes`, `note_embeddings`, `user_modes`, `location_anchors`). Maps cleanly to Swift modules and Next.js route groups. RLS-per-domain. Realistic probability (0.86) for solo dev. Strongest on Architectural Coherence & Data Model — the rubric's third-heaviest dimension and an essential checklist item.

**A-1 (Supabase-Direct BaaS)** — Best coverage of platform mechanism specifics: WidgetKit + App Group shared container, CoreLocation geofencing, pg_cron + APNs for CRM reminders, Edge Functions for Whisper→GPT-4o→pgvector pipeline. Highest stated probability (0.87). Lightest infrastructure burden for a solo dev. Loses points on explicit schema definition.

**C-1 (Progressive Enhancement)** — Most solo-developer-realistic. AI as enhancement layer (never blocking), `processing_status` column pattern, graceful degradation when OpenAI is down, pg_cron + pg_net for background jobs. Lowest risk delivery. Best on Solo-Developer Buildability and Risk Awareness.

## Eliminated — Key Reasons

- **C-4 (Neo4j + Supabase)** — Violates the ONE-shared-Supabase-DB constraint (essential checklist). Auto-capped.
- **A-4, A-5, A-6, B-4, B-5, B-6, C-5, C-6** — Self-rated probabilities ≤0.07; explicitly over-engineered; introduce CRDTs/event-sourcing/multi-agent/graph DBs unsuitable for solo dev.
- **B-3, C-3, A-3** — Either synchronous AI timeout risk, two-source-of-truth sync hazard, or unnecessary Redis/dedicated service infrastructure.
- **A-2, B-2, C-2, C-6** — Solid mid-tier but lack either concrete schema, platform mechanism detail, or introduce avoidable complexity vs the top 3.

## Tiebreak Notes

A-1 vs C-1 tied at 3.28-3.30. A-1 ranked higher on **Feature Coverage Fidelity** (more concrete mechanism per pillar — widgets, geofence, CRM, RAG each named), per spec tiebreak rule.

## Checklist Highlights (Top 3)

| Item | B1 | A1 | C1 |
|------|----|----|----|
| All 4 pillars | Y | Y | Y |
| Mandated stack | Y | Y | Y |
| ONE Supabase | Y | Y | Y |
| Concrete schema | **Y (strong)** | partial | partial |
| Probability estimate | Y (0.86) | Y (0.87) | Y (0.85) |
| WidgetKit mechanism | implied | **Y (App Group)** | Y (App Group implied) |
| Geofence + Focus | partial | Y (CoreLocation) | partial |
| RAG end-to-end | partial | Y | Y |
| Dedup logic | partial | Y (GPT-4o dedup) | Y (daily cron) |
| RLS strategy | Y (per-domain) | Y | implicit |
| Cost envelope | N | N | N |
| Sync/offline | N | partial | Y (background jobs) |
| Top risks named | Y | Y | Y |
| Phased build order | N | N | implicit |
| CRM specifics | Y (tiers table) | Y (pg_cron+APNs) | Y (lastContacted + tier) |
| Asymmetric Note UX | N | partial | partial |

Common gaps across all three: no OpenAI cost envelope, weak asymmetric "computer-in / phone-retrieve" UX detail, no explicit phased MVP sequencing. These should be addressed during full development of the top 3.

## Next Step

Develop B-1, A-1, and C-1 into full architecture documents. Consider hybridization: B-1's schema + A-1's mechanism detail + C-1's progressive-enhancement risk posture may be the strongest synthesis.
