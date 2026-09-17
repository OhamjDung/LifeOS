'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

// Nudges fn-embed-note when the notes list shows queued notes. Fire-and-forget:
// pg_cron drains the queue every 2 min regardless; this only shortens the wait.
export function NotesPendingChecker({ pendingCount }: { pendingCount: number }) {
  useEffect(() => {
    if (pendingCount === 0) return
    const supabase = createClient()
    void supabase.auth.getSession().then(({ data: { session } }) => fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fn-embed-note`,
      { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` } },
    )).catch(() => {})
  }, [pendingCount])

  return pendingCount > 0
    ? <p role="status" className="mb-3 text-xs text-gray-400">{pendingCount} note(s) queued for background categorization.</p>
    : null
}
