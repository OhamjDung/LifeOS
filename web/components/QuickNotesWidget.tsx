'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Draft {
  id: string
  text: string
}

const STORAGE_KEY = 'quickNotesDrafts'

function loadDrafts(): Draft[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Draft[]) : []
    return parsed.length > 0 ? parsed : [{ id: `draft-${Date.now()}`, text: '' }]
  } catch {
    return [{ id: `draft-${Date.now()}`, text: '' }]
  }
}

export function QuickNotesWidget() {
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const loaded = loadDrafts()
    setDrafts(loaded)
    setActiveId(loaded[0].id)
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts))
    } catch {
      // localStorage unavailable (private mode, quota) — draft just won't survive reload
    }
  }, [drafts, hydrated])

  const active = drafts.find(d => d.id === activeId)

  function updateActiveText(text: string) {
    setDrafts(prev => prev.map(d => (d.id === activeId ? { ...d, text } : d)))
  }

  function newTab() {
    const draft: Draft = { id: `draft-${Date.now()}`, text: '' }
    setDrafts(prev => [...prev, draft])
    setActiveId(draft.id)
  }

  function closeTab(id: string) {
    setDrafts(prev => {
      const next = prev.filter(d => d.id !== id)
      const final = next.length > 0 ? next : [{ id: `draft-${Date.now()}`, text: '' }]
      if (id === activeId) setActiveId(final[0].id)
      return final
    })
  }

  async function saveActive() {
    if (!active || !active.text.trim()) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('notes').insert({
      user_id: user?.id,
      content: active.text.trim(),
      source_platform: 'web',
    })
    setSaving(false)
    if (!error) closeTab(active.id)
  }

  if (!hydrated) return null

  return (
    <div
      className="fixed bottom-0 right-4 z-50 flex flex-col items-end"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {open && (
        <div
          className="mb-2 w-80 rounded-t-xl border border-gray-700 bg-gray-900 shadow-2xl flex flex-col"
          style={{ height: 320 }}
        >
          {/* Chrome-style tab strip */}
          <div className="flex items-center border-b border-gray-800 px-1 pt-1 gap-1 overflow-x-auto shrink-0">
            {drafts.map((d, i) => (
              <button
                key={d.id}
                onClick={() => setActiveId(d.id)}
                className={`group flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-t-lg whitespace-nowrap transition-colors ${
                  d.id === activeId
                    ? 'bg-gray-950 text-white'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <span className="max-w-[80px] truncate">{d.text.trim() || `Note ${i + 1}`}</span>
                <span
                  onClick={e => { e.stopPropagation(); closeTab(d.id) }}
                  className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                >
                  ✕
                </span>
              </button>
            ))}
            <button
              onClick={newTab}
              title="New draft"
              className="px-2 py-1 text-xs text-gray-500 hover:text-indigo-300"
            >
              +
            </button>
            <button
              onClick={() => setOpen(false)}
              title="Minimize"
              className="ml-auto px-2 py-1 text-xs text-gray-500 hover:text-white"
            >
              ⌄
            </button>
          </div>

          {/* Active draft textarea */}
          <textarea
            value={active?.text ?? ''}
            onChange={e => updateActiveText(e.target.value)}
            autoFocus
            placeholder="Jot something down..."
            className="flex-1 w-full resize-none bg-gray-950 text-gray-100 text-sm p-3 outline-none"
          />

          <div className="flex justify-end p-2 border-t border-gray-800 shrink-0">
            <button
              onClick={saveActive}
              disabled={saving || !active?.text.trim()}
              className="px-3 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-[#DEDAD2] font-medium transition-colors"
            >
              {saving ? 'Saving…' : 'Save to Notes'}
            </button>
          </div>
        </div>
      )}

      {/* Collapsed handle */}
      <button
        onClick={() => setOpen(v => !v)}
        title="Quick notes"
        className="mb-4 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[#DEDAD2] text-xs font-medium shadow-lg transition-all hover:pr-4"
      >
        📝{open ? '' : drafts.some(d => d.text.trim()) ? ` ${drafts.filter(d => d.text.trim()).length}` : ''}
      </button>
    </div>
  )
}
