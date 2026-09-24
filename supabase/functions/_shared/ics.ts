// ICS → flat list of event occurrences in a window. The ical.js module is passed
// in (not imported) so the same code runs in Deno (npm:ical.js) and in the node
// tests (web/node_modules/ical.js).

export interface CalEvent {
  uid: string
  title: string
  /** allDay: 'YYYY-MM-DD' · timed: ISO UTC */
  start: string
  /** exclusive. allDay: 'YYYY-MM-DD' · timed: ISO UTC */
  end: string
  allDay: boolean
  location: string | null
}

// deno-lint-ignore no-explicit-any
type ICALModule = any
// deno-lint-ignore no-explicit-any
type Comp = any

const MAX_ITERATIONS_PER_EVENT = 20000 // a daily event from 10 years ago is ~3650
const MAX_OCCURRENCES_PER_EVENT = 1000

function isCancelled(c: Comp): boolean {
  return String(c.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED'
}

function dateOnly(t: { year: number; month: number; day: number }): string {
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`
}

// deno-lint-ignore no-explicit-any
function toEvent(ICAL: ICALModule, uid: string, item: any, start: any, end: any): CalEvent {
  const allDay = !!start.isDate
  let endTime = end
  if (!endTime || endTime.compare(start) <= 0) {
    // No/invalid DTEND: all-day lasts one day, timed is a zero-length point.
    endTime = start.clone()
    if (allDay) endTime.day += 1
  }
  return {
    uid,
    title: item.summary || '(no title)',
    start: allDay ? dateOnly(start) : start.toJSDate().toISOString(),
    end: allDay ? dateOnly(endTime) : endTime.toJSDate().toISOString(),
    allDay,
    location: item.location || null,
  }
}

function overlaps(e: CalEvent, from: Date, to: Date): boolean {
  // All-day dates compare as local midnight-ish; a day of slack either side is
  // fine because the client filters precisely by its own local day grid.
  const s = e.allDay ? new Date(e.start + 'T00:00:00Z').getTime() - 86400000 : Date.parse(e.start)
  const en = e.allDay ? new Date(e.end + 'T00:00:00Z').getTime() + 86400000 : Date.parse(e.end)
  return s < to.getTime() && en > from.getTime()
}

export function expandIcs(ICAL: ICALModule, text: string, from: Date, to: Date): CalEvent[] {
  const root = new ICAL.Component(ICAL.parse(text))
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    ICAL.TimezoneService.register(new ICAL.Timezone(tz))
  }

  const masters = new Map<string, Comp>()
  const exceptions = new Map<string, Comp[]>()
  const orphans: Comp[] = []
  for (const v of root.getAllSubcomponents('vevent')) {
    const uid = String(v.getFirstPropertyValue('uid') ?? '')
    if (v.hasProperty('recurrence-id')) {
      const list = exceptions.get(uid) ?? []
      list.push(v)
      exceptions.set(uid, list)
    } else {
      masters.set(uid || `anon-${masters.size}`, v)
    }
  }
  for (const [uid, list] of exceptions) if (!masters.has(uid)) orphans.push(...list)

  const out: CalEvent[] = []
  for (const [uid, v] of masters) {
    if (isCancelled(v)) continue
    const ev = new ICAL.Event(v, { exceptions: exceptions.get(uid) ?? [], strictExceptions: false })
    if (!ev.isRecurring()) {
      const e = toEvent(ICAL, uid, ev, ev.startDate, ev.endDate)
      if (overlaps(e, from, to)) out.push(e)
      continue
    }
    // EXDATEs are skipped by the iterator; RECURRENCE-ID overrides come back via
    // getOccurrenceDetails() (moved time / new title / cancelled).
    const it = ev.iterator()
    let next
    let iterations = 0
    let emitted = 0
    while ((next = it.next()) && iterations++ < MAX_ITERATIONS_PER_EVENT && emitted < MAX_OCCURRENCES_PER_EVENT) {
      if (next.toJSDate().getTime() >= to.getTime() + 86400000) break
      const d = ev.getOccurrenceDetails(next)
      if (isCancelled(d.item.component)) continue
      const e = toEvent(ICAL, uid, d.item, d.startDate, d.endDate)
      if (overlaps(e, from, to)) { out.push(e); emitted++ }
    }
  }
  for (const v of orphans) {
    if (isCancelled(v)) continue
    const ev = new ICAL.Event(v)
    const e = toEvent(ICAL, ev.uid, ev, ev.startDate, ev.endDate)
    if (overlaps(e, from, to)) out.push(e)
  }
  return out.sort((a, b) => a.start.localeCompare(b.start))
}
