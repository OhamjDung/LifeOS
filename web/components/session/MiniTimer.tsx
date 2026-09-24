'use client'

import { useState } from 'react'
import { formatMMSS } from '@/lib/sessionTimer'
import { useFocusSession } from '@/lib/useFocusSession'

type Timer = ReturnType<typeof useFocusSession>

const WORK_BG = '#1C1A14'
const BREAK_BG = '#DEDAD2'
const IDLE_BG = '#CCCAC0'

/**
 * Compact timer for the pop-out window. Everything scales with the window
 * (vw/vh units), so resizing the window resizes the clock.
 */
export function MiniTimer({ timer, onClose }: { timer: Timer; onClose?: () => void }) {
  const { session, remaining, pause, resume, startBreak, startNextRound, rateRound, saveError } = timer
  const [rating, setRating] = useState(false)
  if (!session) return <div style={{ padding: 16, fontFamily: 'monospace' }}>Loading…</div>

  const isPaused = session.phase !== 'idle' && !session.phase_started_at
  const atZero = remaining <= 0
  const bg = session.phase === 'work' ? WORK_BG : session.phase === 'break' ? BREAK_BG : IDLE_BG
  const fg = session.phase === 'work' ? '#DEDAD2' : '#1C1A14'
  const btn = 'px-2.5 py-1 rounded-md border text-[max(11px,min(3.2vw,5vh))] font-medium disabled:opacity-40'

  async function finishRound(value: number | null) {
    setRating(false)
    await rateRound(value)
    startBreak()
  }

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-[2vh] select-none transition-colors duration-500 overflow-hidden"
      style={{ background: bg, color: fg, fontFamily: 'var(--font-ibm-plex-mono), "IBM Plex Mono", monospace' }}
    >
      <p className="uppercase tracking-widest opacity-60 text-[max(9px,min(2.6vw,4vh))] text-center px-2 truncate max-w-full">
        {session.title ? `${session.title} · ` : ''}{session.phase} · r{session.round}{isPaused ? ' · paused' : ''}
      </p>
      <p
        className={`font-bold tabular-nums leading-none ${atZero && session.phase_started_at ? 'animate-pulse' : ''}`}
        style={{ fontSize: 'clamp(28px, min(26vw, 42vh), 260px)' }}
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
          {onClose && (
            <button onClick={onClose} title="Back into the page" className={`${btn} opacity-60`} style={{ borderColor: 'transparent' }}>⤢</button>
          )}
        </div>
      )}
      {saveError && <p role="alert" className="text-[10px] text-red-600">{saveError}</p>}
    </div>
  )
}
