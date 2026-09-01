'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SessionTask } from '@/lib/types'

export function EndSessionModal({
  sessionId,
  onClose,
  onEnded,
}: {
  sessionId: string
  onClose: () => void
  onEnded: () => void
}) {
  const supabase = createClient()
  const [candidates, setCandidates] = useState<SessionTask[]>([])
  const [keep, setKeep] = useState<Record<string, boolean>>({})
  const [loaded, setLoaded] = useState(false)
  const [ending, setEnding] = useState(false)

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('session_tasks')
        .select('*, task:tasks(*)')
        .eq('session_id', sessionId)
        .eq('is_session_created', true)
      const rows = (data as SessionTask[]) ?? []
      setCandidates(rows)
      setKeep(Object.fromEntries(rows.map(r => [r.id, true])))
      setLoaded(true)
    })()
  }, [sessionId])

  async function confirmEnd() {
    setEnding(true)
    const discardTaskIds = candidates.filter(c => !keep[c.id]).map(c => c.task_id)
    if (discardTaskIds.length > 0) {
      await supabase.from('tasks').delete().in('id', discardTaskIds)
    }
    await supabase
      .from('sessions')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', sessionId)
    onEnded()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#DEDAD2] text-[#1C1A14] rounded-xl p-6 max-w-md w-full max-h-[80vh] overflow-y-auto">
        <h3 className="text-lg font-bold mb-1">End session</h3>
        <p className="text-sm opacity-70 mb-4">
          Choose which tasks created in this session to keep. Existing tasks you added are always kept.
        </p>

        {!loaded ? (
          <p className="text-xs opacity-60 mb-4">Loading…</p>
        ) : candidates.length === 0 ? (
          <p className="text-xs italic opacity-60 mb-4">No session-created tasks to review.</p>
        ) : (
          <div className="space-y-2 mb-4">
            {candidates.map(c => (
              <label key={c.id} className="flex items-center gap-3 p-2 rounded-lg border border-black/10 cursor-pointer">
                <input
                  type="checkbox"
                  checked={keep[c.id] ?? true}
                  onChange={e => setKeep(prev => ({ ...prev, [c.id]: e.target.checked }))}
                />
                <span className="text-sm flex-1">{c.task?.title}</span>
                <span className="text-xs opacity-60">{keep[c.id] ? 'Keep' : 'Discard'}</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={ending} className="px-4 py-2 text-sm rounded-lg hover:opacity-70">
            Cancel
          </button>
          <button
            onClick={confirmEnd}
            disabled={ending || !loaded}
            className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white font-medium disabled:opacity-50"
          >
            {ending ? 'Ending…' : 'End session'}
          </button>
        </div>
      </div>
    </div>
  )
}
