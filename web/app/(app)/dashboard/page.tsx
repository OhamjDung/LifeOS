import { createClient } from '@/lib/supabase/server'
import { Task, Contact, TIER_INTERVALS } from '@/lib/types'
import Link from 'next/link'

export default async function DashboardPage() {
  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]

  const [{ data: tasks }, { data: contacts }] = await Promise.all([
    supabase
      .from('tasks')
      .select('*')
      .eq('due_date', today)
      .neq('status', 'done')
      .order('created_at', { ascending: true }),
    supabase
      .from('contacts')
      .select('*')
      .order('last_contacted_at', { ascending: true })
      .limit(5),
  ])

  const pendingTasks = (tasks as Task[]) ?? []
  const recentContacts = (contacts as Contact[]) ?? []

  const now = new Date()
  const overdueContacts = recentContacts.filter(c => {
    if (!c.last_contacted_at) return true
    const daysSince = (now.getTime() - new Date(c.last_contacted_at).getTime()) / 86400000
    return daysSince > TIER_INTERVALS[c.relationship_tier]
  })

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </h2>
        <p className="text-gray-400 text-sm mt-1">Good to see you.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Today's Tasks */}
        <section className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">Today&apos;s tasks</h3>
            <Link href="/tasks" className="text-xs text-indigo-400 hover:text-indigo-300">
              View all →
            </Link>
          </div>

          {pendingTasks.length === 0 ? (
            <p className="text-gray-500 text-sm">No tasks today. Add one?</p>
          ) : (
            <ul className="space-y-2">
              {pendingTasks.map(task => (
                <li key={task.id} className="flex items-start gap-2 text-sm text-gray-300">
                  <span className="mt-0.5 text-gray-600">○</span>
                  <span>{task.title}</span>
                </li>
              ))}
            </ul>
          )}

          <Link
            href="/tasks"
            className="mt-4 block text-center text-xs py-2 rounded-lg border border-dashed border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600 transition-colors"
          >
            + Add task
          </Link>
        </section>

        {/* CRM Nudges */}
        <section className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">Reach out</h3>
            <Link href="/contacts" className="text-xs text-indigo-400 hover:text-indigo-300">
              All contacts →
            </Link>
          </div>

          {overdueContacts.length === 0 ? (
            <p className="text-gray-500 text-sm">You&apos;re all caught up!</p>
          ) : (
            <ul className="space-y-3">
              {overdueContacts.slice(0, 4).map(contact => (
                <li key={contact.id} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-indigo-900 flex items-center justify-center text-sm font-medium text-indigo-300 shrink-0">
                    {contact.name[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{contact.name}</p>
                    <p className="text-xs text-gray-500">
                      {contact.last_contacted_at
                        ? `${Math.floor((now.getTime() - new Date(contact.last_contacted_at).getTime()) / 86400000)}d ago`
                        : 'Never'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
