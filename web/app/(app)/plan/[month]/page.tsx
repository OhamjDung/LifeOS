import { notFound } from 'next/navigation'
import { WeekBoard } from '@/components/plan/WeekBoard'

export default async function PlanMonthPage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) notFound()
  return (
    <div className="p-4 sm:p-6">
      {/* key: remount per month so board state (focus, drag) doesn't leak across months */}
      <WeekBoard key={month} monthKey={`${month}-01`} />
    </div>
  )
}
