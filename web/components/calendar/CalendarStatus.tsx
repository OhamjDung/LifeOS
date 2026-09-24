'use client'

import Link from 'next/link'
import { CalendarResult } from '@/lib/calendar'

/** Not-connected hint, sync failure, and block-save failure banners. */
export function CalendarStatus({
  cal, calError, error, onDismissError,
}: {
  cal: CalendarResult | null
  calError: string | null
  error: string | null
  onDismissError: () => void
}) {
  return (
    <>
      {cal && !cal.configured && (
        <p className="text-xs text-gray-500 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 animate-fade-in">
          Google Calendar isn&apos;t connected. <Link href="/settings" className="text-indigo-600 underline">Add your iCal link in Settings</Link> to see your events here.
        </p>
      )}
      {calError && (
        <p role="alert" className="text-xs text-red-800 bg-red-100/60 border border-red-300 rounded-lg px-3 py-2 animate-slide-up">
          Calendar sync failed{cal?.stale && cal.events.length ? ' (showing last synced events)' : ''}: {calError}
        </p>
      )}
      {error && (
        <div role="alert" className="flex items-center gap-3 text-xs text-red-800 bg-red-100/60 border border-red-300 rounded-lg px-3 py-2 animate-slide-up">
          <span className="flex-1">Couldn&apos;t save: {error}</span>
          <button onClick={onDismissError} aria-label="Dismiss error" className="px-1">×</button>
        </div>
      )}
    </>
  )
}
