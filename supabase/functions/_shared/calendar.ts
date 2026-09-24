import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import ICAL from 'npm:ical.js@2'
import { CalEvent, expandIcs } from './ics.ts'

export type CalendarResult = {
  configured: boolean
  events: CalEvent[]
  fetched_at: string | null
  stale: boolean
  error: string | null
}

const FRESH_MS = 15 * 60 * 1000
const MAX_BYTES = 8 * 1024 * 1024
const DAY = 86400000

function clip(events: CalEvent[], from: Date, to: Date): CalEvent[] {
  return events.filter(e => {
    const s = e.allDay ? Date.parse(e.start + 'T00:00:00Z') - DAY : Date.parse(e.start)
    const en = e.allDay ? Date.parse(e.end + 'T00:00:00Z') + DAY : Date.parse(e.end)
    return s < to.getTime() && en > from.getTime()
  })
}

/**
 * Google Calendar ICS events for a user in [from, to). Serves the cached
 * expansion when it's < 15 min old and covers the range; otherwise refetches.
 * On fetch failure, falls back to stale cache with `error` set.
 * `admin` must be a service-role client (calendar_cache is read-only to users).
 */
export async function getCalendarEvents(
  admin: SupabaseClient, userId: string, from: Date, to: Date, refresh = false,
): Promise<CalendarResult> {
  const [{ data: settings }, { data: cache }] = await Promise.all([
    admin.from('user_settings').select('ics_url').eq('user_id', userId).maybeSingle(),
    admin.from('calendar_cache').select('*').eq('user_id', userId).maybeSingle(),
  ])
  const url = (settings?.ics_url as string | null)?.trim()
  if (!url) return { configured: false, events: [], fetched_at: null, stale: false, error: null }

  const covers = cache && Date.parse(cache.window_start) <= from.getTime() && Date.parse(cache.window_end) >= to.getTime()
  if (!refresh && covers && Date.now() - Date.parse(cache.fetched_at) < FRESH_MS) {
    return { configured: true, events: clip(cache.events as CalEvent[], from, to), fetched_at: cache.fetched_at, stale: false, error: null }
  }

  const now = Date.now()
  const windowStart = new Date(Math.min(from.getTime(), now - 60 * DAY))
  const windowEnd = new Date(Math.max(to.getTime(), now + 180 * DAY))
  try {
    const res = await fetch(url.replace(/^webcal:\/\//i, 'https://'), { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`calendar feed returned HTTP ${res.status}`)
    const text = await res.text()
    if (text.length > MAX_BYTES) throw new Error('calendar feed is too large')
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('URL did not return an iCal feed')
    const events = expandIcs(ICAL, text, windowStart, windowEnd)
    const fetched_at = new Date().toISOString()
    await admin.from('calendar_cache').upsert({
      user_id: userId, fetched_at, window_start: windowStart.toISOString(), window_end: windowEnd.toISOString(),
      events, last_error: null,
    })
    return { configured: true, events: clip(events, from, to), fetched_at, stale: false, error: null }
  } catch (e) {
    // Never echo the URL — it's a secret.
    const message = e instanceof Error ? e.message : String(e)
    if (cache) await admin.from('calendar_cache').update({ last_error: message }).eq('user_id', userId)
    return {
      configured: true,
      events: cache ? clip(cache.events as CalEvent[], from, to) : [],
      fetched_at: cache?.fetched_at ?? null,
      stale: true,
      error: message,
    }
  }
}
