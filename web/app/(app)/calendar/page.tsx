import { createClient } from '@/lib/supabase/server'
import { Task } from '@/lib/types'
import Link from 'next/link'

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; y?: string }>
}) {
  const { m, y } = await searchParams
  const now = new Date()
  const year = y ? parseInt(y) : now.getFullYear()
  const month = m ? parseInt(m) - 1 : now.getMonth() // 0-indexed

  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const firstStr = firstDay.toISOString().split('T')[0]
  const lastStr = lastDay.toISOString().split('T')[0]

  const supabase = await createClient()
  const { data } = await supabase
    .from('tasks')
    .select('id, title, due_date, task_type, status, rollover_count')
    .gte('due_date', firstStr)
    .lte('due_date', lastStr)
    .neq('status', 'rolled_over')
    .order('due_date')

  const tasks = (data as Task[]) ?? []

  // Group tasks by due_date
  const byDate: Record<string, Task[]> = {}
  for (const task of tasks) {
    if (!byDate[task.due_date]) byDate[task.due_date] = []
    byDate[task.due_date].push(task)
  }

  // Build calendar grid
  const startDow = firstDay.getDay() // 0=Sun
  const daysInMonth = lastDay.getDate()
  const cells: (number | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const prevMonth = new Date(year, month - 1, 1)
  const nextMonth = new Date(year, month + 1, 1)
  const todayStr = now.toISOString().split('T')[0]

  const monthLabel = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

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
              const events = dayTasks.filter(t => t.task_type === 'event')
              const regularTasks = dayTasks.filter(t => t.task_type === 'task')

              return (
                <div
                  key={di}
                  className={`min-h-24 p-2 ${di < 6 ? 'border-r border-gray-800' : ''} ${
                    isToday ? 'bg-indigo-950/30' : 'bg-gray-900'
                  }`}
                >
                  <div className={`text-xs font-medium mb-1.5 w-6 h-6 flex items-center justify-center rounded-full ${
                    isToday ? 'bg-indigo-600 text-white' : 'text-gray-400'
                  }`}>
                    {day}
                  </div>

                  {/* Event tasks — show title */}
                  {events.map(t => (
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

                  {/* Regular tasks — show dots */}
                  {regularTasks.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {regularTasks.map(t => (
                        <div
                          key={t.id}
                          title={t.title}
                          className={`w-1.5 h-1.5 rounded-full ${
                            t.status === 'done' ? 'bg-gray-600' : 'bg-indigo-500'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-4 text-xs text-gray-600">
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" /> Task</span>
        <span className="flex items-center gap-1.5"><span className="text-indigo-300">📅</span> Event</span>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-gray-600 inline-block" /> Done</span>
      </div>
    </div>
  )
}
