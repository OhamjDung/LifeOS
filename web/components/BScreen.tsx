'use client'

import { useEffect, useState } from 'react'
import { TASK_DRAG_TYPE } from '@/lib/calendar'
import { ChatPanel } from './chat/ChatPanel'
import { DayCalendar } from './calendar/DayCalendar'

type Tab = 'chat' | 'today'

/**
 * /tasks B screen: CHAT | TODAY tabs. Both stay mounted (chat keeps its thread,
 * the calendar keeps polling); dragging a task over the TODAY tab switches to it
 * so it can be dropped on a block.
 */
export function BScreen() {
  const [tab, setTabState] = useState<Tab>('chat')
  useEffect(() => {
    try { if (localStorage.getItem('bTab') === 'today') setTabState('today') } catch {} // eslint-disable-line react-hooks/set-state-in-effect -- localStorage is client-only
  }, [])
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem('bTab', t) } catch {} }

  const tabCls = (active: boolean) =>
    `flex-1 sm:flex-none px-4 py-1.5 text-xs font-semibold tracking-wide rounded-md ${
      active ? 'bg-indigo-600 text-[#DEDAD2]' : 'text-gray-400 hover:text-white hover:bg-black/5'
    }`

  return (
    <div>
      <div role="tablist" aria-label="Right panel" className="flex gap-1 p-1 mb-4 rounded-lg bg-gray-900 border border-gray-800 w-full sm:w-fit">
        <button role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')} className={tabCls(tab === 'chat')}>
          CHAT
        </button>
        <button
          role="tab"
          aria-selected={tab === 'today'}
          onClick={() => setTab('today')}
          onDragEnter={e => { if (e.dataTransfer.types.includes(TASK_DRAG_TYPE)) setTab('today') }}
          onDragOver={e => { if (e.dataTransfer.types.includes(TASK_DRAG_TYPE)) e.preventDefault() }}
          title="Drag a task here to open today's time grid"
          className={tabCls(tab === 'today')}
        >
          TODAY
        </button>
      </div>
      <div className={tab === 'chat' ? 'animate-fade-in' : 'hidden'}><ChatPanel /></div>
      <div className={tab === 'today' ? 'animate-fade-in' : 'hidden'}><DayCalendar /></div>
    </div>
  )
}
