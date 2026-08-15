'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Candidate = { id: string; title: string }

export default function DeleteTasksModal({
  candidates,
  onClose,
  onConfirm,
}: {
  candidates: Candidate[]
  onClose: () => void
  onConfirm: (deletedIds: string[]) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(candidates.map(c => c.id)))
  const [deleting, setDeleting] = useState(false)
  const supabase = createClient()

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleConfirm() {
    const ids = [...selected]
    if (ids.length === 0) {
      onClose()
      return
    }
    setDeleting(true)
    const { error } = await supabase.from('tasks').delete().in('id', ids)
    setDeleting(false)
    if (error) {
      console.error('[DeleteTasksModal] delete error:', error.message)
      return
    }
    onConfirm(ids)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-red-900/50 bg-gray-900 flex flex-col max-h-[80vh]">
        <div className="px-5 py-4 border-b border-gray-800">
          <h3 className="text-lg font-bold text-white">Delete tasks</h3>
          <p className="text-xs text-gray-500 mt-1">Your braindump mentioned removing these. Uncheck any you want to keep.</p>
        </div>

        <div className="overflow-y-auto px-5 py-3 space-y-1">
          {candidates.map(c => {
            const checked = selected.has(c.id)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                className="w-full flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-gray-800 text-left transition-colors"
              >
                <span
                  className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px] ${
                    checked ? 'bg-red-600 border-red-500 text-[#DEDAD2]' : 'border-gray-600 text-transparent'
                  }`}
                >
                  ✓
                </span>
                <span className={`text-sm ${checked ? 'text-gray-300' : 'text-gray-600 line-through'}`}>
                  {c.title}
                </span>
              </button>
            )
          })}
        </div>

        <div className="px-5 py-4 border-t border-gray-800 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={deleting}
            className="px-5 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-[#DEDAD2] text-sm font-medium rounded-lg transition-colors"
          >
            {deleting ? 'Deleting…' : `Delete ${selected.size} task${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
