'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { feedLabel, fetchCalendar } from '@/lib/calendar'

const MAX_FEEDS = 10
const HIDDEN_KEY = 'hiddenCalendarFeeds'

/** Same as supabase/functions/_shared/calendar.ts feedSrc: first 4 bytes of SHA-256(url), hex. */
async function feedSrc(url: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url))
  return Array.from(new Uint8Array(digest).slice(0, 4), b => b.toString(16).padStart(2, '0')).join('')
}

/** Per-viewer set of feed `src` hashes the user switched off. Browser-only convenience. */
export function useHiddenFeeds(): [Set<string>, (src: string) => void] {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setHidden(new Set(JSON.parse(raw) as string[]))
    } catch { /* storage unavailable */ }
  }, [])
  function toggle(src: string) {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(src)) next.delete(src); else next.add(src)
      try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }
  return [hidden, toggle]
}

/**
 * "Calendars" popover: show/hide each connected Google calendar on the grid,
 * remove one, or add another iCal link. Writes user_settings.ics_urls like /settings.
 */
export function CalendarFeedsMenu({
  hidden, onToggle, onChanged,
}: {
  hidden: Set<string>
  onToggle: (src: string) => void
  onChanged: () => void
}) {
  const [supabase] = useState(createClient)
  const [open, setOpen] = useState(false)
  const [feeds, setFeeds] = useState<{ url: string; src: string }[]>([])
  const [loaded, setLoaded] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const lock = useRef(false)

  useEffect(() => {
    if (!open || loaded) return
    supabase.from('user_settings').select('ics_urls').maybeSingle().then(async ({ data }) => {
      const urls = (data?.ics_urls as string[] | null) ?? []
      setFeeds(await Promise.all(urls.map(async url => ({ url, src: await feedSrc(url) }))))
      setLoaded(true)
    })
  }, [open, loaded, supabase])

  async function save(next: string[], added: string | null) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setStatus(null)
    try {
      if (added && !/^(https|webcal):\/\//i.test(added)) throw new Error('That doesn’t look like an iCal link (should start with https://).')
      if (added && feeds.some(f => f.url === added)) throw new Error('That calendar is already connected.')
      if (next.length > MAX_FEEDS) throw new Error(`At most ${MAX_FEEDS} calendars.`)
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('user_settings')
        .upsert({ user_id: user?.id, ics_urls: next, updated_at: new Date().toISOString() })
      if (error) throw new Error(error.message)
      setFeeds(await Promise.all(next.map(async url => ({ url, src: await feedSrc(url) }))))
      setDraft('')
      if (next.length) {
        // Validate right away so a bad link surfaces here, not as a silent empty grid.
        const now = new Date()
        const r = await fetchCalendar(new Date(now.getTime() - 86400000), new Date(now.getTime() + 7 * 86400000), true)
        if (r.error) throw new Error(`Saved, but the sync failed — ${r.error}`)
      }
      setStatus({ ok: true, text: added ? 'Calendar added.' : 'Calendar removed.' })
      onChanged()
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
      lock.current = false
    }
  }

  const add = () => { const u = draft.trim(); if (u) save([...feeds.map(f => f.url), u], u) }
  const hiddenCount = feeds.filter(f => hidden.has(f.src)).length

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        title="Show, hide, add or remove calendars"
        className="px-2.5 py-1 text-xs border border-gray-700 rounded-lg text-gray-400 hover:text-white hover:bg-black/5"
      >
        ▦ Calendars{loaded && hiddenCount ? ` (${hiddenCount} hidden)` : ''}
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-30 w-72 max-w-[85vw] rounded-xl p-3 space-y-2 shadow-lg animate-popover-in"
          style={{ background: '#DEDAD2', border: '1px solid rgba(28,26,20,0.12)' }}
        >
          {!loaded ? (
            <div className="h-8 rounded-lg bg-gray-800 animate-pulse" aria-busy="true" />
          ) : (
            <>
              {feeds.length === 0 && <p className="text-xs text-gray-500">No calendars connected yet.</p>}
              {feeds.map(f => (
                <div key={f.src} className="flex items-center gap-2">
                  <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!hidden.has(f.src)}
                      onChange={() => onToggle(f.src)}
                      aria-label={`Show ${feedLabel(f.url)}`}
                    />
                    <span className="text-xs text-white font-mono truncate">{feedLabel(f.url)}</span>
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => save(feeds.filter(x => x.url !== f.url).map(x => x.url), null)}
                    aria-label={`Remove ${feedLabel(f.url)}`}
                    title="Disconnect this calendar"
                    className="px-1.5 text-xs text-gray-500 hover:text-red-700 disabled:opacity-40"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {feeds.length < MAX_FEEDS && (
                <div className="flex gap-1.5 pt-1">
                  <input
                    type="password"
                    autoComplete="off"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') add() }}
                    placeholder="Paste iCal link…"
                    aria-label="iCal link"
                    className="min-w-0 flex-1 bg-field border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder-gray-500 outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={add}
                    disabled={busy || !draft.trim()}
                    className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-[#DEDAD2] disabled:opacity-40"
                  >
                    {busy ? '…' : 'Add'}
                  </button>
                </div>
              )}
              {status && (
                <p role={status.ok ? 'status' : 'alert'} className={`text-[11px] ${status.ok ? 'text-indigo-600' : 'text-red-700'}`}>
                  {status.text}
                </p>
              )}
              <p className="text-[10px] text-gray-500">
                Google Calendar → Settings → the calendar → Integrate → Secret address in iCal format. Treat it like a password.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
