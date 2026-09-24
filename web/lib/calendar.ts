import { createClient } from './supabase/client'
import { ymd } from './planDates'

/** dataTransfer type for dragging a task ({id,title} JSON) onto the calendar. */
export const TASK_DRAG_TYPE = 'application/x-lifeos-task'

/** Same shape as supabase/functions/_shared/ics.ts CalEvent. */
export interface CalEvent {
  uid: string
  title: string
  start: string // allDay: YYYY-MM-DD · timed: ISO UTC
  end: string   // exclusive
  allDay: boolean
  location: string | null
}

export interface CalendarResult {
  configured: boolean
  events: CalEvent[]
  fetched_at: string | null
  stale: boolean
  error: string | null
}

export interface TimeBlock {
  id: string
  user_id: string
  title: string | null
  start_at: string
  end_at: string
  color: BlockColor
  created_at: string
  tasks: { id: string; title: string; status: string }[]
}

export type BlockColor = 'indigo' | 'orange' | 'green' | 'rose' | 'cyan' | 'purple'
export const BLOCK_COLORS: Record<BlockColor, { bg: string; border: string; fg: string }> = {
  indigo: { bg: '#CDDBA6', border: '#516439', fg: '#2A3518' },
  orange: { bg: '#F0D2B4', border: '#B0643F', fg: '#5A2E14' },
  green: { bg: '#BFE0CF', border: '#3F7F5A', fg: '#173A26' },
  rose: { bg: '#EBC6CF', border: '#A0506A', fg: '#4A1A2A' },
  cyan: { bg: '#BEDDE0', border: '#3F7F7A', fg: '#163A38' },
  purple: { bg: '#D6CBE6', border: '#6E5A9E', fg: '#2E2248' },
}

export async function fetchCalendar(from: Date, to: Date, refresh = false): Promise<CalendarResult> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fn-calendar-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify({ from: from.toISOString(), to: to.toISOString(), refresh }),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText)
    throw new Error(`${resp.status}: ${text.slice(0, 160)}`)
  }
  return resp.json()
}

/** Local calendar days ('YYYY-MM-DD') an all-day event covers (end exclusive). */
export function allDayDays(e: CalEvent): string[] {
  const out: string[] = []
  const [y, m, d] = e.start.split('-').map(Number)
  const cur = new Date(y, m - 1, d)
  const end = e.end
  for (let i = 0; i < 366 && ymd(cur) < end; i++) {
    out.push(ymd(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out.length ? out : [e.start]
}

/** Minutes since local midnight of `day` for an instant (clamped to 0..1440). */
export function minutesInDay(iso: string, day: string): number {
  const t = new Date(iso)
  const [y, m, d] = day.split('-').map(Number)
  const mins = (t.getTime() - new Date(y, m - 1, d).getTime()) / 60000
  return Math.max(0, Math.min(1440, mins))
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(':00', '')
}

/**
 * Side-by-side layout for overlapping items in one day column: returns lane
 * index + lane count per item (greedy, clustered so unrelated items stay full width).
 */
export function layoutLanes<T extends { startMin: number; endMin: number }>(items: T[]): (T & { lane: number; lanes: number })[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)
  const out: (T & { lane: number; lanes: number })[] = []
  let cluster: (T & { lane: number; lanes: number })[] = []
  let clusterEnd = -1
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map(c => c.lane + 1))
    for (const c of cluster) c.lanes = lanes
    out.push(...cluster)
    cluster = []
  }
  for (const item of sorted) {
    if (cluster.length && item.startMin >= clusterEnd) flush()
    const laneEnds: number[] = []
    for (const c of cluster) laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? -1, c.endMin)
    let lane = laneEnds.findIndex(end => end <= item.startMin)
    if (lane === -1) lane = laneEnds.length
    cluster.push({ ...item, lane, lanes: 1 })
    clusterEnd = Math.max(clusterEnd, item.endMin)
  }
  if (cluster.length) flush()
  return out
}
