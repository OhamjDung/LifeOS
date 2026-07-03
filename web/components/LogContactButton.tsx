'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function LogContactButton({ contactId }: { contactId: string }) {
  const [logging, setLogging] = useState(false)
  const router = useRouter()

  async function log() {
    setLogging(true)
    const supabase = createClient()
    await supabase
      .from('contacts')
      .update({ last_contacted_at: new Date().toISOString() })
      .eq('id', contactId)
    setLogging(false)
    router.refresh()
  }

  return (
    <button
      onClick={e => { e.preventDefault(); log() }}
      disabled={logging}
      className="px-3 py-1.5 text-xs font-medium text-green-400 border border-green-900/60 rounded-lg hover:bg-green-900/20 transition-colors disabled:opacity-40 shrink-0"
    >
      {logging ? '…' : 'LOG ✓'}
    </button>
  )
}
