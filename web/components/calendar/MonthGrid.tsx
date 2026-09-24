'use client'

import { CalEvent, TimeBlock, allDayDays, formatTime } from '@/lib/calendar'
import { parseYmd, ymd } from '@/lib/planDates'
import { DayTask } from './WeekGrid'

export function MonthGrid({
  days,
  monthKey,
  events,
  tasks,
  blocks,
  onPickDay,
}: {
  /** 42 days, Monday-first */
  days: string[]
  monthKey: string
  events: CalEvent[]
  tasks: DayTask[]
  blocks: TimeBlock[]
  onPickDay: (day: string) => void
}) {
  const today = ymd(new Date())
  const month = monthKey.slice(0, 7)

  const byDay = new Map<string, { key: string; label: string; tone: 'ics' | 'event' | 'block' }[]>()
  const push = (day: string, item: { key: string; label: string; tone: 'ics' | 'event' | 'block' }) => {
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day)!.push(item)
  }
  for (const e of events) {
    if (e.allDay) for (const d of allDayDays(e)) push(d, { key: `${e.uid}-${e.start}-${d}`, label: e.title, tone: 'ics' })
    else push(ymd(new Date(e.start)), { key: `${e.uid}-${e.start}`, label: `${formatTime(e.start)} ${e.title}`, tone: 'ics' })
  }
  for (const t of tasks) if (t.task_type === 'event' && t.status !== 'done') push(t.due_date, { key: t.id, label: t.title, tone: 'event' })
  for (const b of blocks) push(ymd(new Date(b.start_at)), { key: b.id, label: `${formatTime(b.start_at)} ${b.title || b.tasks[0]?.title || 'Block'}`, tone: 'block' })
  const openTasks = new Map<string, number>()
  for (const t of tasks) {
    if (t.task_type === 'task' && t.status === 'pending') openTasks.set(t.due_date, (openTasks.get(t.due_date) ?? 0) + 1)
  }

  const tones = {
    ics: { background: '#C9C6BD', color: '#3A3430' },
    event: { background: '#CDDBA6', color: '#2A3518' },
    block: { background: 'transparent', color: '#516439', border: '1px solid rgba(81,100,57,0.4)' },
  }

  return (
    <div className="rounded-xl overflow-hidden border border-gray-800 bg-gray-900">
      <div className="grid grid-cols-7 border-b border-gray-800">
        {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map(d => (
          <div key={d} className="text-center text-[10px] tracking-wide text-gray-500 py-1.5">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const items = byDay.get(day) ?? []
          const open = openTasks.get(day)
          const inMonth = day.slice(0, 7) === month
          const isToday = day === today
          return (
            <button
              key={day}
              onClick={() => onPickDay(day)}
              className={`text-left min-h-24 p-1 border-gray-800 hover:bg-black/5 ${i % 7 ? 'border-l' : ''} ${i >= 7 ? 'border-t' : ''} ${
                inMonth ? '' : 'opacity-45'
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${
                  isToday ? 'bg-indigo-600 text-[#DEDAD2]' : 'text-white'
                }`}>
                  {parseYmd(day).getDate()}
                </span>
                {open ? <span className="text-[9px] text-gray-500" title={`${open} open tasks`}>☐{open}</span> : null}
              </div>
              <div className="space-y-0.5">
                {items.slice(0, 3).map(it => (
                  <div key={it.key} className="text-[10px] leading-tight px-1 py-0.5 rounded truncate" style={tones[it.tone]}>
                    {it.label}
                  </div>
                ))}
                {items.length > 3 && <div className="text-[9px] text-gray-500 px-1">+{items.length - 3} more</div>}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
