import { createClient } from '@/lib/supabase/server'
import { Task } from '@/lib/types'
import Link from 'next/link'

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; y?: string; d?: string }>
}) {
  const { m, y, d } = await searchParams
  const now = new Date()
  const year = y ? parseInt(y) : now.getFullYear()
  const month = m ? parseInt(m) - 1 : now.getMonth()

  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const firstStr = firstDay.toISOString().split('T')[0]
  const lastStr = lastDay.toISOString().split('T')[0]
  const todayStr = now.toISOString().split('T')[0]
  const selectedDate = d ?? null

  const supabase = await createClient()
  const { data } = await supabase
    .from('tasks')
    .select('id, title, due_date, task_type, status, rollover_count')
    .gte('due_date', firstStr)
    .lte('due_date', lastStr)
    .neq('status', 'rolled_over')
    .order('due_date')

  const tasks = (data as Task[]) ?? []

  const byDate: Record<string, Task[]> = {}
  for (const task of tasks) {
    if (!byDate[task.due_date]) byDate[task.due_date] = []
    byDate[task.due_date].push(task)
  }

  const startDow = firstDay.getDay()
  const daysInMonth = lastDay.getDate()
  const cells: (number | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const prevMonth = new Date(year, month - 1, 1)
  const nextMonth = new Date(year, month + 1, 1)
  const monthLabel = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  const selectedTasks = selectedDate ? (byDate[selectedDate] ?? []) : []
  const selectedLabel = selectedDate
    ? new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : null

  function dayHref(day: number) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const base = `?m=${month + 1}&y=${year}&d=${dateStr}`
    return selectedDate === dateStr ? `?m=${month + 1}&y=${year}` : base
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">Calendar</h2>
          <p className="text-gray-400 text-sm mt-1">{monthLabel}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/calendar?m=${prevMonth.getMonth() + 1}&y=${prevMonth.getFullYear()}`}
            className="px-3 py-1.5 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-lg transition-colors"
          >
            ←
          </Link>
          <Link
            href={`/calendar?m=${now.getMonth() + 1}&y=${now.getFullYear()}`}
            className="px-3 py-1.5 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-lg transition-colors"
          >
            Today
          </Link>
          <Link
            href={`/calendar?m=${nextMonth.getMonth() + 1}&y=${nextMonth.getFullYear()}`}
            className="px-3 py-1.5 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-lg transition-colors"
          >
            →
          </Link>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="text-center text-xs text-gray-600 py-2 font-medium">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="border border-gray-800 rounded-xl overflow-hidden">
        {weeks.map((week, wi) => (
          <div key={wi} className={`grid grid-cols-7 ${wi < weeks.length - 1 ? 'border-b border-gray-800' : ''}`}>
            {week.map((day, di) => {
              if (!day) return (
                <div key={di} className={`min-h-24 p-2 bg-gray-950 ${di < 6 ? 'border-r border-gray-800' : ''}`} />
              )
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const dayTasks = byDate[dateStr] ?? []
              const isToday = dateStr === todayStr
              const isSelected = dateStr === selectedDate
              const events = dayTasks.filter(t => t.task_type === 'event')
              const regularTasks = dayTasks.filter(t => t.task_type === 'task')

              return (
                <Link
                  key={di}
                  href={dayHref(day)}
                  className={`min-h-24 p-2 block ${di < 6 ? 'border-r border-gray-800' : ''} transition-colors ${
                    isSelected ? 'bg-indigo-900/30' : isToday ? 'bg-indigo-950/30' : 'bg-gray-900 hover:bg-gray-800/50'
                  }`}
                >
                  <div className={`text-xs font-medium mb-1.5 w-6 h-6 flex items-center justify-center rounded-full ${
                    isSelected ? 'bg-indigo-500 text-[#DEDAD2]' : isToday ? 'bg-indigo-600 text-[#DEDAD2]' : 'text-gray-400'
                  }`}>
                    {day}
                  </div>

                  {events.slice(0, 2).map(t => (
                    <div
                      key={t.id}
                      className={`text-xs px-1.5 py-0.5 rounded mb-1 truncate ${
                        t.status === 'done'
                          ? 'bg-gray-800 text-gray-500 line-through'
                          : 'bg-indigo-900/50 text-indigo-300'
                      }`}
                      title={t.title}
                    >
                      📅 {t.title}
                    </div>
                  ))}

                  {regularTasks.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {regularTasks.slice(0, 5).map(t => (
                        <div
                          key={t.id}
                          title={t.title}
                          className={`w-1.5 h-1.5 rounded-full ${t.status === 'done' ? 'bg-gray-600' : 'bg-indigo-500'}`}
                        />
                      ))}
                    </div>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </div>

      {/* Selected day detail */}
      {selectedDate && (
        <div className="mt-6 bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="font-medium text-white mb-4">{selectedLabel}</h3>
          {selectedTasks.length === 0 ? (
            <p className="text-gray-500 text-sm">Nothing scheduled.</p>
          ) : (
            <div className="space-y-2">
              {selectedTasks.map(t => (
                <div key={t.id} className="flex items-center gap-3">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.status === 'done' ? 'bg-gray-600' : t.task_type === 'event' ? 'bg-indigo-400' : 'bg-indigo-500'}`} />
                  <span className={`text-sm ${t.status === 'done' ? 'line-through text-gray-500' : 'text-gray-200'}`}>
                    {t.task_type === 'event' && <span className="text-indigo-400 mr-1">📅</span>}
                    {t.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-4 text-xs text-gray-600">
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" /> Task</span>
        <span className="flex items-center gap-1.5"><span className="text-indigo-300">📅</span> Event</span>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-gray-600 inline-block" /> Done</span>
      </div>
    </div>
  )
}
