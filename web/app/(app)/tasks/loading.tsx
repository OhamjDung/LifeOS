export default function TasksLoading() {
  return (
    <div className="flex h-screen">
      <div
        className="w-1/2 shrink-0 p-6"
        style={{ borderRight: '1px solid rgba(28,26,20,0.1)' }}
      >
        <div className="h-6 w-20 bg-gray-800 rounded animate-pulse mb-1" />
        <div className="h-4 w-44 bg-gray-800 rounded animate-pulse mb-6" />
        <div className="h-20 bg-gray-900 border border-gray-800 rounded-xl animate-pulse mb-5" />
        <div className="space-y-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="h-14 bg-gray-900 border border-gray-800 rounded-xl animate-pulse"
            />
          ))}
        </div>
      </div>
      <div className="w-1/2 p-6">
        <div className="h-6 w-24 bg-gray-800 rounded animate-pulse mb-5" />
        <div className="h-72 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />
      </div>
    </div>
  )
}
