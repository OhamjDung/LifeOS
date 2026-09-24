'use client'

import { useEffect, useState } from 'react'
import { formatMMSS } from '@/lib/sessionTimer'
import { createFocusSession, useFocusSession } from '@/lib/useFocusSession'
import { createClient } from '@/lib/supabase/client'
import { SessionTaskPanel } from '@/components/SessionTaskPanel'
import { DayCalendar } from '@/components/calendar/DayCalendar'
import { MiniTaskList } from './MiniTaskList'

type Timer = ReturnType<typeof useFocusSession>
type Tab = 'timer' | 'session' | 'tasks' | 'today'

const TABS: { id: Tab; label: string }[] = [
  { id: 'timer', label: 'TIMER' },
  { id: 'session', label: 'SESSION' },
  { id: 'tasks', label: 'TASKS' },
  { id: 'today', label: 'TODAY' },
]

const WORK_BG = '#1C1A14'
const BREAK_BG = '#DEDAD2'
const IDLE_BG = '#CCCAC0'

function phaseColors(phase: string) {
  return {
    bg: phase === 'work' ? WORK_BG : phase === 'break' ? BREAK_BG : IDLE_BG,
    fg: phase === 'work' ? '#DEDAD2' : '#1C1A14',
  }
}

/**
 * Pop-out window contents: tabs for the timer, this session's tasks, today's
 * global tasks, and today's schedule. The timer keeps running (and chimes) on
 * every tab; off the TIMER tab the countdown shows in the tab bar.
 */
export function MiniTimer({ timer, onClose, onSessionStarted }: {
  timer: Timer
  onClose?: () => void
  onSessionStarted?: (sessionId: string) => void
}) {
  const [tab, setTab] = useState<Tab>('timer')
  useEffect(() => {
    try {
      const saved = localStorage.getItem('popoutTab') as Tab | null
      if (saved && TABS.some(t => t.id === saved)) setTab(saved) // eslint-disable-line react-hooks/set-state-in-effect -- localStorage is client-only
    } catch {}
  }, [])
  const choose = (t: Tab) => { setTab(t); try { localStorage.setItem('popoutTab', t) } catch {} }

  const { session, remaining, loaded } = timer
  if (!loaded) return <div style={{ padding: 16, fontFamily: 'monospace' }}>Loading…</div>

  // Everything in the window follows the session's phase: work = dark, break = light.
  const { bg, fg } = phaseColors(session?.phase ?? 'idle')
  const dark = session?.phase === 'work'
  const atZero = !!session && remaining <= 0 && !!session.phase_started_at
  const tabs = session ? TABS : TABS.filter(t => t.id !== 'session')
  const current: Tab = !session && tab === 'session' ? 'timer' : tab

  return (
    <div
      className={`fixed inset-0 flex flex-col overflow-hidden transition-colors duration-500 ${dark ? 'theme-dark' : ''}`}
      style={{ background: bg, color: fg, fontFamily: 'var(--font-ibm-plex-mono), "IBM Plex Mono", monospace' }}
    >
      <div
        role="tablist"
        aria-label="Pop-out views"
        className="flex items-center gap-0.5 px-1 py-1 shrink-0"
        style={{ borderBottom: `1px solid ${dark ? 'rgba(222,218,210,0.12)' : 'rgba(28,26,20,0.1)'}` }}
      >
        {tabs.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={current === t.id}
            onClick={() => choose(t.id)}
            className="px-2 py-1 rounded text-[10px] font-semibold tracking-wide"
            style={{ background: current === t.id ? (dark ? 'rgba(222,218,210,0.14)' : 'rgba(28,26,20,0.1)') : 'transparent', opacity: current === t.id ? 1 : 0.65 }}
          >
            {t.label}
          </button>
        ))}
        <span className="flex-1" />
        {current !== 'timer' && session && (
          <button
            onClick={() => choose('timer')}
            title="Back to the timer"
            className={`px-1.5 text-[11px] font-bold tabular-nums ${atZero ? 'animate-pulse' : ''}`}
          >
            ⏱ {formatMMSS(remaining)}
          </button>
        )}
        {onClose && (
          <button onClick={onClose} title="Close the pop-out" aria-label="Close pop-out" className="px-1.5 text-[12px] opacity-60 hover:opacity-100">⤢</button>
        )}
      </div>

      <div className="flex-1 min-h-0 relative">
        {current === 'timer' && (session ? <TimerFace timer={timer} /> : <StartSessionFace onStarted={onSessionStarted} />)}
        {current === 'session' && session && (
          <div className="absolute inset-0 overflow-y-auto overflow-x-hidden px-2.5 pb-3">
            <SessionTaskPanel sessionId={session.id} textColor={fg} compact />
          </div>
        )}
        {current === 'tasks' && <div className="absolute inset-0 p-2.5"><MiniTaskList /></div>}
        {current === 'today' && <div className="absolute inset-0 overflow-hidden p-2"><DayCalendar compact /></div>}
      </div>
    </div>
  )
}

/** No session yet (opened from /tasks): resume an active one or start a new one. */
function StartSessionFace({ onStarted }: { onStarted?: (id: string) => void }) {
  const [supabase] = useState(createClient)
  const [active, setActive] = useState<{ id: string; title: string | null }[]>([])
  const [title, setTitle] = useState('')
  const [preset, setPreset] = useState<[number, number]>([25, 5])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('sessions').select('id,title').eq('status', 'active').order('created_at', { ascending: false }).limit(5)
      .then(({ data }) => setActive((data as { id: string; title: string | null }[]) ?? []))
  }, [supabase])

  async function start() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const id = await createFocusSession({ title: title.trim() || null, work: preset[0], brk: preset[1] })
      onStarted?.(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="absolute inset-0 overflow-y-auto flex flex-col items-center justify-center gap-2 p-3 text-center">
      <p className="text-[12px] font-semibold">No focus session running</p>
      {active.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1">
          {active.map(a => (
            <button key={a.id} onClick={() => onStarted?.(a.id)} className="px-2 py-1 rounded-md border border-gray-700 text-[11px] hover:bg-black/5">
              ▶ {a.title || 'Untitled session'}
            </button>
          ))}
        </div>
      )}
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') start() }}
        placeholder="New session title (optional)"
        className="w-full max-w-xs bg-field border border-gray-700 rounded-lg px-2.5 py-1.5 text-[12px] text-white placeholder-gray-500 outline-none focus:border-indigo-500"
      />
      <div className="flex gap-1">
        {([[25, 5], [50, 10], [90, 15]] as [number, number][]).map(p => (
          <button
            key={p[0]}
            onClick={() => setPreset(p)}
            aria-pressed={preset[0] === p[0]}
            className={`px-2 py-1 rounded-md text-[11px] border ${preset[0] === p[0] ? 'bg-indigo-600 text-[#DEDAD2] border-transparent' : 'border-gray-700'}`}
          >
            {p[0]}/{p[1]}
          </button>
        ))}
      </div>
      <button onClick={start} disabled={busy} className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[#DEDAD2] text-[12px] font-semibold disabled:opacity-50">
        {busy ? 'Starting…' : 'Start focus session'}
      </button>
      {error && <p role="alert" className="text-[11px] text-red-700">{error}</p>}
    </div>
  )
}

/** The big clock + controls. Scales with the window (vw/vh), so resizing resizes it. */
function TimerFace({ timer }: { timer: Timer }) {
  const { session, remaining, pause, resume, startBreak, startNextRound, rateRound, saveError } = timer
  const [rating, setRating] = useState(false)
  if (!session) return null

  const isPaused = session.phase !== 'idle' && !session.phase_started_at
  const atZero = remaining <= 0
  const { bg, fg } = phaseColors(session.phase)
  const btn = 'px-2.5 py-1 rounded-md border text-[max(11px,min(3.2vw,5vh))] font-medium disabled:opacity-40'

  async function finishRound(value: number | null) {
    setRating(false)
    await rateRound(value)
    startBreak()
  }

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-[2vh] select-none transition-colors duration-500 overflow-hidden"
      style={{ background: bg, color: fg }}
    >
      <p className="uppercase tracking-widest opacity-60 text-[max(9px,min(2.6vw,4vh))] text-center px-2 truncate max-w-full">
        {session.title ? `${session.title} · ` : ''}{session.phase} · r{session.round}{isPaused ? ' · paused' : ''}
      </p>
      <p
        className={`font-bold tabular-nums leading-none ${atZero && session.phase_started_at ? 'animate-pulse' : ''}`}
        style={{ fontSize: 'clamp(28px, min(26vw, 38vh), 260px)' }}
      >
        {formatMMSS(remaining)}
      </p>

      {rating ? (
        <div className="flex flex-col items-center gap-1 animate-fade-in">
          <p className="opacity-70 text-[max(10px,min(2.8vw,4.5vh))]">How locked in?</p>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} onClick={() => finishRound(n)} className={btn} style={{ borderColor: fg }}>{n}</button>
            ))}
            <button onClick={() => finishRound(null)} className={`${btn} opacity-60`} style={{ borderColor: 'transparent' }}>skip</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-1.5 px-2">
          {isPaused ? (
            <button onClick={resume} className={`${btn} bg-indigo-600 text-[#DEDAD2] border-transparent`}>Resume</button>
          ) : (
            <button onClick={pause} className={btn} style={{ borderColor: fg }}>Pause</button>
          )}
          {session.phase === 'work' && (
            <button onClick={() => setRating(true)} disabled={!atZero && !isPaused} className={btn} style={{ borderColor: fg }}>Break</button>
          )}
          {session.phase === 'break' && (
            <button onClick={startNextRound} className={btn} style={{ borderColor: fg }}>{atZero ? 'Next round' : 'Skip break'}</button>
          )}
        </div>
      )}
      {saveError && <p role="alert" className="text-[10px] text-red-600">{saveError}</p>}
    </div>
  )
}
