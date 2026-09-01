# Focus Sessions — Design Spec

Date: 2026-08-31

## Purpose

New `/session` tab: Pomodoro-style focus sessions. User starts a session, pulls in existing tasks and/or creates session-specific tasks (with subtasks) to work on, runs a work/break timer, and at session end chooses which session-created tasks to keep vs discard. Narrows a broad task list down to "what I'm working on right now."

## Requirements

- Multiple concurrent sessions allowed (per user) — not limited to one active session.
- Session survives tab close. It only ends when the user explicitly hits "End Session." Reopening the tab (same or different device) resumes exactly where it left off, timer included.
- Timer: work + break phases, minutes configurable per session at creation (default 25/5). Single work→break cycle per "round"; no auto-cycling — user manually starts the next phase.
- Tasks in a session are either:
  - **Existing tasks** added to the session (just linked, never deleted by session actions).
  - **Session-created tasks** made while inside the session (can have subtasks, same as normal tasks).
- At "End Session," user is shown only the session-created tasks and picks Keep or Discard for each. Existing tasks added to the session are always retained (just unlinked). Keep = task becomes a normal task. Discard = task (and its subtasks, via cascade) is deleted.
- Visual: session view background shifts by phase — dark during work ("lock in"), light during break.

## Data Model

New migration `supabase/migrations_v7.sql`:

```sql
create type session_status as enum ('active', 'ended');
create type timer_phase as enum ('work', 'break', 'idle');

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  title text,
  status session_status not null default 'active',
  work_minutes int not null default 25,
  break_minutes int not null default 5,
  phase timer_phase not null default 'work',
  phase_started_at timestamptz,        -- null while paused; set to now() when running
  phase_remaining_seconds int,          -- snapshot of remaining time, used when paused
  round int not null default 1,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create table session_tasks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  is_session_created boolean not null default false,
  added_at timestamptz not null default now()
);

alter table sessions enable row level security;
alter table session_tasks enable row level security;

create policy "sessions_owner" on sessions for all using (auth.uid() = user_id);
create policy "session_tasks_owner" on session_tasks for all using (auth.uid() = user_id);
```

Timer state is wall-clock derived, not a client-only countdown: remaining time = `duration_for(phase) - (now - phase_started_at)` when running, or the stored `phase_remaining_seconds` when paused. This is what makes "close tab, reopen later, timer picked up correctly" work without any background job — the client just recomputes on load.

## TypeScript Types (`web/lib/types.ts` additions)

```typescript
export type SessionStatus = 'active' | 'ended'
export type TimerPhase = 'work' | 'break' | 'idle'

export interface FocusSession {
  id: string
  user_id: string
  title: string | null
  status: SessionStatus
  work_minutes: number
  break_minutes: number
  phase: TimerPhase
  phase_started_at: string | null
  phase_remaining_seconds: number | null
  round: number
  created_at: string
  ended_at: string | null
}

export interface SessionTask {
  id: string
  session_id: string
  task_id: string
  user_id: string
  is_session_created: boolean
  added_at: string
  task?: Task
}
```

(`FocusSession` not `Session` — avoids collision with Supabase auth's `Session` type already imported around the codebase.)

## UI Flow

### `web/app/(app)/session/page.tsx`
- Grid of cards, one per active session for the user (`status='active'`): title (or "Untitled session"), phase badge, live elapsed/remaining, task count. Click → `/session/[id]`.
- "New Session" button → inline form (not modal, matches existing app patterns — see braindump form): title (optional text input), work minutes (number, default 25), break minutes (number, default 5). Submit creates row with `phase='work'`, `phase_started_at=now()`, `phase_remaining_seconds=null`, redirects to `/session/[id]`.

### `web/app/(app)/session/[id]/page.tsx`
- Full-bleed background color driven by `phase`: dark ink tone during `work`, light surface tone during `break`, neutral during `idle` (paused). Reuses existing analog palette tokens rather than new colors.
- Timer display: large mm:ss countdown, computed client-side from wall clock on an interval tick (1s), phase label ("Work" / "Break").
- Controls: Pause/Resume (toggles `phase_started_at` null vs now(), persists `phase_remaining_seconds` on pause), "Start Break" (visible once work countdown hits 0, or manually before if user wants to cut work short — sets `phase='break'`, resets `phase_started_at=now()`), "Start Next Round" (visible once break hits 0 — sets `phase='work'`, `round += 1`), "End Session" (opens end-session flow below).
- Task panel: list of linked tasks (via `session_tasks` join), each showing subtasks inline (reuse existing subtask UI patterns from `TaskDetailPane`/`TaskList`). Two ways to populate:
  - **Add existing** — search/select from user's pending tasks, inserts a `session_tasks` row with `is_session_created=false`.
  - **Quick-add new** — title input creates a new `tasks` row (`due_date=today`) + `session_tasks` row with `is_session_created=true`. Subtasks addable the same way subtasks work elsewhere.
- **End Session** flow: confirmation panel listing only `session_tasks` where `is_session_created=true`, each with a Keep/Discard toggle (default Keep). Confirm → for Discard rows, delete the `tasks` row (subtasks cascade via existing FK); for Keep rows, no task change needed, just leave as normal tasks. Session row: `status='ended'`, `ended_at=now()`. Existing (non-session-created) linked tasks are untouched — the `session_tasks` link rows are cleaned up via cascade delete when needed, or simply ignored since the session is no longer active. Redirect to `/session`.

### Nav
Add "SESSION" to `web/components/NavBar.tsx` alongside TASKS / DUMP / NOTES / PEOPLE.

## Error Handling
- All session/session_task mutations follow existing pattern: client-side Supabase calls with `user_id` passed explicitly, RLS enforces ownership.
- If timer computation yields negative remaining beyond the current phase (e.g. user was away for a long time), clamp display to `00:00` and surface the "Start Break" / "Start Next Round" action rather than erroring.

## Testing
- Manual verification per project convention (no existing test suite for web app): create session, add existing task, quick-add task + subtask, close tab mid-work-phase, reopen and confirm timer resumed correctly, pause/resume, transition to break (background color change), end session and confirm keep/discard behavior (session-created task discarded is gone incl. subtasks; kept one persists as normal task; existing added task always retained), confirm multiple concurrent sessions list correctly on `/session`.

## Out of Scope
- Auto-cycling through multiple rounds automatically.
- Notifications/sound when phase ends.
- Session history/analytics (past ended sessions are not surfaced anywhere post-MVP; `status='ended'` rows just stop appearing in the active list).
