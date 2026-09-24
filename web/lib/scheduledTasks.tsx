'use client'

import { createContext, ReactNode, useContext, useState } from 'react'

/** task id → start time label of the (first) time block it's in, e.g. "2pm". */
export type ScheduledMap = Map<string, string>

const ScheduledTasksContext = createContext<{ scheduled: ScheduledMap; setScheduled: (m: ScheduledMap) => void }>({
  scheduled: new Map(),
  setScheduled: () => {},
})

/**
 * Lets a calendar (DayCalendar on /tasks) tell sibling task lists which tasks
 * already sit in a time block, so those rows render darker. Outside a provider
 * everything reads as unscheduled.
 */
export function ScheduledTasksProvider({ children }: { children: ReactNode }) {
  const [scheduled, setScheduled] = useState<ScheduledMap>(() => new Map())
  return (
    <ScheduledTasksContext.Provider value={{ scheduled, setScheduled }}>
      {children}
    </ScheduledTasksContext.Provider>
  )
}

export function useScheduledTasks() {
  return useContext(ScheduledTasksContext)
}
