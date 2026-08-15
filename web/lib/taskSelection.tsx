'use client'

import { createContext, useContext, useState, ReactNode } from 'react'
import { Task } from './types'

interface TaskSelectionContextValue {
  selected: Task | null
  select: (task: Task | null) => void
}

const TaskSelectionContext = createContext<TaskSelectionContextValue | null>(null)

export function TaskSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Task | null>(null)
  return (
    <TaskSelectionContext.Provider value={{ selected, select: setSelected }}>
      {children}
    </TaskSelectionContext.Provider>
  )
}

export function useTaskSelection() {
  const ctx = useContext(TaskSelectionContext)
  if (!ctx) throw new Error('useTaskSelection must be used within TaskSelectionProvider')
  return ctx
}
