# Tasks + Chat Harness, Planner, Calendar — Design Spec

Date: 2026-09-23 · Rollback point: tag `baseline-pre-harness` (`be2d2e7`)
Source of requirements: `questions.md` (Thomas's answers). Where he said "choose the best", decisions are marked **[D]**.

## Overview

Four chunks, built and deployed in order (web only):

0. **Quick wins** — delete session from `/session` list; press feedback + animations on every button.
1. **Planner** (`/plan`, BOARD view) — year → month → week goal boards.
2. **Calendar** (`/plan`, CALENDAR view) — Google Calendar ICS (read-only) + LifeOS tasks + draggable time blocks. Replaces calendar grid on `/tasks`.
3. **Chat harness** — `/tasks` B screen becomes an LLM chat with tools over tasks/contacts/notes/planner/calendar. Replaces DUMP tab.

Nav after rework: `TASKS / PLAN / SESSION / NOTES / PEOPLE` + ⚙ settings (bottom, above OUT).

---

## Chunk 0 — Quick wins

**Session delete.** Each card on `/session` gets an `×` top-right. Click → inline confirm ("Delete session? Linked tasks stay on your list.") → `delete from sessions`. `session_tasks` / `session_rounds` cascade (v7/v8 FKs). Session-created tasks are NOT deleted — they become normal tasks (skips `EndSessionModal` on purpose; delete = "abandon", end = "wrap up") **[D]**.

**Press feedback.** Global rule in `globals.css` for `button`, `[role=button]`, and `a` styled as buttons (`.app-nav a`, `.btn-like`): `:active { transform: scale(.96) }` with a transition list that explicitly includes `color, background-color, border-color, opacity, box-shadow, transform` (Tailwind v4 utilities live in `@layer utilities`; an unlayered global `transition` would override `transition-colors`, so the global rule must carry all of them). Plus keyframe utilities: `animate-fade-in`, `animate-slide-up`, `animate-slide-in-right`, `animate-pop` for cards, drawers, chat messages, receipts. Reduced-motion rule already neutralizes durations.

---

## Chunk 1 — Planner (BOARD)

### Data (`migrations_v12.sql`)

```sql
create type goal_level  as enum ('year','month','week');
create type goal_status as enum ('not_started','in_progress','done');

create table plan_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  level goal_level not null,
  title text not null,
  description text,
  category text,                         -- free text; UI offers School/Career/Health/Social/Personal/Finance
  status goal_status not null default 'not_started',
  period_start date not null,            -- year: Jan 1 · month: 1st of month · week: Monday
  period_end date not null,              -- same as start unless month goal spans months (1st of last month)
  parent_id uuid references plan_goals(id) on delete set null,  -- week→month goal, month→year goal
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create index on plan_goals (user_id, level, period_start);
alter table plan_goals enable row level security;
create policy plan_goals_rls on plan_goals using (auth.uid() = user_id);
```

One table for all levels keeps drag/edit/linking uniform.

### UI (`/plan`)

- Header toggle `BOARD | CALENDAR` (`?view=`).
- **Year strip** (top): current year's year goals as chips + "+ year goal". Each chip shows count of month goals linked to it. `‹ 2026 ›` switcher.
- **Month board**: columns = current month + next 3, horizontal scroll, "+ more" loads 3 more; `‹` shows earlier months. Cards: title, category color chip, status pill, `↳ year goal` if linked, span badge ("Oct → Dec") if multi-month. Multi-month cards render in every column they cover.
- **Drag** (native HTML5 DnD, same as TaskList): drop card into another month → shift `period_start`/`period_end` by the same delta (span preserved). Reorder within column → `sort_order`.
- **Card editor** (modal/popover): title, description, category, status, span end month, parent year goal.
- **Week board** (`/plan/2026-10`, click month header): columns = weeks whose **Monday** is in that month (Mon–Sun). **Pinned sidebar**: that month's goals (incl. spanning ones), each with count of week cards linked → highlights 0-count goals ("not distributing evenly"). Week cards: same fields, `parent_id` = a month goal (optional). Drag between weeks.
- No day board — TaskList is the day. No task linkage from week cards (E6: they're context for the LLM).

---

## Chunk 2 — Calendar (CALENDAR view)

### Data (`migrations_v13.sql`)

```sql
create table user_settings (
  user_id uuid primary key references auth.users(id),
  ics_url text,                          -- secret; RLS-protected, never logged
  chat_model text not null default 'deepseek-v4-flash',
  chat_budget_usd numeric not null default 5,
  updated_at timestamptz not null default now()
);
create table calendar_cache (             -- written only by edge fn (service role)
  user_id uuid primary key references auth.users(id),
  fetched_at timestamptz not null,
  events jsonb not null                   -- expanded occurrences, window: -30d … +120d
);
create table time_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  title text,
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at > start_at),
  color text not null default 'indigo',
  created_at timestamptz not null default now()
);
create table time_block_tasks (
  block_id uuid not null references time_blocks(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  primary key (block_id, task_id)
);
-- RLS on all four; calendar_cache: select-only for owner.
```

### ICS pipeline — one parser

- `supabase/functions/_shared/ics.ts`: fetch URL, parse with `npm:ical.js`, expand RRULE (honoring EXDATE + RECURRENCE-ID overrides), normalize all-day vs timed, convert to ISO UTC + `allDay` flag. Unit-tested in `tests/` with fixture ICS (recurring, override, all-day, DST crossing).
- `fn-calendar-events` (GET `?from&to`, JWT): returns cached events if `fetched_at` < 15 min, else refetch + upsert cache. Web can't fetch Google's feed directly (CORS) — this is the only path. `fn-chat` imports `_shared/ics.ts`/cache directly.
- Web polls on page open + every 15 min while open.

### UI

- **Month view**: grid; each day shows ICS events (muted color), LifeOS events (sage), task dots. Click day → week view at that week.
- **Week view (time grid)**: 7 columns × hours (scroll to 7am). All-day row on top: all-day ICS events + LifeOS tasks due that day. Timed ICS events as blocks (read-only, lighter style).
- **Time blocks**: drag on empty grid → creates a block (15-min snap); drag edges to resize, drag body to move; click to title/delete. **Right sidebar: pending tasks list** → drag a task onto a block assigns it (`time_block_tasks`); block shows its tasks' titles, checkmark style when done.
- `/tasks` loses the calendar grid; `/calendar` redirects to `/plan?view=calendar`.
- `/settings`: ICS URL field (masked after save), chat model, budget + month spend, memory editor (chunk 3).

---

## Chunk 3 — Chat harness

### Layout (`/tasks`)

- A screen: TaskList (unchanged).
- B screen: chat. Selecting a task opens `TaskDetailPane` as a **drawer sliding over the chat**; close → chat returns.
- **Sync A↔B**: TaskList subscribes to Supabase Realtime on `tasks` (+ `subtasks`, `task_groups`) for the user and merges inserts/updates/deletes into its state. Also fixes cross-tab staleness. (TaskList copies `initialTasks` into state on mount, so `router.refresh()` alone would not update it.)
- `/braindump` removed from nav, route kept (hidden) until chat proven; mobile + pg_cron keep using `fn-process-braindump` unchanged.

### Data (`migrations_v14.sql`)

```sql
create table chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  thread_date date not null,             -- one thread per local day
  summary text,                          -- rolling summary of compacted older turns
  compacted_through timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, thread_date)
);
create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('user','assistant','tool','system_note')),
  content text,
  tool_calls jsonb,                      -- read-tool calls made during the turn (for debug panel)
  proposals jsonb,                       -- [{id, tool, args, summary, status: pending|applied|rejected|failed, result}]
  model text, prompt_tokens int, completion_tokens int, cost_usd numeric,
  created_at timestamptz not null default now()
);
create table chat_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  content text not null,                 -- one fact, e.g. "Works best in mornings"
  source text not null default 'auto',   -- auto | user
  created_at timestamptz not null default now()
);
alter table contacts add column if not exists category text
  check (category in ('family','work','friend','other'));
```

### Edge function `fn-chat` (JWT, non-streaming)

`POST {action:'send', text, command?}` and `POST {action:'apply', message_id, decisions:[{proposal_id, accept, choice?}]}`.

**Send loop**: build prompt → call DeepSeek with tools (`tool_choice:'auto'`) → execute **read** tools immediately, feed results back → **write** tools are NOT executed: collected as proposals → loop until model answers or **max 6 iterations** (wall-clock guard well under edge fn limit) → save assistant message with proposals → return all at once.

**Apply**: load proposals from DB by id (client never sends args) → re-validate (task still exists / not already done, contact match still valid) → execute via shared modules → mark each `applied|failed` with result → insert `system_note` message ("Applied: created 3 tasks; failed: …") so the next turn knows. No extra model call.

**Tools**

| Read (auto-execute) | Write (proposal → Confirm) |
|---|---|
| `list_tasks(filter: today/overdue/upcoming/all, group?)` | `create_tasks([{title, due_date, task_type, description, is_priority, contact_id}])` (Jina dedup vs existing, reused) |
| `get_task(id)` (+subtasks) | `update_task(id, fields)` / `reschedule` / `set_priority` |
| `search_notes(query)` (reuse `search_notes()` RPC) | `complete_task(id)` · `delete_tasks(ids)` |
| `list_contacts(filter)` / `get_contact(id)` / `overdue_contacts()` | `add_subtasks(task_id, [...])` · `group_tasks(...)` |
| `get_calendar(from, to)` (ICS cache + time blocks + LifeOS events) | `create_contact` / `update_contact` (merge policy + `category`) · `log_interaction` |
| `get_plan(level, period)` | `create_note(title, content)` |

Planner is **read-only** for the chat (E10) — it suggests, user edits. No session tools. Duplicate contact names: proposal card shows the matches with "Update → X / Create new" choices (replaces `ResolveContactsModal` for chat).

**Code reuse**: braindump logic moves into `_shared/` — `tasks.ts` (insert + Jina cosine dedup), `contacts.ts` (`namesCollide`, merge policy, interaction backdating), `deepseek.ts` (client + thinking-mode handling). `fn-process-braindump` imports them unchanged in behavior; verified afterwards by running a real `braindump_jobs` row through the cron path. Deploy flags unchanged (`verify_jwt` stays on).

**Prompt (per turn)**: persona (efficient but warm; honest pushback on avoided tasks) · today's date/time/timezone · memories · **planner context always inline**: current year goals, this month's goals, this week's goals (titles + status) · compact task list: pending today+overdue as `short_id | title | due | ★ | rollover | group` (short_id = first 8 hex of uuid, resolved server-side within the user's rows) · today's calendar load (count + busy hours) · thread summary + recent messages.

**Slash commands** (client autocompletes, server handles):
- `/prioritize` — grilling mode. Asks a few targeted questions per turn, then proposes an order. Weighting, most → least: **due date, overdue contacts, calendar load that day, rollover count, goals**; and group similar tasks together.
- `/model` — toggle flash ↔ pro (persisted in `user_settings.chat_model`).
- `/memory` — list memories; edit in `/settings`.
- `/help`.

**Memory (Claude-Code-style)**: one thread per day (old days viewable read-only). When a thread's history exceeds ~12k tokens, or on the first message of a new day for yesterday's thread, a compaction call writes (a) `chat_threads.summary` and (b) durable facts → `chat_memories`. **Exception to B2**: memory writes are not confirmed item-by-item — they show as a "📝 remembered: …" chip and are editable/deletable in `/settings`.

**Cost**: per-message `usage` × pricing constants (taken from DeepSeek's pricing page at build time, not memory) → `cost_usd`. Month total shown in chat header + `/settings`. Hard cap `chat_budget_usd` (default $5): over cap → fn-chat refuses with a clear message.

**Voice**: mic in chat box → existing `fn-transcribe`, extracted into `useVoiceRecorder` hook.

**Pre-build spike**: before the chat UI, test `fn-chat` with one read tool to confirm `tool_choice:'auto'` behavior with thinking mode, whether `reasoning_content` must be stripped/returned across loop turns, and real v4 pricing.

---

## Ops per chunk

Apply migration to live DB → deploy edge fns with `C:\Users\Hi\AppData\Local\Programs\supabase\supabase.exe` → `npm run build` + lint → `npx vercel --prod --yes` → `npx vercel alias set <url> lifeostrich.vercel.app` → `graphify update .` → CLAUDE.md update → commit.
