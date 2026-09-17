import { FocusSession } from './types'

export function phaseDurationSeconds(session: FocusSession): number {
  if (session.phase === 'break') return session.break_minutes * 60
  if (session.phase === 'work') return session.work_minutes * 60
  return 0
}

// Remaining time in the current phase, clamped to >= 0.
// Running (phase_started_at set): derived from wall clock so a closed/reopened
// tab always recomputes the correct value.
// Paused (phase_started_at null): uses the stored snapshot directly.
export function remainingSeconds(session: FocusSession, now: Date = new Date()): number {
  if (session.phase === 'idle') return 0
  if (!session.phase_started_at) {
    return Math.max(0, session.phase_remaining_seconds ?? phaseDurationSeconds(session))
  }
  const elapsed = Math.floor((now.getTime() - new Date(session.phase_started_at).getTime()) / 1000)
  return Math.max(0, phaseDurationSeconds(session) - elapsed)
}

export function formatMMSS(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Backdate the resumed start to preserve the time already spent in this phase.
export function resumedStartedAt(session: FocusSession, now: Date = new Date()): string {
  const remaining = Math.min(phaseDurationSeconds(session), remainingSeconds(session, now))
  return new Date(now.getTime() - (phaseDurationSeconds(session) - remaining) * 1000).toISOString()
}
