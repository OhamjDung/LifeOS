import { createClient } from '@/lib/supabase/server'
import { Task, Contact } from '@/lib/types'
import { TaskList } from '@/components/TaskList'

export default async function TasksPage() {
  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]

  // Auto-rollover past pending tasks to today
  await supabase
    .from('tasks')
    .update({ due_date: today, status: 'pending', updated_at: new Date().toISOString() })
    .eq('status', 'pending')
    .lt('due_date', today)

  // Fetch today's tasks, sorted by rollover_count desc (higher = more urgent)
  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('due_date', today)
    .neq('status', 'rolled_over')
    .order('rollover_count', { ascending: false })
    .order('created_at', { ascending: true })

  // Fetch contacts for event task selector
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name')
    .order('name')

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Tasks</h2>
          <p className="text-gray-400 text-sm mt-1">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <a href="/calendar" className="text-xs text-indigo-400 hover:text-indigo-300 border border-gray-700 rounded-lg px-3 py-1.5">
          Calendar →
        </a>
      </div>

      <TaskList
        initialTasks={(tasks as Task[]) ?? []}
        contacts={(contacts as Pick<Contact, 'id' | 'name'>[]) ?? []}
        today={today}
      />
    </div>
  )
}
