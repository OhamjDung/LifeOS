'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { FocusSession } from '@/lib/types'
import { remainingSeconds, formatMMSS } from '@/lib/sessionTimer'

export default function SessionListPage() {
  const router = useRouter()
  const supabase = createClient()
  const [sessions, setSessions] = useState<FocusSession[]>([])
  const [loaded, setLoaded] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [title, setTitle] = useState('')
  const [workMinutes, setWorkMinutes] = useState(25)
  const [breakMinutes, setBreakMinutes] = useState(5)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('sessions')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
      setSessions((data as FocusSession[]) ?? [])
      setLoaded(true)
    })()
  }, [])

  async function createSession() {
    setCreating(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('sessions')
      .insert({
        user_id: user?.id,
        title: title.trim() || null,
        work_minutes: workMinutes,
        break_minutes: breakMinutes,
        phase: 'work',
        phase_started_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (!error && data) {
      router.push(`/session/${data.id}`)
    } else {
      setCreating(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-xl font-bold text-white">Focus sessions</h2>
        <button
          onClick={() => setShowNew(v => !v)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-[#DEDAD2] text-sm font-medium rounded-lg transition-colors"
        >
          {showNew ? 'Cancel' : '+ New Session'}
        </button>
      </div>

      {showNew && (
        <div className="mb-8 p-4 rounded-xl bg-gray-900 border border-gray-700 space-y-3">
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Session title (optional)"
            autoFocus
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-600 outline-none focus:border-indigo-500"
          />
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">Work minutes</label>
              <input
                type="number"
                min={1}
                value={workMinutes}
                onChange={e => setWorkMinutes(Math.max(1, Number(e.target.value) || 1))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">Break minutes</label>
              <input
                type="number"
                min={1}
                value={breakMinutes}
                onChange={e => setBreakMinutes(Math.max(1, Number(e.target.value) || 1))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white outline-none focus:border-indigo-500"
              />
            </div>
          </div>
          <button
            onClick={createSession}
            disabled={creating}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-[#DEDAD2] font-medium rounded-lg transition-colors"
          >
            {creating ? 'Starting…' : 'Start session'}
          </button>
        </div>
      )}

      {!loaded ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No active sessions. Start one above.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {sessions.map(s => (
            <button
              key={s.id}
              onClick={() => router.push(`/session/${s.id}`)}
              className="text-left p-4 rounded-xl bg-gray-900 border border-gray-700 hover:border-indigo-500 transition-colors"
            >
              <p className="text-white font-medium mb-1">{s.title || 'Untitled session'}</p>
              <p className="text-xs text-gray-400 uppercase tracking-wide">{s.phase}</p>
              <p className="text-sm text-gray-300 mt-2 font-mono">{formatMMSS(remainingSeconds(s))}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
