# Focus Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/session` tab implementing Pomodoro-style focus sessions: multiple concurrent sessions, work/break timer that survives tab close, existing + session-created tasks with subtasks, and a keep/discard flow for session-created tasks at session end.

**Architecture:** New Supabase tables (`sessions`, `session_tasks`) plus RLS policies, mirroring the existing `tasks`/`subtasks` pattern. All new UI is client-side React (`'use client'`) using the existing Supabase browser client, matching every other page in `web/app/(app)/`. Timer correctness across tab close/reopen comes from storing `phase_started_at` (wall clock) + `phase_remaining_seconds` (snapshot when paused) in the DB row and recomputing remaining time from `Date.now()` on every render tick — never from a client-only interval that resets on reload.

**Tech Stack:** Next.js 16 (App Router, client components), Supabase (`@supabase/ssr` browser client), Tailwind v4 with the project's remapped analog palette (`bg-gray-950` etc. — see `web/CLAUDE.md` for the mapping table), TypeScript.

**Spec:** `docs/superpowers/specs/2026-08-31-focus-sessions-design.md`

## Global Constraints

- Timer state must be wall-clock derived (`phase_started_at` + duration), not a pure client countdown — this is what makes tab-close/reopen work (spec: Data Model).
- Multiple concurrent sessions per user are allowed — no "one active session" constraint anywhere (spec: Requirements).
- Only `session_tasks` rows with `is_session_created=true` are offered Keep/Discard at session end. Existing tasks added to a session are never deleted by session actions (spec: Requirements, UI Flow).
- Session background color: dark during `work` phase, light during `break` phase (spec: Requirements, UI Flow).
- No auto-cycling — every phase transition (work→break, break→next round) is a manual button click (spec: Requirements).
- This repo has no automated test suite (confirmed: `web/package.json` has no test script or test framework). Verification for every task is `npm run build` (catches type errors) plus a manual check in the running dev server (`npm run dev`), matching how every existing feature in this codebase was verified — do not introduce a new test framework as part of this plan.
- Follow existing patterns exactly: fully client-side pages (`'use client'`), `createClient()` from `@/lib/supabase/client`, explicit `user_id` on every insert (no server-side default — RLS just enforces ownership), Tailwind classes using the remapped palette names (`bg-gray-900`, `text-white`, `bg-indigo-600`, etc.) rather than raw hex where an equivalent mapped class exists.

---

## File Structure

- `supabase/migrations_v7.sql` — **new**. `sessions` + `session_tasks` tables, enum types, RLS policies.
- `web/lib/types.ts` — **modify**. Add `SessionStatus`, `TimerPhase`, `FocusSession`, `SessionTask` types.
- `web/lib/sessionTimer.ts` — **new**. Pure functions for timer math (remaining seconds, mm:ss formatting, phase duration lookup). Isolated from React/Supabase so the timer logic is easy to reason about and reuse between the list page (elapsed badge) and detail page (full countdown).
- `web/components/NavBar.tsx` — **modify**. Add SESSION nav entry.
- `web/app/(app)/session/page.tsx` — **new**. List of active sessions + "New Session" form.
- `web/app/(app)/session/[id]/page.tsx` — **new**. Session detail: timer display/controls, phase-driven background, hosts the task panel and end-session flow.
- `web/components/SessionTaskPanel.tsx` — **new**. Add-existing-task search, quick-add-new-task, and subtask list/add UI scoped to one session. Split out of the `[id]/page.tsx` to keep that file focused on timer/layout.
- `web/components/EndSessionModal.tsx` — **new**. Keep/Discard confirmation UI for session-created tasks.

---

## Task 1: Database migration + TypeScript types

**Files:**
- Create: `supabase/migrations_v7.sql`
- Modify: `web/lib/types.ts`

**Interfaces:**
- Produces: `FocusSession`, `SessionTask` types (exported from `web/lib/types.ts`) and DB tables `sessions`, `session_tasks` — every later task depends on these exact shapes.

- [ ] **Step 1: Write the migration**

```sql
-- Run in Supabase SQL Editor after migrations_v6.sql

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
  phase_started_at timestamptz,
  phase_remaining_seconds int,
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
create policy sessions_rls on sessions using (auth.uid() = user_id);

alter table session_tasks enable row level security;
create policy session_tasks_rls on session_tasks using (auth.uid() = user_id);
```

Save this content to `supabase/migrations_v7.sql`.

- [ ] **Step 2: Apply the migration**

Run the SQL above against the live Supabase project (SQL Editor, or `mcp__supabase__apply_migration` if working via MCP). Confirm no errors and that `sessions` / `session_tasks` appear via `mcp__supabase__list_tables`.

- [ ] **Step 3: Add TypeScript types**

Add to `web/lib/types.ts`, after the existing `Subtask`/`SubtaskStatus` block (around line 47):

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

(Named `FocusSession`, not `Session`, to avoid collision with Supabase auth's `Session` type used elsewhere in the codebase.)

- [ ] **Step 4: Typecheck**

Run: `cd web && npm run build`
Expected: build succeeds (no other files reference the new types yet, so this just confirms `types.ts` itself is syntactically valid).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations_v7.sql web/lib/types.ts
git commit -m "feat: add focus sessions DB schema and types"
```

---

## Task 2: Timer math helper (`web/lib/sessionTimer.ts`)

**Files:**
- Create: `web/lib/sessionTimer.ts`

**Interfaces:**
- Consumes: `FocusSession`, `TimerPhase` from `web/lib/types.ts` (Task 1).
- Produces: `phaseDurationSeconds(session: FocusSession): number`, `remainingSeconds(session: FocusSession, now?: Date): number`, `formatMMSS(totalSeconds: number): string` — Tasks 3 and 5 import all three.

- [ ] **Step 1: Write the helper module**

```typescript
import { FocusSession } from './types'

export function phaseDurationSeconds(session: FocusSession): number {
  if (session.phase === 'break') return session.break_minutes * 60
  if (session.phase === 'work') return session.work_minutes * 60
  return 0
}

// Remaining time in the current phase, clamped to >= 0.
// Running (phase_started_at set): derived from wall clock so a closed/reopened
// tab always recomputes the correct value.
// Paused (phase_started_at null): uses the stored snapshot directly.
export function remainingSeconds(session: FocusSession, now: Date = new Date()): number {
  if (session.phase === 'idle') return 0
  if (!session.phase_started_at) {
    return Math.max(0, session.phase_remaining_seconds ?? phaseDurationSeconds(session))
  }
  const elapsed = Math.floor((now.getTime() - new Date(session.phase_started_at).getTime()) / 1000)
  return Math.max(0, phaseDurationSeconds(session) - elapsed)
}

export function formatMMSS(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
```

- [ ] **Step 2: Verify the math manually**

Run: `cd web && npx tsc --noEmit lib/sessionTimer.ts --esModuleInterop --skipLibCheck --module esnext --moduleResolution bundler --target es2020`
Expected: no type errors.

Then sanity-check the logic by hand against these cases (no test runner exists in this repo — reason through them explicitly rather than skip verification):
- `phase='work'`, `work_minutes=25`, `phase_started_at` = 10 minutes ago → `remainingSeconds` should be `900` (15 min left).
- `phase='work'`, `phase_started_at=null`, `phase_remaining_seconds=120` → `remainingSeconds` returns `120` unchanged (paused snapshot).
- `phase='work'`, `phase_started_at` = 40 minutes ago, `work_minutes=25` → `remainingSeconds` returns `0`, not negative (clamped).
- `formatMMSS(65)` → `"01:05"`. `formatMMSS(9)` → `"00:09"`.

- [ ] **Step 3: Commit**

```bash
git add web/lib/sessionTimer.ts
git commit -m "feat: add focus session timer math helpers"
```

---

## Task 3: NavBar entry

**Files:**
- Modify: `web/components/NavBar.tsx:8-13`

**Interfaces:**
- Consumes: none new.
- Produces: `/session` link visible in the sidebar for Task 4+ to land on.

- [ ] **Step 1: Add the nav entry**

In `web/components/NavBar.tsx`, the `NAV` array currently reads:

```typescript
const NAV = [
  { href: '/tasks',     icon: '☐', label: 'TASKS'  },
  { href: '/braindump', icon: '◉', label: 'DUMP'   },
  { href: '/notes',     icon: '≡', label: 'NOTES'  },
  { href: '/contacts',  icon: '○', label: 'PEOPLE' },
]
```

Change to:

```typescript
const NAV = [
  { href: '/tasks',     icon: '☐', label: 'TASKS'   },
  { href: '/session',   icon: '⏱', label: 'SESSION' },
  { href: '/braindump', icon: '◉', label: 'DUMP'    },
  { href: '/notes',     icon: '≡', label: 'NOTES'   },
  { href: '/contacts',  icon: '○', label: 'PEOPLE'  },
]
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run build`
Expected: succeeds. The `/session` link will 404 until Task 4 lands — that's expected at this point.

- [ ] **Step 3: Commit**

```bash
git add web/components/NavBar.tsx
git commit -m "feat: add SESSION tab to nav bar"
```

---

## Task 4: Session list page (`/session`)

**Files:**
- Create: `web/app/(app)/session/page.tsx`

**Interfaces:**
- Consumes: `FocusSession` type (Task 1), `remainingSeconds`/`formatMMSS` from `web/lib/sessionTimer.ts` (Task 2), `createClient` from `@/lib/supabase/client`.
- Produces: working `/session` route that creates a `sessions` row and navigates to `/session/[id]` — Task 5 depends on rows created here.

- [ ] **Step 1: Write the page**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { FocusSession } from '@/lib/types'
import { remainingSeconds, formatMMSS } from '@/lib/sessionTimer'

export default function SessionListPage() {
  const router = useRouter()
  const supabase = createClient()
  const [sessions, setSessions] = useState<FocusSession[]>([])
  const [loaded, setLoaded] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [title, setTitle] = useState('')
  const [workMinutes, setWorkMinutes] = useState(25)
  const [breakMinutes, setBreakMinutes] = useState(5)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('sessions')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
      setSessions((data as FocusSession[]) ?? [])
      setLoaded(true)
    })()
  }, [])

  async function createSession() {
    setCreating(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('sessions')
      .insert({
        user_id: user?.id,
        title: title.trim() || null,
        work_minutes: workMinutes,
        break_minutes: breakMinutes,
        phase: 'work',
        phase_started_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (!error && data) {
      router.push(`/session/${data.id}`)
    } else {
      setCreating(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-xl font-bold text-white">Focus sessions</h2>
        <button
          onClick={() => setShowNew(v => !v)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-[#DEDAD2] text-sm font-medium rounded-lg transition-colors"
        >
          {showNew ? 'Cancel' : '+ New Session'}
        </button>
      </div>

      {showNew && (
        <div className="mb-8 p-4 rounded-xl bg-gray-900 border border-gray-700 space-y-3">
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Session title (optional)"
            autoFocus
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-600 outline-none focus:border-indigo-500"
          />
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">Work minutes</label>
              <input
                type="number"
                min={1}
                value={workMinutes}
                onChange={e => setWorkMinutes(Math.max(1, Number(e.target.value) || 1))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">Break minutes</label>
              <input
                type="number"
                min={1}
                value={breakMinutes}
                onChange={e => setBreakMinutes(Math.max(1, Number(e.target.value) || 1))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white outline-none focus:border-indigo-500"
              />
            </div>
          </div>
          <button
            onClick={createSession}
            disabled={creating}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-[#DEDAD2] font-medium rounded-lg transition-colors"
          >
            {creating ? 'Starting…' : 'Start session'}
          </button>
        </div>
      )}

      {!loaded ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No active sessions. Start one above.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {sessions.map(s => (
            <button
              key={s.id}
              onClick={() => router.push(`/session/${s.id}`)}
              className="text-left p-4 rounded-xl bg-gray-900 border border-gray-700 hover:border-indigo-500 transition-colors"
            >
              <p className="text-white font-medium mb-1">{s.title || 'Untitled session'}</p>
              <p className="text-xs text-gray-400 uppercase tracking-wide">{s.phase}</p>
              <p className="text-sm text-gray-300 mt-2 font-mono">{formatMMSS(remainingSeconds(s))}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual verification**

Run: `cd web && npm run dev`, open `http://localhost:3000/session`.
- Confirm "No active sessions" shows initially.
- Click "+ New Session", set title "Test", work=1, break=1, submit.
- Confirm redirect attempt to `/session/<id>` (will 404 until Task 5 — expected).
- Navigate back to `/session`, confirm the new session now appears in the grid with phase "work" and a counting-down mm:ss.

- [ ] **Step 4: Commit**

```bash
git add "web/app/(app)/session/page.tsx"
git commit -m "feat: add focus session list and creation page"
```

---

## Task 5: Session detail page — timer display and phase controls

**Files:**
- Create: `web/app/(app)/session/[id]/page.tsx`

**Interfaces:**
- Consumes: `FocusSession` (Task 1), `remainingSeconds`/`phaseDurationSeconds`/`formatMMSS` (Task 2).
- Produces: the `session` state object and `updateSession(patch: Partial<FocusSession>)` helper pattern that Task 6 (`SessionTaskPanel`) and Task 7 (`EndSessionModal`) are rendered inside of / receive `sessionId` from.

- [ ] **Step 1: Write the page (timer portion only — task panel and end-session modal are stubbed as TODO placeholders replaced in Tasks 6-7)**

```tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { FocusSession } from '@/lib/types'
import { remainingSeconds, phaseDurationSeconds, formatMMSS } from '@/lib/sessionTimer'
import { SessionTaskPanel } from '@/components/SessionTaskPanel'
import { EndSessionModal } from '@/components/EndSessionModal'

const WORK_BG = '#1C1A14'
const BREAK_BG = '#DEDAD2'
const IDLE_BG = '#CCCAC0'

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()
  const sessionId = params.id

  const [session, setSession] = useState<FocusSession | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [remaining, setRemaining] = useState(0)
  const [showEndModal, setShowEndModal] = useState(false)

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('sessions').select('*').eq('id', sessionId).single()
      setSession(data as FocusSession)
      setLoaded(true)
    })()
  }, [sessionId])

  useEffect(() => {
    if (!session) return
    setRemaining(remainingSeconds(session))
    const interval = setInterval(() => setRemaining(remainingSeconds(session)), 1000)
    return () => clearInterval(interval)
  }, [session])

  const updateSession = useCallback(async (patch: Partial<FocusSession>) => {
    if (!session) return
    const next = { ...session, ...patch }
    setSession(next)
    await supabase.from('sessions').update(patch).eq('id', session.id)
  }, [session])

  function pause() {
    updateSession({ phase_started_at: null, phase_remaining_seconds: remaining })
  }

  function resume() {
    updateSession({ phase_started_at: new Date().toISOString(), phase_remaining_seconds: null })
  }

  function startBreak() {
    updateSession({ phase: 'break', phase_started_at: new Date().toISOString(), phase_remaining_seconds: null })
  }

  function startNextRound() {
    if (!session) return
    updateSession({
      phase: 'work',
      round: session.round + 1,
      phase_started_at: new Date().toISOString(),
      phase_remaining_seconds: null,
    })
  }

  if (!loaded) return <div className="p-8 text-gray-400 text-sm">Loading…</div>
  if (!session) return <div className="p-8 text-gray-400 text-sm">Session not found.</div>

  const isPaused = session.phase !== 'idle' && !session.phase_started_at
  const bg = session.phase === 'work' ? WORK_BG : session.phase === 'break' ? BREAK_BG : IDLE_BG
  const fg = session.phase === 'work' ? '#DEDAD2' : '#1C1A14'
  const atZero = remaining <= 0

  return (
    <div className="min-h-full p-8 transition-colors duration-500" style={{ background: bg, color: fg }}>
      <div className="flex items-center justify-between mb-8">
        <button onClick={() => router.push('/session')} className="text-sm opacity-70 hover:opacity-100">
          ← All sessions
        </button>
        <button
          onClick={() => setShowEndModal(true)}
          className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          End Session
        </button>
      </div>

      <div className="text-center mb-10">
        <h2 className="text-lg font-medium mb-1">{session.title || 'Untitled session'}</h2>
        <p className="text-xs uppercase tracking-widest opacity-60 mb-6">
          {session.phase} · round {session.round}{isPaused ? ' · paused' : ''}
        </p>
        <p className="text-7xl font-mono font-bold mb-8">{formatMMSS(remaining)}</p>

        <div className="flex items-center justify-center gap-3">
          {isPaused ? (
            <button onClick={resume} className="px-5 py-2.5 rounded-lg bg-indigo-600 text-[#DEDAD2] font-medium">
              Resume
            </button>
          ) : (
            <button onClick={pause} className="px-5 py-2.5 rounded-lg border" style={{ borderColor: fg }}>
              Pause
            </button>
          )}
          {session.phase === 'work' && (
            <button onClick={startBreak} disabled={!atZero && !isPaused} className="px-5 py-2.5 rounded-lg border disabled:opacity-40" style={{ borderColor: fg }}>
              Start Break
            </button>
          )}
          {session.phase === 'break' && (
            <button onClick={startNextRound} disabled={!atZero && !isPaused} className="px-5 py-2.5 rounded-lg border disabled:opacity-40" style={{ borderColor: fg }}>
              Start Next Round
            </button>
          )}
        </div>
      </div>

      <SessionTaskPanel sessionId={session.id} textColor={fg} />

      {showEndModal && (
        <EndSessionModal
          sessionId={session.id}
          onClose={() => setShowEndModal(false)}
          onEnded={() => router.push('/session')}
        />
      )}
    </div>
  )
}
```

Note: `startBreak`/`startNextRound` are disabled unless the timer has reached zero OR the session is paused — this still allows a user to cut work short manually by pausing first, matching the spec's "or manually before if user wants to cut work short" note, while preventing an accidental click mid-countdown.

- [ ] **Step 2: Typecheck (will fail until Tasks 6-7 create the imported components — that's expected; confirm the error is only about the two missing modules)**

Run: `cd web && npm run build`
Expected: fails with "Cannot find module '@/components/SessionTaskPanel'" and "'@/components/EndSessionModal'" — no other errors. This confirms the page itself is otherwise correct; Tasks 6-7 resolve it.

- [ ] **Step 3: Commit**

```bash
git add "web/app/(app)/session/[id]/page.tsx"
git commit -m "feat: add focus session detail page with timer and phase controls"
```

---

## Task 6: Session task panel (add existing / quick-add / subtasks)

**Files:**
- Create: `web/components/SessionTaskPanel.tsx`

**Interfaces:**
- Consumes: `SessionTask`, `Task`, `Subtask` types (Task 1); receives `sessionId: string` and `textColor: string` props from `web/app/(app)/session/[id]/page.tsx` (Task 5).
- Produces: `SessionTaskPanel` default-exported-as-named component (`export function SessionTaskPanel`) — Task 5 already imports it; Task 7's `EndSessionModal` independently queries `session_tasks` itself so has no direct dependency on this file, but both read/write the same `session_tasks` table shape from Task 1.

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SessionTask, Task, Subtask } from '@/lib/types'

export function SessionTaskPanel({ sessionId, textColor }: { sessionId: string; textColor: string }) {
  const supabase = createClient()
  const [sessionTasks, setSessionTasks] = useState<SessionTask[]>([])
  const [loaded, setLoaded] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Task[]>([])
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [subtaskDrafts, setSubtaskDrafts] = useState<Record<string, string>>({})
  const [subtasksByTask, setSubtasksByTask] = useState<Record<string, Subtask[]>>({})

  async function loadSessionTasks() {
    const { data } = await supabase
      .from('session_tasks')
      .select('*, task:tasks(*)')
      .eq('session_id', sessionId)
      .order('added_at', { ascending: true })
    const rows = (data as SessionTask[]) ?? []
    setSessionTasks(rows)
    setLoaded(true)

    const taskIds = rows.map(r => r.task_id)
    if (taskIds.length > 0) {
      const { data: subData } = await supabase
        .from('subtasks')
        .select('*')
        .in('task_id', taskIds)
        .order('sort_order', { ascending: true })
      const grouped: Record<string, Subtask[]> = {}
      for (const st of (subData as Subtask[]) ?? []) {
        grouped[st.task_id] = [...(grouped[st.task_id] ?? []), st]
      }
      setSubtasksByTask(grouped)
    }
  }

  useEffect(() => {
    loadSessionTasks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    const linkedIds = new Set(sessionTasks.map(st => st.task_id))
    const handle = setTimeout(async () => {
      const { data } = await supabase
        .from('tasks')
        .select('*')
        .eq('status', 'pending')
        .ilike('title', `%${searchQuery.trim()}%`)
        .limit(10)
      setSearchResults(((data as Task[]) ?? []).filter(t => !linkedIds.has(t.id)))
    }, 250)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, sessionTasks])

  async function addExistingTask(task: Task) {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('session_tasks').insert({
      session_id: sessionId,
      task_id: task.id,
      user_id: user?.id,
      is_session_created: false,
    })
    setSearchQuery('')
    setSearchResults([])
    loadSessionTasks()
  }

  async function quickAddTask() {
    const title = newTaskTitle.trim()
    if (!title) return
    setNewTaskTitle('')
    const { data: { user } } = await supabase.auth.getUser()
    const { data: task, error } = await supabase
      .from('tasks')
      .insert({
        user_id: user?.id,
        title,
        task_type: 'task',
        due_date: new Date().toISOString().slice(0, 10),
      })
      .select()
      .single()
    if (error || !task) return
    await supabase.from('session_tasks').insert({
      session_id: sessionId,
      task_id: task.id,
      user_id: user?.id,
      is_session_created: true,
    })
    loadSessionTasks()
  }

  async function addSubtask(taskId: string) {
    const title = (subtaskDrafts[taskId] ?? '').trim()
    if (!title) return
    setSubtaskDrafts(prev => ({ ...prev, [taskId]: '' }))
    const { data: { user } } = await supabase.auth.getUser()
    const existing = subtasksByTask[taskId] ?? []
    await supabase.from('subtasks').insert({
      task_id: taskId,
      user_id: user?.id,
      title,
      sort_order: existing.length,
    })
    loadSessionTasks()
  }

  const borderColor = textColor === '#DEDAD2' ? 'rgba(222,218,210,0.25)' : 'rgba(28,26,20,0.15)'

  return (
    <div className="max-w-xl mx-auto mt-4">
      <h3 className="text-sm font-medium mb-3 opacity-80">Session tasks</h3>

      {!loaded ? (
        <p className="text-xs opacity-60">Loading…</p>
      ) : sessionTasks.length === 0 ? (
        <p className="text-xs italic opacity-60 mb-3">No tasks in this session yet.</p>
      ) : (
        <div className="space-y-2 mb-4">
          {sessionTasks.map(st => (
            <div key={st.id} className="rounded-lg p-3 border" style={{ borderColor }}>
              <div className="flex items-center justify-between">
                <span className="text-sm">{st.task?.title}</span>
                {st.is_session_created && (
                  <span className="text-[10px] uppercase tracking-wide opacity-50">session task</span>
                )}
              </div>
              {(subtasksByTask[st.task_id] ?? []).length > 0 && (
                <ul className="mt-1.5 ml-3 space-y-0.5">
                  {subtasksByTask[st.task_id].map(sub => (
                    <li key={sub.id} className="text-xs opacity-70">
                      · {sub.title}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2 mt-2">
                <input
                  value={subtaskDrafts[st.task_id] ?? ''}
                  onChange={e => setSubtaskDrafts(prev => ({ ...prev, [st.task_id]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && addSubtask(st.task_id)}
                  placeholder="Add subtask…"
                  className="flex-1 text-xs px-2 py-1 rounded border bg-transparent outline-none"
                  style={{ borderColor, color: textColor }}
                />
                <button onClick={() => addSubtask(st.task_id)} className="text-xs px-2 py-1 rounded border" style={{ borderColor }}>
                  Add
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <div className="relative">
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search existing tasks to add…"
            className="w-full text-sm px-3 py-2 rounded-lg border bg-transparent outline-none"
            style={{ borderColor, color: textColor }}
          />
          {searchResults.length > 0 && (
            <div className="absolute z-10 w-full mt-1 rounded-lg border bg-[#DEDAD2] text-[#1C1A14] max-h-48 overflow-y-auto" style={{ borderColor: 'rgba(28,26,20,0.15)' }}>
              {searchResults.map(t => (
                <button
                  key={t.id}
                  onClick={() => addExistingTask(t)}
                  className="block w-full text-left px-3 py-2 text-sm hover:bg-black/5"
                >
                  {t.title}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <input
            value={newTaskTitle}
            onChange={e => setNewTaskTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && quickAddTask()}
            placeholder="Quick-add a new task for this session…"
            className="flex-1 text-sm px-3 py-2 rounded-lg border bg-transparent outline-none"
            style={{ borderColor, color: textColor }}
          />
          <button onClick={quickAddTask} className="px-3 py-2 text-sm rounded-lg bg-indigo-600 text-[#DEDAD2]">
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npm run build`
Expected: fails only with "Cannot find module '@/components/EndSessionModal'" now (Task 7 not done yet) — confirms this file itself is correct.

- [ ] **Step 3: Commit**

```bash
git add web/components/SessionTaskPanel.tsx
git commit -m "feat: add session task panel (add existing / quick-add / subtasks)"
```

---

## Task 7: End session modal (keep/discard flow)

**Files:**
- Create: `web/components/EndSessionModal.tsx`

**Interfaces:**
- Consumes: `SessionTask` type (Task 1); receives `sessionId: string`, `onClose: () => void`, `onEnded: () => void` props from `web/app/(app)/session/[id]/page.tsx` (Task 5).
- Produces: nothing consumed elsewhere — terminal component for this feature.

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SessionTask } from '@/lib/types'

export function EndSessionModal({
  sessionId,
  onClose,
  onEnded,
}: {
  sessionId: string
  onClose: () => void
  onEnded: () => void
}) {
  const supabase = createClient()
  const [candidates, setCandidates] = useState<SessionTask[]>([])
  const [keep, setKeep] = useState<Record<string, boolean>>({})
  const [loaded, setLoaded] = useState(false)
  const [ending, setEnding] = useState(false)

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('session_tasks')
        .select('*, task:tasks(*)')
        .eq('session_id', sessionId)
        .eq('is_session_created', true)
      const rows = (data as SessionTask[]) ?? []
      setCandidates(rows)
      setKeep(Object.fromEntries(rows.map(r => [r.id, true])))
      setLoaded(true)
    })()
  }, [sessionId])

  async function confirmEnd() {
    setEnding(true)
    const discardTaskIds = candidates.filter(c => !keep[c.id]).map(c => c.task_id)
    if (discardTaskIds.length > 0) {
      await supabase.from('tasks').delete().in('id', discardTaskIds)
    }
    await supabase
      .from('sessions')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', sessionId)
    onEnded()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#DEDAD2] text-[#1C1A14] rounded-xl p-6 max-w-md w-full max-h-[80vh] overflow-y-auto">
        <h3 className="text-lg font-bold mb-1">End session</h3>
        <p className="text-sm opacity-70 mb-4">
          Choose which tasks created in this session to keep. Existing tasks you added are always kept.
        </p>

        {!loaded ? (
          <p className="text-xs opacity-60 mb-4">Loading…</p>
        ) : candidates.length === 0 ? (
          <p className="text-xs italic opacity-60 mb-4">No session-created tasks to review.</p>
        ) : (
          <div className="space-y-2 mb-4">
            {candidates.map(c => (
              <label key={c.id} className="flex items-center gap-3 p-2 rounded-lg border border-black/10 cursor-pointer">
                <input
                  type="checkbox"
                  checked={keep[c.id] ?? true}
                  onChange={e => setKeep(prev => ({ ...prev, [c.id]: e.target.checked }))}
                />
                <span className="text-sm flex-1">{c.task?.title}</span>
                <span className="text-xs opacity-60">{keep[c.id] ? 'Keep' : 'Discard'}</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={ending} className="px-4 py-2 text-sm rounded-lg hover:opacity-70">
            Cancel
          </button>
          <button
            onClick={confirmEnd}
            disabled={ending || !loaded}
            className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white font-medium disabled:opacity-50"
          >
            {ending ? 'Ending…' : 'End session'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck — full feature should now build cleanly**

Run: `cd web && npm run build`
Expected: succeeds with no errors.

Run: `cd web && npm run lint`
Expected: no errors (warnings acceptable if consistent with rest of codebase).

- [ ] **Step 3: Commit**

```bash
git add web/components/EndSessionModal.tsx
git commit -m "feat: add end-session keep/discard modal"
```

---

## Task 8: Full manual verification pass

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run: `cd web && npm run dev`, open `http://localhost:3000/session`.

- [ ] **Step 2: Walk the full spec Testing checklist**

1. Click "+ New Session", title "Deep work", work=1 min, break=1 min → submit. Confirm redirect to `/session/<id>`, background is dark (work phase), timer counting down from 01:00.
2. In the task panel, search for an existing pending task by title substring, click it → confirm it appears in the session task list without a "session task" badge.
3. Quick-add a new task titled "Session-only task" → confirm it appears with a "session task" badge.
4. Add a subtask to the quick-added task → confirm it renders under it.
5. Click Pause → confirm countdown stops, "Resume" button appears, phase label shows "paused". Wait 5 real seconds, click Resume → confirm countdown continues from where it paused (not reset).
6. Close the browser tab entirely (not just navigate away). Reopen `http://localhost:3000/session`, click into the same session → confirm the timer reflects real elapsed wall-clock time (i.e. it's lower than when you left, or paused state was preserved if you left it paused).
7. Let the work countdown reach 00:00 (or manually verify the "Start Break" button becomes enabled at zero). Click "Start Break" → confirm background switches to light, phase label "break".
8. Let break reach zero, click "Start Next Round" → confirm background switches back to dark, round increments to 2.
9. Click "End Session" → confirm modal shows only "Session-only task" (not the existing task added in step 2), defaulted to Keep.
10. Uncheck it (Discard), confirm.
11. Verify on `/tasks` that "Session-only task" is gone (deleted, subtask cascade included) and the existing task from step 2 is still present, unaffected.
12. Go back to `/session` → confirm the ended session no longer appears in the active list.
13. Create two more sessions without ending them → confirm both appear simultaneously in the `/session` grid (multiple concurrent sessions).

- [ ] **Step 3: Fix any discrepancies found, re-run affected steps**

If any check fails, fix the relevant file from Tasks 1-7, re-run `npm run build`, and re-walk the specific failed checklist item (not the whole list) until it passes.

- [ ] **Step 4: Final commit if fixes were made**

```bash
git add -A
git commit -m "fix: address issues found in focus sessions manual verification"
```

(Skip this step if no fixes were needed.)
