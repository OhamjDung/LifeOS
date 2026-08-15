# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Personal

Start every message with "Yes, Thomas"

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

**Known working versions**: `react@19.2.3`, `@types/react@~19.2.0` — `react@19.1.0` caused runtime crashes (fixed by bumping).

**Expo Go limitations** (features requiring EAS dev client build):
- Voice recording (`@react-native-voice/voice`) — mic button hidden in Expo Go, shown after dev client
- Background geofencing (`expo-location` background tasks)

**GitHub Actions build pipeline** (free, no Apple Developer account):
- `.github/workflows/build-ios.yml` — runs on push to main when `mobile/` changes
- `expo prebuild` → `xcodebuild` (unsigned) → `.ipa` artifact
- Download artifact → drag into AltStore → signs with free Apple ID → installs on iPhone
- AltStore re-signs every 7 days automatically over WiFi

**CI history**: the expo-av vs SDK 56 CI breakage saga (runs 39-83, resolved) has been moved to the `mobile-ci-expo-av-history` skill — load it only if a similar Xcode/CocoaPods module-build error resurfaces.

## AI Models

Chat/completions use DeepSeek via OpenAI SDK with a custom base URL:

```typescript
const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: Deno.env.get('DEEPSEEK_TOKEN'),
})
```

Embeddings use Jina AI directly (`https://api.jina.ai/v1/embeddings`, model `jina-embeddings-v3`) via `JINA_API_KEY` — not DeepSeek, no embeddings model there.

Model in use for all chat calls: `deepseek-v4-flash` (task extraction, note categorization, CRM drafts, auto-tag, task grouping) — cheap/fast tier, not `-pro`.

| Function | Uses |
|---|---|
| `fn-process-braindump` | `deepseek-v4-flash` + Jina embeddings (dedup) |
| `fn-embed-note` | Jina embeddings + `deepseek-v4-flash` (category/tags) |
| `fn-auto-tag` | `deepseek-v4-flash` |
| `fn-draft-catchup` | `deepseek-v4-flash` |
| `fn-group-tasks` | `deepseek-v4-flash` |
| `fn-transcribe` | Groq (`https://api.groq.com/openai/v1`), separate `GROQ_API_KEY` |

Secrets (Supabase Edge Function secrets — never in web client or mobile binary): `DEEPSEEK_TOKEN`, `JINA_API_KEY`, `GROQ_API_KEY`. `GITHUB_TOKEN` still exists as a secret but is unused legacy from the pre-DeepSeek GitHub Models setup.

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
- **Auto-rollover**: on page load, past pending `task`-type tasks are moved to today automatically. Events are NOT rolled over — they stay on their original date.
- **Future scheduling**: `due_date` can be any date, date picker in UI
- **Rollover count**: `rollover_count` incremented by trigger on each `task_rollovers` insert. Tasks with higher rollover_count sorted first (higher priority). Badge shown at ≥1, orange highlight at ≥3.
- **Event → contact sync**: completing an event task with `contact_id` set triggers `trg_event_task_contact` → updates `contacts.last_contacted_at`
- **Tags**: `tags`/`task_tags` tables. Tasks can have multiple tags. First tag shown on task card. `fn-auto-tag` auto-assigns one tag per task via GPT-4o-mini.
- **Contact badge**: tasks with `contact_id` show "● KEEP IN TOUCH" badge instead of rollover count

## Web App Structure

```
web/app/
  page.tsx                       # root redirect to /dashboard
  login/page.tsx                 # neumorphic analog card, IBM Plex Mono, sage button
  auth/callback/route.ts
  proxy.ts                       # auth proxy (Next.js 16 — replaces middleware.ts)
  globals.css                    # @theme inline: warm analog palette (grays→#CCCAC0/#DEDAD2, indigos→sage #516439, white→#1C1A14)
  layout.tsx                     # IBM Plex Mono font via next/font/google
  (app)/layout.tsx               # auth guard + <NavBar /> (left sidebar)
  (app)/dashboard/page.tsx       # LCD metrics panel (dark #2A2F29) + overdue contacts
  (app)/tasks/page.tsx           # 50/50 split: left=TaskList, right=calendar grid; searchParams m/y/d for month+day selection
  (app)/calendar/page.tsx        # standalone calendar (still exists; tasks page embeds calendar too)
  (app)/braindump/page.tsx       # 50/50 split: form left, results right (tasks/notes/contacts extracted + reprompt box)
  (app)/notes/                   # list (with filter bar), new, [id]
  (app)/search/page.tsx          # semantic search via fn-search-notes
  (app)/contacts/                # list, new, [id]
web/lib/
  supabase/{client,server,middleware}.ts
  types.ts                       # all shared TypeScript types
web/components/
  NavBar.tsx                     # left sidebar nav (72px, analog gradient, IBM Plex Mono labels, usePathname active state)
  TaskList.tsx                   # add/complete/rollover/delete — "Keep in Touch" section above pending; drag-to-reorder within sections
  NotesFilter.tsx                # client component: live filter notes by title/content/tag
  NoteEditor.tsx                 # edit/delete note (client)
  NotesPendingChecker.tsx        # triggers fn-embed-note when pending notes detected
  ContactDetail.tsx              # log events + AI draft message button (client)
  LogoutButton.tsx
```

### UI Theme (analog/neumorphic)
- Palette mapped via Tailwind v4 `@theme inline` — existing class names auto-remap, no per-file changes needed:
  - `bg-gray-950` → `#CCCAC0` (page bg), `bg-gray-900` → `#DEDAD2` (surface), `bg-gray-800` → `#C4C1B7`
  - `bg-indigo-600` → `#516439` (sage), `text-white` → `#1C1A14` (dark ink)
- Sage-bg buttons must use `text-[#DEDAD2]` explicitly (dark ink on dark sage = poor contrast)
- LCD panels (dashboard metrics) use explicit `style={{ background: '#2A2F29' }}` to stay dark

## Mobile App Structure

```
mobile/app/
  _layout.tsx                    # root layout — auth guard, session listener
  index.tsx                      # redirect to /(tabs)/today
  (auth)/login.tsx
  (tabs)/_layout.tsx             # tab bar: Today, Tasks, Dump, Notes, People, Modes, Logs
  (tabs)/today.tsx               # today's tasks + overdue contacts dashboard
  (tabs)/tasks.tsx               # all tasks, auto-rollover, event type, date picker, rollover badges
  (tabs)/braindump.tsx           # text + voice braindump (voice: mic hidden in Expo Go, shown in dev client)
  (tabs)/notes.tsx               # notes list + compose (text + voice recording)
  (tabs)/contacts.tsx            # contacts list with overdue badges (contact_tier-based)
  (tabs)/search.tsx              # semantic search (hidden from tab bar, accessible via nav)
  (tabs)/calendar.tsx            # calendar view (hidden from tab bar, accessible via nav)
  (tabs)/modes.tsx               # location anchors + geofence activation
  (tabs)/logs.tsx                # in-app debug log viewer (subscribes to lib/logger)
  contact/[id].tsx               # contact detail — timeline, log interaction
  contact-new.tsx                # new contact form
  connect-widget.tsx             # widget registration screen — links widget_id to user account
mobile/lib/
  supabase.ts                    # Supabase client with SecureStore auth persistence
  types.ts                       # Task, Contact, ContactEvent, Tag, TaskType, TaskStatus, ContactTier, etc.
  geofence.ts                    # expo-location geofencing task + startGeofencing/stopGeofencing
  logger.ts                      # in-memory log ring buffer + subscribe() for LogsScreen
  theme.ts                       # T color tokens, MONO font, raisedShadow helpers
  dailyTasks.ts                  # daily task helpers
  widgetSync.ts                  # widget registration + sync helpers
```

## Edge Functions

All in `supabase/functions/`. Each uses Deno + `jsr:@supabase/supabase-js@2` + `npm:openai`.

| Function | Trigger | Does |
|---|---|---|
| `fn-process-braindump` | pg_cron every 2 min | GPT-4o extracts tasks, cosine dedup (0.85/0.65 thresholds) |
| `fn-embed-note` | pg_cron every 2 min | Paragraph chunks → embeddings → semantic search for top-5 similar notes → GPT-4o-mini category+tags (uses ±2h temporal context + semantic context + existing tags library) |
| `fn-search-notes` | HTTP POST from client | Embeds query → calls `search_notes()` DB function |
| `fn-draft-catchup` | HTTP POST from client | GPT-4o-mini drafts catch-up message for a contact |
| `fn-auto-tag` | HTTP POST from client | GPT-4o-mini picks best tag from user's tag list for a task |
| `fn-widget-data` | HTTP GET from iOS widget | Returns today's tasks for a `widget_id` (no JWT — uses `widget_registrations` table) |
| `fn-widget-action` | HTTP POST from iOS widget | Complete or rollover a task; auth via `widget_id` credential |

`fn-search-notes`, `fn-draft-catchup`, and `fn-auto-tag` verify the user JWT from `Authorization` header before executing.
`fn-widget-data` and `fn-widget-action` use `widget_registrations.widget_id` as the auth credential (no JWT — widget can't store tokens).

## Database Key Patterns

- All tables use RLS (`auth.uid() = user_id`). Always pass `user_id: user?.id` explicitly on inserts (no server-side default).
- `braindump_jobs` and `notes`: Edge Functions set `processing_status='processing'` before AI call, `done/failed` after. `retry_count` max 3 enforced in query (`lt('retry_count', 3)`).
- `braindump_jobs.categories`: TEXT[] column (added in migrations_v3.sql), e.g. `['Tasks', 'Contacts']`. Controls what fn-process-braindump extracts.
- `tasks.rollover_count`: incremented by `trg_increment_rollover_count` trigger on `task_rollovers` insert. Backfilled from existing rows via `migrations.sql`.
- `tasks.contact_id`: optional FK to contacts. `trg_event_task_contact` trigger updates `contacts.last_contacted_at` when event task marked done.
- `contact_events` with `event_type in ('photo_sent','message_sent','met')` also auto-update `contacts.last_contacted_at` via `trg_last_contacted` trigger.
- `note_chunks.embedding` uses HNSW index (`vector_cosine_ops`, m=16, ef_construction=64). `search_notes()` DB function handles cosine similarity search.
- `tags` + `task_tags`: user-defined tags; `fn-auto-tag` auto-assigns one tag per task via GPT-4o-mini. Also `contact_tags` table for contact tags (mobile only).
- `widget_registrations`: maps `widget_id` (UUID generated on iOS) → `user_id`. No JWT needed — widget uses `widget_id` as credential for `fn-widget-data` / `fn-widget-action`.
- `contacts.contact_tier`: enum `daily|weekly|biweekly|monthly` — drives overdue badge logic via `CONTACT_TIER_DAYS` map (`1/7/14/30` days). Added in migrations_v2.sql.
- `contacts.relationship_tier`: enum `family|close_friend|friend|acquaintance` — used by `fn-draft-catchup` for AI tone selection. Both tiers coexist; `contact_tier` drives CRM timing, `relationship_tier` drives AI tone.
- When creating contacts, write both: `contact_tier` (user-selected frequency) + `relationship_tier: 'friend'` (default, for AI drafts).

## Build Phase Status

| Phase | Status |
|---|---|
| 0 — CRUD foundation | ✅ Done |
| 1 — Voice braindump (mobile) | ⏳ Code ready, needs dev client build (Apple Dev account or GitHub Actions + AltStore) |
| 1b — Voice braindump (web) | ✅ Done — Web Speech API (SpeechRecognition), graceful fallback if unsupported |
| 2 — AI task extraction + dedup | ✅ Done — prompt updated to extract "Research X" tasks from lists/programs |
| 3 — Contextual modes / geofencing | ⏳ Mobile only, needs dev client build. Web: N/A |
| 4 — CRM (web + AI drafts) | ✅ Done (push notifications need APNs) |
| 5 — Notes + semantic search | ✅ Done |
| 6 — Task events + calendar view | ✅ Done — tasks page is 50/50 split: TaskList left, calendar right |
| 7 — Mobile notes with voice | ⏳ Code ready, needs dev client build |
| 8 — iOS widget (tasks/events) | ✅ Done — HTTP polling via Supabase, no App Group required |
| 9 — Tags + AI auto-tag | ✅ Done |
| 10 — Today dashboard | ✅ Done |
| 11 — In-app debug logs | ✅ Done |
| 12 — Web/mobile feature parity | ✅ Done |
| 13 — Braindump results panel | ✅ Done — 50/50 layout: form left, results right; shows tasks/notes/contacts extracted; reprompt box to adjust output |
| 14 — Task drag-to-reorder | ✅ Done — drag within pending/followUp sections; client-side ordering |

**Pending DB migration**: Run `supabase/migrations_v3.sql` in Supabase SQL Editor to add `braindump_jobs.categories` column.

## What's Working Right Now (Aug 2026)

**Web app** (`/web`) is the primary surface — fully functional:
- `/tasks` — 50/50 split: task list (with drag reorder + Keep in Touch section) + embedded calendar
- `/braindump` — 50/50 split: form + live results panel (tasks/notes/contacts) + reprompt box
- `/notes` — list with live filter bar (title/content/tag search)
- `/dashboard` — LCD metrics panel + overdue contacts
- `/contacts` — CRM with tiers, AI draft messages
- `/search` — semantic vector search across notes

**Mobile app** (`/mobile`) — Expo SDK 56, works in Expo Go except voice + geofencing:
- Full task management with swipe gestures, drag reorder, rollover badges
- Braindump (text only in Expo Go, voice needs dev client)
- Notes with semantic search
- Contacts CRM
- Today dashboard
- iOS widget via `fn-widget-data` / `fn-widget-action`

**AI pipeline** (all free via GitHub Models):
- Braindump → GPT-4o extracts tasks (lists → "Research X" tasks, todos → direct tasks)
- Notes → `text-embedding-3-small` embeds → semantic search + GPT-4o-mini categorizes
- Contacts → GPT-4o-mini drafts catch-up messages
- Tasks → GPT-4o-mini auto-tags

**Known issue**: If pg_cron picks up a braindump job the same moment as the manual trigger, second call hits GitHub Models 429 rate limit (2 concurrent requests max) and job gets stuck in `processing`. Fix: mark stuck jobs `done` via `supabase db query --linked`.

## What's Next (possible next features)

- **Task sort persistence** — save drag order to DB (`sort_order` column on tasks)
- **Push notifications** — APNs setup for contact overdue reminders
- **Web Realtime** — live task updates without page refresh (Supabase Realtime subscription)
- **Layer 2 proactive nudges** — AI surfaces tasks you've been avoiding (high rollover_count)
- **Voice transcription on web** — `fn-transcribe` edge function exists, wire up to braindump page mic
- **Contact import** — bulk add from CSV or phone contacts
- **Recurring tasks** — `rrule` support for daily/weekly repeating tasks
