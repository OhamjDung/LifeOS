'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PlanGoal } from '@/lib/types'

type SB = ReturnType<typeof createClient>
export type GoalPatch = Partial<Omit<PlanGoal, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
export type NewGoal = Pick<PlanGoal, 'level' | 'title' | 'period_start' | 'period_end'> & GoalPatch

/**
 * Planner goals with optimistic writes: local state changes immediately, the DB
 * write follows, and a failure rolls back to the pre-write snapshot + sets `error`.
 */
export function usePlanGoals(load: (sb: SB) => PromiseLike<{ data: unknown; error: { message: string } | null }>, key: string) {
  const [supabase] = useState(createClient)
  const [goals, setGoals] = useState<PlanGoal[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Latest values for async callbacks (rollback snapshot, loader) without
  // re-creating the callbacks. Synced in effects, declared before the load effect.
  const goalsRef = useRef(goals)
  const loadRef = useRef(load)
  useEffect(() => { goalsRef.current = goals }, [goals])
  useEffect(() => { loadRef.current = load })

  // Consumers remount on `key` change (see /plan/[month]), so `loaded` starts false.
  useEffect(() => {
    let cancelled = false
    Promise.resolve(loadRef.current(supabase)).then(({ data, error }) => {
      if (cancelled) return
      if (error) setError(error.message)
      setGoals((data as PlanGoal[]) ?? [])
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [key, supabase])

  const fail = useCallback((snapshot: PlanGoal[], message: string) => {
    setGoals(snapshot)
    setError(message)
  }, [])

  const create = useCallback(async (fields: NewGoal): Promise<PlanGoal | null> => {
    setError(null)
    const { data: { user } } = await supabase.auth.getUser()
    const tempId = `temp-${Math.random().toString(36).slice(2)}`
    const now = new Date().toISOString()
    const optimistic: PlanGoal = {
      id: tempId, user_id: user?.id ?? '', description: null, category: null, status: 'not_started',
      parent_id: null, sort_order: 0, created_at: now, updated_at: now, ...fields,
    }
    setGoals(prev => [...prev, optimistic])
    const { data, error } = await supabase
      .from('plan_goals')
      .insert({ ...fields, user_id: user?.id })
      .select('*')
      .single()
    if (error || !data) {
      setGoals(prev => prev.filter(g => g.id !== tempId))
      setError(error?.message ?? 'Could not save')
      return null
    }
    setGoals(prev => prev.map(g => (g.id === tempId ? (data as PlanGoal) : g)))
    return data as PlanGoal
  }, [supabase])

  const updateMany = useCallback(async (updates: { id: string; patch: GoalPatch }[]) => {
    const real = updates.filter(u => !u.id.startsWith('temp-'))
    if (real.length === 0) return
    setError(null)
    const snapshot = goalsRef.current
    const byId = new Map(real.map(u => [u.id, u.patch]))
    setGoals(prev => prev.map(g => (byId.has(g.id) ? { ...g, ...byId.get(g.id) } : g)))
    const now = new Date().toISOString()
    const results = await Promise.all(
      real.map(u => supabase.from('plan_goals').update({ ...u.patch, updated_at: now }).eq('id', u.id)),
    )
    const failed = results.find(r => r.error)
    if (failed?.error) fail(snapshot, failed.error.message)
  }, [supabase, fail])

  const update = useCallback((id: string, patch: GoalPatch) => updateMany([{ id, patch }]), [updateMany])

  const remove = useCallback(async (id: string) => {
    setError(null)
    const snapshot = goalsRef.current
    // Children keep existing (FK is on delete set null) — mirror that locally.
    setGoals(prev => prev.filter(g => g.id !== id).map(g => (g.parent_id === id ? { ...g, parent_id: null } : g)))
    const { error } = await supabase.from('plan_goals').delete().eq('id', id)
    if (error) fail(snapshot, error.message)
  }, [supabase, fail])

  return { goals, loaded, error, setError, create, update, updateMany, remove }
}
