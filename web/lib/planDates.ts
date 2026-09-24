// Local-date math for the planner. Everything is a plain 'YYYY-MM-DD' string in the
// user's local calendar — never go through toISOString(), which shifts to UTC and
// can land on the previous day.

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 1st of the month containing `d`. */
export function monthStart(d: Date): string {
  return ymd(new Date(d.getFullYear(), d.getMonth(), 1))
}

/** Shift a 'YYYY-MM-01' month key by n months. */
export function addMonths(monthKey: string, n: number): string {
  const d = parseYmd(monthKey)
  return ymd(new Date(d.getFullYear(), d.getMonth() + n, 1))
}

/** Whole-month difference b − a between two month keys. */
export function monthDiff(a: string, b: string): number {
  const da = parseYmd(a), db = parseYmd(b)
  return (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth())
}

export function addDays(day: string, n: number): string {
  const d = parseYmd(day)
  return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n))
}

/** Monday of the week containing `d` (weeks run Mon–Sun). */
export function mondayOf(d: Date): string {
  const offset = (d.getDay() + 6) % 7 // Mon=0 … Sun=6
  return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset))
}

/** Mondays that fall inside the month — a week belongs to the month its Monday is in. */
export function weeksOfMonth(monthKey: string): string[] {
  const first = parseYmd(monthKey)
  const out: string[] = []
  const d = new Date(first)
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1)
  while (d.getMonth() === first.getMonth()) {
    out.push(ymd(d))
    d.setDate(d.getDate() + 7)
  }
  return out
}

/** Month key a week belongs to (the month of its Monday). */
export function monthOfWeek(monday: string): string {
  return monday.slice(0, 8) + '01'
}

export function monthLabel(monthKey: string, withYear = true): string {
  return parseYmd(monthKey).toLocaleDateString('en-US', withYear ? { month: 'long', year: 'numeric' } : { month: 'long' })
}

export function shortMonth(monthKey: string): string {
  return parseYmd(monthKey).toLocaleDateString('en-US', { month: 'short' })
}

export function weekLabel(monday: string): string {
  const fmt = (s: string) => parseYmd(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(monday)} – ${fmt(addDays(monday, 6))}`
}

/** Does a goal's [period_start, period_end] cover the given month key? */
export function coversMonth(g: { period_start: string; period_end: string }, monthKey: string): boolean {
  return g.period_start <= monthKey && g.period_end >= monthKey
}
