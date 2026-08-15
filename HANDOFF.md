# Handoff — 2026-08-15

Session was planning/discussion only, no code changes. Notes below for picking
back up locally.

## Topic: Hosting the web app

Recommended **Vercel** (free Hobby tier) over Netlify — Vercel is built by the
Next.js team, so it tracks Next.js 16 breaking changes (this repo's `proxy.ts`,
etc.) day one. Netlify's Next runtime is a third-party adapter and can lag.

Hobby tier is free forever for personal/non-commercial use — no card required.
Includes serverless/edge functions, previews on every PR, custom domains.

**Deploy steps:**
1. vercel.com → sign in with GitHub → Import `ohamjdung/lifeos`
2. Set **Root Directory** to `web` (app isn't at repo root)
3. Add env vars before first deploy:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (values are in `web/.env.local`)
4. Deploy — build command auto-detected (`npm run build`)
5. Every push to `master` auto-redeploys; custom domain is free under
   Project → Settings → Domains

Note: Vercel only hosts the `web/` Next.js frontend. Supabase Edge Functions
(the AI calls) are deployed separately via `supabase functions deploy`.

## Topic: AI provider — DeepSeek

**Finding: the code is already migrated to DeepSeek.** `CLAUDE.md`'s "AI
Models" section is stale — it still describes GitHub Models, but every Edge
Function under `supabase/functions/` already points at
`https://api.deepseek.com` and reads a `DEEPSEEK_TOKEN` secret:

- `fn-auto-tag`, `fn-process-braindump`, `fn-embed-note`, `fn-draft-catchup`,
  `fn-group-tasks` → DeepSeek
- `fn-transcribe` → Groq (`https://api.groq.com/openai/v1`), separate key

**To activate:** get a key at platform.deepseek.com, then:
```bash
supabase secrets set DEEPSEEK_TOKEN=sk-xxxx --project-ref atokyvaqjvqkveqnfurg
```

**Pricing clarified:** one API key works across both `deepseek-v4-flash` and
`deepseek-v4-pro` — model choice is just the `model` string in the request,
not a separate key/account. The `$0.003625` figure asked about is the
**cache-hit** input price for `-pro` (vs. `$0.435` cache-miss) — it applies
automatically when a request's prompt prefix matches something DeepSeek
recently cached (e.g. a repeated system prompt), not something you toggle.

## Open items / next steps

- [ ] Set `DEEPSEEK_TOKEN` Supabase secret (not yet confirmed done)
- [ ] Deploy `web/` to Vercel per steps above
- [ ] **Check which model string each Edge Function actually requests** —
      confirm none are accidentally calling `-pro` (~10x pricier on
      cache-miss input, ~3x on output) for simple jobs like auto-tagging
- [ ] Run `supabase/migrations_v3.sql` (still pending per CLAUDE.md — adds
      `braindump_jobs.categories` column)
- [ ] Update `CLAUDE.md` "AI Models" section — it documents GitHub Models but
      the code has moved to DeepSeek; doc is out of sync with reality
