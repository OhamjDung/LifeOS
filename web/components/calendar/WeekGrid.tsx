'use client'

import { useEffect, useRef, useState } from 'react'
import {
  BLOCK_COLORS, CalEvent, TimeBlock, allDayDays, formatTime, layoutLanes, minutesInDay,
} from '@/lib/calendar'
import { parseYmd, ymd } from '@/lib/planDates'

export const TASK_DRAG_TYPE = 'application/x-lifeos-task'
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

function fmtMin(m: number): string {
  const h = Math.floor(m / 60), mm = m % 60
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${mm ? ':' + String(mm).padStart(2, '0') : ''}${h < 12 || h === 24 ? 'am' : 'pm'}`
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
}: {
  days: string[]
  events: CalEvent[]
  tasks: DayTask[]
  blocks: TimeBlock[]
  onCreateBlock: (startIso: string, endIso: string, task?: { id: string; title: string }) => void
  onUpdateBlock: (id: string, patch: { start_at: string; end_at: string }) => void
  onOpenBlock: (id: string) => void
  onAssignTask: (blockId: string, taskId: string) => void
}) {
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
    const day = clamp(Math.floor(((e.clientX - rect.left) / rect.width) * 7), 0, 6)
    const minute = clamp(((e.clientY - rect.top) / HOUR_PX) * 60, 0, DAY_MIN)
    return { day, minute }
  }

  // ── pointer interactions (pointer capture keeps events flowing outside the element) ──
  function onGridPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || e.target !== e.currentTarget) return
    const { day, minute } = pos(e)
    const m = clamp(Math.floor(minute / SNAP) * SNAP, 0, DAY_MIN - SNAP)
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ kind: 'create', day, anchor: m, cur: m + SNAP })
  }
  function onBlockPointerDown(e: React.PointerEvent, b: TimeBlock, dayIdx: number, resize: boolean) {
    if (e.button !== 0 || b.id.startsWith('temp-')) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const start = minutesInDay(b.start_at, days[dayIdx])
    const end = minutesInDay(b.end_at, days[dayIdx])
    if (resize) setDrag({ kind: 'resize', id: b.id, day: dayIdx, start, end })
    else setDrag({ kind: 'move', id: b.id, day: dayIdx, start, dur: end - start, grab: pos(e).minute - start, moved: false, x0: e.clientX, y0: e.clientY })
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return
    const p = pos(e)
    if (drag.kind === 'create') {
      setDrag({ ...drag, cur: clamp(snap(p.minute), 0, DAY_MIN) })
    } else if (drag.kind === 'resize') {
      setDrag({ ...drag, end: clamp(snap(p.minute), drag.start + SNAP, DAY_MIN) })
    } else {
      const moved = drag.moved || Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) > 4
      setDrag({ ...drag, moved, day: p.day, start: clamp(snap(p.minute - drag.grab), 0, DAY_MIN - drag.dur) })
    }
  }
  function onPointerUp() {
    const d = drag
    setDrag(null)
    if (!d) return
    if (d.kind === 'create') {
      let start = Math.min(d.anchor, d.cur), end = Math.max(d.anchor, d.cur)
      // A plain click makes a 1-hour block, like Notion Calendar.
      if (end - start <= SNAP) end = Math.min(DAY_MIN, start + 60)
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
    const start = clamp(Math.floor(minute / SNAP) * SNAP, 0, DAY_MIN - 60)
    onCreateBlock(toIso(days[day], start), toIso(days[day], start + 60), task)
  }

  // ── what to draw per day ──
  const allDay = days.map(day => [
    ...events.filter(e => e.allDay && allDayDays(e).includes(day)).map(e => ({ key: `e-${e.uid}-${e.start}`, title: e.title, kind: 'ics' as const, done: false })),
    ...tasks.filter(t => t.due_date === day).map(t => ({ key: `t-${t.id}`, title: t.title, kind: t.task_type === 'event' ? 'event' as const : 'task' as const, done: t.status === 'done' })),
  ])

  type Item =
    | { kind: 'ics'; key: string; startMin: number; endMin: number; ev: CalEvent }
    | { kind: 'block'; key: string; startMin: number; endMin: number; block: TimeBlock }
  const perDay: Item[][] = days.map(day => {
    const dayStart = parseYmd(day).getTime()
    const dayEnd = dayStart + DAY_MIN * 60000
    const items: Item[] = []
    for (const ev of events) {
      if (ev.allDay) continue
      const s = Date.parse(ev.start), en = Date.parse(ev.end)
      if (s >= dayEnd || Math.max(en, s + 1) <= dayStart) continue
      const startMin = minutesInDay(ev.start, day)
      items.push({ kind: 'ics', key: `${ev.uid}-${ev.start}`, startMin, endMin: Math.max(startMin + 20, minutesInDay(ev.end, day)), ev })
    }
    for (const b of blocks) {
      if (drag && drag.kind !== 'create' && drag.id === b.id) continue // drawn as the drag preview
      const s = Date.parse(b.start_at), en = Date.parse(b.end_at)
      if (s >= dayEnd || en <= dayStart) continue
      items.push({ kind: 'block', key: b.id, startMin: minutesInDay(b.start_at, day), endMin: minutesInDay(b.end_at, day), block: b })
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
        <div className="min-w-[640px]">
          {/* Header + all-day row */}
          <div className="grid border-b border-gray-800" style={{ gridTemplateColumns: '52px repeat(7, 1fr)' }}>
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
            <div className="text-[9px] text-gray-500 text-right pr-1.5 pt-1.5 border-t border-gray-800">all-day</div>
            {allDay.map((items, i) => (
              <div key={days[i]} className="border-l border-t border-gray-800 p-1 space-y-0.5 min-h-7">
                {items.slice(0, 4).map(it => (
                  <div
                    key={it.key}
                    title={it.title}
                    className={`text-[10px] leading-tight px-1.5 py-0.5 rounded truncate animate-fade-in ${it.done ? 'line-through opacity-50' : ''}`}
                    style={
                      it.kind === 'ics' ? { background: '#C9C6BD', color: '#3A3430' }
                      : it.kind === 'event' ? { background: '#CDDBA6', color: '#2A3518' }
                      : { background: 'transparent', color: '#3A3430', border: '1px dashed rgba(28,26,20,0.25)' }
                    }
                  >
                    {it.kind === 'task' ? '☐ ' : ''}{it.title}
                  </div>
                ))}
                {items.length > 4 && <div className="text-[9px] text-gray-500 px-1">+{items.length - 4} more</div>}
              </div>
            ))}
          </div>

          {/* Time grid */}
          <div ref={scrollRef} className="relative overflow-y-auto" style={{ height: 'min(70vh, 720px)' }}>
            <div className="grid" style={{ gridTemplateColumns: '52px 1fr' }}>
              <div className="relative" style={{ height: 24 * HOUR_PX }}>
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="absolute right-1.5 text-[10px] text-gray-500 -translate-y-1/2" style={{ top: h * HOUR_PX }}>
                    {h === 0 ? '' : fmtMin(h * 60)}
                  </div>
                ))}
              </div>
              <div
                ref={gridRef}
                className={`relative grid grid-cols-7 select-none touch-none ${drag?.kind === 'create' ? 'cursor-ns-resize' : 'cursor-crosshair'}`}
                style={{
                  height: 24 * HOUR_PX,
                  backgroundImage: `repeating-linear-gradient(to bottom, rgba(28,26,20,0.08) 0 1px, transparent 1px ${HOUR_PX}px)`,
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
                            style={{ ...style, background: '#C9C6BD', color: '#3A3430', borderLeft: '3px solid #8C877C' }}
                          >
                            <div className="font-medium truncate">{item.ev.title}</div>
                            {height > 30 && <div className="opacity-70">{formatTime(item.ev.start)}</div>}
                          </div>
                        )
                      }
                      const b = item.block
                      const { c, label } = blockBody(b, item.startMin, item.endMin)
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
                            onAssignTask(b.id, (JSON.parse(raw) as { id: string }).id)
                          }}
                          className={`absolute rounded-md px-1.5 py-1 overflow-hidden text-[10px] leading-tight pointer-events-auto cursor-grab active:cursor-grabbing animate-pop ${
                            dropBlock === b.id ? 'ring-2 ring-offset-1 ring-indigo-600 scale-[1.02]' : ''
                          } ${b.id.startsWith('temp-') ? 'opacity-70' : ''}`}
                          style={{ ...style, background: c.bg, color: c.fg, borderLeft: `3px solid ${c.border}`, boxShadow: '0 1px 3px rgba(28,26,20,0.15)' }}
                        >
                          <div className="font-semibold truncate">{b.title || (b.tasks[0]?.title ?? 'Block')}</div>
                          {height > 30 && <div className="opacity-70">{label}</div>}
                          {b.tasks.map(t => (
                            <div key={t.id} className={`truncate ${t.status === 'done' ? 'line-through opacity-50' : ''}`}>☐ {t.title}</div>
                          ))}
                          <div
                            onPointerDown={e => onBlockPointerDown(e, b, di, true)}
                            className="absolute left-0 right-0 bottom-0 h-2 cursor-ns-resize"
                            aria-hidden
                          />
                        </div>
                      )
                    })}
                    {pv && pv.day === di && (() => {
                      const { c, label } = blockBody(pv.block, pv.start, pv.end)
                      return (
                        <div
                          className="absolute left-0.5 right-0.5 rounded-md px-1.5 py-1 text-[10px] z-10"
                          style={{
                            top: (pv.start / 60) * HOUR_PX, height: Math.max(12, ((pv.end - pv.start) / 60) * HOUR_PX - 2),
                            background: c.bg, color: c.fg, border: `1.5px dashed ${c.border}`, opacity: 0.9,
                          }}
                        >
                          <div className="font-semibold truncate">{pv.block?.title ?? 'New block'}</div>
                          <div>{label}</div>
                        </div>
                      )
                    })()}
                    {day === today && (
                      <div className="absolute left-0 right-0 z-10" style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX }}>
                        <div className="h-[2px] bg-red-600" />
                        <div className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-red-600" />
                      </div>
                    )}
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
