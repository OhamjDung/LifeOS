import { createClient } from '@/lib/supabase/server'
import { Task, Contact, CONTACT_TIER_DAYS, ContactTier } from '@/lib/types'
import Link from 'next/link'

export default async function DashboardPage() {
  const supabase = await createClient()
  const today = new Date().toISOString().split('T')[0]

  const [{ data: allTodayTasks }, { data: contacts }] = await Promise.all([
    supabase
      .from('tasks')
      .select('*')
      .eq('due_date', today)
      .neq('status', 'rolled_over')
      .order('rollover_count', { ascending: false })
      .order('created_at', { ascending: true }),
    supabase
      .from('contacts')
      .select('*'),
  ])

  const tasks = (allTodayTasks as Task[]) ?? []
  const allContacts = (contacts as Contact[]) ?? []

  const pending = tasks.filter(t => t.status === 'pending')
  const done = tasks.filter(t => t.status === 'done')

  const now = Date.now()
  const overdueContacts = allContacts
    .filter(c => {
      const tierDays = CONTACT_TIER_DAYS[(c.contact_tier ?? 'weekly') as ContactTier]
      const days = c.last_contacted_at
        ? Math.floor((now - new Date(c.last_contacted_at).getTime()) / 86400000)
        : tierDays + 1
      return days >= tierDays
    })
    .sort((a, b) => {
      const dA = a.last_contacted_at ? Math.floor((now - new Date(a.last_contacted_at).getTime()) / 86400000) : 999
      const dB = b.last_contacted_at ? Math.floor((now - new Date(b.last_contacted_at).getTime()) / 86400000) : 999
      return dB - dA
    })

  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Good morning.</h2>
        <p className="text-gray-400 text-sm mt-1">{dateLabel}</p>
      </div>

      {/* LCD metrics */}
      <div className="grid grid-cols-3 rounded-2xl overflow-hidden mb-6" style={{ background: '#2A2F29', border: '1px solid rgba(28,26,20,0.2)' }}>
        {([
          ['TASKS',     pending.length,           'text-[#CDDBA6]'],
          ['DONE',      done.length,              'text-[#9FE3B0]'],
          ['REACH OUT', overdueContacts.length,   'text-[#ECA06A]'],
        ] as [string, number, string][]).map(([label, val, color], i) => (
          <div key={label} className={`flex flex-col items-center py-5 ${i > 0 ? 'border-l border-[#CDDBA6]/15' : ''}`}>
            <span className={`font-mono text-4xl font-bold ${color}`}>
              {String(val).padStart(2, '0')}
            </span>
            <span className="text-xs tracking-widest mt-2" style={{ color: 'rgba(205,219,166,0.5)' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Up next */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Up next</h3>
          <Link href="/tasks" className="text-xs text-indigo-400 hover:text-indigo-300">ALL TASKS →</Link>
        </div>
        {pending.length === 0 ? (
          <p className="text-gray-500 text-sm py-4 text-center">Nothing pending.</p>
        ) : (
          <div className="space-y-2">
            {pending.slice(0, 4).map(task => {
              const rolls = task.rollover_count ?? 0
              const isEvent = task.task_type === 'event'
              return (
                <div key={task.id} className={`flex items-center gap-3 px-4 py-3 bg-gray-900 border rounded-xl ${
                  rolls >= 3 ? 'border-l-2 border-l-orange-500 border-gray-800' : isEvent ? 'border-indigo-900/60' : 'border-gray-800'
                }`}>
                  <div className={`w-4 h-4 shrink-0 rounded-${isEvent ? 'sm' : 'full'} border-2 border-gray-600`} />
                  <span className="text-sm text-gray-200 flex-1 truncate">{task.title}</span>
                  {task.contact_id && !isEvent && (
                    <span className="text-xs text-orange-400 shrink-0">● KEEP IN TOUCH</span>
                  )}
                  {rolls > 0 && !task.contact_id && (
                    <span className={`text-xs shrink-0 ${rolls >= 3 ? 'text-orange-400' : 'text-gray-600'}`}>↻{rolls}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <Link
          href="/tasks"
          className="mt-3 block text-center text-xs py-2 rounded-lg border border-dashed border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600 transition-colors"
        >
          + Add task
        </Link>
      </section>

      {/* Reach out */}
      {overdueContacts.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Reach out</h3>
            <Link href="/contacts" className="text-xs text-indigo-400 hover:text-indigo-300">PEOPLE →</Link>
          </div>
          <div className="flex gap-4">
            {overdueContacts.slice(0, 3).map(c => {
              const tierDays = CONTACT_TIER_DAYS[(c.contact_tier ?? 'weekly') as ContactTier]
              const days = c.last_contacted_at
                ? Math.floor((now - new Date(c.last_contacted_at).getTime()) / 86400000)
                : tierDays + 1
              const od = days - tierDays
              const initials = c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
              return (
                <Link key={c.id} href={`/contacts/${c.id}`} className="flex-1 flex flex-col items-center py-4 px-2 bg-gray-900 border border-gray-800 rounded-xl hover:border-gray-700 transition-colors text-center">
                  <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center text-base font-bold text-orange-400 mb-2">
                    {initials}
                  </div>
                  <p className="text-sm text-white font-medium truncate w-full">{c.name}</p>
                  <p className="text-xs text-red-400 mt-1">{od}D OVERDUE</p>
                </Link>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
