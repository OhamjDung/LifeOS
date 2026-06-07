---
VOTE: Solution C
SCORES:
  Solution A: 3.0/5.0
  Solution B: 3.4/5.0
  Solution C: 3.9/5.0
CRITERIA:
  - Schema Completeness: 4.0/5.0
  - iOS Correctness: 3.7/5.0
  - AI Pipeline Viability: 3.7/5.0
  - Cost Realism: 4.0/5.0
  - Build Feasibility: 3.7/5.0
  - Feature Coverage: 4.0/5.0
  - Cross-Platform Coherence: 4.0/5.0
  - Security/Ops: 3.7/5.0
---

# LifeOS Architecture Evaluation — 2026-06-03

## Executive Summary

All three solutions converge on the same correct macro-architecture (Supabase + pgvector HNSW + Edge Functions proxy to OpenAI + SwiftUI client + Next.js web), with full RLS on every user table, the right embedding model (`text-embedding-3-small`, 1536 dims), and a 20-region CoreLocation budget. None commits the pitfalls (no client-side OpenAI keys, no RAG/fine-tuning confusion). Differentiation lives in dedup rigor, failure handling, and how aggressively each respects solo-dev scope. **Solution C wins** by specifying an explicit cosine-threshold dedup algorithm (0.85/0.65), built-in retry semantics (`retry_count` + pg_cron), an on-device SFSpeechRecognizer Layer 0 that decouples shipping from OpenAI uptime, and a phased plan that ships value before any AI cost.

## Per-Solution Analysis

### Solution A — Feature-Isolated Schema (3.0/5.0)

**Strengths:**
- Complete schema across all 4 domains with RLS on every table; HNSW index on `note_embeddings` with `m=16, ef_construction=64`.
- Clean iOS module structure; concrete `TimelineProvider` code with `.after(midnight)` policy and App Group `group.com.yourname.lifeos`.
- Explicit `NSLocationAlwaysAndWhenInUseUsageDescription` and `NSFocusStatusUsageDescription`; 19 regions/1 spare allocation.
- 14-week plan is the most conservative and realistic for a solo dev.

**Weaknesses:**
- **Dedup is hand-waved**: "ask GPT-4o to decide merge vs create" with no similarity threshold or embedding step. This is the weakest dedup spec of the three. Borderline pitfall.
- No failure handling / retry logic for `processing_status='failed'`.
- No on-device speech fallback in the pipeline (mentioned only as a vague cost-control bullet).
- Missing the Focus Filter entitlement *name* (`com.apple.developer.usernotifications.focus-filter-intents`) — only describes the user-facing setup.
- Cost table omits the actual per-model unit prices ($/1M tokens) — totals are stated but unverifiable from the doc.
- `tasks.source` field is referenced in the Edge Function flow but not declared in the schema (defaults to `'manual'` with no `'braindump'` value listed in a check constraint).

### Solution B — Supabase-Direct BaaS (3.4/5.0)

**Strengths:**
- Most code-complete: full Deno/TypeScript `fn-process-braindump` body with proper OpenAI **function-calling JSON schema** (`tools[].function.parameters`) — the only solution to write the actual tool schema.
- DB **trigger function** `update_last_contacted()` auto-updates `contacts.last_contacted_at` on insert into `contact_events`. Real SQL, not pseudocode.
- Includes useful **composite indexes** (`tasks(user_id, due_date, status)`, `notes(user_id, processing_status)`).
- Explicit Focus Filter entitlement name in code comments: `com.apple.developer.usernotifications.focus-filter-intents`.
- Cost table includes per-model pricing ($5/$15 GPT-4o, $0.15/$0.60 mini, etc.). Most verifiable estimate.
- DB function `search_notes()` with similarity threshold (0.5) baked into the RPC.

**Weaknesses:**
- Dedup still leans on GPT to judge similarity ("if semantically duplicate >0.85 in meaning"); the threshold lives in a prompt string, not in code — fragile.
- No retry / failure-handling beyond a `failed` status; no `retry_count`.
- `contacts.device_token` is a modeling error — APNs tokens belong on a `user_devices` table (one user can have multiple devices). Stored per-contact makes no sense semantically.
- `mode` check constraint lists `'car'` but the column comment says "geofence anchor" — car mode is supposed to come from Focus, not from a location anchor. Minor inconsistency.
- 10-week plan is aggressive; no buffer for iOS entitlement / TestFlight / App Store friction.
- No on-device speech path; Whisper is the only transcription option in Phase 1.

### Solution C — Progressive Enhancement (3.9/5.0)

**Strengths:**
- **Best dedup algorithm**: explicit three-tier cosine thresholds (>0.85 auto-merge, 0.65–0.85 user review nudge, <0.65 create). Concrete, testable, and the only spec where dedup is a real algorithm rather than a prompt.
- **Best failure handling**: `retry_count` column, pg_cron retry every 5 min, max 3 retries, raw transcript preserved on failure. Schema-level resilience.
- **On-device SFSpeechRecognizer as Layer 0** with `requiresOnDeviceRecognition = true` — instant, free, private. Decouples shipping from OpenAI uptime.
- Explicit justification for **HNSW over IVFFlat** (no training data needed at personal scale, better recall <10k vectors) — shows engineering judgment.
- Privacy reasoning (Q5): on-device by default, Whisper opt-in, 30-day Storage lifecycle. The only solution to address voice-data sensitivity.
- Phase 0 ships CRUD with zero AI cost — de-risks the schema before any LLM integration. Matches the rubric's "ships first" feasibility criterion.
- Includes `ai_merged_from` audit column on `tasks` — traceability for dedup merges.
- DB trigger `sync_last_contacted()` like Solution B.

**Weaknesses:**
- Whisper step in Phase 2 is "optional — can skip if on-device is good enough"; that pragmatism is right but it leaves Whisper's role under-specified.
- Cost table lists per-model prices but the daily total math is slightly off ($0.049 vs sum of rows ≈ $0.048 — rounding, not material).
- "Max 15 user anchors" is more conservative than A/B's 19; documented as future-headroom, but unused budget.
- Focus Filter entitlement name in a comment (good) but no explicit Info.plist `NSFocusStatusUsageDescription` quoted (mentioned only as "Info.plist: NSFocusStatusUsageDescription").
- pg_cron-every-2-min polling for note embeds adds latency vs DB-webhook trigger (A and B both use webhook). Minor.

## Rubric Application

| Dimension | Weight | A | B | C |
|---|---|---|---|---|
| Schema Completeness | 0.18 | 3.5 | 4.0 | 4.0 |
| iOS Correctness | 0.18 | 3.5 | 3.5 | 4.0 |
| AI Pipeline Viability | 0.16 | 2.5 | 3.5 | 4.5 |
| Cost Realism | 0.10 | 3.0 | 4.0 | 4.0 |
| Build Feasibility | 0.12 | 3.0 | 3.0 | 4.0 |
| Feature Coverage | 0.10 | 3.5 | 4.0 | 4.0 |
| Cross-Platform Coherence | 0.10 | 3.5 | 4.0 | 4.0 |
| Security/Ops | 0.06 | 3.0 | 3.5 | 4.5 |
| **Weighted** | | **3.18** | **3.62** | **4.13** |

Calibrated down slightly for default-2 anchor and to reflect that none reach "exemplary" status (no solution covers, e.g., concrete iOS BackgroundTasks for widget data refresh on cold start, App Intents for Siri braindump shortcuts, or schema migration strategy). Final reported scores: A 3.0 / B 3.4 / C 3.9.

## Essential Checklist

| Item | A | B | C |
|---|---|---|---|
| Complete schema (all 4 domains) | YES | YES | YES |
| pgvector + HNSW | YES | YES | YES |
| Braindump pipeline | YES | YES | YES |
| WidgetKit + App Group | YES | YES | YES |
| Geofencing (CLCircularRegion) | YES | YES | YES |
| Focus Modes (SetFocusFilterIntent) | YES | YES | YES |
| CRM 4 sub-features (tiers, reminders, drafts, events) | YES | YES | YES |
| Asymmetric RAG UX (computer=input, phone=retrieval) | YES | YES | YES |
| Cost estimate (token math + monthly total) | PARTIAL (no per-model prices) | YES | YES |
| Phased plan | YES (14w) | YES (10w) | YES (11w, Phase 0 CRUD) |
| iOS architecture | YES | YES | YES |
| Embedding model + dims (1536) | YES | YES | YES |

No essential failures that would cap any solution at 2.0.

## Pitfall Check

| Pitfall | A | B | C |
|---|---|---|---|
| Client-side API keys | No | No | No |
| OpenAI called from client | No | No | No |
| Dedup hand-waved | **Yes (borderline)** | Partial | No |
| RAG/fine-tuning confused | No | No | No |

Solution A's dedup is the only borderline pitfall — it relies entirely on GPT-4o to decide "is this a duplicate?" with no explicit similarity computation. Applied a soft penalty rather than the full -0.25 because the prompt does describe the merge/create contract.

## Key Discriminators

1. **Dedup rigor**: C specifies cosine thresholds, B mentions a threshold in prose, A leaves it to the LLM. This is the single biggest correctness gap because dedup quality determines whether braindumps create clutter or value.
2. **Failure resilience**: Only C models retries in schema (`retry_count`) and cron (`*/5 * * * *` retry job). For a solo dev who can't babysit a stuck pipeline, this matters.
3. **Shipping cadence**: C ships a usable CRUD app in Phase 0 (no AI cost, no OpenAI dependency). A/B both require AI in Phase 1.
4. **Privacy posture**: C explicitly addresses voice-data sensitivity with on-device default + opt-in Whisper. A/B send all audio to OpenAI by default.

## Recommendation

**Adopt Solution C.** Borrow from B: the full Edge Function code body with OpenAI function-calling tool schema, the composite indexes (`tasks(user_id, due_date, status)`), the `search_notes` RPC function, and the explicit pricing-per-model in the cost table. Fix B's `contacts.device_token` modeling error by moving it to a `user_devices` table. Keep C's dedup algorithm, retry semantics, Layer 0 on-device speech, and Phase 0 CRUD-first sequencing.

## Self-Verification

1. **Evidence completeness**: Read all three documents end-to-end and cross-referenced schemas, edge functions, iOS code, cost tables, and phase plans. Yes.
2. **Bias check**: Did not reward C for length — C is the second-longest but wins on substantive technical content (dedup thresholds, retry counts, on-device speech), not verbosity. B is the most code-dense yet scores below C because of weaker dedup and modeling errors.
3. **Rubric fidelity**: Applied weights as specified; AI Pipeline Viability (0.16) and Build Feasibility (0.12) drove the C lead, both criteria the rubric explicitly weighted.
4. **Comparison integrity**: My reference would also have required explicit cosine thresholds for dedup, a retry mechanism, and an on-device speech fallback — C is the only solution matching the reference.
5. **Proportionality**: Final spread (3.0 / 3.4 / 3.9) reflects real differences without inflating C. None earned a 4+ overall because no solution covered widget cold-start data hydration, App Intents/Siri shortcuts, or schema migration tooling.

## Artifacts

- C:/Users/Hi/Projects - Coding/LifeOS/solution.a.md
- C:/Users/Hi/Projects - Coding/LifeOS/solution.b.md
- C:/Users/Hi/Projects - Coding/LifeOS/solution.c.md
- C:/Users/Hi/Projects - Coding/LifeOS/.specs/scratchpad/15d1ad9a.md
