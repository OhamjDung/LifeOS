'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchCalendar } from '@/lib/calendar'

const card = 'rounded-xl p-4 sm:p-5 bg-gray-900 border border-gray-700'

export function SettingsForm() {
  const [supabase] = useState(createClient)
  const [loaded, setLoaded] = useState(false)
  const [hasIcs, setHasIcs] = useState(false)
  const [editing, setEditing] = useState(false)
  const [icsDraft, setIcsDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    supabase.from('user_settings').select('ics_url').maybeSingle().then(({ data }) => {
      setHasIcs(!!data?.ics_url)
      setEditing(!data?.ics_url)
      setLoaded(true)
    })
  }, [supabase])

  async function saveIcs(url: string | null) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setStatus(null)
    try {
      if (url && !/^(https|webcal):\/\//i.test(url)) throw new Error('That doesn’t look like an iCal link (should start with https://).')
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('user_settings')
        .upsert({ user_id: user?.id, ics_url: url, updated_at: new Date().toISOString() })
      if (error) throw new Error(error.message)
      setHasIcs(!!url)
      setIcsDraft('')
      if (!url) {
        setEditing(true)
        setStatus({ ok: true, text: 'Disconnected.' })
        return
      }
      // Validate by syncing right away.
      const now = new Date()
      const r = await fetchCalendar(new Date(now.getTime() - 86400000), new Date(now.getTime() + 7 * 86400000), true)
      if (r.error) throw new Error(`Saved, but the sync failed: ${r.error}`)
      setEditing(false)
      setStatus({ ok: true, text: `Connected — ${r.events.length} event${r.events.length === 1 ? '' : 's'} in the next 7 days.` })
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
      lock.current = false
    }
  }

  return (
    <div className="space-y-4">
      <section className={card}>
        <h3 className="text-sm font-bold text-white">Google Calendar</h3>
        <p className="text-xs text-gray-500 mt-1 mb-3">
          Read-only sync into Plan → Calendar, refreshed every 15 minutes. In Google Calendar: <b>Settings → your calendar →
          Integrate calendar → Secret address in iCal format</b>. Treat that link like a password.
        </p>
        {!loaded ? (
          <div className="h-9 rounded-lg bg-gray-800 animate-pulse" aria-busy="true" />
        ) : hasIcs && !editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs px-2 py-1 rounded-full bg-indigo-900 text-indigo-950 font-medium">● Connected</span>
            <span className="text-xs text-gray-500 font-mono">https://calendar.google.com/…••••••</span>
            <div className="flex-1" />
            <button onClick={() => setEditing(true)} className="px-3 py-1.5 text-xs rounded-lg border border-gray-700 text-gray-400 hover:text-white">
              Replace
            </button>
            <button onClick={() => saveIcs(null)} disabled={busy} className="px-3 py-1.5 text-xs rounded-lg text-red-700 hover:bg-red-700/10 disabled:opacity-50">
              Disconnect
            </button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="password"
              autoComplete="off"
              value={icsDraft}
              onChange={e => setIcsDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && icsDraft.trim()) saveIcs(icsDraft.trim()) }}
              placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
              className="flex-1 bg-[#EAE7E0] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-indigo-500"
            />
            <div className="flex gap-2">
              {hasIcs && (
                <button onClick={() => { setEditing(false); setIcsDraft('') }} className="px-3 py-2 text-xs rounded-lg text-gray-500 hover:text-white">
                  Cancel
                </button>
              )}
              <button
                onClick={() => saveIcs(icsDraft.trim())}
                disabled={busy || !icsDraft.trim()}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[#DEDAD2] disabled:opacity-40"
              >
                {busy ? 'Checking…' : 'Save & sync'}
              </button>
            </div>
          </div>
        )}
        {status && (
          <p role={status.ok ? 'status' : 'alert'} className={`mt-2 text-xs animate-slide-up ${status.ok ? 'text-indigo-600' : 'text-red-700'}`}>
            {status.text}
          </p>
        )}
      </section>
    </div>
  )
}
