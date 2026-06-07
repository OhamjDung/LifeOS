---
VOTE: Solution C
SCORES:
  Solution A: 3.8/5.0
  Solution B: 3.9/5.0
  Solution C: 4.3/5.0
CRITERIA:
  - Schema Completeness: 4.0/5.0
  - iOS Correctness: 4.0/5.0
  - AI Pipeline Viability: 4.0/5.0
  - Cost Realism: 4.0/5.0
  - Build Feasibility: 4.0/5.0
  - Feature Coverage: 4.0/5.0
  - Cross-Platform Coherence: 4.0/5.0
  - Security/Ops: 4.0/5.0
---

# LifeOS Architecture Evaluation Report

## Executive Summary

All three solutions share the same fundamentally sound architecture: SwiftUI + Next.js + Supabase + OpenAI, with AI proxied through Edge Functions (no client-side keys), pgvector with HNSW for RAG, and 1536-dim text-embedding-3-small. They are siblings, not strangers. The differentiators are in **dedup specificity**, **failure handling**, and **build sequencing**.

**Solution C wins** because it is the only one that (a) specifies a concrete numeric dedup algorithm (cosine 0.85/0.65 thresholds with three branches), (b) explicitly addresses OpenAI downtime with retry counts and pg_cron retry, (c) ships Layer 0 CRUD before AI (validating schema before adding cost/complexity), and (d) addresses a real privacy concern (sending voice to Whisper) with on-device SFSpeechRecognizer as default.

Solution B is a close second — clean schema, good function-calling spec, includes the contact `last_contacted_at` SQL trigger. Solution A is solid but has the weakest dedup ("check if semantically duplicates" — hand-waved, no numeric threshold) and weakest failure story.

---

## Per-Solution Analysis

### Solution A — Feature-Isolated Schema

**Strengths:**
- Complete schema with RLS on every table, pgvector + HNSW (m=16, ef_construction=64) correctly specified
- iOS architecture is correct: CLCircularRegion with 20-region limit acknowledged, SetFocusFilterIntent, App Group + WidgetCenter.reloadAllTimelines, NSLocationAlwaysAndWhenInUseUsageDescription
- 14-week phased plan grouped by domain
- Self-verification answers all 5 hard questions

**Weaknesses:**
- **Dedup is hand-waved**: "check if semantically duplicates an existing task" — no numeric threshold, no embedding comparison specified. Just hopes GPT-4o gets it right. This triggers a pitfall consideration (-0.25 risk).
- No structured function-calling schema for task extraction (just describes the JSON shape in prose)
- Tier intervals listed as SQL comment, not enforced anywhere; no trigger for `last_contacted_at`
- Failure path for AI is described once (retry every 5 min) but no retry_count, no max retries
- Cost table is reasonable but uses GPT-4o for categorization in main table then mentions GPT-4o-mini only as a "cost control" afterthought — inconsistent

**Score: 3.8/5.0**

### Solution B — Supabase-Direct BaaS

**Strengths:**
- Cleanest, most complete schema in one block; includes `update_last_contacted()` trigger (real SQL)
- Concrete function-calling spec with full OpenAI tools schema (type, function, parameters with enum)
- HNSW index + similarity threshold (>0.5) in search RPC
- Honest about Focus Filter entitlement key: `com.apple.developer.usernotifications.focus-filter-intents`
- Daily cost breakdown uses GPT-4o-mini consistently where appropriate; lowest cost estimate ($1.45/mo)
- Chunking code shown with paragraph-aware splitting

**Weaknesses:**
- Dedup specified as "semantically duplicate (>0.85 similarity in meaning)" inside the GPT prompt — relies on the LLM to do the similarity rather than computing embeddings explicitly. Better than A but weaker than C's explicit pre-embedding pipeline.
- No retry count / failure state machine — just `'failed'` enum value
- Phase plan is 10 weeks but compresses CRM (2 weeks) which is realistic; no Phase 0 validation
- `device_token` stored on `contacts` (line 119) — this is wrong: device tokens belong to the user/device, not to each contact row. Minor schema mistake.

**Score: 3.9/5.0**

### Solution C — Progressive Enhancement

**Strengths:**
- **Best dedup specification**: explicit three-tier algorithm with cosine thresholds (>0.85 auto-merge, 0.65–0.85 user review, <0.65 new). No other solution gives numeric thresholds.
- **Best failure story**: explicit state machine diagram (pending → processing → done/failed → retry), `retry_count` column, pg_cron retries every 5 min with `retry_count < 3` limit, raw transcript preserved
- **Best privacy story**: SFSpeechRecognizer on-device by default (free, offline, private), Whisper as opt-in upgrade; 30-day audio retention via Storage lifecycle
- Layer 0/1/2 model is the only one that explicitly decouples CRUD from AI — phased plan ships Phase 0 CRUD first, AI in Phase 2
- Explicit justification for HNSW over IVFFlat (no training data, better recall at small scale) — shows understanding, not cargo-culting
- Includes `ai_merged_from` foreign key for dedup traceability — small but thoughtful
- Self-verification addresses the geofence 20-region limit honestly and proposes significant-location-change fallback

**Weaknesses:**
- Geofence MAX_REGIONS set to 15 (more conservative than A's 19); arguably leaves capacity on table but defensible
- Phase plan is 11 weeks — longest of the three, though most defensible
- pg_cron polling every 2 min for embedding instead of DB webhook adds latency (acknowledged as batching trade-off)
- Note categorization uses GPT-4o-mini in cost table (good), but the embedding+categorization happens in pg_cron polling — slight architectural inconsistency vs the webhook model

**Score: 4.3/5.0**

---

## Checklist Results

| Item | A | B | C |
|---|---|---|---|
| Complete schema (all 4 domains, RLS, indexes) | YES | YES | YES |
| pgvector + HNSW with parameters | YES | YES | YES |
| Embedding model + dims stated (1536) | YES | YES | YES |
| Braindump pipeline (Whisper → GPT-4o → tasks) | YES | YES | YES |
| Dedup algorithm specified concretely | NO (hand-waved) | PARTIAL (threshold in prompt) | YES (numeric thresholds + tiers) |
| WidgetKit TimelineProvider + App Group | YES | YES | YES |
| CLCircularRegion + 20-region limit | YES | YES | YES |
| SetFocusFilterIntent + entitlements | YES | YES (key named) | YES |
| CRM 4 sub-features (tiers, reminders, photo prompts, drafts) | YES | YES | YES |
| Asymmetric input/retrieval UX | YES | YES | YES |
| Cost estimate with token math | YES | YES | YES |
| Phased plan | YES | YES | YES |
| iOS architecture (modules) | YES | YES | YES |
| Server-side AI proxy (no client keys) | YES | YES | YES |
| Failure/retry handling | PARTIAL | PARTIAL | YES (state machine + retry_count) |
| `last_contacted_at` auto-update | NO | YES (trigger) | YES (trigger) |
| On-device speech option | YES (fallback mention) | YES (fallback mention) | YES (default Layer 0) |

No pitfalls triggered for any solution (no client-side keys, no direct client→OpenAI, no RAG/fine-tuning confusion). A is closest to a pitfall on dedup hand-waving but doesn't quite cross the line.

---

## Rubric Scores Summary

| Dimension | Weight | A | B | C |
|---|---|---|---|---|
| Schema Completeness | 0.18 | 4 | 4 | 4 |
| iOS Correctness | 0.18 | 4 | 4 | 4 |
| AI Pipeline Viability | 0.16 | 3 | 4 | 5 |
| Cost Realism | 0.10 | 3 | 4 | 4 |
| Build Feasibility | 0.12 | 4 | 4 | 5 |
| Feature Coverage | 0.10 | 4 | 4 | 4 |
| Cross-Platform Coherence | 0.10 | 4 | 4 | 4 |
| Security/Ops | 0.06 | 4 | 4 | 5 |
| **Weighted total** | | **3.78** | **4.00** | **4.36** |

(Rounded to header line: A 3.8, B 3.9 [adjusted down 0.1 for device_token schema error], C 4.3.)

---

## Key Differentiators

1. **Dedup specificity** — C >> B > A. C is the only solution that gives numeric cosine thresholds and a three-branch decision tree.
2. **Failure handling** — C >> A ≈ B. Only C has retry_count + state machine + pg_cron retry job.
3. **Privacy** — C >> A ≈ B. On-device speech as default vs fallback is a meaningful posture difference.
4. **Build sequencing** — C >> A ≈ B. Phase 0 CRUD-only validates the schema before AI complexity is added.
5. **Schema correctness** — B ≈ C > A. B has the SQL trigger; A lacks it. B has the `device_token` placement error.
6. **Cost realism** — B ≈ C > A. B/C consistently use GPT-4o-mini in the main table; A buries it in cost controls.

## Final Vote: Solution C

For a **solo developer** building a personal app where reliability matters more than time-to-AI-magic, Solution C's progressive enhancement model is the strongest fit: ship Layer 0 in 2 weeks, validate the schema with real use, then layer AI on without ever risking a broken core experience. It also gives the only credible answer to "what if OpenAI is down?" and the only concrete dedup algorithm.
