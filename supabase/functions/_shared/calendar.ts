import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import ICAL from 'npm:ical.js@2'
import { CalEvent, expandIcs, feedLabel, mergeFeeds } from './ics.ts'

export type CalendarResult = {
  configured: boolean
  events: CalEvent[]
  fetched_at: string | null
  stale: boolean
  error: string | null
}

const FRESH_MS = 15 * 60 * 1000
const MAX_BYTES = 8 * 1024 * 1024
const MAX_FEEDS = 10
const DAY = 86400000

function clip(events: CalEvent[], from: Date, to: Date): CalEvent[] {
  return events.filter(e => {
    const s = e.allDay ? Date.parse(e.start + 'T00:00:00Z') - DAY : Date.parse(e.start)
    const en = e.allDay ? Date.parse(e.end + 'T00:00:00Z') + DAY : Date.parse(e.end)
    return s < to.getTime() && en > from.getTime()
  })
}

/** Stable short id for a feed URL — lets cached events be matched to their feed without storing the URL. */
async function feedSrc(url: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url))
  return Array.from(new Uint8Array(digest).slice(0, 4), b => b.toString(16).padStart(2, '0')).join('')
}

async function fetchFeed(url: string, windowStart: Date, windowEnd: Date): Promise<CalEvent[]> {
  const res = await fetch(url.replace(/^webcal:\/\//i, 'https://'), { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`calendar feed returned HTTP ${res.status}`)
  const text = await res.text()
  if (text.length > MAX_BYTES) throw new Error('calendar feed is too large')
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('URL did not return an iCal feed')
  return expandIcs(ICAL, text, windowStart, windowEnd)
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x))

/**
 * Google Calendar ICS events (all of the user's feeds, merged) in [from, to).
 * Serves the cached expansion when it's < 15 min old, covers the range and was
 * built from the same feed set; otherwise refetches every feed. A feed that fails
 * falls back to its own cached events (others still refresh) and sets `error`.
 * `admin` must be a service-role client (calendar_cache is read-only to users).
 */
export async function getCalendarEvents(
  admin: SupabaseClient, userId: string, from: Date, to: Date, refresh = false,
): Promise<CalendarResult> {
  const [{ data: settings }, { data: cache }] = await Promise.all([
    admin.from('user_settings').select('ics_urls').eq('user_id', userId).maybeSingle(),
    admin.from('calendar_cache').select('*').eq('user_id', userId).maybeSingle(),
  ])
  const urls = [...new Set(((settings?.ics_urls as string[] | null) ?? []).map(u => u.trim()).filter(Boolean))].slice(0, MAX_FEEDS)
  if (!urls.length) return { configured: false, events: [], fetched_at: null, stale: false, error: null }
  const srcs = await Promise.all(urls.map(feedSrc))

  const cachedEvents = (cache?.events ?? []) as CalEvent[]
  const covers = cache && Date.parse(cache.window_start) <= from.getTime() && Date.parse(cache.window_end) >= to.getTime()
  if (!refresh && covers && sameSet(cache.feeds ?? [], srcs) && Date.now() - Date.parse(cache.fetched_at) < FRESH_MS) {
    return { configured: true, events: clip(cachedEvents, from, to), fetched_at: cache.fetched_at, stale: false, error: cache.last_error ?? null }
  }

  const now = Date.now()
  const windowStart = new Date(Math.min(from.getTime(), now - 60 * DAY))
  const windowEnd = new Date(Math.max(to.getTime(), now + 180 * DAY))
  const results = await Promise.allSettled(urls.map(u => fetchFeed(u, windowStart, windowEnd)))

  // Never echo a URL — they're secrets. The calendar id / host is fine.
  const errors: string[] = []
  const feeds = results.map((r, i) => {
    if (r.status === 'fulfilled') return { src: srcs[i], events: r.value }
    errors.push(`${feedLabel(urls[i])}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
    return { src: srcs[i], events: cachedEvents.filter(e => e.src === srcs[i]) }
  })
  const events = mergeFeeds(feeds)
  const error = errors.length ? errors.join(' · ') : null

  if (errors.length === urls.length) {
    // Total failure: keep the old cache as-is (incl. its fetched_at) so the next request retries.
    if (cache) await admin.from('calendar_cache').update({ last_error: error }).eq('user_id', userId)
    return { configured: true, events: clip(events, from, to), fetched_at: cache?.fetched_at ?? null, stale: true, error }
  }
  const fetched_at = new Date().toISOString()
  await admin.from('calendar_cache').upsert({
    user_id: userId, fetched_at, window_start: windowStart.toISOString(), window_end: windowEnd.toISOString(),
    events, feeds: srcs, last_error: error,
  })
  return { configured: true, events: clip(events, from, to), fetched_at, stale: !!error, error }
}
