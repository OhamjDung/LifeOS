'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { formatMMSS } from '@/lib/sessionTimer'
import { useFocusSession } from '@/lib/useFocusSession'
import { playChime, setSoundEnabled, soundEnabled, unlockAudio } from '@/lib/chime'
import { SessionTaskPanel } from '@/components/SessionTaskPanel'
import { EndSessionModal } from '@/components/EndSessionModal'
import { LockinRatingModal } from '@/components/LockinRatingModal'
import { useFloatingTimer } from '@/components/session/FloatingTimer'

const WORK_BG = '#1C1A14'
const BREAK_BG = '#DEDAD2'
const IDLE_BG = '#CCCAC0'

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const sessionId = params.id
  const { session, loaded, remaining, saveError, pause, resume, startBreak, startNextRound } =
    useFocusSession(sessionId, { setTitle: true })
  const { popped, popOut, closePopOut } = useFloatingTimer()
  const [showEndModal, setShowEndModal] = useState(false)
  const [showRatingModal, setShowRatingModal] = useState(false)
  const [sound, setSound] = useState(true)

  useEffect(() => { setSound(soundEnabled()) }, []) // eslint-disable-line react-hooks/set-state-in-effect -- localStorage is client-only

  function toggleSound() {
    const next = !sound
    setSound(next)
    setSoundEnabled(next)
    if (next) {
      unlockAudio()
      playChime('work-done') // preview so you know what it sounds like
      // Desktop notification too, for when the tab is in the background.
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => {})
    }
  }

  if (!loaded) return <div className="p-4 sm:p-8 text-gray-400 text-sm">Loading…</div>
  if (!session) return <div className="p-4 sm:p-8 text-gray-400 text-sm">Session not found.</div>

  const isPaused = session.phase !== 'idle' && !session.phase_started_at
  const bg = session.phase === 'work' ? WORK_BG : session.phase === 'break' ? BREAK_BG : IDLE_BG
  const fg = session.phase === 'work' ? '#DEDAD2' : '#1C1A14'
  const atZero = remaining <= 0
  const poppedHere = popped?.sessionId === session.id

  return (
    <div className="min-h-full p-4 sm:p-8 transition-colors duration-500" style={{ background: bg, color: fg }}>
      {saveError && <p role="alert" className="mb-3">{saveError}</p>}
      <div className="flex items-center justify-between gap-2 mb-8">
        <button onClick={() => router.push('/session')} className="text-sm opacity-70 hover:opacity-100">
          ← All sessions
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleSound}
            aria-pressed={sound}
            title={sound ? 'Chime when the timer ends (click to mute)' : 'Muted — click to turn the chime on'}
            className="px-3 py-2 rounded-lg border text-sm opacity-80 hover:opacity-100"
            style={{ borderColor: fg }}
          >
            {sound ? '🔔' : '🔕'}
          </button>
          <button
            onClick={() => (poppedHere ? closePopOut() : popOut(session.id))}
            title="Float the timer in its own always-on-top window you can move and resize"
            className="px-3 py-2 rounded-lg border text-sm font-medium opacity-80 hover:opacity-100"
            style={{ borderColor: fg }}
          >
            {poppedHere ? '⤢ Dock timer' : '⧉ Pop out'}
          </button>
          <button
            onClick={() => setShowEndModal(true)}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            End Session
          </button>
        </div>
      </div>

      <div className="text-center mb-10">
        <h2 className="text-lg font-medium mb-1">{session.title || 'Untitled session'}</h2>
        <p className="text-xs uppercase tracking-widest opacity-60 mb-6">
          {session.phase} · round {session.round}{isPaused ? ' · paused' : ''}{poppedHere ? ' · popped out' : ''}
        </p>
        <p className={`text-7xl font-mono font-bold mb-8 ${atZero && session.phase_started_at ? 'animate-pulse' : ''}`}>
          {formatMMSS(remaining)}
        </p>

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
            <button onClick={() => setShowRatingModal(true)} disabled={!atZero && !isPaused} className="px-5 py-2.5 rounded-lg border disabled:opacity-40" style={{ borderColor: fg }}>
              Start Break
            </button>
          )}
          {session.phase === 'break' && (
            <>
              <button onClick={startNextRound} disabled={!atZero && !isPaused} className="px-5 py-2.5 rounded-lg border disabled:opacity-40" style={{ borderColor: fg }}>
                Start Next Round
              </button>
              <button onClick={startNextRound} className="px-5 py-2.5 rounded-lg opacity-70 hover:opacity-100" style={{ color: fg }}>
                Skip Break
              </button>
            </>
          )}
        </div>
      </div>

      <SessionTaskPanel sessionId={session.id} textColor={fg} />

      {showEndModal && (
        <EndSessionModal
          sessionId={session.id}
          onClose={() => setShowEndModal(false)}
          onEnded={() => { if (poppedHere) closePopOut(); router.push('/session') }}
        />
      )}

      {showRatingModal && (
        <LockinRatingModal
          sessionId={session.id}
          round={session.round}
          onDone={() => {
            setShowRatingModal(false)
            startBreak()
          }}
        />
      )}
    </div>
  )
}
