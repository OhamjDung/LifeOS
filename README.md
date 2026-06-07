# LifeOS

Personal second brain. SwiftUI iOS + Next.js web + Supabase + OpenAI.

## What it does

- **Task capture** — voice braindump on phone, AI extracts and deduplicates tasks async
- **Contextual modes** — app auto-switches Home/Work/Gym/Car via geofencing and iOS Focus
- **Personal CRM** — relationship reminders by tier, AI-drafted catch-up messages
- **Notes + semantic search** — rich editor on web, search-first retrieval on phone

## Architecture

Three layers. Lower layers work without higher ones.

```
Layer 2 — AI Proactive   nudges, cross-feature insights
Layer 1 — AI Async       background embed/categorize/dedup (non-blocking)
Layer 0 — CRUD Core      always works, even when OpenAI is down
```

AI never blocks the write path. Voice braindumps save raw transcript instantly. Edge Functions process async via pg_cron.

## Stack

| Layer | Tech |
|---|---|
| iOS | SwiftUI, SFSpeechRecognizer, CoreLocation, WidgetKit |
| Web | Next.js 16, Tailwind CSS 4, TypeScript |
| Backend | Supabase (PostgreSQL + pgvector, Auth, Realtime, Storage, Edge Functions, pg_cron) |
| AI | OpenAI GPT-4o (task extraction), GPT-4o-mini (categorization, CRM drafts), text-embedding-3-small |

OpenAI API key is a Supabase Edge Function secret — never in iOS binary or web client.

## Web App

```bash
cd web
npm install
npm run dev      # localhost:3000
npm run build
npm run lint
```

Requires `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

## Database

Run `supabase/schema.sql` in Supabase SQL Editor. Requires `uuid-ossp` and `vector` extensions (enabled in the script).

## Cost

~$0.40/month default (on-device speech). ~$1.50/month with Whisper opt-in.

## Build Plan

- [x] Phase 0 — CRUD foundation (current)
- [ ] Phase 1 — Voice braindump (on-device, free)
- [ ] Phase 2 — AI task extraction + dedup
- [ ] Phase 3 — Contextual modes (geofencing + Focus Filter)
- [ ] Phase 4 — Personal CRM
- [ ] Phase 5 — Notes + semantic search
