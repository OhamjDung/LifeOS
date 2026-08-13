'use client'

import { useState } from 'react'
import { Task } from '@/lib/types'
import Link from 'next/link'

const INITIAL_COUNT = 5

function TaskPreviewCard({ task }: { task: Task }) {
  const rolls = task.rollover_count ?? 0
  const isEvent = task.task_type === 'event'
  const dueStr = new Date(task.due_date + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 bg-gray-900 border rounded-xl ${
        rolls >= 3
          ? 'border-l-2 border-l-orange-500 border-gray-800'
          : isEvent
          ? 'border-indigo-900/60'
          : 'border-gray-800'
      }`}
    >
      <div
        className={`w-4 h-4 shrink-0 border-2 border-gray-600 ${
          isEvent ? 'rounded' : 'rounded-full'
        }`}
      />
      <span className="text-sm text-gray-200 flex-1 truncate">{task.title}</span>
      <div className="flex items-center gap-2 shrink-0 ml-2">
        <span className="text-xs text-gray-600">{dueStr}</span>
        {task.contact_id && !isEvent && (
          <span className="text-xs text-orange-400">● KEEP IN TOUCH</span>
        )}
        {rolls > 0 && !task.contact_id && (
          <span className={`text-xs ${rolls >= 3 ? 'text-orange-400' : 'text-gray-600'}`}>
            ↻{rolls}
          </span>
        )}
      </div>
    </div>
  )
}

export function DashboardUpNext({ tasks }: { tasks: Task[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? tasks : tasks.slice(0, INITIAL_COUNT)
  const hiddenCount = tasks.length - INITIAL_COUNT

  return (
    <div className="space-y-2">
      {tasks.length === 0 ? (
        <p className="text-gray-500 text-sm py-4 text-center">Nothing pending.</p>
      ) : (
        <>
          {visible.map(task => (
            <TaskPreviewCard key={task.id} task={task} />
          ))}
          {!expanded && hiddenCount > 0 && (
            <button
              onClick={() => setExpanded(true)}
              className="w-full text-center text-xs py-2 rounded-lg border border-dashed border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600 transition-colors"
            >
              See {hiddenCount} more task{hiddenCount !== 1 ? 's' : ''} →
            </button>
          )}
        </>
      )}
      <Link
        href="/tasks"
        className="block text-center text-xs py-2 rounded-lg border border-dashed border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600 transition-colors"
      >
        + Add task
      </Link>
    </div>
  )
}
