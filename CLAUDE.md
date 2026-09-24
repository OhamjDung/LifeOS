# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Personal

Start every message with "Yes, Thomas"

## Rollback point

**`be2d2e7`** (git tag `baseline-pre-harness`, 2026-09-23) = last version before the big rework (tasks page → tasks + AI chat harness, new Planner tab, Notion Calendar ICS sync). To go back: `git checkout baseline-pre-harness` (look) or `git reset --hard baseline-pre-harness` (discard everything after — destructive). Redeploy after reverting web code.

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)

## Deploying to Vercel

User wants a Vercel deploy after every change to `web/` — no need to ask each time.

**No GitHub auto-deploy is wired up.** The Vercel project (`web`, projectId `prj_aqd5uLIChr21ebSBtafoJScQ2L42`, team `team_lNV3tyGL6a9vc7iRNkawBTmN`) is not linked to the `OhamjDung/LifeOS` GitHub repo, so `git push` does **not** trigger a deploy. Attempting to link it via the `create_git_project` MCP tool fails with "You need to add a Login Connection to your GitHub account first" — that's a one-time action only the user can do in Vercel account settings, not yet done.

**Deploy command** (run from `web/` after any code change there):
```bash
npx vercel --prod --yes
```
This prints a JSON result whose `deployment.url` is the fresh, uniquely-named deployment URL (e.g. `web-xxxxxxxxx-ohamjdung196-9908s-projects.vercel.app`). The default `web-hazel-nine-48.vercel.app` alias was removed — `lifeostrich.vercel.app` is now the only custom alias, and it does NOT follow new deploys automatically (custom aliases are pinned to whatever deployment they last pointed at). **Always re-point it after deploying:**
```bash
npx vercel alias set <deployment.url from the JSON output above> lifeostrich.vercel.app
```
Forgetting this silently serves a stale build on `lifeostrich.vercel.app` (happened once already — the due-date-picker feature looked broken because the alias hadn't been re-pointed after deploy).
This works because the local Vercel CLI is authenticated — confirmed via `npx vercel whoami` → `ohamjdung196-9908`. If a fresh environment ever shows `"Not authorized"` on this command, re-auth with:
```bash
npx vercel login
```
It runs a device-flow login (prints `https://vercel.com/oauth/device?user_code=...`), which auto-approved instantly last time since the account was already authorized elsewhere — no browser needed on this machine.

**Do NOT** attempt to deploy by hand-building a `files` array for the `deploy_to_vercel` MCP tool (reading every source file and inlining it as a JSON param) — tried this once, it required transcribing ~190KB/51 files into a single tool call, truncated on binary files (favicon.ico), and is far too fragile/expensive vs. just running the CLI command above.

Production URL: https://lifeostrich.vercel.app — the only alias now; must be manually re-pointed after every deploy (see above).

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

**Jina = 1024 dimensions. `note_chunks.embedding` is `vector(1024)` (migrations_v11.sql).** It was `vector(1536)` from the old `text-embedding-3-small` days and nobody noticed for months because the chunk insert never checked its error — every note since the Jina switch was marked `done` with zero chunks and semantic search silently returned nothing for them. `schema.sql` now says 1024 too (fixed 2026-09-17). Jina's free tier also 429s on ~10 concurrent calls, which is why `fn-embed-note` processes notes sequentially, not `Promise.all`.

Model in use for all chat calls: `deepseek-v4-flash` (task extraction, note categorization, CRM drafts, auto-tag, task grouping) — cheap/fast tier, not `-pro`.

| Function | Uses |
|---|---|
| `fn-process-braindump` | `deepseek-v4-flash` (tasks + contacts, multi-tool) + Jina embeddings (task dedup) |
| `fn-embed-note` | Jina embeddings + `deepseek-v4-flash` (category/tags) |
| `fn-auto-tag` | `deepseek-v4-flash` |
| `fn-draft-catchup` | `deepseek-v4-flash` |
| `fn-group-tasks` | `deepseek-v4-flash` |
| `fn-transcribe` | Groq (`https://api.groq.com/openai/v1`), separate `GROQ_API_KEY` |

Secrets (Supabase Edge Function secrets — never in web client or mobile binary): `DEEPSEEK_TOKEN`, `JINA_API_KEY`, `GROQ_API_KEY`. `GITHUB_TOKEN` still exists as a secret but is unused legacy from the pre-DeepSeek GitHub Models setup. There's also an unused legacy `DEEPSEEK_API_KEY` secret (predates `DEEPSEEK_TOKEN`, not read by any function) — don't confuse the two.

**Debugging Edge Function secrets**: Supabase secrets are write-only — `supabase secrets list` shows only digests, never the actual value, so a bad/expired key can't be recovered from the CLI. If a function starts silently failing, check `mcp__supabase__query_logs` with `source = 'function_logs'` (this is where `console.log`/`console.error` output lands — `function_edge_logs` only has HTTP status lines, not console output) — an invalid key shows up as a 401 there. `fn-process-braindump` has verbose `trace()` logging that also comes back in the HTTP response body (`logs`/`errors` fields) and renders in a "🔍 Debug reasoning" panel on the `/braindump` page — check there first before digging into Supabase logs directly.

**DeepSeek gotcha**: `deepseek-v4-flash` defaults to "thinking" (reasoning) mode, which rejects a forced `tool_choice: {type:'function', function:{name:...}}` with `400 Thinking mode does not support this tool_choice`. Fix: pass `thinking: { type: 'disabled' }` as an extra top-level field in the `openai.chat.completions.create()` call (the JS SDK forwards unknown keys as-is; TS needs `@ts-expect-error` since it's not in the SDK's types). `fn-process-braindump` does this already — reuse the pattern in any new function that forces tool use.

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

Braindump flow: web/mobile saves `raw_transcript` to `braindump_jobs` immediately → `fn-process-braindump` polls every 2 min via pg_cron → extracts tasks with DeepSeek + Jina cosine dedup → tasks appear via Realtime.

Note embedding: save note → `fn-embed-note` polls every 2 min (web also nudges it right after a save) → chunks + embeds → category/tags update via Realtime on `notes.processing_status`. `NoteEditor` autosaves 1s after typing stops with a compare-and-set on the previous content (conflict → error banner, draft kept in localStorage), and has a manual Category select that sets `category_locked` so background processing never overwrites it.

## Task Domain Details

Tasks have two types (`task_type`):
- `task` — regular task, shown as dot on calendar
- `event` — calendar event, shown with title on calendar, can be linked to a contact

Key task behaviors:
- **Auto-rollover**: on page load, past pending `task`-type tasks are moved to today automatically. Events are NOT rolled over — they stay on their original date.
- **Future scheduling**: `due_date` can be any date, date picker in UI
- **Braindump due dates**: `fn-process-braindump` infers `due_date` per task from relative language in the transcript ("tomorrow", "by Friday", "April 15th") — the system prompt is given today's date and the model returns an ISO date per task; defaults to today if no date is implied. Not just hardcoded to today anymore.
- **Rollover count**: `rollover_count` incremented by trigger on each `task_rollovers` insert. Tasks with higher rollover_count sorted first (higher priority). Badge shown at ≥1, orange highlight at ≥3.
- **Event → contact sync**: completing an event task with `contact_id` set triggers `trg_event_task_contact` → updates `contacts.last_contacted_at`
- **Tags**: `tags`/`task_tags` tables. Tasks can have multiple tags. First tag shown on task card. `fn-auto-tag` auto-assigns one tag per task via `deepseek-v4-flash`.
- **Contact badge**: tasks with `contact_id` show "● KEEP IN TOUCH" badge instead of rollover count
- **Description**: `tasks.description` (migrations_v4.sql) — free-text body edited in the B-screen `TaskDetailPane`
- **Priority**: `tasks.is_priority` (migrations_v5.sql) — ★ badge, sorted to top. TaskList has a "priority mode" toggle: selections are staged client-side and only committed to `is_priority` when the mode is turned back off.
- **Subtasks**: `subtasks` table (migrations_v4.sql), infinite depth via self-referential `parent_subtask_id` (migrations_v9.sql, cascade delete). Optional `group_name` for visual grouping within a task. Shown nested under the parent in the A-screen list and in the B-screen detail pane; also checkable/removable from the `/session/[id]` task panel.
- **Task groups**: `task_groups` table + `tasks.group_id` (migrations_v9.sql). TaskList "group view" is persisted (not client-only anymore). `fn-group-tasks` returns AI suggestions (`{groups:[{name,color,task_ids}], ungrouped_ids}`, max 6 groups, min 2 tasks/group, needs ≥3 tasks) which TaskList then materializes as real `task_groups` rows + `group_id` assignments. Drag between groups supported. Colors: `indigo|orange|green|yellow|rose|cyan|purple`.

## Focus Sessions (`/session`)

Pomodoro-style work/break timer, web only. Tables `sessions`, `session_tasks`, `session_rounds` (migrations_v7–v9.sql).

- `/session` — list of `status='active'` sessions + "new session" form (title, `work_minutes` default 25, `break_minutes` default 5). Creating one redirects to `/session/[id]`.
- `/session/[id]` — full-screen timer. Background swaps by phase: work = `#1C1A14` (dark), break = `#DEDAD2`, idle = `#CCCAC0`. Buttons: pause/resume, start break, Skip Break, end session.
- **Timer is wall-clock derived, not tick-counted** (`web/lib/sessionTimer.ts`): running phase stores `phase_started_at` and remaining = `duration − (now − phase_started_at)`, so a closed/reopened tab recomputes correctly. Pause = set `phase_started_at=null` + snapshot `phase_remaining_seconds`; resume = clear the snapshot + set `phase_started_at=now`. Don't add a client-side countdown that mutates DB every second.
- **Rounds**: `sessions.round` increments when a work phase completes. `LockinRatingModal` then asks for a 1–5 "lockin-ness" rating → inserted into `session_rounds` (`lockin_rating` check 1..5).
- **Session tasks** (`SessionTaskPanel`): link existing tasks or create new ones inline. Inline-created ones get `session_tasks.is_session_created=true`. Complete-toggle + unlink per task; subtasks checkable/removable here too.
  - "Add existing" browse list loads all pending tasks **plus tasks completed today** (`updated_at >= local midnight`) so a tick can be undone in place. Each row has its own check circle → marks the task done on the main board **without linking it**; clicking the title links it.
  - Both sections (linked session tasks + browse list) sort pending first, done last.
- **End session** (`EndSessionModal`): lists only `is_session_created=true` tasks and asks keep/discard per task — completed ones default to **Discard**. Then `status='ended'`, `ended_at=now`.

## Quick Notes Widget

`QuickNotesWidget` is mounted in `(app)/layout.tsx` so it's on every authed page — bottom-right, chrome-style tabs. Opens on hover, closes when cursor leaves. Drafts live in `localStorage` (`quickNotesDrafts`) so they survive reload; "save" inserts into `notes` with `source_platform='web'` and closes that tab (note then flows through the normal `fn-embed-note` pipeline).

## Web App Structure

```
web/app/
  page.tsx                       # root redirect to /tasks (dashboard/"Today" tab was removed from nav)
  login/page.tsx                 # neumorphic analog card, IBM Plex Mono, sage button
  auth/callback/route.ts
  proxy.ts                       # auth proxy (Next.js 16 — replaces middleware.ts)
  globals.css                    # @theme inline: warm analog palette (grays→#CCCAC0/#DEDAD2, indigos→sage #516439, white→#1C1A14)
  layout.tsx                     # IBM Plex Mono font via next/font/google
  (app)/layout.tsx               # auth guard + <NavBar /> (left sidebar) + <QuickNotesWidget /> (global, bottom-right)
  (app)/dashboard/page.tsx       # LCD metrics panel + overdue contacts + DashboardUpNext — still exists as a route, but no longer in nav; post-login redirect goes to /tasks instead
  (app)/tasks/page.tsx           # 50/50 split: A screen (left) = TaskList, B screen (right) = DayCalendar (today's time grid) / TaskDetailPane (selected via TaskSelectionProvider). A-screen task rows drag straight onto B-screen time blocks
  (app)/calendar/page.tsx        # redirects to /plan?view=calendar
  (app)/plan/page.tsx            # Planner: ?view=calendar → CalendarView, else BOARD (year-goal strip + month kanban, MonthBoard)
  (app)/settings/page.tsx        # SettingsForm — Google Calendar iCal URL (masked once saved, validated by an immediate sync)
  (app)/plan/[month]/page.tsx    # week kanban for YYYY-MM (WeekBoard) — pinned month goals w/ linked-count bars
  (app)/session/page.tsx         # active focus sessions list + new-session form + × delete per card (inline confirm; cascades session_tasks/rounds, tasks stay)
  (app)/session/[id]/page.tsx    # focus session timer — phase-colored full-screen, SessionTaskPanel, End/Lockin modals (client component, useParams)
  (app)/braindump/page.tsx       # 50/50 split: form left, right = persisted history feed (one card per past dump, newest first, loaded from braindump_jobs.result so it survives reload). Each card has its own "🔍 Debug reasoning" panel and its own reprompt/adjust box (reprompting creates a new card, doesn't mutate the old one)
  (app)/notes/                   # list (with filter bar), new, [id]
  (app)/search/page.tsx          # semantic search via fn-search-notes
  (app)/contacts/                # list (inline ContactTierPicker per card), new (structured profile fields), [id] (ContactTierPicker in header; ContactProfile section shows title/education/location/email/phone/linkedin/why-good/less-useful/rating/next-step when present). Overdue math everywhere uses `contact_tier` via CONTACT_TIER_DAYS — NOT `relationship_tier`/TIER_INTERVALS (detail page used to, was a bug)
web/lib/
  supabase/{client,server,middleware}.ts
  types.ts                       # all shared TypeScript types (Task, Subtask, PersistedTaskGroup, FocusSession, SessionTask, ...)
  planDates.ts                   # local YYYY-MM-DD month/week math (weeksOfMonth, mondayOf, addMonths…) — never toISOString (UTC shift)
  calendar.ts                    # TASK_DRAG_TYPE (TaskList rows + tray set it), CalEvent/TimeBlock types, BLOCK_COLORS, fetchCalendar() → fn-calendar-events, layoutLanes() overlap layout
  planGoals.ts                   # category colors, STATUS_META, reorderColumn() for kanban drops
  sessionTimer.ts                # remainingSeconds() / formatMMSS() — wall-clock timer math for focus sessions
  taskSelection.tsx              # TaskSelectionProvider + useTaskSelection() — which task the B-screen detail pane shows
  contactMerge.ts                # applyPendingContact() — client-side insert/update + contact_events write, mirrors edge fn merge policy
web/components/
  NavBar.tsx                     # left sidebar nav (72px, analog gradient, IBM Plex Mono labels, usePathname active state) — TASKS / PLAN / SESSION / DUMP / NOTES / PEOPLE (TODAY/dashboard tab removed)
  calendar/                      # useCalendarData (events poll + tasks + block CRUD, shared), CalendarView (/plan week/month + task tray), DayCalendar (/tasks B screen, today only, no tray), WeekGrid (1–7 day time grid, pointer-capture create/move/resize, HTML5 task drop), MonthGrid, BlockEditor, CalendarStatus
  SettingsForm.tsx               # /settings
  plan/                          # MonthBoard, WeekBoard, BoardColumn, GoalCard, GoalEditor, usePlanGoals (optimistic CRUD + rollback)
  TaskList.tsx                   # A screen: add/complete/rollover/delete, "Keep in Touch" section, drag-to-reorder + drag between groups, priority mode, persisted group view (calls fn-group-tasks), nested subtasks
  TaskDetailPane.tsx             # B screen: selected task's description + subtasks editor
  DeleteTasksModal.tsx           # bulk-delete confirm
  ContactTierPicker.tsx          # daily/weekly/biweekly/monthly segmented control → contacts.contact_tier; used on /contacts list cards (compact, "7d") and /contacts/[id] header
  ResolveContactsModal.tsx       # braindump: pick which same-name contact to update (or create new) for pendingContacts
  DashboardUpNext.tsx            # dashboard "up next" task strip
  SessionTaskPanel.tsx           # /session/[id]: link/create/complete/unlink tasks, check off subtasks
  EndSessionModal.tsx            # keep/discard session-created tasks, then ends session
  LockinRatingModal.tsx          # 1–5 rating after each work round → session_rounds
  QuickNotesWidget.tsx           # global bottom-right tabbed scratchpad → notes table (localStorage drafts). Opens on hover AND click-toggle (hover was removed once by another agent — user wants it, keep it)
  NotesFilter.tsx                # client component: live filter notes by title/content/tag
  NoteEditor.tsx                 # autosave (1s debounce, CAS on prior content), localStorage draft, manual category lock, Realtime metadata, Cmd/Ctrl+S
  NotesPendingChecker.tsx        # shows "N queued" + fire-and-forget nudge to fn-embed-note
  ContactDetail.tsx              # log events + AI draft message button (client)
  LogContactButton.tsx           # quick "log interaction" button for a contact
  LogoutButton.tsx
```

### Panel naming convention
On split-panel pages (e.g. `/tasks`), user calls left panel "A screen" and right panel "B screen". Use this naming when discussing which panel a change affects.

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
| `fn-process-braindump` | pg_cron every 2 min | DeepSeek extracts tasks (+ contacts when category checked), infers due dates, cosine dedup (0.85/0.65 thresholds) |
| `fn-embed-note` | pg_cron every 2 min (+ fire-and-forget nudge from `/notes/new` and `NotesPendingChecker`) | Fixed-window chunks (`_shared/noteText.ts`, 1200 chars / 200 overlap) → Jina embeddings → semantic search for top-5 similar notes → DeepSeek category+tags (uses ±2h temporal context + semantic context + existing tags library). Claims a note by `updated_at` (CAS), commits chunks+category atomically via `finish_note_processing()` RPC, skips the AI call when `notes.category_locked`. Reclaims notes stuck in `processing` >10 min. Processes sequentially (Jina 429s). |
| `fn-search-notes` | HTTP POST from client | Embeds query → calls `search_notes()` DB function |
| `fn-draft-catchup` | HTTP POST from client | DeepSeek drafts catch-up message for a contact |
| `fn-auto-tag` | HTTP POST from client | DeepSeek picks best tag from user's tag list for a task |
| `fn-group-tasks` | HTTP POST from TaskList | DeepSeek (`response_format: json_object`) groups `{id,title}[]` into ≤6 named/colored themes; returns `[]` groups if <3 tasks. Only checks `Bearer` header is present, doesn't call `getUser()` |
| `fn-transcribe` | HTTP POST (multipart) from `/braindump` | Groq Whisper speech-to-text for uploaded audio; verifies JWT |
| `fn-calendar-events` | HTTP POST `{from,to,refresh?}` from CalendarView / SettingsForm (JWT) | Google Calendar ICS → `_shared/calendar.ts` `getCalendarEvents()`: serves `calendar_cache` if <15 min old and covering the range, else fetches `user_settings.ics_url`, expands via `_shared/ics.ts` (`npm:ical.js`, window −60d…+180d), upserts cache; on failure returns stale cache + `error`. Never echoes the URL. |
| `fn-widget-data` | HTTP GET from iOS widget | Returns today's tasks for a `widget_id` (no JWT — uses `widget_registrations` table) |
| `fn-widget-action` | HTTP POST from iOS widget | Complete or rollover a task; auth via `widget_id` credential |

`fn-search-notes`, `fn-draft-catchup`, `fn-auto-tag`, `fn-group-tasks`, and `fn-transcribe` verify the user JWT from `Authorization` header before executing (`fn-group-tasks` also validates/dedupes the task list and clamps the model output via `_shared/taskGrouping.ts`).

**Queue functions (`fn-embed-note`, `fn-process-braindump`) auth contract** — `_shared/auth.ts` `resolveCaller()`: service caller → drains everyone's queue; signed-in user → drains only their own rows. A caller is "service" if the token equals env `SUPABASE_SERVICE_ROLE_KEY` **or** is a gateway-verified JWT with `role: service_role` (the functions gateway has `verify_jwt: true`, so the signature is already checked). **Never deploy `fn-embed-note` or `fn-process-braindump` with `--no-verify-jwt`** — `resolveCaller` decodes the JWT payload without verifying it and relies on the gateway having rejected forged signatures; without that, anyone could send `{"role":"service_role"}` and drain every user's queue. The second branch is required: the pg_cron jobs send the legacy service-role JWT and env `SUPABASE_SERVICE_ROLE_KEY` is a different string, so plain equality 401'd every cron tick for 14 minutes on 2026-09-17 (06:46–07:00) and nothing processed. Anon key is no longer accepted — `curl` with the anon key gets 401; use the service JWT from `select command from cron.job` or a real user session token.

**`supabase/functions/_shared/`** — first shared modules across edge fns (`auth.ts`, `noteText.ts`, `taskGrouping.ts`). `supabase functions deploy <fn>` bundles them automatically (confirmed in `get_edge_function` output). Pure helpers (`noteText`, `taskGrouping`) are unit-tested in `tests/`.

**Tests** (no framework; run from repo root):
- `node --test tests/ai-regressions.test.mjs` — transpiles the `_shared/*.ts` helpers + `web/lib/sessionTimer.ts` with the web app's TypeScript and asserts on chunking, group normalization, timer resume.
- `node --test tests/planner.test.mjs` — `web/lib/planDates.ts` week/month math.
- `node --test tests/ics.test.mjs` — `_shared/ics.ts` against `tests/fixtures/calendar.ics` (EXDATE, moved/cancelled RECURRENCE-ID overrides, DST, all-day, 10-year-old daily series). Uses `web/node_modules/ical.js` (devDependency).
- `tests/note-indexing.sql` — paste into SQL Editor / `execute_sql`; `begin … rollback` so it leaves nothing behind; asserts `finish_note_processing` rejects stale claims + bad vectors, keeps `category_locked`, and is not executable by `authenticated`.
`fn-widget-data` and `fn-widget-action` use `widget_registrations.widget_id` as the auth credential (no JWT — widget can't store tokens).

## Database Key Patterns

- All tables use RLS (`auth.uid() = user_id`). Always pass `user_id: user?.id` explicitly on inserts (no server-side default).
- `braindump_jobs` and `notes`: Edge Functions set `processing_status='processing'` before AI call, `done/failed` after. `retry_count` max 3 enforced in query (`lt('retry_count', 3)`). Both claim rows with a conditional update (`.eq('processing_status','pending')` / `.eq('updated_at', seen)`) so two workers can't process the same row.
- `notes.category_locked` (v10) + `finish_note_processing(p_note_id, p_claim_time, p_chunks, p_category, p_tags)` (v10, **service_role only**, revoked from anon/authenticated): atomically replaces `note_chunks` and sets category/tags/`done`, but only if the note's `updated_at` still equals the claim time — an edit during processing makes the old worker's result a no-op (returns false). `notes.last_error` (v11) holds the last failure string; on failure `retry_count` increments and status goes back to `pending` (or `failed` at 3).
- `braindump_jobs.categories`: TEXT[] column (added in migrations_v3.sql), e.g. `['Tasks', 'Contacts']`. Controls what `fn-process-braindump` extracts — gates whether the `submit_contacts` tool is offered to the model at all.
- `tasks.rollover_count`: incremented by `trg_increment_rollover_count` trigger on `task_rollovers` insert. Backfilled from existing rows via `migrations.sql`.
- `tasks.contact_id`: optional FK to contacts. `trg_event_task_contact` trigger updates `contacts.last_contacted_at` when event task marked done.
- `contact_events` with `event_type in ('photo_sent','message_sent','met')` also auto-update `contacts.last_contacted_at` via `trg_last_contacted` trigger.
- `note_chunks.embedding` uses HNSW index (`vector_cosine_ops`, m=16, ef_construction=64). `search_notes()` DB function handles cosine similarity search.
- `tags` + `task_tags`: user-defined tags; `fn-auto-tag` auto-assigns one tag per task via `deepseek-v4-flash`. Also `contact_tags` table for contact tags (mobile only).
- `widget_registrations`: maps `widget_id` (UUID generated on iOS) → `user_id`. No JWT needed — widget uses `widget_id` as credential for `fn-widget-data` / `fn-widget-action`.
- `contacts.contact_tier`: enum `daily|weekly|biweekly|monthly` — drives overdue badge logic via `CONTACT_TIER_DAYS` map (`1/7/14/30` days). Added in migrations_v2.sql.
- `contacts.relationship_tier`: enum `family|close_friend|friend|acquaintance` — used by `fn-draft-catchup` for AI tone selection. Both tiers coexist; `contact_tier` drives CRM timing, `relationship_tier` drives AI tone.
- When creating contacts, write both: `contact_tier` (user-selected frequency) + `relationship_tier: 'friend'` (default, for AI drafts).
- `contacts` structured profile fields (migrations_v6.sql, all nullable TEXT): `title`, `education`, `location`, `email`, `phone`, `linkedin`, `why_good_contact`, `less_useful_for`, `rating`, `next_step` — shown on `/contacts/[id]` (`ContactProfile` component in `page.tsx`) and editable on `/contacts/new`. Populated manually or auto-extracted by `fn-process-braindump` when the "Contacts" category is checked on `/braindump`.
- **Braindump contact update rules** (`fn-process-braindump`): user's existing `contacts (id, name, title)` are passed in the prompt; model sets `existing_id` on a match. Update merge policy: `title/education/location/email/phone/linkedin/next_step/tiers` **overwrite**; `why_good_contact/less_useful_for/rating` **append** as a new line; `how_we_met` only set if empty. Hallucinated `existing_id` (not in user's list) falls back to insert. Optional `interaction {type: met|message_sent, date, summary}` → inserts `contact_events` with explicit `created_at = <date>T12:00:00Z` so `trg_last_contacted` backdates `last_contacted_at` correctly. Model told past-tense only; planned contact goes to `next_step`/tasks.
- **Contact tier defaults from braindump**: new contacts default `monthly`/`acquaintance` (was `weekly`/`friend` — that produced a wall of overdue). Model is told: family → biweekly, close friends → weekly, professional/recruiter/one-off → monthly; for EXISTING contacts it must omit `contact_tier` unless the transcript states a cadence, so tiers don't drift on every dump.
- **`result.contactReport[]`** (`{name, status: created|updated|pending|error, contact_tier, relationship_tier, fields, interaction, matchCount}`): one row per person the model extracted. Rendered by `ContactsReport` in `braindump/page.tsx` (header count + per-person status badge, tier chip, interaction line, fields logged). Older jobs without it fall back to the plain `contactsCreated` list.
- **Duplicate-name gate** (server-side, ignores model's choice): `namesCollide()` — case/punct-insensitive, token-subset match ("Mark" ⊂ "Mark Deniel Sampelo"). Auto-write only if 0 collisions, or exactly 1 collision AND model's `existing_id` points at it. Otherwise nothing is written; the extracted contact goes to `result.pendingContacts[] {name, fields, interaction, matches[]}`. `/braindump` auto-opens `ResolveContactsModal` (pick "Update → X" per match or "Create new"); card shows "⚠ N contacts match existing names — Resolve →" until handled. Resolution writes happen **client-side** via `web/lib/contactMerge.ts` (`applyPendingContact`, same merge policy as the edge fn) and then `pendingContacts` is cleared in `braindump_jobs.result` so it doesn't re-prompt after reload.
- `braindump_jobs.result` (migrations_v6.sql, JSONB): snapshot of `{created, merged, pendingDeletions, contactsCreated, contactsUpdated, interactionsLogged, logs, errors}` written by `fn-process-braindump` on both success and failure. Lets the `/braindump` history feed survive a page reload without re-running anything — read back via `jobToEntry()` in `web/app/(app)/braindump/page.tsx`.
- `tasks.description` (v4), `tasks.is_priority` (v5), `tasks.group_id → task_groups` (v9, `on delete set null`).
- `subtasks` (v4): `task_id`, `title`, `group_name`, `status`, `sort_order`; `parent_subtask_id` self-FK (v9, `on delete cascade`) for infinite nesting.
- `task_groups` (v9): `name`, `color` (default `'indigo'`). Persisted result of `fn-group-tasks` suggestions.
- `sessions` (v7): enums `session_status('active','ended')`, `timer_phase('work','break','idle')`; `work_minutes`/`break_minutes`, `phase`, `phase_started_at` (null = paused), `phase_remaining_seconds` (pause snapshot), `round`, `ended_at`.
- `session_tasks` (v7): `session_id` + `task_id` (both cascade), `is_session_created` flag drives the end-of-session keep/discard prompt.
- `session_rounds` (v8): one row per completed work round with `lockin_rating` (1–5 check).
- Migrations v7–v9 use lowercase SQL + `create policy X_rls on T using (auth.uid() = user_id)` (single `using`, no `for all`/`with check`) — same effect for authed users, just terser style than v2–v6.

## Build Phase Status

| Phase | Status |
|---|---|
| 0 — CRUD foundation | ✅ Done |
| 1 — Voice braindump (mobile) | ⏳ Code ready, needs dev client build (Apple Dev account or GitHub Actions + AltStore) |
| 1b — Voice braindump (web) | ✅ Done — MediaRecorder captures audio → `fn-transcribe` (Groq Whisper) returns text into the form |
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
| 13 — Braindump results panel | ✅ Done — 50/50 layout: form left, persisted history feed right (one card per dump, survives reload); reprompt per-card creates a new card |
| 14 — Task drag-to-reorder | ✅ Done — drag within pending/followUp sections; client-side ordering |
| 15 — Braindump contact extraction | ✅ Done — `fn-process-braindump` calls a `submit_contacts` tool alongside `submit_tasks` when "Contacts" category is checked; creates new contacts, **updates existing ones** (`existing_id`), and **logs past interactions** to `contact_events` (backdated `met`/`message_sent` → bumps `last_contacted_at`) |
| 16 — Structured contact profiles | ✅ Done — title/education/location/email/phone/linkedin/why-good/less-useful/rating/next-step fields, manual + AI-populated |
| 17 — Braindump due-date inference | ✅ Done — tasks extracted from braindumps get an AI-inferred due_date instead of always defaulting to today |
| 18 — Task detail pane + description + subtasks | ✅ Done — B-screen `TaskDetailPane`; subtasks nested in A-screen list |
| 19 — Priority mode | ✅ Done — `is_priority` ★, staged selection committed on toggle-off |
| 20 — Focus sessions | ✅ Done — `/session` Pomodoro timer, session tasks, lockin rating per round, Skip Break, keep/discard on end |
| 21 — Persisted task groups + infinite subtasks | ✅ Done — `task_groups` table, `group_id`, `parent_subtask_id`, drag between groups |
| 22 — Quick notes widget | ✅ Done — global bottom-right tabbed scratchpad, hover open/close, localStorage drafts |
| 23 — Rework (spec: `docs/superpowers/specs/2026-09-23-harness-planner-design.md`) | 🚧 Chunk 0 ✅ (session delete, press animations) · Chunk 1 ✅ Planner board · Chunk 2 ✅ Calendar/ICS · Chunk 3 Chat harness |

**Migrations applied**: `migrations_v3.sql` through `migrations_v13.sql` are all applied to the live DB (v7 sessions, v8 session_rounds, v9 task_groups + nested subtasks, v10 `category_locked` + `finish_note_processing`, v11 `notes.last_error` + `note_chunks.embedding` → `vector(1024)` + full note re-embed, v12 `plan_goals`, v13 `user_settings`/`calendar_cache`/`time_blocks`/`time_block_tasks`). All `.sql` files are committed.

## What's Working Right Now (Sep 2026)

**Web app** (`/web`) is the primary surface — fully functional. Nav: TASKS / SESSION / DUMP / NOTES / PEOPLE (post-login lands on `/tasks`, not a dashboard). Responsive pass started 2026-09-17: nav is a horizontal sticky bar under `sm`, the 50/50 split pages (`/tasks`, `/braindump`) stack under `lg`, inputs are 16px on phones (no iOS zoom), focus rings + `aria-*` on interactive controls, `prefers-reduced-motion` honored. Every mutation button has a click-lock (`useRef`) + inline `role="alert"` error and rolls back optimistic state on failure.
- `/tasks` — 50/50 split: task list (drag reorder, drag between groups, Keep in Touch section, priority mode, persisted AI groups, nested subtasks) + embedded calendar / task detail pane
- `/session` — focus sessions (Pomodoro timer, linked tasks, round ratings)
- `/braindump` — 50/50 split: form (text + mic → MediaRecorder blob → fn-transcribe/Groq Whisper) + persisted history feed (cards per dump, survives reload, per-card debug panel + reprompt)
- `/notes` — list with live filter bar (title/content/tag search)
- `/dashboard` — still exists as a route (LCD metrics + overdue contacts) but no longer linked from nav
- `/contacts` — CRM with tiers, structured profile fields, AI draft messages
- `/search` — semantic vector search across notes

**Mobile app** (`/mobile`) — Expo SDK 56, works in Expo Go except voice + geofencing:
- Full task management with swipe gestures, drag reorder, rollover badges
- Braindump (text only in Expo Go, voice needs dev client)
- Notes with semantic search
- Contacts CRM
- Today dashboard
- iOS widget via `fn-widget-data` / `fn-widget-action`

**AI pipeline** (DeepSeek `deepseek-v4-flash` for chat, Jina `jina-embeddings-v3` for embeddings, Groq for speech-to-text — see "AI Models" above):
- Braindump → extracts tasks (lists → "Research X" tasks, todos → direct tasks) + contacts + per-task due dates
- Notes → Jina embeds → semantic search + DeepSeek categorizes/tags
- Contacts → DeepSeek drafts catch-up messages
- Tasks → DeepSeek auto-tags; DeepSeek groups tasks into themes (`fn-group-tasks`)
- Voice → Groq Whisper transcribes (`fn-transcribe`)

**Known issue**: if a braindump job's Edge Function secret (`DEEPSEEK_TOKEN` or `JINA_API_KEY`) goes bad, the job flips straight to `processing_status='failed'` with no visible symptom in the UI other than "nothing got created" — always check the `/braindump` page's per-card "🔍 Debug reasoning" panel first, it surfaces the real error. If a job is stuck (e.g. you fixed a secret after the fact), reset it manually: `update braindump_jobs set processing_status='pending', retry_count=0 where id=...` — pg_cron picks it up within 2 min, or trigger immediately with a POST to `fn-process-braindump`.

## What's Next (possible next features)

- **Task sort persistence** — save drag order to DB (`sort_order` column on tasks). Groups are persisted now; order within a group still isn't.
- **Session history / stats** — `/session` only lists `active` sessions; ended ones + `session_rounds` ratings aren't surfaced anywhere yet
- **Focus sessions on mobile** — web only today
- **Push notifications** — APNs setup for contact overdue reminders
- **Web Realtime** — live task updates without page refresh (Supabase Realtime subscription)
- **Layer 2 proactive nudges** — AI surfaces tasks you've been avoiding (high rollover_count)
- **Contact import** — bulk add from CSV or phone contacts
- **Recurring tasks** — `rrule` support for daily/weekly repeating tasks
- **Notes-category dumps in braindump history** — currently only Tasks/Contacts dumps persist as history cards across reloads (backed by `braindump_jobs.result`); a Notes-only submission's card is client-state only and disappears on refresh (the note itself is still saved to the `notes` table, just not shown as a history card after reload)

## Planner (`/plan`)

`plan_goals` (v12) — one table for all levels: `level` year|month|week, `title`, `description`, `category` (free text; presets School/Career/Health/Social/Personal/Finance get fixed colors), `status` not_started|in_progress|done, `period_start`/`period_end` (year = Jan 1; month = 1st; week = Monday; `period_end` > start only for multi-month month goals), `parent_id` (week→month goal, month→year goal, `on delete set null`), `sort_order`.
- A week belongs to the month its **Monday** is in (weeks Mon–Sun).
- Month board: current month + 3 (`+ 3 more`), multi-month goals render in every column they cover; dragging shifts start+end by the same month delta. Hovering a year-goal chip highlights its month goals.
- Every goal card has a hover trash can (always visible on touch) → deletes immediately, no confirm; year chips have a tiny ×.
- Week board: sidebar (on the RIGHT) = this month's goals with linked-week-item counts + bars (0 = red, "not distributing evenly"); clicking a goal focuses it and quick-adds link to it.
- Week items are NOT linked to tasks — they're context for the chat LLM (read-only for it).

**Calendar** (`/plan?view=calendar`, v13): read-only Google Calendar via the iCal secret URL (`user_settings.ics_url`, owner-only RLS). Browsers can't fetch Google's feed (CORS) — always go through `fn-calendar-events`. `calendar_cache` is select-only for the owner; only the edge fn (service role) writes it. Week view = Mon–Sun time grid: click = 1h block, drag = custom block (15-min snap), drag body = move (across days), bottom edge = resize; tray tasks drop onto a block (`time_block_tasks`) or onto empty grid (new 1h block with that task). All-day row (hidden when empty) shows all-day ICS events + pending LifeOS `event`s only — regular tasks and anything done are deliberately NOT drawn on the grid (user: duplicate data / wasted space); blocks hide their done tasks too. Month view click → that week. Mode remembered in localStorage `calMode`.

**Press feedback**: `globals.css` has a global `:active` scale for `button`, `[role=button]`, `.app-nav a`, `.btn-like`. It's unlayered, so its `transition-property` list must include color props or it'd override Tailwind `transition-colors`. Motion utilities: `animate-fade-in|slide-up|slide-in-right|pop|shrink-out`.
