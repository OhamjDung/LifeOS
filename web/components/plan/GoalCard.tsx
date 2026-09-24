'use client'

import { PlanGoal } from '@/lib/types'
import { categoryColor, STATUS_META } from '@/lib/planGoals'

export function GoalCard({
  goal,
  parentTitle,
  spanLabel,
  highlighted,
  dimmed,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
  onDropBefore,
}: {
  goal: PlanGoal
  parentTitle?: string | null
  spanLabel?: string | null
  highlighted?: boolean
  dimmed?: boolean
  dragging?: boolean
  onOpen: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDropBefore: () => void
}) {
  const status = STATUS_META[goal.status]
  const color = categoryColor(goal.category)
  const done = goal.status === 'done'

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!goal.id.startsWith('temp-')}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart() }}
      onDragEnd={onDragEnd}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); e.stopPropagation(); onDropBefore() }}
      className={`group relative rounded-lg p-2.5 pl-3 cursor-pointer select-none animate-pop hover:-translate-y-px hover:shadow-md ${
        dragging ? 'opacity-40' : dimmed ? 'opacity-45' : ''
      } ${highlighted ? 'ring-2 ring-indigo-500' : ''}`}
      style={{
        background: '#EAE7E0',
        border: '1px solid rgba(28,26,20,0.1)',
        boxShadow: '1px 1px 3px rgba(107,99,88,0.12)',
      }}
    >
      <span aria-hidden className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full" style={{ background: color }} />
      <div className="flex items-start gap-2">
        <p className={`flex-1 text-[13px] leading-snug font-medium text-white ${done ? 'line-through opacity-60' : ''}`}>
          {goal.title}
        </p>
        <span
          className="shrink-0 text-[9px] font-semibold tracking-wide px-1.5 py-0.5 rounded"
          style={{ background: status.bg, color: status.fg }}
        >
          {status.label}
        </span>
      </div>
      {goal.description && (
        <p className="mt-1 text-[11px] leading-snug text-gray-500 line-clamp-2">{goal.description}</p>
      )}
      {(goal.category || parentTitle || spanLabel) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
          {goal.category && (
            <span className="px-1.5 py-0.5 rounded-full font-medium" style={{ background: `${color}22`, color }}>
              {goal.category}
            </span>
          )}
          {spanLabel && <span className="px-1.5 py-0.5 rounded-full bg-black/5 text-gray-500">{spanLabel}</span>}
          {parentTitle && <span className="text-gray-500 truncate max-w-full">↳ {parentTitle}</span>}
        </div>
      )}
    </div>
  )
}
