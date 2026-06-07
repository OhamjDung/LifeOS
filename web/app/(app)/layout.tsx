import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { LogoutButton } from '@/components/LogoutButton'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col p-4 gap-1 shrink-0">
        <div className="px-2 py-3 mb-2">
          <h1 className="text-lg font-bold text-white">LifeOS</h1>
          <p className="text-xs text-gray-500">{user.email}</p>
        </div>

        <NavLink href="/dashboard" label="Dashboard" icon="⚡" />
        <NavLink href="/tasks" label="Tasks" icon="✅" />
        <NavLink href="/calendar" label="Calendar" icon="📅" />
        <NavLink href="/braindump" label="Braindump" icon="🧠" />
        <NavLink href="/notes" label="Notes" icon="📝" />
        <NavLink href="/search" label="Search" icon="🔍" />
        <NavLink href="/contacts" label="Contacts" icon="👥" />

        <div className="mt-auto">
          <LogoutButton />
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}

function NavLink({ href, label, icon }: { href: string; label: string; icon: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors text-sm"
    >
      <span>{icon}</span>
      <span>{label}</span>
    </Link>
  )
}
