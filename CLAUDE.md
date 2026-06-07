# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)

## Next.js Web App

The web app lives in `web/`. **Before writing any Next.js code**, read the notice in `web/AGENTS.md` — this is Next.js 16 with breaking changes from standard Next.js.

Key Next.js 16 rules already applied to this codebase:
- `params` and `searchParams` in page components are `Promise` — always `await` before use
- Auth proxy is `proxy.ts` / `export function proxy()` — NOT `middleware.ts` / `middleware`
- `cookies()` is async — already handled in `lib/supabase/server.ts`

```bash
# From web/
npm run dev      # dev server at localhost:3000
npm run build    # production build
npm run lint     # ESLint (runs eslint directly, not next lint)
```

Env vars required (`web/.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Mobile App (Expo)

The mobile app lives in `mobile/`. Uses Expo SDK 56 + Expo Router v6.

```bash
# From mobile/
npx expo start --clear    # start dev server (scan QR with Expo Go)
eas build --profile development --platform ios   # build dev client (needs Apple Developer account)
```

Env vars in `mobile/.env`: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`

**Expo Go limitations** (features requiring EAS dev client build):
- Voice recording (`@react-native-voice/voice`) — mic button hidden in Expo Go, shown after dev client
- Background geofencing (`expo-location` background tasks)

**GitHub Actions build pipeline** (free, no Apple Developer account):
- `.github/workflows/build-ios.yml` — runs on push to main when `mobile/` changes
- `expo prebuild` → `xcodebuild` (unsigned) → `.ipa` artifact
- Download artifact → drag into AltStore → signs with free Apple ID → installs on iPhone
- AltStore re-signs every 7 days automatically over WiFi

## AI Models

All AI calls use GitHub Models (free) via OpenAI SDK with a custom base URL:

```typescript
const openai = new OpenAI({
  baseURL: 'https://models.inference.ai.azure.com',
  apiKey: Deno.env.get('GITHUB_TOKEN'),
})
```

Models in use: `gpt-4o` (task extraction), `gpt-4o-mini` (categorization, CRM drafts), `text-embedding-3-small` (note embeddings + search). `GITHUB_TOKEN` is a Supabase Edge Function secret — never in web client or mobile binary.

## Supabase

- Schema: `supabase/schema.sql` — run in SQL Editor to initialize DB
- Additional migrations: `supabase/migrations.sql` — run after schema (task_type, rollover_count, triggers)
- Helper functions + pg_cron schedules: `supabase/functions.sql` — run after schema
- Edge Functions: `supabase/functions/` — deploy with `supabase functions deploy <name> --project-ref atokyvaqjvqkveqnfurg`

All Supabase clients use `@supabase/ssr` (web) or `@supabase/supabase-js` (mobile):
- Web server components: `import { createClient } from '@/lib/supabase/server'`
- Web client components: `import { createClient } from '@/lib/supabase/client'`
- Mobile: `import { supabase } from '../../lib/supabase'`

Never call AI from web client or mobile. All AI calls go through Edge Functions only.

## Architecture

Three-layer progressive enhancement — lower layers work without higher ones:

- **Layer 0** — CRUD core. Always works. No AI dependency.
- **Layer 1** — Async AI via pg_cron polling `processing_status='pending'` rows. Never blocks writes.
- **Layer 2** — Proactive AI nudges (not yet built).

Braindump flow: web/mobile saves `raw_transcript` to `braindump_jobs` immediately → `fn-process-braindump` polls every 2 min via pg_cron → extracts tasks with GPT-4o + cosine dedup → tasks appear via Realtime.

Note embedding: save note → `fn-embed-note` polls every 2 min → chunks + embeds → category/tags update via Realtime on `notes.processing_status`.

## Task Domain Details

Tasks have two types (`task_type`):
- `task` — regular task, shown as dot on calendar
- `event` — calendar event, shown with title on calendar, can be linked to a contact

Key task behaviors:
- **Auto-rollover**: on page load, past pending tasks are moved to today automatically
- **Future scheduling**: `due_date` can be any date, date picker in UI
- **Rollover count**: `rollover_count` incremented by trigger on each `task_rollovers` insert. Tasks with higher rollover_count sorted first (higher priority). Badge shown at ≥1, orange highlight at ≥3.
- **Event → contact sync**: completing an event task with `contact_id` set triggers `trg_event_task_contact` → updates `contacts.last_contacted_at`

## Web App Structure

```
web/app/
  page.tsx                       # root redirect to /dashboard
  login/page.tsx
  auth/callback/route.ts
  proxy.ts                       # auth proxy (Next.js 16 — replaces middleware.ts)
  (app)/layout.tsx               # auth guard + sidebar (Dashboard, Tasks, Calendar, Braindump, Notes, Search, Contacts)
  (app)/dashboard/page.tsx
  (app)/tasks/page.tsx           # auto-rollover past tasks, fetch with rollover_count sort
  (app)/calendar/page.tsx        # monthly grid: dots for tasks, titles for events, searchParams for month/year
  (app)/braindump/page.tsx       # text braindump → braindump_jobs
  (app)/notes/                   # list, new, [id]
  (app)/search/page.tsx          # semantic search via fn-search-notes
  (app)/contacts/                # list, new, [id]
web/lib/
  supabase/{client,server,middleware}.ts
  types.ts                       # all shared TypeScript types
web/components/
  TaskList.tsx                   # add/complete/rollover/delete tasks — type selector, date picker, contact selector for events
  NoteEditor.tsx                 # edit/delete note (client)
  ContactDetail.tsx              # log events + AI draft message button (client)
  LogoutButton.tsx
```

## Mobile App Structure

```
mobile/app/
  _layout.tsx                    # root layout — auth guard, session listener
  index.tsx                      # redirect to /(tabs)/tasks
  (auth)/login.tsx
  (tabs)/_layout.tsx             # tab bar: Tasks, Braindump, Notes, Contacts, Search, Modes
  (tabs)/tasks.tsx               # today's tasks, auto-rollover, event type, date picker, rollover badges
  (tabs)/braindump.tsx           # text + voice braindump (voice: mic hidden in Expo Go, shown in dev client)
  (tabs)/notes.tsx               # notes list + compose (text + voice recording)
  (tabs)/contacts.tsx            # contacts list with overdue badges
  (tabs)/search.tsx              # semantic search
  (tabs)/modes.tsx               # location anchors + geofence activation
  contact/[id].tsx               # contact detail — timeline, log interaction
  contact-new.tsx                # new contact form
mobile/lib/
  supabase.ts                    # Supabase client with SecureStore auth persistence
  types.ts                       # Task, Contact, ContactEvent, TaskType, TaskStatus, etc.
  geofence.ts                    # expo-location geofencing task + startGeofencing/stopGeofencing
```

## Edge Functions

All in `supabase/functions/`. Each uses Deno + `jsr:@supabase/supabase-js@2` + `npm:openai`.

| Function | Trigger | Does |
|---|---|---|
| `fn-process-braindump` | pg_cron every 2 min | GPT-4o extracts tasks, cosine dedup (0.85/0.65 thresholds) |
| `fn-embed-note` | pg_cron every 2 min | Paragraph chunks → embeddings → GPT-4o-mini category+tags |
| `fn-search-notes` | HTTP POST from client | Embeds query → calls `search_notes()` DB function |
| `fn-draft-catchup` | HTTP POST from client | GPT-4o-mini drafts catch-up message for a contact |

`fn-search-notes` and `fn-draft-catchup` verify the user JWT from `Authorization` header before executing.

## Database Key Patterns

- All tables use RLS (`auth.uid() = user_id`). Always pass `user_id: user?.id` explicitly on inserts (no server-side default).
- `braindump_jobs` and `notes`: Edge Functions set `processing_status='processing'` before AI call, `done/failed` after. `retry_count` max 3 enforced in query (`lt('retry_count', 3)`).
- `tasks.rollover_count`: incremented by `trg_increment_rollover_count` trigger on `task_rollovers` insert. Backfilled from existing rows via `migrations.sql`.
- `tasks.contact_id`: optional FK to contacts. `trg_event_task_contact` trigger updates `contacts.last_contacted_at` when event task marked done.
- `contact_events` with `event_type in ('photo_sent','message_sent','met')` also auto-update `contacts.last_contacted_at` via `trg_last_contacted` trigger.
- `note_chunks.embedding` uses HNSW index (`vector_cosine_ops`, m=16, ef_construction=64). `search_notes()` DB function handles cosine similarity search.

## Build Phase Status

| Phase | Status |
|---|---|
| 0 — CRUD foundation | ✅ Done |
| 1 — Voice braindump (mobile) | ⏳ Code ready, needs dev client build (Apple Dev account or GitHub Actions + AltStore) |
| 2 — AI task extraction + dedup | ✅ Done |
| 3 — Contextual modes / geofencing | ⏳ Code ready, needs dev client build |
| 4 — CRM (web + AI drafts) | ✅ Done (push notifications need APNs) |
| 5 — Notes + semantic search | ✅ Done |
| 6 — Task events + calendar view | ✅ Done |
| 7 — Mobile notes with voice | ⏳ Code ready, needs dev client build |
