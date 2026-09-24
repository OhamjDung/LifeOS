import { createClient } from '@/lib/supabase/server'
import { Task, Contact } from '@/lib/types'
import { TaskList } from '@/components/TaskList'
import { TaskDetailPane } from '@/components/TaskDetailPane'
import { TaskSelectionProvider } from '@/lib/taskSelection'
import { DayCalendar } from '@/components/calendar/DayCalendar'
import { ScheduledTasksProvider } from '@/lib/scheduledTasks'

export default async function TasksPage() {
  const supabase = await createClient()
  const now = new Date()
  const today = now.toISOString().split('T')[0]

  // Auto-rollover past pending tasks (tasks only, not events)
  await supabase
    .from('tasks')
    .update({ due_date: today, status: 'pending', updated_at: new Date().toISOString() })
    .eq('status', 'pending')
    .eq('task_type', 'task')
    .lt('due_date', today)

  const [{ data: rawTasks }, { data: contacts }] = await Promise.all([
    supabase
      .from('tasks')
      .select('*, task_tags(tag_id, tags(id,name)), subtasks(*)')
      .eq('due_date', today)
      .neq('status', 'rolled_over')
      .order('rollover_count', { ascending: false })
      .order('created_at', { ascending: true })
      .order('sort_order', { foreignTable: 'subtasks', ascending: true }),
    supabase.from('contacts').select('id, name').order('name'),
  ])

  const tasks = (rawTasks ?? []).map((t: any) => ({
    ...t,
    tags: (t.task_tags ?? []).map((tt: any) => tt?.tags).filter(Boolean),
  })) as Task[]

  return (
    <TaskSelectionProvider>
    <ScheduledTasksProvider>
    <div className="flex flex-col lg:flex-row lg:h-screen">
      {/* Left: Task list */}
      <div
        className="w-full lg:w-1/2 shrink-0 p-4 sm:p-6 overflow-y-auto"
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

      {/* Right (B screen): today's time grid / Task detail */}
      <div className="w-full lg:w-1/2 p-4 sm:p-6 overflow-y-auto min-w-0">
      <TaskDetailPane>
        <DayCalendar />
      </TaskDetailPane>
      </div>
    </div>
    </ScheduledTasksProvider>
    </TaskSelectionProvider>
  )
}
