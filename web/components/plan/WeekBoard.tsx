'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { PlanGoal } from '@/lib/types'
import { addMonths, coversMonth, mondayOf, monthLabel, weekLabel, weeksOfMonth } from '@/lib/planDates'
import { categoryColor, reorderColumn, sortGoals } from '@/lib/planGoals'
import { GoalPatch, usePlanGoals } from './usePlanGoals'
import { GoalCard } from './GoalCard'
import { GoalEditor } from './GoalEditor'
import { BoardColumn } from './BoardColumn'
import { TrashDropZone } from './TrashDropZone'

type Editor = { goal: PlanGoal } | { newLevel: 'week'; period: string } | { newLevel: 'month'; period: string } | null

export function WeekBoard({ monthKey }: { monthKey: string }) {
  const weeks = weeksOfMonth(monthKey)
  const thisWeek = mondayOf(new Date())
  const year = monthKey.slice(0, 4)
  const [drag, setDrag] = useState<string | null>(null)
  const [editor, setEditor] = useState<Editor>(null)
  const [focusGoal, setFocusGoal] = useState<string | null>(null)

  // This month's goals (incl. ones spanning into it), this year's goals for context,
  // and the week items of this month's weeks.
  const { goals, loaded, error, setError, create, update, updateMany, remove } = usePlanGoals(
    sb => sb
      .from('plan_goals')
      .select('*')
      .or(
        `and(level.eq.year,period_start.eq.${year}-01-01),` +
        `and(level.eq.month,period_start.lte.${monthKey},period_end.gte.${monthKey}),` +
        `and(level.eq.week,period_start.gte.${weeks[0]},period_start.lte.${weeks[weeks.length - 1]})`,
      ),
    monthKey,
  )

  const byId = useMemo(() => new Map(goals.map(g => [g.id, g])), [goals])
  const monthGoals = useMemo(
    () => sortGoals(goals.filter(g => g.level === 'month' && coversMonth(g, monthKey))),
    [goals, monthKey],
  )
  const yearGoals = useMemo(() => sortGoals(goals.filter(g => g.level === 'year')), [goals])
  const weekItems = useMemo(() => goals.filter(g => g.level === 'week'), [goals])
  const linkCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const w of weekItems) if (w.parent_id) counts.set(w.parent_id, (counts.get(w.parent_id) ?? 0) + 1)
    return counts
  }, [weekItems])
  const maxCount = Math.max(1, ...monthGoals.map(g => linkCounts.get(g.id) ?? 0))

  function column(monday: string, list = weekItems) {
    return sortGoals(list.filter(g => g.period_start === monday))
  }

  function dropInto(monday: string, beforeId: string | null) {
    if (!drag) return
    const goal = byId.get(drag)
    setDrag(null)
    if (!goal || goal.level !== 'week') return
    const moved = goal.period_start !== monday
    const after = weekItems.map(g => (g.id === goal.id ? { ...g, period_start: monday, period_end: monday } : g))
    const patches = new Map<string, GoalPatch>()
    if (moved) patches.set(goal.id, { period_start: monday, period_end: monday })
    for (const o of reorderColumn(column(monday, after), goal.id, beforeId)) {
      patches.set(o.id, { ...patches.get(o.id), sort_order: o.sort_order })
    }
    if (patches.size) updateMany([...patches].map(([id, patch]) => ({ id, patch })))
  }

  function quickAdd(monday: string, title: string) {
    const col = column(monday)
    create({
      level: 'week', title, period_start: monday, period_end: monday,
      // Adding while a month goal is focused links the item to it.
      parent_id: focusGoal,
      sort_order: col.length ? Math.max(...col.map(g => g.sort_order)) + 10 : 0,
    })
  }

  const prev = addMonths(monthKey, -1).slice(0, 7)
  const next = addMonths(monthKey, 1).slice(0, 7)
  const navBtn = 'btn-like px-2.5 py-1 text-sm border border-gray-700 rounded-lg text-gray-400 hover:text-white hover:bg-black/5'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/plan" className={`${navBtn} text-xs`}>← Months</Link>
        <Link href={`/plan/${prev}`} className={navBtn} aria-label="Previous month">‹</Link>
        <h2 className="text-xl font-bold text-white px-1">{monthLabel(monthKey)}</h2>
        <Link href={`/plan/${next}`} className={navBtn} aria-label="Next month">›</Link>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-3 text-xs text-red-800 bg-red-100/60 border border-red-300 rounded-lg px-3 py-2 animate-slide-up">
          <span className="flex-1">Couldn&apos;t save: {error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss error" className="px-1">×</button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* ── Pinned month goals ── */}
        <aside
          className="w-full lg:w-72 shrink-0 lg:order-2 lg:sticky lg:top-4 rounded-xl p-3"
          style={{ background: '#DEDAD2', border: '1px solid rgba(28,26,20,0.08)' }}
        >
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="text-xs font-bold tracking-wide text-white">THIS MONTH&apos;S GOALS</h3>
            <span className="text-[10px] text-gray-500">week items linked</span>
          </div>
          <p className="text-[10px] text-gray-500 mb-2.5">Click a goal to focus it. New items then link to it.</p>
          {!loaded ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2].map(i => <div key={i} className="h-10 rounded-lg bg-gray-900/70 animate-pulse" />)}
            </div>
          ) : monthGoals.length === 0 ? (
            <p className="text-xs text-gray-500 italic mb-2">No goals for this month yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {monthGoals.map(g => {
                const n = linkCounts.get(g.id) ?? 0
                const focused = focusGoal === g.id
                const color = categoryColor(g.category)
                return (
                  <li key={g.id}>
                    <button
                      onClick={() => setFocusGoal(focused ? null : g.id)}
                      onDoubleClick={() => setEditor({ goal: g })}
                      aria-pressed={focused}
                      className={`w-full text-left rounded-lg px-2.5 py-2 border animate-pop ${
                        focused ? 'border-indigo-500 bg-indigo-900/40' : 'border-transparent hover:bg-black/5'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                        <span className={`flex-1 text-xs font-medium text-white ${g.status === 'done' ? 'line-through opacity-60' : ''}`}>
                          {g.title}
                        </span>
                        <span
                          className={`text-[11px] font-semibold tabular-nums ${n === 0 ? 'text-red-700' : 'text-gray-500'}`}
                          title={n === 0 ? 'Nothing planned for this goal yet' : `${n} week items`}
                        >
                          {n}
                        </span>
                      </div>
                      {/* Distribution bar — an empty one means the goal isn't getting any weeks. */}
                      <div className="mt-1.5 ml-4 h-1 rounded-full bg-black/5 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-[width] duration-300"
                          style={{ width: `${(n / maxCount) * 100}%`, background: color }}
                        />
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={() => setEditor({ newLevel: 'month', period: monthKey })}
              className="text-xs text-gray-500 hover:text-white px-1 py-1"
            >
              + month goal
            </button>
            {focusGoal && byId.get(focusGoal) && (
              <button onClick={() => setEditor({ goal: byId.get(focusGoal)! })} className="text-xs text-gray-500 hover:text-white px-1 py-1">
                edit focused
              </button>
            )}
          </div>
          {yearGoals.length > 0 && (
            <div className="mt-3 pt-3 border-t border-black/10">
              <p className="text-[10px] font-bold tracking-wide text-gray-500 mb-1.5">{year}</p>
              <div className="flex flex-wrap gap-1">
                {yearGoals.map(g => (
                  <span
                    key={g.id}
                    className="text-[10px] px-1.5 py-0.5 rounded-full"
                    style={{ background: `${categoryColor(g.category)}1f`, color: '#3A3430' }}
                  >
                    {g.title}
                  </span>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* ── Week columns ── */}
        <div className="flex gap-3 overflow-x-auto pb-4 w-full min-w-0 lg:order-1 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x">
          {weeks.map((monday, wi) => {
            const col = column(monday)
            return (
              <div key={monday} className="snap-start">
                <BoardColumn
                  isCurrent={monday === thisWeek}
                  canDrop={!!drag}
                  onDropAtEnd={() => dropInto(monday, null)}
                  onQuickAdd={t => quickAdd(monday, t)}
                  addLabel={focusGoal ? `+ add → ${byId.get(focusGoal)?.title ?? ''}` : '+ add'}
                  header={
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-bold text-white">Week {wi + 1}</span>
                      <span className="text-[11px] text-gray-500">{weekLabel(monday)}</span>
                    </div>
                  }
                >
                  {col.map(g => {
                    const parent = g.parent_id ? byId.get(g.parent_id) : null
                    return (
                      <GoalCard
                        key={g.id}
                        goal={g}
                        parentTitle={parent?.title}
                        highlighted={!!focusGoal && g.parent_id === focusGoal}
                        dimmed={!!focusGoal && g.parent_id !== focusGoal}
                        dragging={drag === g.id}
                        onOpen={() => setEditor({ goal: g })}
                        onDragStart={() => setDrag(g.id)}
                        onDragEnd={() => setDrag(null)}
                        onDropBefore={() => dropInto(monday, g.id)}
                        onDelete={() => remove(g.id)}
                      />
                    )
                  })}
                </BoardColumn>
              </div>
            )
          })}
        </div>
      </div>

      <TrashDropZone
        dragging={!!drag}
        onDrop={() => { if (drag) remove(drag); setDrag(null) }}
      />

      {editor && (() => {
        const goal = 'goal' in editor ? editor.goal : undefined
        const level = goal ? goal.level : (editor as { newLevel: 'week' | 'month' }).newLevel
        const period = goal ? goal.period_start : (editor as { period: string }).period
        return (
          <GoalEditor
            goal={goal}
            level={level}
            periodLabel={level === 'week' ? weekLabel(period) : level === 'month' ? monthLabel(period) : period.slice(0, 4)}
            parentLabel={level === 'week' ? 'Part of month goal' : 'Part of year goal'}
            parentOptions={level === 'week' ? monthGoals : yearGoals}
            onClose={() => setEditor(null)}
            onDelete={goal ? () => { remove(goal.id); if (focusGoal === goal.id) setFocusGoal(null); setEditor(null) } : undefined}
            onSave={fields => {
              if (goal) update(goal.id, fields)
              else create({ ...fields, level, period_start: period, period_end: period, sort_order: monthGoals.length * 10 })
              setEditor(null)
            }}
          />
        )
      })()}
    </div>
  )
}
