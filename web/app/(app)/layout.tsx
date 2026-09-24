import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { NavBar } from '@/components/NavBar'
import { QuickNotesWidget } from '@/components/QuickNotesWidget'
import { FloatingTimerProvider } from '@/components/session/FloatingTimer'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <FloatingTimerProvider>
      <div className="flex flex-col sm:flex-row min-h-screen">
        <NavBar />
        <main className="flex-1 min-w-0 overflow-auto">
          {children}
        </main>
        <QuickNotesWidget />
      </div>
    </FloatingTimerProvider>
  )
}
