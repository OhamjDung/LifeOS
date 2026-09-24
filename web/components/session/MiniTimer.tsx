'use client'

import { useEffect, useState } from 'react'
import { formatMMSS } from '@/lib/sessionTimer'
import { useFocusSession } from '@/lib/useFocusSession'
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
export function MiniTimer({ timer, onClose }: { timer: Timer; onClose?: () => void }) {
  const [tab, setTab] = useState<Tab>('timer')
  useEffect(() => {
    try {
      const saved = localStorage.getItem('popoutTab') as Tab | null
      if (saved && TABS.some(t => t.id === saved)) setTab(saved) // eslint-disable-line react-hooks/set-state-in-effect -- localStorage is client-only
    } catch {}
  }, [])
  const choose = (t: Tab) => { setTab(t); try { localStorage.setItem('popoutTab', t) } catch {} }

  const { session, remaining } = timer
  if (!session) return <div style={{ padding: 16, fontFamily: 'monospace' }}>Loading…</div>
  const { bg, fg } = phaseColors(session.phase)
  const atZero = remaining <= 0 && !!session.phase_started_at

  return (
    <div
      className="fixed inset-0 flex flex-col overflow-hidden"
      style={{ background: tab === 'timer' ? bg : '#CCCAC0', fontFamily: 'var(--font-ibm-plex-mono), "IBM Plex Mono", monospace' }}
    >
      {/* Tab bar — phase-coloured so work/break is obvious from any tab */}
      <div role="tablist" aria-label="Pop-out views" className="flex items-center gap-0.5 px-1 py-1 shrink-0 transition-colors duration-500" style={{ background: bg, color: fg }}>
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => choose(t.id)}
            className="px-2 py-1 rounded text-[10px] font-semibold tracking-wide"
            style={{ background: tab === t.id ? (session.phase === 'work' ? 'rgba(222,218,210,0.16)' : 'rgba(28,26,20,0.1)') : 'transparent', opacity: tab === t.id ? 1 : 0.65 }}
          >
            {t.label}
          </button>
        ))}
        <span className="flex-1" />
        {tab !== 'timer' && (
          <button
            onClick={() => choose('timer')}
            title="Back to the timer"
            className={`px-1.5 text-[11px] font-bold tabular-nums ${atZero ? 'animate-pulse' : ''}`}
          >
            ⏱ {formatMMSS(remaining)}
          </button>
        )}
        {onClose && (
          <button onClick={onClose} title="Dock back into the page" aria-label="Close pop-out" className="px-1.5 text-[12px] opacity-60 hover:opacity-100">⤢</button>
        )}
      </div>

      <div className="flex-1 min-h-0 relative">
        {tab === 'timer' && <TimerFace timer={timer} />}
        {tab === 'session' && (
          <div className="absolute inset-0 overflow-y-auto px-3 pb-3" style={{ color: '#1C1A14' }}>
            <SessionTaskPanel sessionId={session.id} textColor="#1C1A14" />
          </div>
        )}
        {tab === 'tasks' && <div className="absolute inset-0 p-3"><MiniTaskList /></div>}
        {tab === 'today' && <div className="absolute inset-0 overflow-hidden p-2"><DayCalendar compact /></div>}
      </div>
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
