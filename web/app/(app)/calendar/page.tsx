import { redirect } from 'next/navigation'

// The calendar lives in the Planner now.
export default function CalendarPage() {
  redirect('/plan?view=calendar')
}
