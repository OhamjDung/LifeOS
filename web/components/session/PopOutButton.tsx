'use client'

import { useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useFloatingTimer } from './FloatingTimer'

/**
 * "⧉ Pop out" for pages without a specific session (e.g. /tasks): attaches the
 * floating window to the most recent active focus session, or opens it without
 * one (TASKS / TODAY + a start-session face).
 */
export function PopOutButton({ className = '' }: { className?: string }) {
  const { popped, popOut, closePopOut } = useFloatingTimer()
  const busy = useRef(false)

  async function open() {
    if (busy.current) return
    busy.current = true
    try {
      const { data } = await createClient().from('sessions').select('id').eq('status', 'active')
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      await popOut((data?.id as string | undefined) ?? null)
    } finally {
      busy.current = false
    }
  }

  return (
    <button
      onClick={() => (popped ? closePopOut() : open())}
      title="Float a small always-on-top window with your timer, tasks and today's schedule"
      className={`px-2.5 py-1 text-xs border border-gray-700 rounded-lg text-gray-400 hover:text-white hover:bg-black/5 ${className}`}
    >
      {popped ? '⤢ Close pop-out' : '⧉ Pop out'}
    </button>
  )
}
