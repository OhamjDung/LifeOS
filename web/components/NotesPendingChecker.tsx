'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export function NotesPendingChecker({ pendingCount }: { pendingCount: number }) {
  const supabase = createClient()

  useEffect(() => {
    if (pendingCount === 0) return
    console.log(`[notes] ${pendingCount} note(s) pending categorization — triggering fn-embed-note...`)
    supabase.auth.getSession().then(({ data: { session } }) => {
      fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fn-embed-note`,
        { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` } },
      )
        .then(r => r.json())
        .then(b => console.log('[notes] fn-embed-note response:', b))
        .catch(e => console.error('[notes] fn-embed-note error:', e))
    })
  }, [])

  return null
}
