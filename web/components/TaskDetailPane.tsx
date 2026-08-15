'use client'

import { ReactNode } from 'react'
import { useTaskSelection } from '@/lib/taskSelection'

export function TaskDetailPane({ children }: { children: ReactNode }) {
  const { selected, select } = useTaskSelection()

  if (!selected) return <>{children}</>

  const isEvent = selected.task_type === 'event'
  const isDone = selected.status === 'done'
  const dueStr = new Date(selected.due_date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="relative">
      <button
        onClick={() => select(null)}
        title="Close and show calendar"
        className="absolute top-0 right-0 w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors z-10"
      >
        ✕
      </button>

      <div className="pr-10">
        <div className="flex items-start gap-2 mb-1">
          {isEvent && <span className="text-indigo-400 shrink-0 mt-0.5">📅</span>}
          <h2 className="text-xl font-bold text-white break-words min-w-0">{selected.title}</h2>
        </div>
        <p className="text-gray-400 text-xs mb-6">{dueStr}</p>

        <div
          className="rounded-xl p-4 space-y-3"
          style={{
            background: '#DEDAD2',
            border: '1px solid rgba(28,26,20,0.1)',
            boxShadow: '2px 2px 6px rgba(107,99,88,0.1)',
          }}
        >
          <DetailRow label="Type" value={isEvent ? 'Event' : 'Task'} />
          <DetailRow label="Status" value={isDone ? 'Done' : 'Pending'} />
          {(selected.rollover_count ?? 0) > 0 && (
            <DetailRow label="Rolled over" value={`${selected.rollover_count}x`} />
          )}
          {selected.tags?.[0] && <DetailRow label="Tag" value={selected.tags[0].name} />}
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span style={{ color: '#837C6F' }}>{label}</span>
      <span style={{ color: '#1C1A14' }}>{value}</span>
    </div>
  )
}
