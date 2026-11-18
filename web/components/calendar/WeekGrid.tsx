'use client'

import { useEffect, useRef, useState } from 'react'
import {
  BLOCK_COLORS, CalEvent, TASK_DRAG_TYPE, TimeBlock, allDayDays, formatTime, layoutLanes,
} from '@/lib/calendar'
import { addDays, parseYmd, ymd } from '@/lib/planDates'

export type DayTask = { id: string; title: string; status: string; task_type: string; due_date: string }

const HOUR_PX = 48
const SNAP = 15
const DAY_MIN = 1440

type Drag =
  | { kind: 'create'; day: number; anchor: number; cur: number }
  | { kind: 'move'; id: string; day: number; start: number; dur: number; grab: number; moved: boolean; x0: number; y0: number }
  | { kind: 'resize'; id: string; day: number; start: number; end: number }
  | null

const snap = (m: number) => Math.round(m / SNAP) * SNAP
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function toIso(day: string, minute: number): string {
  const d = parseYmd(day)
  d.setMinutes(minute)
  return d.toISOString()
}

/** Minutes from local midnight of `day` to an instant — unclamped (negative = before, >1440 = a later day). */
function rawMin(iso: string, day: string): number {
  return Math.round((Date.parse(iso) - parseYmd(day).getTime()) / 60000)
}

/** Clock label for a minute offset; wraps, so -60 → 11pm and 1500 → 1am. */
function fmtMin(m: number): string {
  const w = ((Math.round(m) % DAY_MIN) + DAY_MIN) % DAY_MIN
  const h = Math.floor(w / 60), mm = w % 60
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${mm ? ':' + String(mm).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`
}

export function WeekGrid({
  days,
  events,
  tasks,
  blocks,
  onCreateBlock,
  onUpdateBlock,
  onOpenBlock,
  onAssignTask,
  onUnassignTask,
  height = 'min(70vh, 720px)',
  spanDays = 1,
}: {
  /** 1 (day view) to 7 (week view) consecutive days */
  days: string[]
  events: CalEvent[]
  tasks: DayTask[]
  blocks: TimeBlock[]
  onCreateBlock: (startIso: string, endIso: string, task?: { id: string; title: string }) => void
  onUpdateBlock: (id: string, patch: { start_at: string; end_at: string }) => void
  onOpenBlock: (id: string) => void
  onAssignTask: (blockId: string, task: { id: string; title: string }) => void
  onUnassignTask: (blockId: string, taskId: string) => void
  height?: string
  /** How many consecutive days each column runs through (2 = the column continues past midnight into the next day). */
  spanDays?: number
}) {
  const n = days.length
  const SPAN = spanDays * DAY_MIN
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag>(null)
  const [dropBlock, setDropBlock] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  const today = ymd(now)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_PX
    const t = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(t)
  }, [])

  function pos(e: { clientX: number; clientY: number }) {
    const rect = gridRef.current!.getBoundingClientRect()
    const day = clamp(Math.floor(((e.clientX - rect.left) / rect.width) * n), 0, n - 1)
    const minute = clamp(((e.clientY - rect.top) / HOUR_PX) * 60, 0, SPAN)
    return { day, minute }
  }

  // ── pointer interactions (pointer capture keeps events flowing outside the element) ──
  function onGridPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || e.target !== e.currentTarget) return
    const { day, minute } = pos(e)
    const m = clamp(Math.floor(minute / SNAP) * SNAP, 0, SPAN - SNAP)
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ kind: 'create', day, anchor: m, cur: m + SNAP })
  }
  function onBlockPointerDown(e: React.PointerEvent, b: TimeBlock, dayIdx: number, resize: boolean) {
    if (e.button !== 0 || b.id.startsWith('temp-')) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    // True (unclamped) offsets: a block that crosses midnight is drawn as a clipped
    // segment, but dragging it must keep its real start and length.
    const start = rawMin(b.start_at, days[dayIdx])
    const end = rawMin(b.end_at, days[dayIdx])
    if (resize) setDrag({ kind: 'resize', id: b.id, day: dayIdx, start, end })
    else setDrag({ kind: 'move', id: b.id, day: dayIdx, start, dur: end - start, grab: pos(e).minute - start, moved: false, x0: e.clientX, y0: e.clientY })
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return
    const p = pos(e)
    if (drag.kind === 'create') {
      setDrag({ ...drag, cur: clamp(snap(p.minute), 0, SPAN) })
    } else if (drag.kind === 'resize') {
      setDrag({ ...drag, end: clamp(snap(p.minute), Math.max(drag.start, 0) + SNAP, SPAN) })
    } else {
      const moved = drag.moved || Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) > 4
      // May hang over either edge of the column — that's how a block crosses midnight.
      setDrag({ ...drag, moved, day: p.day, start: clamp(snap(p.minute - drag.grab), SNAP - drag.dur, SPAN - SNAP) })
    }
  }
  function onPointerUp() {
    const d = drag
    setDrag(null)
    if (!d) return
    if (d.kind === 'create') {
      let start = Math.min(d.anchor, d.cur), end = Math.max(d.anchor, d.cur)
      // A plain click makes a 1-hour block, like Notion Calendar.
      // (Late at night it simply runs on past midnight.)
      if (end - start <= SNAP) end = start + 60
      if (end - start < SNAP) start = end - SNAP
      onCreateBlock(toIso(days[d.day], start), toIso(days[d.day], end))
    } else if (d.kind === 'resize') {
      onUpdateBlock(d.id, { start_at: toIso(days[d.day], d.start), end_at: toIso(days[d.day], d.end) })
    } else if (!d.moved) {
      onOpenBlock(d.id)
    } else {
      onUpdateBlock(d.id, { start_at: toIso(days[d.day], d.start), end_at: toIso(days[d.day], d.start + d.dur) })
    }
  }

  // ── task drag from the tray ──
  function onGridDrop(e: React.DragEvent) {
    const raw = e.dataTransfer.getData(TASK_DRAG_TYPE)
    if (!raw) return
    e.preventDefault()
    const task = JSON.parse(raw) as { id: string; title: string }
    const { day, minute } = pos(e)
    const start = clamp(Math.floor(minute / SNAP) * SNAP, 0, SPAN - SNAP)
    onCreateBlock(toIso(days[day], start), toIso(days[day], start + 60), task)
  }

  // ── what to draw per day ──
  const allDay = days.map(day => [
    ...events.filter(e => e.allDay && allDayDays(e).includes(day)).map(e => ({ key: `e-${e.uid}-${e.start}`, title: e.title, kind: 'ics' as const, done: false })),
    ...tasks.filter(t => t.due_date === day && t.task_type === 'event' && t.status !== 'done')
      .map(t => ({ key: `t-${t.id}`, title: t.title, kind: 'event' as const, done: false })),
  ])
  const hasAllDay = allDay.some(items => items.length > 0)

  type Item =
    | { kind: 'ics'; key: string; startMin: number; endMin: number; ev: CalEvent }
    | { kind: 'block'; key: string; startMin: number; endMin: number; block: TimeBlock; rawStart: number; rawEnd: number }
  const inCol = (m: number) => clamp(m, 0, SPAN)
  const perDay: Item[][] = days.map(day => {
    const items: Item[] = []
    for (const ev of events) {
      if (ev.allDay) continue
      const s = rawMin(ev.start, day), en = rawMin(ev.end, day)
      if (s >= SPAN || Math.max(en, s + 1) <= 0) continue
      const startMin = inCol(s)
      items.push({ kind: 'ics', key: `${ev.uid}-${ev.start}`, startMin, endMin: Math.max(startMin + 20, inCol(en)), ev })
    }
    for (const b of blocks) {
      if (drag && drag.kind !== 'create' && drag.id === b.id) continue // drawn as the drag preview
      const s = rawMin(b.start_at, day), en = rawMin(b.end_at, day)
      if (s >= SPAN || en <= 0) continue
      items.push({ kind: 'block', key: b.id, startMin: inCol(s), endMin: inCol(en), block: b, rawStart: s, rawEnd: en })
    }
    return items
  })

  function preview(): { day: number; start: number; end: number; block?: TimeBlock } | null {
    if (!drag) return null
    if (drag.kind === 'create') return { day: drag.day, start: Math.min(drag.anchor, drag.cur), end: Math.max(drag.anchor, drag.cur, Math.min(drag.anchor, drag.cur) + SNAP) }
    const block = blocks.find(b => b.id === drag.id)
    if (drag.kind === 'resize') return { day: drag.day, start: drag.start, end: drag.end, block }
    return { day: drag.day, start: drag.start, end: drag.start + drag.dur, block }
  }
  const pv = preview()

  function blockBody(b: TimeBlock | undefined, start: number, end: number) {
    const c = BLOCK_COLORS[b?.color ?? 'indigo'] ?? BLOCK_COLORS.indigo
    return { c, label: `${fmtMin(start)} – ${fmtMin(end)}` }
  }

  return (
    <div className="rounded-xl overflow-hidden border border-gray-800 bg-gray-900">
      <div className="overflow-x-auto">
        <div className={n > 1 ? 'min-w-[640px]' : ''}>
          {/* Header + all-day row */}
          <div className="grid border-b border-gray-800" style={{ gridTemplateColumns: `52px repeat(${n}, 1fr)` }}>
            <div />
            {days.map(day => {
              const d = parseYmd(day)
              const isToday = day === today
              return (
                <div key={day} className="px-1.5 py-2 text-center border-l border-gray-800">
                  <div className="text-[10px] tracking-wide text-gray-500">
                    {d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}
                  </div>
                  <div className={`mx-auto mt-0.5 w-7 h-7 flex items-center justify-center rounded-full text-sm font-semibold ${
                    isToday ? 'bg-indigo-600 text-[#DEDAD2]' : 'text-white'
                  }`}>
                    {d.getDate()}
                  </div>
                </div>
              )
            })}
            {hasAllDay && <div className="text-[9px] text-gray-500 text-right pr-1.5 pt-1.5 border-t border-gray-800">all-day</div>}
            {hasAllDay && allDay.map((items, i) => (
              <div key={days[i]} className="border-l border-t border-gray-800 p-1 space-y-0.5 min-h-7">
                {items.slice(0, 4).map(it => (
                  <div
                    key={it.key}
                    title={it.title}
                    className={`text-[10px] leading-tight px-1.5 py-0.5 rounded truncate animate-fade-in ${it.done ? 'line-through opacity-50' : ''}`}
                    style={
                      it.kind === 'ics' ? { background: 'var(--cal-ics-bg)', color: 'var(--cal-ics-fg)' }
                      : it.kind === 'event' ? { background: 'var(--cal-event-bg)', color: 'var(--cal-event-fg)' }
                      : { background: 'transparent', color: 'var(--cal-ics-fg)', border: '1px dashed var(--cal-dash)' }
                    }
                  >
                    {it.title}
                  </div>
                ))}
                {items.length > 4 && <div className="text-[9px] text-gray-500 px-1">+{items.length - 4} more</div>}
              </div>
            ))}
          </div>

          {/* Time grid */}
          <div ref={scrollRef} className="relative overflow-y-auto" style={{ height }}>
            <div className="grid" style={{ gridTemplateColumns: '52px 1fr' }}>
              <div className="relative" style={{ height: (SPAN / 60) * HOUR_PX }}>
                {Array.from({ length: SPAN / 60 }, (_, h) => (
                  <div key={h} className="absolute right-1.5 text-[10px] text-gray-500 -translate-y-1/2" style={{ top: h * HOUR_PX }}>
                    {h === 0 ? '' : fmtMin(h * 60)}
                  </div>
                ))}
              </div>
              <div
                ref={gridRef}
                className={`relative grid select-none touch-none ${drag?.kind === 'create' ? 'cursor-ns-resize' : 'cursor-crosshair'}`}
                style={{
                  gridTemplateColumns: `repeat(${n}, 1fr)`,
                  height: (SPAN / 60) * HOUR_PX,
                  backgroundImage: `repeating-linear-gradient(to bottom, var(--cal-line) 0 1px, transparent 1px ${HOUR_PX}px)`,
                }}
                onPointerDown={onGridPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => setDrag(null)}
                onDragOver={e => { if (e.dataTransfer.types.includes(TASK_DRAG_TYPE)) e.preventDefault() }}
                onDrop={onGridDrop}
              >
                {days.map((day, di) => (
                  <div key={day} className={`relative border-l border-gray-800 pointer-events-none ${day === today ? 'bg-indigo-900/15' : ''}`}>
                    {layoutLanes(perDay[di]).map(item => {
                      const top = (item.startMin / 60) * HOUR_PX
                      const height = Math.max(18, ((item.endMin - item.startMin) / 60) * HOUR_PX - 2)
                      const style = { top, height, left: `calc(${(item.lane / item.lanes) * 100}% + 2px)`, width: `calc(${100 / item.lanes}% - 4px)` }
                      if (item.kind === 'ics') {
                        return (
                          <div
                            key={item.key}
                            title={`${item.ev.title}\n${formatTime(item.ev.start)} – ${formatTime(item.ev.end)}${item.ev.location ? '\n' + item.ev.location : ''}`}
                            className="absolute rounded-md px-1.5 py-0.5 overflow-hidden text-[10px] leading-tight animate-fade-in"
                            style={{ ...style, background: 'var(--cal-ics-bg)', color: 'var(--cal-ics-fg)', borderLeft: '3px solid var(--cal-ics-edge)' }}
                          >
                            <div className="font-medium truncate">{item.ev.title}</div>
                            {height > 30 && <div className="opacity-70">{formatTime(item.ev.start)}</div>}
                          </div>
                        )
                      }
                      const b = item.block
                      const { c, label } = blockBody(b, item.rawStart, item.rawEnd)
                      // Continues below this column (next day in week view): the bottom edge isn't its real end.
                      const cutOff = item.rawEnd > SPAN
                      // Tasks split the block side by side: 1 task = full width, 2 = halves,
                      // 3 = thirds… Each column wraps its title; type shrinks as columns narrow.
                      const open = b.tasks.filter(t => t.status !== 'done')
                      const showTitle = !!b.title || open.length === 0
                      const showTime = height > 30
                      const avail = Math.max(0, height - 8 - (showTitle ? 13 : 0) - (showTime ? 12 : 0))
                      const maxFs = [16, 16, 13, 12, 11][open.length] ?? 10
                      const fs = open.length ? clamp(Math.floor(avail * 0.6), 9, maxFs) : 10
                      const lines = Math.max(1, Math.floor((avail - 2) / (fs * 1.25)))
                      return (
                        <div
                          key={item.key}
                          role="button"
                          tabIndex={0}
                          aria-label={`Time block ${b.title ?? ''} ${label}`}
                          onKeyDown={e => { if (e.key === 'Enter') onOpenBlock(b.id) }}
                          // move/up bubble to the grid's handlers (pointer capture keeps them coming)
                          onPointerDown={e => onBlockPointerDown(e, b, di, false)}
                          onDragOver={e => { if (e.dataTransfer.types.includes(TASK_DRAG_TYPE)) { e.preventDefault(); e.stopPropagation(); setDropBlock(b.id) } }}
                          onDragLeave={() => setDropBlock(null)}
                          onDrop={e => {
                            const raw = e.dataTransfer.getData(TASK_DRAG_TYPE)
                            setDropBlock(null)
                            if (!raw) return
                            e.preventDefault(); e.stopPropagation()
                            onAssignTask(b.id, JSON.parse(raw) as { id: string; title: string })
                          }}
                          className={`absolute rounded-md px-1.5 py-1 overflow-hidden text-[10px] leading-tight pointer-events-auto cursor-grab active:cursor-grabbing animate-pop ${
                            dropBlock === b.id ? 'ring-2 ring-offset-1 ring-indigo-600 scale-[1.02]' : ''
                          } ${b.id.startsWith('temp-') ? 'opacity-70' : ''}`}
                          style={{ ...style, background: c.bg, color: c.fg, borderLeft: `3px solid ${c.border}`, boxShadow: '0 1px 3px rgba(28,26,20,0.15)' }}
                        >
                          <div className="flex flex-col h-full">
                            {showTime && <div className="opacity-70 shrink-0">{label}</div>}
                            {showTitle && <div className="font-semibold truncate shrink-0">{b.title || 'Block'}</div>}
                            <div className="flex-1 min-h-0 flex">
                              {open.map((t, i) => (
                                <div
                                  key={t.id}
                                  className={`group/task relative flex-1 basis-0 min-w-0 flex animate-fade-in ${i > 0 ? 'border-l border-black/15 pl-1' : ''} ${i < open.length - 1 ? 'pr-1' : ''} ${open.length === 1 && !b.title ? 'items-center' : 'items-start'}`}
                                  style={{ fontSize: fs, lineHeight: 1.25 }}
                                  title={t.title}
                                >
                                  <span
                                    className={`flex-1 min-w-0 break-words overflow-hidden ${open.length === 1 ? 'font-semibold' : ''}`}
                                    style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: lines }}
                                  >
                                    {t.title}
                                  </span>
                                  <button
                                    type="button"
                                    // Don't let the press start a block move / open the editor.
                                    onPointerDown={e => e.stopPropagation()}
                                    onClick={e => { e.stopPropagation(); onUnassignTask(b.id, t.id) }}
                                    aria-label={`Remove ${t.title} from this block`}
                                    title="Remove from block"
                                    className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-[11px] leading-none hover:bg-black/15 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/task:opacity-100"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                          {!cutOff && (
                            <div
                              onPointerDown={e => onBlockPointerDown(e, b, di, true)}
                              className="absolute left-0 right-0 bottom-0 h-2 cursor-ns-resize"
                              aria-hidden
                            />
                          )}
                        </div>
                      )
                    })}
                    {Array.from({ length: spanDays - 1 }, (_, i) => {
                      const next = parseYmd(addDays(day, i + 1))
                      return (
                        <div key={i} className="absolute left-0 right-0 z-[5]" style={{ top: (i + 1) * 24 * HOUR_PX }}>
                          <div className="h-[2px] bg-gray-600" />
                          <div className="absolute right-1 -top-[9px] px-1.5 rounded bg-gray-900 border border-gray-700 text-[9px] font-semibold tracking-wide text-gray-400">
                            {next.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()} {next.getDate()}
                          </div>
                        </div>
                      )
                    })}
                    {pv && pv.day === di && (() => {
                      const { c, label } = blockBody(pv.block, pv.start, pv.end)
                      const pvTop = inCol(pv.start), pvBottom = inCol(pv.end)
                      return (
                        <div
                          className="absolute left-0.5 right-0.5 rounded-md px-1.5 py-1 text-[10px] z-10 overflow-hidden"
                          style={{
                            top: (pvTop / 60) * HOUR_PX, height: Math.max(12, ((pvBottom - pvTop) / 60) * HOUR_PX - 2),
                            background: c.bg, color: c.fg, border: `1.5px dashed ${c.border}`, opacity: 0.9,
                          }}
                        >
                          <div className="font-semibold truncate">{pv.block?.title ?? 'New block'}</div>
                          <div>{label}</div>
                        </div>
                      )
                    })()}
                    {(() => {
                      const nowMin = (now.getTime() - parseYmd(day).getTime()) / 60000
                      if (nowMin < 0 || nowMin >= SPAN) return null
                      return (
                        <div className="absolute left-0 right-0 z-10" style={{ top: (nowMin / 60) * HOUR_PX }}>
                          <div className="h-[2px] bg-red-600" />
                          <div className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-red-600" />
                        </div>
                      )
                    })()}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
