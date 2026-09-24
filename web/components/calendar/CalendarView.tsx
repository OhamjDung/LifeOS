'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BlockColor, CalendarResult, TimeBlock, fetchCalendar } from '@/lib/calendar'
import { addDays, mondayOf, monthLabel, parseYmd, weekLabel, ymd } from '@/lib/planDates'
import { DayTask, TASK_DRAG_TYPE, WeekGrid } from './WeekGrid'
import { MonthGrid } from './MonthGrid'
import { BlockEditor } from './BlockEditor'

type Mode = 'week' | 'month'
type BlockRow = Omit<TimeBlock, 'tasks'> & { time_block_tasks: { task_id: string; tasks: { id: string; title: string; status: string } | null }[] }

const POLL_MS = 15 * 60 * 1000

function readMode(): Mode {
  try { return localStorage.getItem('calMode') === 'month' ? 'month' : 'week' } catch { return 'week' }
}

export function CalendarView() {
  const [supabase] = useState(createClient)
  const [mode, setModeState] = useState<Mode>('week')
  const [anchor, setAnchor] = useState(() => ymd(new Date()))
  const [cal, setCal] = useState<CalendarResult | null>(null)
  const [calLoading, setCalLoading] = useState(false)
  const [calError, setCalError] = useState<string | null>(null)
  const [tasks, setTasks] = useState<DayTask[]>([])
  const [blocks, setBlocks] = useState<TimeBlock[]>([])
  const [tray, setTray] = useState<DayTask[]>([])
  const [trayQuery, setTrayQuery] = useState('')
  const [openBlock, setOpenBlock] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setModeState(readMode()) }, []) // eslint-disable-line react-hooks/set-state-in-effect -- localStorage only exists client-side
  const setMode = (m: Mode) => { setModeState(m); try { localStorage.setItem('calMode', m) } catch {} }

  // Visible range: a Mon–Sun week, or the 6-week grid around the anchor's month.
  const { days, monthKey } = useMemo(() => {
    const a = parseYmd(anchor)
    if (mode === 'week') {
      const mon = mondayOf(a)
      return { days: Array.from({ length: 7 }, (_, i) => addDays(mon, i)), monthKey: anchor.slice(0, 8) + '01' }
    }
    const mk = ymd(new Date(a.getFullYear(), a.getMonth(), 1))
    const first = mondayOf(parseYmd(mk))
    return { days: Array.from({ length: 42 }, (_, i) => addDays(first, i)), monthKey: mk }
  }, [anchor, mode])
  const rangeStart = days[0]
  const rangeEnd = addDays(days[days.length - 1], 1)

  const loadCalendar = useCallback(async (refresh = false) => {
    setCalLoading(true)
    try {
      const r = await fetchCalendar(parseYmd(rangeStart), parseYmd(rangeEnd), refresh)
      setCal(r)
      setCalError(r.error)
    } catch (e) {
      setCalError(e instanceof Error ? e.message : String(e))
    } finally {
      setCalLoading(false)
    }
  }, [rangeStart, rangeEnd])

  const loadLocal = useCallback(async () => {
    const [{ data: t }, { data: b }] = await Promise.all([
      supabase.from('tasks').select('id,title,status,task_type,due_date')
        .gte('due_date', rangeStart).lt('due_date', rangeEnd).neq('status', 'rolled_over'),
      supabase.from('time_blocks').select('*, time_block_tasks(task_id, tasks(id,title,status))')
        .gte('end_at', parseYmd(rangeStart).toISOString()).lt('start_at', parseYmd(rangeEnd).toISOString()),
    ])
    setTasks((t as DayTask[]) ?? [])
    setBlocks(((b as BlockRow[]) ?? []).map(({ time_block_tasks, ...rest }) => ({
      ...rest,
      tasks: time_block_tasks.map(x => x.tasks).filter((x): x is NonNullable<typeof x> => !!x),
    })))
  }, [supabase, rangeStart, rangeEnd])

  useEffect(() => {
    // Fetch-on-range-change: the synchronous setCalLoading(true) is the intended loading flag.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCalendar()
    loadLocal()
    const t = setInterval(() => loadCalendar(), POLL_MS)
    return () => clearInterval(t)
  }, [loadCalendar, loadLocal])

  useEffect(() => {
    supabase.from('tasks').select('id,title,status,task_type,due_date')
      .eq('status', 'pending').eq('task_type', 'task').order('due_date').limit(300)
      .then(({ data }) => setTray((data as DayTask[]) ?? []))
  }, [supabase])

  // ── block mutations (optimistic, roll back on failure) ──
  async function createBlock(start_at: string, end_at: string, task?: { id: string; title: string }) {
    setError(null)
    const tempId = `temp-${Math.random().toString(36).slice(2)}`
    const { data: { user } } = await supabase.auth.getUser()
    const optimistic: TimeBlock = {
      id: tempId, user_id: user?.id ?? '', title: null, start_at, end_at, color: 'indigo',
      created_at: new Date().toISOString(), tasks: task ? [{ id: task.id, title: task.title, status: 'pending' }] : [],
    }
    setBlocks(prev => [...prev, optimistic])
    const { data, error } = await supabase.from('time_blocks')
      .insert({ user_id: user?.id, start_at, end_at }).select('*').single()
    if (error || !data) {
      setBlocks(prev => prev.filter(b => b.id !== tempId))
      setError(error?.message ?? 'Could not create block')
      return
    }
    if (task) {
      const { error: linkErr } = await supabase.from('time_block_tasks').insert({ block_id: data.id, task_id: task.id, user_id: user?.id })
      if (linkErr) setError(linkErr.message)
    }
    setBlocks(prev => prev.map(b => (b.id === tempId ? { ...(data as TimeBlock), tasks: optimistic.tasks } : b)))
  }

  async function updateBlock(id: string, patch: Partial<Pick<TimeBlock, 'start_at' | 'end_at' | 'title' | 'color'>>) {
    setError(null)
    const before = blocks
    setBlocks(prev => prev.map(b => (b.id === id ? { ...b, ...patch } : b)))
    const { error } = await supabase.from('time_blocks').update(patch).eq('id', id)
    if (error) { setBlocks(before); setError(error.message) }
  }

  async function deleteBlock(id: string) {
    setError(null)
    const before = blocks
    setBlocks(prev => prev.filter(b => b.id !== id))
    setOpenBlock(null)
    const { error } = await supabase.from('time_blocks').delete().eq('id', id)
    if (error) { setBlocks(before); setError(error.message) }
  }

  async function assignTask(blockId: string, taskId: string) {
    const block = blocks.find(b => b.id === blockId)
    const task = tray.find(t => t.id === taskId) ?? tasks.find(t => t.id === taskId)
    if (!block || !task || block.tasks.some(t => t.id === taskId)) return
    setError(null)
    const before = blocks
    setBlocks(prev => prev.map(b => (b.id === blockId ? { ...b, tasks: [...b.tasks, { id: task.id, title: task.title, status: task.status }] } : b)))
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('time_block_tasks').insert({ block_id: blockId, task_id: taskId, user_id: user?.id })
    if (error) { setBlocks(before); setError(error.message) }
  }

  async function unassignTask(blockId: string, taskId: string) {
    setError(null)
    const before = blocks
    setBlocks(prev => prev.map(b => (b.id === blockId ? { ...b, tasks: b.tasks.filter(t => t.id !== taskId) } : b)))
    const { error } = await supabase.from('time_block_tasks').delete().eq('block_id', blockId).eq('task_id', taskId)
    if (error) { setBlocks(before); setError(error.message) }
  }

  function shift(n: number) {
    const a = parseYmd(anchor)
    setAnchor(mode === 'week' ? addDays(anchor, 7 * n) : ymd(new Date(a.getFullYear(), a.getMonth() + n, 1)))
  }

  const events = cal?.events ?? []
  const scheduled = new Set(blocks.flatMap(b => b.tasks.map(t => t.id)))
  const today = ymd(new Date())
  const trayShown = tray.filter(t => !trayQuery || t.title.toLowerCase().includes(trayQuery.toLowerCase()))
  const active = blocks.find(b => b.id === openBlock)
  const navBtn = 'px-2.5 py-1 text-sm border border-gray-700 rounded-lg text-gray-400 hover:text-white hover:bg-black/5'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => shift(-1)} className={navBtn} aria-label="Previous">‹</button>
        <button onClick={() => setAnchor(today)} className={`${navBtn} text-xs`}>Today</button>
        <button onClick={() => shift(1)} className={navBtn} aria-label="Next">›</button>
        <h3 className="text-sm font-bold text-white px-1">
          {mode === 'week' ? weekLabel(days[0]) : monthLabel(monthKey)}
        </h3>
        <div className="flex-1" />
        <span className="text-[10px] text-gray-500" aria-live="polite">
          {calLoading ? 'syncing…' : cal?.fetched_at ? `synced ${new Date(cal.fetched_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}
        </span>
        <button onClick={() => loadCalendar(true)} disabled={calLoading} className={`${navBtn} text-xs disabled:opacity-40`} title="Refresh Google Calendar now">↻</button>
        <div className="flex rounded-lg border border-gray-700 overflow-hidden text-xs" role="tablist">
          {(['week', 'month'] as Mode[]).map(m => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={`px-3 py-1 ${mode === m ? 'bg-indigo-600 text-[#DEDAD2]' : 'text-gray-400 hover:text-white'}`}>
              {m === 'week' ? 'Week' : 'Month'}
            </button>
          ))}
        </div>
      </div>

      {cal && !cal.configured && (
        <p className="text-xs text-gray-500 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 animate-fade-in">
          Google Calendar isn&apos;t connected. <Link href="/settings" className="text-indigo-600 underline">Add your iCal link in Settings</Link> to see your events here.
        </p>
      )}
      {calError && (
        <p role="alert" className="text-xs text-red-800 bg-red-100/60 border border-red-300 rounded-lg px-3 py-2 animate-slide-up">
          Calendar sync failed{cal?.stale && cal.events.length ? ' (showing last synced events)' : ''}: {calError}
        </p>
      )}
      {error && (
        <div role="alert" className="flex items-center gap-3 text-xs text-red-800 bg-red-100/60 border border-red-300 rounded-lg px-3 py-2 animate-slide-up">
          <span className="flex-1">Couldn&apos;t save: {error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss error" className="px-1">×</button>
        </div>
      )}

      {mode === 'month' ? (
        <MonthGrid days={days} monthKey={monthKey} events={events} tasks={tasks} blocks={blocks}
          onPickDay={d => { setAnchor(d); setMode('week') }} />
      ) : (
        <div className="flex flex-col xl:flex-row gap-3 items-start">
          <div className="flex-1 min-w-0 w-full">
            <WeekGrid
              days={days} events={events} tasks={tasks} blocks={blocks}
              onCreateBlock={createBlock}
              onUpdateBlock={updateBlock}
              onOpenBlock={setOpenBlock}
              onAssignTask={assignTask}
            />
            <p className="mt-1.5 text-[10px] text-gray-500">
              Click or drag on the grid to block time · drag a block to move, its bottom edge to resize · drop tasks onto a block to assign them.
            </p>
          </div>
          <aside className="w-full xl:w-60 shrink-0 rounded-xl bg-gray-900 border border-gray-800 p-2.5">
            <p className="text-[10px] font-bold tracking-wide text-white mb-1.5">TASKS → drag onto the grid</p>
            <input
              value={trayQuery}
              onChange={e => setTrayQuery(e.target.value)}
              placeholder="Filter…"
              className="w-full mb-2 bg-[#EAE7E0] border border-gray-700 rounded-lg px-2 py-1 text-xs text-white placeholder-gray-500 outline-none focus:border-indigo-500"
            />
            <ul className="space-y-1 max-h-[60vh] overflow-y-auto">
              {trayShown.map(t => {
                const overdue = t.due_date < today
                return (
                  <li
                    key={t.id}
                    draggable
                    onDragStart={e => {
                      e.dataTransfer.setData(TASK_DRAG_TYPE, JSON.stringify({ id: t.id, title: t.title }))
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    className="flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg bg-[#EAE7E0] border border-black/5 cursor-grab active:cursor-grabbing hover:shadow-sm"
                  >
                    <span className="flex-1 truncate text-white">{t.title}</span>
                    {scheduled.has(t.id) && <span title="Already in a block this view" className="text-indigo-600">◷</span>}
                    <span className={`text-[9px] ${overdue ? 'text-red-700' : 'text-gray-500'}`}>
                      {t.due_date === today ? 'today' : parseYmd(t.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </li>
                )
              })}
              {trayShown.length === 0 && <li className="text-xs text-gray-500 italic px-1">No pending tasks.</li>}
            </ul>
          </aside>
        </div>
      )}

      {active && (
        <BlockEditor
          key={active.id}
          block={active}
          onClose={() => setOpenBlock(null)}
          onDelete={() => deleteBlock(active.id)}
          onUnassign={taskId => unassignTask(active.id, taskId)}
          onSave={patch => { updateBlock(active.id, patch as { title: string | null; color: BlockColor }); setOpenBlock(null) }}
        />
      )}
    </div>
  )
}
