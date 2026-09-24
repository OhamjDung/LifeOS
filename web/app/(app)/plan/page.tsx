import { MonthBoard } from '@/components/plan/MonthBoard'

export default function PlanPage() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-white">Plan</h2>
        <p className="text-gray-400 text-xs mt-1">Year → month → week. Click a month to plan its weeks.</p>
      </div>
      <MonthBoard />
    </div>
  )
}
