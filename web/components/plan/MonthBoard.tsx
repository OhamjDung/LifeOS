'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { PlanGoal } from '@/lib/types'
import { addMonths, coversMonth, monthDiff, monthLabel, monthStart, shortMonth } from '@/lib/planDates'
import { categoryColor, reorderColumn, sortGoals, STATUS_META } from '@/lib/planGoals'
import { GoalPatch, usePlanGoals } from './usePlanGoals'
import { GoalCard } from './GoalCard'
import { GoalEditor } from './GoalEditor'
import { BoardColumn } from './BoardColumn'

type Editor =
  | { goal: PlanGoal }
  | { newLevel: 'year' | 'month'; period: string }
  | null

export function MonthBoard() {
  const thisMonth = monthStart(new Date())
  const [start, setStart] = useState(thisMonth)
  const [count, setCount] = useState(4)
  const [year, setYear] = useState(new Date().getFullYear())
  const [drag, setDrag] = useState<{ id: string; fromMonth: string } | null>(null)
  const [editor, setEditor] = useState<Editor>(null)
  const [hoverYearGoal, setHoverYearGoal] = useState<string | null>(null)

  // Year + month goals are a small personal dataset — load them all once.
  const { goals, loaded, error, setError, create, update, updateMany, remove } = usePlanGoals(
    sb => sb.from('plan_goals').select('*').in('level', ['year', 'month']),
    'year+month',
  )

  const yearGoals = useMemo(
    () => sortGoals(goals.filter(g => g.level === 'year' && g.period_start === `${year}-01-01`)),
    [goals, year],
  )
  const monthGoals = useMemo(() => goals.filter(g => g.level === 'month'), [goals])
  const byId = useMemo(() => new Map(goals.map(g => [g.id, g])), [goals])
  const months = Array.from({ length: count }, (_, i) => addMonths(start, i))

  function columnGoals(m: string, list = monthGoals) {
    return sortGoals(list.filter(g => coversMonth(g, m)))
  }

  function dropInto(monthKey: string, beforeId: string | null) {
    if (!drag) return
    const goal = byId.get(drag.id)
    setDrag(null)
    if (!goal || goal.level !== 'month') return
    const delta = monthDiff(drag.fromMonth, monthKey)
    const shift: GoalPatch = delta
      ? { period_start: addMonths(goal.period_start, delta), period_end: addMonths(goal.period_end, delta) }
      : {}
    const moved = { ...goal, ...shift }
    const after = monthGoals.map(g => (g.id === goal.id ? moved : g))
    const order = reorderColumn(columnGoals(monthKey, after), goal.id, beforeId)
    const patches = new Map<string, GoalPatch>()
    if (delta) patches.set(goal.id, shift)
    for (const o of order) patches.set(o.id, { ...patches.get(o.id), sort_order: o.sort_order })
    if (patches.size) updateMany([...patches].map(([id, patch]) => ({ id, patch })))
  }

  function quickAdd(monthKey: string, title: string) {
    const col = columnGoals(monthKey)
    create({
      level: 'month', title, period_start: monthKey, period_end: monthKey,
      sort_order: col.length ? Math.max(...col.map(g => g.sort_order)) + 10 : 0,
    })
  }

  const navBtn = 'px-2.5 py-1 text-sm border border-gray-700 rounded-lg text-gray-400 hover:text-white hover:bg-black/5'

  return (
    <div className="space-y-5">
      {error && (
        <div role="alert" className="flex items-center gap-3 text-xs text-red-800 bg-red-100/60 border border-red-300 rounded-lg px-3 py-2 animate-slide-up">
          <span className="flex-1">Couldn&apos;t save: {error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss error" className="px-1">×</button>
        </div>
      )}

      {/* ── Year strip ── */}
      <section
        className="rounded-xl p-3 sm:p-4"
        style={{ background: '#DEDAD2', border: '1px solid rgba(28,26,20,0.08)' }}
      >
        <div className="flex items-center gap-2 mb-2.5">
          <button onClick={() => setYear(y => y - 1)} className={navBtn} aria-label="Previous year">‹</button>
          <h3 className="text-sm font-bold text-white tracking-wide">{year} GOALS</h3>
          <button onClick={() => setYear(y => y + 1)} className={navBtn} aria-label="Next year">›</button>
          <span className="text-[11px] text-gray-500 ml-1 hidden sm:inline">month goals link up to these</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {yearGoals.map(g => {
            const linked = monthGoals.filter(m => m.parent_id === g.id).length
            const color = categoryColor(g.category)
            return (
              <button
                key={g.id}
                onClick={() => setEditor({ goal: g })}
                onMouseEnter={() => setHoverYearGoal(g.id)}
                onMouseLeave={() => setHoverYearGoal(null)}
                className={`flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-full text-xs border animate-pop ${
                  g.status === 'done' ? 'opacity-60 line-through' : ''
                }`}
                style={{ borderColor: `${color}66`, background: `${color}14`, color: '#1C1A14' }}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                <span className="font-medium">{g.title}</span>
                <span
                  className="text-[9px] font-semibold px-1 rounded"
                  style={{ background: STATUS_META[g.status].bg, color: STATUS_META[g.status].fg }}
                >
                  {STATUS_META[g.status].label}
                </span>
                <span className="text-[10px] text-gray-500" title="Month goals linked">{linked}↓</span>
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Delete ${g.title}`}
                  title="Delete"
                  onClick={e => { e.stopPropagation(); remove(g.id) }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); remove(g.id) } }}
                  className="-mr-1 w-4 h-4 flex items-center justify-center rounded-full text-gray-500 hover:text-red-700 hover:bg-red-700/10"
                >
                  ×
                </span>
              </button>
            )
          })}
          <button
            onClick={() => setEditor({ newLevel: 'year', period: `${year}-01-01` })}
            className="px-3 py-1.5 rounded-full text-xs border border-dashed border-gray-600 text-gray-500 hover:text-white hover:border-gray-400"
          >
            + year goal
          </button>
        </div>
      </section>

      {/* ── Month board ── */}
      <div className="flex items-center gap-2">
        <button onClick={() => setStart(s => addMonths(s, -1))} className={navBtn} aria-label="Earlier month">‹</button>
        <button onClick={() => { setStart(thisMonth); setCount(4) }} className={`${navBtn} text-xs`}>This month</button>
        <button onClick={() => setStart(s => addMonths(s, 1))} className={navBtn} aria-label="Later month">›</button>
        <span className="text-xs text-gray-500 ml-1">
          {monthLabel(months[0])} – {monthLabel(months[months.length - 1])}
        </span>
      </div>

      {!loaded ? (
        <div className="flex gap-3 overflow-hidden" aria-busy="true">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="w-64 h-48 shrink-0 rounded-xl bg-gray-900/70 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x">
          {months.map(m => {
            const col = columnGoals(m)
            return (
              <div key={m} className="snap-start">
                <BoardColumn
                  isCurrent={m === thisMonth}
                  canDrop={!!drag}
                  onDropAtEnd={() => dropInto(m, null)}
                  onQuickAdd={t => quickAdd(m, t)}
                  addLabel="+ add goal"
                  header={
                    <Link
                      href={`/plan/${m.slice(0, 7)}`}
                      className="btn-like group flex items-baseline justify-between rounded-md -mx-1 px-1 hover:bg-black/5"
                      title="Open week board"
                    >
                      <span className="text-sm font-bold text-white">
                        {monthLabel(m, m.slice(0, 4) !== thisMonth.slice(0, 4))}
                        <span className="ml-1.5 text-[11px] font-normal text-gray-500">{col.length}</span>
                      </span>
                      <span className="text-[11px] text-gray-500 group-hover:text-indigo-600">weeks →</span>
                    </Link>
                  }
                >
                  {col.map(g => {
                    const parent = g.parent_id ? byId.get(g.parent_id) : null
                    return (
                      <GoalCard
                        key={g.id}
                        goal={g}
                        parentTitle={parent?.title}
                        spanLabel={g.period_start !== g.period_end ? `${shortMonth(g.period_start)} → ${shortMonth(g.period_end)}` : null}
                        highlighted={!!hoverYearGoal && g.parent_id === hoverYearGoal}
                        dimmed={!!hoverYearGoal && g.parent_id !== hoverYearGoal}
                        dragging={drag?.id === g.id}
                        onOpen={() => setEditor({ goal: g })}
                        onDragStart={() => setDrag({ id: g.id, fromMonth: m })}
                        onDragEnd={() => setDrag(null)}
                        onDropBefore={() => dropInto(m, g.id)}
                        onDelete={() => remove(g.id)}
                      />
                    )
                  })}
                </BoardColumn>
              </div>
            )
          })}
          <button
            onClick={() => setCount(c => c + 3)}
            className="shrink-0 w-24 rounded-xl border border-dashed border-gray-600 text-xs text-gray-500 hover:text-white hover:border-gray-400"
          >
            + 3 more months
          </button>
        </div>
      )}

      {editor && (() => {
        const goal = 'goal' in editor ? editor.goal : undefined
        const level = goal ? (goal.level as 'year' | 'month') : (editor as { newLevel: 'year' | 'month' }).newLevel
        const period = goal ? goal.period_start : (editor as { period: string }).period
        const parentYear = Number(period.slice(0, 4))
        return (
          <GoalEditor
            goal={goal}
            level={level}
            periodLabel={level === 'year' ? period.slice(0, 4) : monthLabel(period)}
            parentLabel="Part of year goal"
            parentOptions={sortGoals(goals.filter(g => g.level === 'year' && g.period_start === `${parentYear}-01-01`))}
            onClose={() => setEditor(null)}
            onDelete={goal ? () => { remove(goal.id); setEditor(null) } : undefined}
            onSave={fields => {
              if (goal) update(goal.id, fields)
              else create({ ...fields, level, period_start: period, period_end: period, sort_order: yearGoals.length * 10 })
              setEditor(null)
            }}
          />
        )
      })()}
    </div>
  )
}
