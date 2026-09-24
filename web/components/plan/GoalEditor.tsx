'use client'

import { useEffect, useState } from 'react'
import { GoalLevel, GoalStatus, PlanGoal } from '@/lib/types'
import { CATEGORY_PRESETS, STATUS_META, STATUS_ORDER, categoryColor } from '@/lib/planGoals'
import { addMonths, monthLabel } from '@/lib/planDates'
import { GoalPatch } from './usePlanGoals'

const LEVEL_NAME: Record<GoalLevel, string> = { year: 'Year goal', month: 'Month goal', week: 'Week item' }

export function GoalEditor({
  goal,
  level,
  periodLabel,
  parentOptions,
  parentLabel,
  onSave,
  onDelete,
  onClose,
}: {
  /** Existing goal to edit; omit to create. */
  goal?: PlanGoal
  level: GoalLevel
  periodLabel: string
  parentOptions: PlanGoal[]
  parentLabel: string
  onSave: (fields: GoalPatch & { title: string }) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(goal?.title ?? '')
  const [description, setDescription] = useState(goal?.description ?? '')
  const [category, setCategory] = useState(goal?.category ?? '')
  const [status, setStatus] = useState<GoalStatus>(goal?.status ?? 'not_started')
  const [parentId, setParentId] = useState(goal?.parent_id ?? '')
  const [periodEnd, setPeriodEnd] = useState(goal?.period_end ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function save() {
    if (!title.trim()) return
    const fields: GoalPatch & { title: string } = {
      title: title.trim(),
      description: description.trim() || null,
      category: category.trim() || null,
      status,
      parent_id: parentId || null,
    }
    if (level === 'month' && goal && periodEnd) fields.period_end = periodEnd
    onSave(fields)
  }

  const inputCls =
    'w-full bg-[#EAE7E0] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-indigo-500'

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4 animate-fade-in"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={goal ? `Edit ${LEVEL_NAME[level]}` : `New ${LEVEL_NAME[level]}`}
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-gray-900 border border-gray-700 p-5 space-y-3 animate-slide-up max-h-[90dvh] overflow-y-auto"
        style={{ boxShadow: '0 20px 50px rgba(28,26,20,0.25)' }}
      >
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-bold text-white">{goal ? 'Edit' : 'New'} {LEVEL_NAME[level].toLowerCase()}</h3>
          <span className="text-[11px] text-gray-500">{periodLabel}</span>
        </div>

        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save() }}
          placeholder="Title"
          className={inputCls}
        />
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Description (optional)"
          rows={3}
          className={`${inputCls} resize-none`}
        />

        <div>
          <label className="block text-[11px] text-gray-500 mb-1">Category</label>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {CATEGORY_PRESETS.map(c => {
              const active = category.toLowerCase() === c.toLowerCase()
              const color = categoryColor(c)
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(active ? '' : c)}
                  className="px-2 py-0.5 rounded-full text-[11px] font-medium border"
                  style={{
                    borderColor: color,
                    background: active ? color : 'transparent',
                    color: active ? '#F3F1EA' : color,
                  }}
                >
                  {c}
                </button>
              )
            })}
          </div>
          <input
            value={category}
            onChange={e => setCategory(e.target.value)}
            placeholder="…or type your own"
            className={inputCls}
          />
        </div>

        <div>
          <label className="block text-[11px] text-gray-500 mb-1">Status</label>
          <div className="flex gap-1.5">
            {STATUS_ORDER.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold tracking-wide border"
                style={{
                  background: status === s ? STATUS_META[s].bg : 'transparent',
                  color: STATUS_META[s].fg,
                  borderColor: status === s ? STATUS_META[s].fg : 'rgba(28,26,20,0.12)',
                }}
              >
                {STATUS_META[s].label}
              </button>
            ))}
          </div>
        </div>

        {level === 'month' && goal && (
          <div>
            <label className="block text-[11px] text-gray-500 mb-1">Runs through</label>
            <select value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className={inputCls}>
              {Array.from({ length: 12 }, (_, i) => addMonths(goal.period_start, i)).map(m => (
                <option key={m} value={m}>{monthLabel(m)}{m === goal.period_start ? ' (single month)' : ''}</option>
              ))}
            </select>
          </div>
        )}

        {level !== 'year' && (
          <div>
            <label className="block text-[11px] text-gray-500 mb-1">{parentLabel}</label>
            <select value={parentId} onChange={e => setParentId(e.target.value)} className={inputCls}>
              <option value="">— none —</option>
              {parentOptions.map(p => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          {onDelete && (
            confirmDelete ? (
              <button
                type="button"
                onClick={onDelete}
                className="px-3 py-2 rounded-lg text-xs font-medium bg-red-700 hover:bg-red-600 text-[#DEDAD2]"
              >
                Confirm delete
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="px-3 py-2 rounded-lg text-xs text-red-700 hover:bg-red-700/10"
              >
                Delete
              </button>
            )
          )}
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-xs text-gray-500 hover:text-white">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!title.trim()}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-[#DEDAD2] disabled:opacity-40"
          >
            {goal ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}
