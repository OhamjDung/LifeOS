import { createClient } from '@/lib/supabase/server'
import { Task, Contact } from '@/lib/types'
import { TaskList } from '@/components/TaskList'
import { TaskDetailPane } from '@/components/TaskDetailPane'
import { TaskSelectionProvider } from '@/lib/taskSelection'
import Link from 'next/link'

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; y?: string; d?: string }>
}) {
  const { m, y, d } = await searchParams
  const supabase = await createClient()
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const year = y ? parseInt(y) : now.getFullYear()
  const month = m ? parseInt(m) - 1 : now.getMonth()

  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const firstStr = firstDay.toISOString().split('T')[0]
  const lastStr = lastDay.toISOString().split('T')[0]
  const selectedDate = d ?? null

  // Auto-rollover past pending tasks (tasks only, not events)
  await supabase
    .from('tasks')
    .update({ due_date: today, status: 'pending', updated_at: new Date().toISOString() })
    .eq('status', 'pending')
    .eq('task_type', 'task')
    .lt('due_date', today)

  // Fetch all data in parallel after rollover
  const [{ data: rawTasks }, { data: contacts }, { data: calData }] = await Promise.all([
    supabase
      .from('tasks')
      .select('*, task_tags(tag_id, tags(id,name))')
      .eq('due_date', today)
      .neq('status', 'rolled_over')
      .order('rollover_count', { ascending: false })
      .order('created_at', { ascending: true }),
    supabase.from('contacts').select('id, name').order('name'),
    supabase
      .from('tasks')
      .select('id, title, due_date, task_type, status, rollover_count')
      .gte('due_date', firstStr)
      .lte('due_date', lastStr)
      .neq('status', 'rolled_over')
      .order('due_date'),
  ])

  const tasks = (rawTasks ?? []).map((t: any) => ({
    ...t,
    tags: (t.task_tags ?? []).map((tt: any) => tt?.tags).filter(Boolean),
  })) as Task[]

  const calTasks = (calData as Task[]) ?? []
  const byDate: Record<string, Task[]> = {}
  for (const task of calTasks) {
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
  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  const selectedTasks = selectedDate ? (byDate[selectedDate] ?? []) : []
  const selectedLabel = selectedDate
    ? new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : null

  function dayHref(day: number) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return selectedDate === dateStr
      ? `/tasks?m=${month + 1}&y=${year}`
      : `/tasks?m=${month + 1}&y=${year}&d=${dateStr}`
  }

  return (
    <TaskSelectionProvider>
    <div className="flex h-screen">
      {/* Left: Task list */}
      <div
        className="w-1/2 shrink-0 p-6 overflow-y-auto"
        style={{ borderRight: '1px solid rgba(28,26,20,0.1)' }}
      >
        <div className="mb-5">
          <h2 className="text-xl font-bold text-white">Tasks</h2>
          <p className="text-gray-400 text-xs mt-1">
            {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <TaskList
          initialTasks={tasks}
          contacts={(contacts as Pick<Contact, 'id' | 'name'>[]) ?? []}
          today={today}
        />
      </div>

      {/* Right: Calendar / Task detail */}
      <div className="w-1/2 p-6 overflow-y-auto min-w-0">
      <TaskDetailPane>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xl font-bold text-white">Calendar</h2>
            <p className="text-gray-400 text-xs mt-1">{monthLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/tasks?m=${prevMonth.getMonth() + 1}&y=${prevMonth.getFullYear()}`}
              className="px-2.5 py-1 text-sm border border-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors"
            >
              ←
            </Link>
            <Link
              href={`/tasks?m=${now.getMonth() + 1}&y=${now.getFullYear()}`}
              className="px-2.5 py-1 text-xs border border-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors"
            >
              Today
            </Link>
            <Link
              href={`/tasks?m=${nextMonth.getMonth() + 1}&y=${nextMonth.getFullYear()}`}
              className="px-2.5 py-1 text-sm border border-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors"
            >
              →
            </Link>
          </div>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((lbl, i) => (
            <div key={i} className="text-center text-xs text-gray-600 py-1 font-medium">
              {lbl}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="border border-gray-800 rounded-xl overflow-hidden">
          {weeks.map((week, wi) => (
            <div
              key={wi}
              className={`grid grid-cols-7 ${wi < weeks.length - 1 ? 'border-b border-gray-800' : ''}`}
            >
              {week.map((day, di) => {
                if (!day)
                  return (
                    <div
                      key={di}
                      className={`min-h-16 p-1 bg-gray-950 ${di < 6 ? 'border-r border-gray-800' : ''}`}
                    />
                  )
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                const dayTasks = byDate[dateStr] ?? []
                const isToday = dateStr === today
                const isSelected = dateStr === selectedDate
                const events = dayTasks.filter(t => t.task_type === 'event')
                const regularTasks = dayTasks.filter(t => t.task_type === 'task')

                return (
                  <Link
                    key={di}
                    href={dayHref(day)}
                    className={`min-h-16 p-1.5 block ${di < 6 ? 'border-r border-gray-800' : ''} transition-colors ${
                      isSelected
                        ? 'bg-indigo-900/30'
                        : isToday
                        ? 'bg-indigo-950/30'
                        : 'bg-gray-900 hover:bg-gray-800/50'
                    }`}
                  >
                    <div
                      className={`text-xs font-medium mb-1 w-5 h-5 flex items-center justify-center rounded-full ${
                        isSelected
                          ? 'bg-indigo-500 text-[#DEDAD2]'
                          : isToday
                          ? 'bg-indigo-600 text-[#DEDAD2]'
                          : 'text-gray-400'
                      }`}
                    >
                      {day}
                    </div>
                    {/* Events — show up to 2, then +N */}
                    {events.slice(0, 2).map(t => (
                      <div
                        key={t.id}
                        title={t.title}
                        className={`text-[10px] px-1 py-0.5 rounded mb-0.5 truncate ${
                          t.status === 'done'
                            ? 'bg-gray-800 text-gray-500 line-through'
                            : 'bg-indigo-900/50 text-indigo-300'
                        }`}
                      >
                        {t.title}
                      </div>
                    ))}
                    {events.length > 2 && (
                      <div className="text-[9px] text-indigo-400 px-1">
                        +{events.length - 2} more
                      </div>
                    )}
                    {/* Task dots — show up to 7, then +N */}
                    {regularTasks.length > 0 && (
                      <div className="flex flex-wrap items-center gap-0.5 mt-0.5">
                        {regularTasks.slice(0, 7).map(t => (
                          <div
                            key={t.id}
                            title={t.title}
                            className={`w-1.5 h-1.5 rounded-full ${
                              t.status === 'done' ? 'bg-gray-600' : 'bg-indigo-500'
                            }`}
                          />
                        ))}
                        {regularTasks.length > 7 && (
                          <span className="text-[9px] leading-none text-gray-500">
                            +{regularTasks.length - 7}
                          </span>
                        )}
                      </div>
                    )}
                  </Link>
                )
              })}
            </div>
          ))}
        </div>

        {/* Selected day panel */}
        {selectedDate && (
          <div
            className="mt-4 rounded-xl p-4"
            style={{
              background: '#DEDAD2',
              border: '1px solid rgba(28,26,20,0.1)',
              boxShadow: '2px 2px 6px rgba(107,99,88,0.1)',
            }}
          >
            <h3 className="font-medium text-sm mb-3" style={{ color: '#1C1A14' }}>
              {selectedLabel}
            </h3>
            {selectedTasks.length === 0 ? (
              <p className="text-xs" style={{ color: '#837C6F' }}>
                Nothing scheduled.
              </p>
            ) : (
              <div className="space-y-1.5">
                {selectedTasks.map(t => (
                  <div key={t.id} className="flex items-center gap-2">
                    <div
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        t.status === 'done'
                          ? 'bg-gray-600'
                          : t.task_type === 'event'
                          ? 'bg-indigo-400'
                          : 'bg-indigo-500'
                      }`}
                    />
                    <span
                      className={`text-xs ${t.status === 'done' ? 'line-through text-gray-500' : ''}`}
                      style={{ color: t.status === 'done' ? undefined : '#1C1A14' }}
                    >
                      {t.task_type === 'event' && (
                        <span className="text-indigo-400 mr-1">📅</span>
                      )}
                      {t.title}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-4 text-xs text-gray-600">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" /> Task
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-indigo-300">▬</span> Event
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-600 inline-block" /> Done
          </span>
        </div>
      </TaskDetailPane>
      </div>
    </div>
    </TaskSelectionProvider>
  )
}
