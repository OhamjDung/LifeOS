'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { FocusSession } from '@/lib/types'
import { remainingSeconds, formatMMSS } from '@/lib/sessionTimer'
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
