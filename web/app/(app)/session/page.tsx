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
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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

  // Deleting skips EndSessionModal on purpose: session_tasks/session_rounds cascade,
  // but the tasks themselves (incl. session-created ones) stay on the main list.
  async function deleteSession(id: string) {
    if (deletingId) return
    setDeletingId(id)
    setDeleteError(null)
    const { error } = await supabase.from('sessions').delete().eq('id', id)
    if (error) {
      setDeleteError(error.message)
      setDeletingId(null)
      return
    }
    // Let the shrink-out animation play before removing the card.
    setTimeout(() => {
      setSessions(prev => prev.filter(s => s.id !== id))
      setDeletingId(null)
      setConfirmingId(null)
    }, 160)
  }

  return (
    <div className="p-4 sm:p-8 max-w-2xl">
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
        <>
        {deleteError && (
          <p role="alert" className="mb-3 text-xs text-red-700">Couldn&apos;t delete: {deleteError}</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sessions.map((s, i) => (
            <div
              key={s.id}
              className={`relative ${deletingId === s.id ? 'animate-shrink-out' : 'animate-slide-up'}`}
              style={{ animationDelay: deletingId === s.id ? undefined : `${i * 40}ms` }}
            >
              <button
                onClick={() => router.push(`/session/${s.id}`)}
                className="w-full text-left p-4 pr-10 rounded-xl bg-gray-900 border border-gray-700 hover:border-indigo-500 transition-colors"
              >
                <p className="text-white font-medium mb-1">{s.title || 'Untitled session'}</p>
                <p className="text-xs text-gray-400 uppercase tracking-wide">{s.phase}</p>
                <p className="text-sm text-gray-300 mt-2 font-mono">{formatMMSS(remainingSeconds(s))}</p>
              </button>
              {confirmingId === s.id ? (
                <div className="absolute inset-0 rounded-xl bg-gray-900/95 border border-gray-700 flex flex-col items-center justify-center gap-2 p-3 animate-fade-in">
                  <p className="text-xs text-white text-center">Delete session? Linked tasks stay on your list.</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmingId(null)}
                      className="px-3 py-1 text-xs rounded-lg border border-gray-700 text-gray-400 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => deleteSession(s.id)}
                      disabled={deletingId === s.id}
                      autoFocus
                      className="px-3 py-1 text-xs rounded-lg bg-red-700 hover:bg-red-600 text-[#DEDAD2] disabled:opacity-50"
                    >
                      {deletingId === s.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmingId(s.id)}
                  aria-label={`Delete session ${s.title || 'Untitled session'}`}
                  title="Delete session"
                  className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full text-gray-500 hover:text-red-700 hover:bg-black/5"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        </>

      )}
    </div>
  )
}
