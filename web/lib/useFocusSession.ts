'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from './supabase/client'
import { FocusSession } from './types'
import { formatMMSS, phaseDurationSeconds, remainingSeconds, resumedStartedAt } from './sessionTimer'
import { playChime, soundEnabled } from './chime'

/**
 * One focus session's live state + actions, shared by the full /session/[id]
 * page and the pop-out mini timer. Changes are broadcast to other windows of the
 * same session (the fallback popup is a separate window) via BroadcastChannel.
 * When a running phase reaches 0 it chimes once across all windows.
 */
export function useFocusSession(sessionId: string, opts: { setTitle?: boolean } = {}) {
  const [supabase] = useState(createClient)
  const [session, setSession] = useState<FocusSession | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [remaining, setRemaining] = useState(0)
  const [saveError, setSaveError] = useState('')
  const saving = useRef(false)
  const channel = useRef<BroadcastChannel | null>(null)
  const prevRemaining = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase.from('sessions').select('*').eq('id', sessionId).maybeSingle().then(({ data }) => {
      if (cancelled) return
      setSession((data as FocusSession) ?? null)
      setLoaded(true)
    })
    const ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`lifeos-session-${sessionId}`) : null
    if (ch) ch.onmessage = e => { if (e.data?.id === sessionId) setSession(e.data as FocusSession) }
    channel.current = ch
    return () => { cancelled = true; ch?.close() }
  }, [sessionId, supabase])

  // Tick + chime on the transition to zero (only while running, never on load).
  useEffect(() => {
    if (!session) return
    prevRemaining.current = null
    const tick = () => {
      const r = remainingSeconds(session)
      const prev = prevRemaining.current
      prevRemaining.current = r
      setRemaining(r)
      if (prev !== null && prev > 0 && r === 0 && session.phase_started_at && session.phase !== 'idle') {
        onPhaseDone(session)
      }
    }
    const first = setTimeout(tick, 0)
    const interval = setInterval(tick, 1000)
    // Background tabs throttle repeating timers (Chrome: to ~1/min after 5 min hidden),
    // which would delay the chime. A single timeout aimed at the end moment isn't
    // subject to that, so the chime lands on time.
    const msLeft = session.phase_started_at
      ? phaseDurationSeconds(session) * 1000 - (Date.now() - Date.parse(session.phase_started_at))
      : 0
    const atEnd = msLeft > 0 ? setTimeout(tick, msLeft + 80) : null
    return () => { clearTimeout(first); clearInterval(interval); if (atEnd) clearTimeout(atEnd) }
  }, [session])

  // Tab title shows the countdown (handy with the tab in the background).
  useEffect(() => {
    if (!opts.setTitle || !session) return
    const base = document.title
    document.title = remaining === 0 && session.phase_started_at
      ? `⏰ ${session.phase === 'work' ? 'Break time' : 'Back to work'}`
      : `${formatMMSS(remaining)} · ${session.phase}`
    return () => { document.title = base }
  }, [remaining, session, opts.setTitle])

  const updateSession = useCallback(async (patch: Partial<FocusSession>) => {
    if (!session || saving.current) return
    saving.current = true
    setSaveError('')
    const next = { ...session, ...patch }
    setSession(next)
    channel.current?.postMessage(next)
    try {
      const { error } = await supabase.from('sessions').update(patch).eq('id', session.id)
      if (error) throw error
    } catch {
      setSession(session)
      channel.current?.postMessage(session)
      setSaveError('Could not save timer change. Please retry.')
    } finally {
      saving.current = false
    }
  }, [session, supabase])

  const pause = () => session && updateSession({ phase_started_at: null, phase_remaining_seconds: remainingSeconds(session) })
  const resume = () => session && updateSession({ phase_started_at: resumedStartedAt(session), phase_remaining_seconds: null })
  const startBreak = () => updateSession({ phase: 'break', phase_started_at: new Date().toISOString(), phase_remaining_seconds: null })
  const startNextRound = () => session && updateSession({
    phase: 'work', round: session.round + 1, phase_started_at: new Date().toISOString(), phase_remaining_seconds: null,
  })

  async function rateRound(rating: number | null) {
    if (!session) return
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('session_rounds').insert({ session_id: session.id, user_id: user?.id, round: session.round, lockin_rating: rating })
  }

  return { session, loaded, remaining, saveError, pause, resume, startBreak, startNextRound, rateRound }
}

/** Chime + desktop notification, once per phase across every open window. */
function onPhaseDone(s: FocusSession) {
  const key = `chimed:${s.id}:${s.phase}:${s.phase_started_at}`
  try {
    if (localStorage.getItem(key)) return
    localStorage.setItem(key, '1')
  } catch { /* storage blocked: still chime in this window */ }
  if (soundEnabled()) playChime(s.phase === 'work' ? 'work-done' : 'break-done')
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
    try {
      new Notification(s.phase === 'work' ? 'Work round done — take a break' : 'Break over — back to it', {
        body: s.title ?? 'Focus session', tag: `lifeos-${s.id}`,
      })
    } catch { /* some browsers only allow notifications from a service worker */ }
  }
}
