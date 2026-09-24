'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ymd } from '@/lib/planDates'
import { DATA_CHANGED, notifyDataChanged } from '@/lib/chat'
import { TASK_DRAG_TYPE } from '@/lib/calendar'

type Row = { id: string; title: string; status: string; is_priority: boolean; rollover_count: number; due_date: string; task_type: string }

/**
 * The global task list, compact, for the pop-out timer: today + overdue pending
 * tasks and what's been finished today. Tick to complete, quick-add at the bottom.
 * Fires DATA_CHANGED so the /tasks page (if open) stays in sync.
 */
export function MiniTaskList() {
  const [supabase] = useState(createClient)
  const [rows, setRows] = useState<Row[]>([])
  const [loaded, setLoaded] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const adding = useRef(false)

  const load = useCallback(async () => {
    const today = ymd(new Date())
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
    const { data } = await supabase
      .from('tasks')
      .select('id,title,status,is_priority,rollover_count,due_date,task_type')
      .lte('due_date', today)
      .or(`status.eq.pending,and(status.eq.done,updated_at.gte.${dayStart.toISOString()})`)
      .order('is_priority', { ascending: false })
      .order('rollover_count', { ascending: false })
      .order('created_at')
    setRows((data as Row[]) ?? [])
    setLoaded(true)
  }, [supabase])

  useEffect(() => {
    // Fetch on mount; load() only sets state after its await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    window.addEventListener(DATA_CHANGED, load)
    return () => window.removeEventListener(DATA_CHANGED, load)
  }, [load])

  async function toggle(r: Row) {
    const status = r.status === 'done' ? 'pending' : 'done'
    setRows(prev => prev.map(x => (x.id === r.id ? { ...x, status } : x)))
    const { error } = await supabase.from('tasks').update({ status, updated_at: new Date().toISOString() }).eq('id', r.id)
    if (error) { setRows(prev => prev.map(x => (x.id === r.id ? r : x))); setError(error.message); return }
    notifyDataChanged()
  }

  async function add() {
    const title = draft.trim()
    if (!title || adding.current) return
    adding.current = true
    setDraft('')
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('tasks').insert({ user_id: user?.id, title, due_date: ymd(new Date()) })
    adding.current = false
    if (error) { setDraft(title); setError(error.message); return }
    await load()
    notifyDataChanged()
  }

  const pending = rows.filter(r => r.status !== 'done')
  const done = rows.filter(r => r.status === 'done')

  const renderItem = (r: Row) => {
    const isDone = r.status === 'done'
    return (
      <li
        key={r.id}
        draggable={!isDone}
        onDragStart={e => e.dataTransfer.setData(TASK_DRAG_TYPE, JSON.stringify({ id: r.id, title: r.title }))}
        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-900 border border-black/5 animate-fade-in ${isDone ? 'opacity-50' : ''}`}
      >
        <button
          onClick={() => toggle(r)}
          aria-label={`Mark "${r.title}" ${isDone ? 'pending' : 'done'}`}
          className={`w-4 h-4 shrink-0 rounded-full border-2 flex items-center justify-center ${
            isDone ? 'bg-indigo-600 border-indigo-600' : 'border-gray-600 hover:border-indigo-400'
          }`}
        >
          {isDone && <span className="text-[#DEDAD2] text-[9px] leading-none">✓</span>}
        </button>
        {r.is_priority && <span className="text-[11px] text-yellow-600">★</span>}
        <span className={`flex-1 min-w-0 truncate text-[13px] text-white ${isDone ? 'line-through' : ''}`}>{r.title}</span>
        {r.rollover_count > 0 && !isDone && (
          <span className={`text-[10px] ${r.rollover_count >= 3 ? 'text-orange-600' : 'text-gray-500'}`}>↻{r.rollover_count}</span>
        )}
      </li>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <p className="text-[11px] font-semibold tracking-wide text-gray-500 mb-2">
        TODAY&apos;S TASKS <span className="font-normal">· {pending.length} left{done.length ? `, ${done.length} done` : ''}</span>
      </p>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {!loaded ? (
          <div className="space-y-1.5" aria-busy="true">{[0, 1, 2].map(i => <div key={i} className="h-8 rounded-lg bg-gray-900/70 animate-pulse" />)}</div>
        ) : rows.length === 0 ? (
          <p className="text-xs text-gray-500 italic">Nothing due today.</p>
        ) : (
          <ul className="space-y-1">
            {pending.map(renderItem)}
            {done.map(renderItem)}
          </ul>
        )}
      </div>
      {error && <p role="alert" className="text-[11px] text-red-700 mt-1">{error}</p>}
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') add() }}
        placeholder="+ Add a task for today"
        className="mt-2 w-full bg-[#EAE7E0] border border-gray-700 rounded-lg px-2.5 py-1.5 text-[13px] text-white placeholder-gray-500 outline-none focus:border-indigo-500"
      />
    </div>
  )
}
