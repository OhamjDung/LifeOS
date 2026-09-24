'use client'

import { useEffect, useState } from 'react'
import { BlockColor, scheduledTaskMap } from '@/lib/calendar'
import { useScheduledTasks } from '@/lib/scheduledTasks'
import { addDays, ymd } from '@/lib/planDates'
import { WeekGrid } from './WeekGrid'
import { BlockEditor } from './BlockEditor'
import { CalendarStatus } from './CalendarStatus'
import { useCalendarData } from './useCalendarData'

/**
 * Today-only time grid for the /tasks B screen. No task tray: rows in the
 * A-screen TaskList carry TASK_DRAG_TYPE, so they drop straight onto blocks.
 */
export function DayCalendar({ compact = false }: { compact?: boolean } = {}) {
  const [today] = useState(() => ymd(new Date()))
  const {
    cal, calLoading, calError, loadCalendar, tasks, blocks, error, setError,
    createBlock, updateBlock, deleteBlock, assignTask, unassignTask,
  } = useCalendarData(today, addDays(today, 1))
  const [openBlock, setOpenBlock] = useState<string | null>(null)
  const { setScheduled } = useScheduledTasks()
  useEffect(() => { setScheduled(scheduledTaskMap(blocks)) }, [blocks, setScheduled])
  const active = blocks.find(b => b.id === openBlock)

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          {compact ? (
            <p className="text-[11px] font-semibold tracking-wide text-gray-500">TODAY&apos;S SCHEDULE</p>
          ) : (
            <>
              <h2 className="text-xl font-bold text-white">Today</h2>
              <p className="text-gray-400 text-xs mt-1">Drag tasks from the list onto a time block.</p>
            </>
          )}
        </div>
        <span className="text-[10px] text-gray-500" aria-live="polite">
          {calLoading ? 'syncing…' : cal?.fetched_at ? `synced ${new Date(cal.fetched_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}
        </span>
        <button
          onClick={() => loadCalendar(true)}
          disabled={calLoading}
          title="Refresh Google Calendar now"
          className="px-2.5 py-1 text-xs border border-gray-700 rounded-lg text-gray-400 hover:text-white hover:bg-black/5 disabled:opacity-40"
        >
          ↻
        </button>
      </div>

      <CalendarStatus cal={cal} calError={calError} error={error} onDismissError={() => setError(null)} />

      <WeekGrid
        days={[today]}
        events={cal?.events ?? []}
        tasks={tasks}
        blocks={blocks}
        height={compact ? 'calc(100vh - 92px)' : 'calc(100dvh - 190px)'}
        onCreateBlock={createBlock}
        onUpdateBlock={updateBlock}
        onOpenBlock={setOpenBlock}
        onAssignTask={assignTask}
        onUnassignTask={unassignTask}
      />

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
