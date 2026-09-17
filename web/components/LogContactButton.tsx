'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function LogContactButton({ contactId }: { contactId: string }) {
  const [logging, setLogging] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState('')
  const [logged, setLogged] = useState(false)
  const router = useRouter()

  async function log() {
    if (lock.current) return
    lock.current = true
    setError('')
    setLogging(true)
    const supabase = createClient()
    try {
    const { error: failure } = await supabase
      .from('contacts')
      .update({ last_contacted_at: new Date().toISOString() })
      .eq('id', contactId)
    if (failure) throw failure
    setLogged(true)
    router.refresh()
    } catch { setError('Could not log contact. Retry.') }
    finally { lock.current = false; setLogging(false) }
  }

  return (
    <span>
    <button
      onClick={e => { e.preventDefault(); e.stopPropagation(); void log() }}
      disabled={logging}
      className="px-3 py-1.5 text-xs font-medium text-green-400 border border-green-900/60 rounded-lg hover:bg-green-900/20 transition-colors disabled:opacity-40 shrink-0"
    >
      {logging ? 'Saving…' : logged ? 'Logged ✓' : 'LOG ✓'}
    </button>
    {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    </span>
  )
}
