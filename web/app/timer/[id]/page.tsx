'use client'

// Pop-out timer for browsers without Document Picture-in-Picture: a bare page
// (outside the (app) layout — no nav) opened with window.open. Resize/move the
// window freely; the clock scales with it. Syncs with the main tab via
// BroadcastChannel (useFocusSession). Auth is enforced by proxy.ts + RLS.

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { unlockAudio } from '@/lib/chime'
import { useFocusSession } from '@/lib/useFocusSession'
import { MiniTimer } from '@/components/session/MiniTimer'

export default function TimerPopoutPage() {
  const { id } = useParams<{ id: string }>()
  const timer = useFocusSession(id, { setTitle: true })

  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock)
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  if (timer.loaded && !timer.session) {
    return <p style={{ padding: 16, fontFamily: 'monospace' }}>Session not found.</p>
  }
  return <MiniTimer timer={timer} onClose={() => window.close()} />
}
