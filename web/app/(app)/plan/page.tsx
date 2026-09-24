import Link from 'next/link'
import { MonthBoard } from '@/components/plan/MonthBoard'
import { CalendarView } from '@/components/calendar/CalendarView'

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams
  const isCalendar = view === 'calendar'
  const tab = (active: boolean) =>
    `btn-like px-3 py-1.5 text-xs font-semibold tracking-wide rounded-md ${
      active ? 'bg-indigo-600 text-[#DEDAD2]' : 'text-gray-400 hover:text-white hover:bg-black/5'
    }`
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Plan</h2>
          <p className="text-gray-400 text-xs mt-1">
            {isCalendar ? 'Google Calendar + your tasks. Block time and drop tasks in.' : 'Year → month → week. Click a month to plan its weeks.'}
          </p>
        </div>
        <nav className="flex gap-1 p-1 rounded-lg bg-gray-900 border border-gray-800" aria-label="Plan views">
          <Link href="/plan" className={tab(!isCalendar)} aria-current={!isCalendar ? 'page' : undefined}>BOARD</Link>
          <Link href="/plan?view=calendar" className={tab(isCalendar)} aria-current={isCalendar ? 'page' : undefined}>CALENDAR</Link>
        </nav>
      </div>
      {isCalendar ? <CalendarView /> : <MonthBoard />}
    </div>
  )
}
