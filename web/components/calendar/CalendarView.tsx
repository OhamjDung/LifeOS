'use client'

import { useEffect, useMemo, useState } from 'react'
import { BlockColor, TASK_DRAG_TYPE, scheduledTaskMap } from '@/lib/calendar'
import { addDays, mondayOf, monthLabel, parseYmd, weekLabel, ymd } from '@/lib/planDates'
import { DayTask, WeekGrid } from './WeekGrid'
import { MonthGrid } from './MonthGrid'
import { BlockEditor } from './BlockEditor'
import { CalendarStatus } from './CalendarStatus'
import { useCalendarData } from './useCalendarData'

type Mode = 'week' | 'month'

function readMode(): Mode {
  try { return localStorage.getItem('calMode') === 'month' ? 'month' : 'week' } catch { return 'week' }
}

export function CalendarView() {
  const [mode, setModeState] = useState<Mode>('week')
  const [anchor, setAnchor] = useState(() => ymd(new Date()))
  const [tray, setTray] = useState<DayTask[]>([])
  const [trayQuery, setTrayQuery] = useState('')
  const [openBlock, setOpenBlock] = useState<string | null>(null)

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

  const {
    supabase, cal, calLoading, calError, loadCalendar, tasks, blocks, error, setError,
    createBlock, updateBlock, deleteBlock, assignTask, unassignTask,
  } = useCalendarData(rangeStart, rangeEnd)

  useEffect(() => {
    supabase.from('tasks').select('id,title,status,task_type,due_date')
      .eq('status', 'pending').eq('task_type', 'task').order('due_date').limit(300)
      .then(({ data }) => setTray((data as DayTask[]) ?? []))
  }, [supabase])

  function shift(n: number) {
    const a = parseYmd(anchor)
    setAnchor(mode === 'week' ? addDays(anchor, 7 * n) : ymd(new Date(a.getFullYear(), a.getMonth() + n, 1)))
  }

  const events = cal?.events ?? []
  const scheduled = scheduledTaskMap(blocks)
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

      <CalendarStatus cal={cal} calError={calError} error={error} onDismissError={() => setError(null)} />

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
              onUnassignTask={unassignTask}
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
                    title={scheduled.has(t.id) ? `In a time block at ${scheduled.get(t.id)}` : undefined}
                    className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg border cursor-grab active:cursor-grabbing hover:shadow-sm transition-colors ${
                      scheduled.has(t.id) ? 'task-scheduled' : 'bg-[#EAE7E0] border-black/5'
                    }`}
                  >
                    <span className="flex-1 truncate text-white">{t.title}</span>
                    {scheduled.has(t.id) && <span className="text-[9px] font-semibold text-indigo-950">◷ {scheduled.get(t.id)}</span>}
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
          onDelete={() => { deleteBlock(active.id); setOpenBlock(null) }}
          onUnassign={taskId => unassignTask(active.id, taskId)}
          onSave={patch => { updateBlock(active.id, patch as { title: string | null; color: BlockColor }); setOpenBlock(null) }}
        />
      )}
    </div>
  )
}
