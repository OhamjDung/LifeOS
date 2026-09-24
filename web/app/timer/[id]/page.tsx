'use client'

// Pop-out window for browsers without Document Picture-in-Picture: a bare page
// (outside the (app) layout — no nav) opened with window.open. /timer/none = no
// session (opened from /tasks). Resize/move the window freely; the clock scales
// with it. Syncs with the main tab via BroadcastChannel (useFocusSession).
// Auth is enforced by proxy.ts + RLS.

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { unlockAudio } from '@/lib/chime'
import { useFocusSession } from '@/lib/useFocusSession'
import { MiniTimer } from '@/components/session/MiniTimer'

export default function TimerPopoutPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const sessionId = id === 'none' ? null : id
  const timer = useFocusSession(sessionId, { setTitle: !!sessionId })

  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock)
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  if (sessionId && timer.loaded && !timer.session) {
    return <p style={{ padding: 16, fontFamily: 'monospace' }}>Session not found.</p>
  }
  return (
    <MiniTimer
      timer={timer}
      onClose={() => window.close()}
      onSessionStarted={newId => router.replace(`/timer/${newId}`)}
    />
  )
}
