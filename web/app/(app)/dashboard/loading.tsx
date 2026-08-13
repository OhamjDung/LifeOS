export default function DashboardLoading() {
  return (
    <div className="flex h-screen">
      <div
        className="flex-1 p-8"
        style={{ borderRight: '1px solid rgba(28,26,20,0.1)' }}
      >
        <div className="mb-6">
          <div className="h-8 w-48 bg-gray-800 rounded animate-pulse mb-2" />
          <div className="h-4 w-36 bg-gray-800 rounded animate-pulse" />
        </div>
        <div className="h-24 bg-gray-800 rounded-2xl animate-pulse mb-8" />
        <div className="h-4 w-20 bg-gray-800 rounded animate-pulse mb-3" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
      <div className="w-80 shrink-0 p-8">
        <div className="h-4 w-24 bg-gray-800 rounded animate-pulse mb-5" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  )
}
