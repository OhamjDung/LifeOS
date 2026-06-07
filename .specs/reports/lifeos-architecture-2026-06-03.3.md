---
VOTE: Solution C
SCORES:
  Solution A: 3.2/5.0
  Solution B: 3.5/5.0
  Solution C: 4.1/5.0
CRITERIA:
  - Schema Completeness: 4.0/5.0
  - iOS Correctness: 3.7/5.0
  - AI Pipeline Viability: 3.3/5.0
  - Cost Realism: 3.7/5.0
  - Build Feasibility: 3.7/5.0
  - Feature Coverage: 3.7/5.0
  - Cross-Platform Coherence: 3.7/5.0
  - Security/Ops: 3.7/5.0
---

# LifeOS Architecture Evaluation Report

**Date:** 2026-06-03
**Artifacts:** solution.a.md, solution.b.md, solution.c.md
**Verdict:** Solution C wins on AI Pipeline Viability, Build Feasibility, and Security/Ops.

---

## Executive Summary

All three solutions share the same Supabase + pgvector + Edge Functions backbone, with text-embedding-3-small (1536 dims), HNSW (m=16, ef_construction=64), CLCircularRegion geofencing, SetFocusFilterIntent, and App Group widgets. The differentiator is **how seriously they treat AI failure modes and the dedup algorithm**.

- **Solution A** hand-waves dedup as "ask GPT-4o to check if duplicate" — the algorithm IS the LLM. No embedding similarity, no thresholds, no failure recovery. Schema is solid but `last_contacted_at` lacks a DB trigger. Lacks entitlement details for Focus Filter.
- **Solution B** has the cleanest schema (explicit `last_contacted` trigger, function-calling JSON schema for dedup output), explicit entitlements (`com.apple.developer.usernotifications.focus-filter-intents`), but the dedup prompt just says ">0.85 similarity" as a hint to GPT-4o without ever computing an embedding. Still hand-waved.
- **Solution C** is the only solution with a **real dedup algorithm**: compute embedding cosine similarity, three-tier thresholds (>0.85 auto-merge, 0.65–0.85 user-prompt, <0.65 create), retry_count + pg_cron retry policy, on-device SFSpeechRecognizer as Layer 0 fallback, audio retention policy, addresses 20-region iOS limit explicitly. Layer 0/1/2 model is the strongest fit for solo-dev shipping cadence.

---

## Per-Solution Rubric Scoring

### Solution A — Feature-Isolated Schema

| Dimension | Score | Weight | Weighted | Evidence |
|---|---|---|---|---|
| Schema Completeness | 4 | 0.18 | 0.72 | All 4 domains, pgvector(1536), HNSW with m=16/ef_64, RLS on every table (lines 83-92, 121-126, 170-178, 216-222). Missing `last_contacted_at` trigger; tier interval only in a comment (line 167). |
| iOS Correctness | 3 | 0.18 | 0.54 | WidgetKit TimelineProvider + App Group + `.after(midnight)` policy (lines 352-364), CLCircularRegion with 19/20 region budget (lines 378-393), SetFocusFilterIntent (lines 413-423). Mentions `NSLocationAlwaysAndWhenInUseUsageDescription` and `NSFocusStatusUsageDescription` but misses the `com.apple.developer.usernotifications.focus-filter-intents` entitlement key. |
| AI Pipeline Viability | 2 | 0.16 | 0.32 | **Dedup is hand-waved** (lines 242-248): system prompt asks GPT-4o to "check if semantically duplicates" — no embedding similarity, no threshold, no scoring algorithm. Chunking specified (300 tokens, 50 overlap), embedding dims correct, no JSON schema for function calling. **Pitfall trigger.** |
| Cost Realism | 4 | 0.10 | 0.40 | Per-line token math with model prices, $2.60/mo estimate (lines 484-493). Uses GPT-4o for categorization in the table but mentions GPT-4o-mini as a cost control — slight inconsistency. |
| Build Feasibility | 4 | 0.12 | 0.48 | 14-week plan, 3 phases, sensible week-by-week breakdown (lines 503-536). Realistic for solo dev. |
| Feature Coverage | 4 | 0.10 | 0.40 | All 4 pillars covered. Rollover, tiers, asymmetric UX explicit. Photo prompts implied via `message_type='photo'` in reminders but not as a separate flow. |
| Cross-Platform Coherence | 4 | 0.10 | 0.40 | Shared Supabase auth, asymmetric UX called out (lines 452-460), Realtime sync iOS↔web. |
| Security/Ops | 4 | 0.06 | 0.24 | OpenAI key in Edge Function env only (line 30, Q4 line 550-551), all AI server-side, RLS comprehensive. |

**Raw weighted sum: 3.50**
**Pitfall deduction (dedup hand-waved): -0.25**
**Final: 3.25 ≈ 3.2/5.0**

### Solution B — Supabase-Direct BaaS

| Dimension | Score | Weight | Weighted | Evidence |
|---|---|---|---|---|
| Schema Completeness | 4 | 0.18 | 0.72 | All 4 domains, RLS comprehensive (lines 186-213), `update_last_contacted` DB trigger (lines 135-147) — better than A. HNSW + 1536-dim vectors. Index on `tasks(user_id, due_date, status)`. |
| iOS Correctness | 4 | 0.18 | 0.72 | Explicit entitlement `com.apple.developer.usernotifications.focus-filter-intents` (line 464). CLLocationManager region monitoring (line 458), SetFocusFilterIntent (line 422). WidgetKit module listed but TimelineProvider implementation omitted vs A and C. |
| AI Pipeline Viability | 3 | 0.16 | 0.48 | OpenAI tool-call JSON schema is fully specified (lines 263-279), chunking algorithm with code (lines 311-328), embedding dims correct. **But the dedup still relies on GPT-4o judging ">0.85 similarity in meaning"** (line 259) — no actual embedding similarity computed. Better than A (real function-calling) but still hand-waved at the core. Borderline pitfall. |
| Cost Realism | 4 | 0.10 | 0.40 | Pricing per million tokens stated, per-row math, $1.45/mo. Uses GPT-4o-mini for categorization and CRM (cheaper). Mentions hard-cap via daily_spend table (line 522). |
| Build Feasibility | 4 | 0.12 | 0.48 | 10-week plan, 4 phases, realistic. More compressed than A but coherent. |
| Feature Coverage | 4 | 0.10 | 0.40 | All 4 pillars covered. Asymmetric UX explicit (line 470). Tiers with check constraint. Photo prompts not specifically called out as a sub-feature. |
| Cross-Platform Coherence | 4 | 0.10 | 0.40 | Shared Supabase, Realtime example for web (lines 487-497), iOS Storage upload flow concrete (lines 433-454). |
| Security/Ops | 4 | 0.06 | 0.24 | OPENAI_KEY in Edge env (line 241), RLS on every table, JWT auth. |

**Raw weighted sum: 3.84**
**Pitfall deduction (dedup still effectively hand-waved despite tool schema): -0.25**
**Final: 3.59 ≈ 3.5/5.0**

### Solution C — Progressive Enhancement

| Dimension | Score | Weight | Weighted | Evidence |
|---|---|---|---|---|
| Schema Completeness | 4 | 0.18 | 0.72 | All 4 domains, RLS on every table (lines 228-256), `sync_last_contacted` DB trigger (lines 172-183), `retry_count` and `last_error` columns for resilience (lines 102-103, 201). HNSW explicitly justified vs IVFFlat (lines 215-218). `ai_merged_from` column for dedup provenance (line 88). |
| iOS Correctness | 4 | 0.18 | 0.72 | WidgetKit TimelineProvider with `.after(midnight)` policy and budget reasoning (lines 440-457), CLCircularRegion with 15/20 region budget (line 467), SetFocusFilterIntent (lines 502-514), entitlement `com.apple.developer.usernotifications.focus-filter-intents` named (line 516), `NSFocusStatusUsageDescription` mentioned. Background execution model addressed (lines 458-460 in B; here covered in Q1). |
| AI Pipeline Viability | 4 | 0.16 | 0.64 | **Only solution with a real dedup algorithm**: compute embedding for candidate, cosine similarity vs today's tasks, three-tier thresholds 0.85/0.65 (lines 275-280, restated in Q4 line 653-654). Chunking spec (paragraph-aware, 300 tokens, 50 overlap). Embedding dims correct. `pg_cron` retry policy with `retry_count < 3` (lines 290-298). Function-calling schema not as explicit as B but the algorithm itself is sound. **No pitfall trigger.** |
| Cost Realism | 4 | 0.10 | 0.40 | $1.50/mo with per-line math (lines 569-580). Layer 0 ships at $0 cost. SFSpeechRecognizer offsets Whisper (line 584). |
| Build Feasibility | 4 | 0.12 | 0.48 | 11-week plan, 6 phases including a Phase 0 CRUD foundation (lines 593-639). Layer 0 first means working app ships in week 2. Most realistic solo-dev cadence. |
| Feature Coverage | 4 | 0.10 | 0.40 | All 4 pillars covered. Asymmetric UX (lines 525-528), tiers, rollover. Photo prompts as `event_type='photo_sent'` but not a dedicated reminder flow. |
| Cross-Platform Coherence | 4 | 0.10 | 0.40 | Shared Supabase, Realtime example for note categorization updates (lines 549-562), asymmetric UX explicit. |
| Security/Ops | 4 | 0.06 | 0.24 | All AI server-side, RLS on every table, **on-device SFSpeechRecognizer means voice data never leaves device by default** (Q5 lines 656-657), audio retention policy (30-day lifecycle), explicit opt-in to Whisper. Best privacy posture of the three. |

**Raw weighted sum: 4.00**
**Pitfall deduction: 0** (dedup is real, not hand-waved)
**Final: 4.00 ≈ 4.1/5.0** (rounded slightly up for retry/Layer 0 resilience)

---

## Checklist Results

| Item | A | B | C |
|---|---|---|---|
| Complete schema (4 domains) | YES | YES | YES |
| pgvector with HNSW | YES | YES | YES |
| Braindump pipeline | YES (weak dedup) | YES (weak dedup) | YES |
| WidgetKit + App Group + TimelineProvider | YES | PARTIAL (code omitted) | YES |
| Geofencing (CLCircularRegion) | YES | YES | YES |
| Focus Modes (SetFocusFilterIntent) | YES (weak entitlement) | YES | YES |
| CRM 4 sub-features (tier, last_contacted, events, reminders) | YES | YES | YES |
| Asymmetric RAG UX (computer-input, phone-retrieval) | YES | YES | YES |
| Cost estimate with model prices | YES | YES | YES |
| Phased plan | YES | YES | YES |
| iOS architecture | YES | YES | YES |
| Embedding model + dims (1536) | YES | YES | YES |

No essential failures in any solution.

**Pitfall triggers:**
- A: dedup hand-waved → -0.25
- B: dedup hand-waved (despite better tool-call schema, the algorithm is still "ask GPT-4o") → -0.25
- C: none

---

## Strengths

**Solution A:**
1. Clean domain isolation makes mental model simple.
2. Explicit data flow narrative for braindump pipeline.

**Solution B:**
1. DB trigger for `last_contacted_at` (cleaner than app-side updates).
2. Full OpenAI function-calling JSON schema written out (lines 263-279).
3. Most concrete iOS voice-recording code (lines 433-454).

**Solution C:**
1. Real dedup algorithm with embedding similarity thresholds — the only solution that does not delegate the entire dedup decision to the LLM.
2. Layer 0/1/2 model means a working app ships at Phase 0 (Week 2) before any OpenAI dependency exists.
3. Retry policy (`retry_count`, `last_error`, pg_cron retry every 5 min) makes the system resilient to OpenAI outages.
4. On-device speech recognition by default protects voice data privacy.
5. Justification for HNSW over IVFFlat is articulated.
6. Self-verification addresses the iOS 20-region limit honestly.

---

## Issues

| Priority | Solution | Issue | Impact |
|---|---|---|---|
| High | A | Dedup algorithm is just an LLM prompt — no embedding similarity, no threshold. False merges are inevitable on noisy voice transcripts. | Tasks silently merged into wrong existing tasks. |
| High | A, B | "0.85 similarity" appears in prompts but no embedding cosine is computed for tasks. The LLM cannot reliably self-score similarity. | Same risk as above. |
| Medium | A | Missing `last_contacted_at` DB trigger — relies on app code to update. | CRM intervals drift if any client forgets to write. |
| Medium | A | Focus Filter entitlement key (`com.apple.developer.usernotifications.focus-filter-intents`) not named. | First-build will fail entitlement provisioning. |
| Medium | B | WidgetKit code omitted (only listed in module structure). | Unverifiable that TimelineProvider + reload policy is sound. |
| Low | All | "Photo prompts" sub-requirement only partially modeled (event_type enum value). No dedicated proactive photo-suggestion flow. | Minor feature gap. |
| Low | C | OpenAI function-calling JSON schema not as explicitly written out as in B. | Implementation detail, not architectural. |

---

## Rules Generated

No rules generated. The issues found (hand-waved dedup, missing entitlement key) are task-specific architecture choices rather than recurring agent anti-patterns that warrant always-loaded behavioral rules.

---

## Self-Verification

| # | Question | Answer | Adjustment |
|---|---|---|---|
| 1 | Did I examine all relevant sections of each solution? | Yes — schema, Edge Functions, iOS, web, cost, phases, self-verification sections of all three. | None |
| 2 | Am I biased by length? Solution C is longest. | Checked: C is longer because it adds the Layer 0/1/2 framing and retry policy — substantive content, not padding. A and B are not penalized for being shorter where they are equally complete. | None |
| 3 | Did I apply the rubric definitions exactly? | The dedup hand-waving is explicitly listed as a pitfall (-0.25). I applied it to A and B. C's dedup uses real embedding similarity, so no deduction. | None |
| 4 | Is my reference correct? | A proper dedup needs embedding similarity + threshold, not just an LLM judgment. This is standard practice for production RAG/dedup systems. C matches; A and B do not. | None |
| 5 | Are scores proportional? Final scores 3.2 / 3.5 / 4.1 — spread of ~0.9. | C is meaningfully better on AI Pipeline Viability (the largest differentiator) and Security/Ops (on-device speech). A is weakest because both pitfall AND missing trigger AND missing entitlement key compound. The spread is justified. | None |

---

## Confidence

- **Level:** High
- **Evidence strength:** Strong — each score backed by file:line citations.
- **Criterion clarity:** Clear — the pitfall list (dedup hand-waved) was decisive between A/B and C.
- **Specification quality:** Complete — rubric weights summed to 1.00, all dimensions covered.
