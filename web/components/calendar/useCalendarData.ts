'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CalendarResult, TimeBlock, fetchCalendar } from '@/lib/calendar'
import { parseYmd } from '@/lib/planDates'
import { DayTask } from './WeekGrid'
import { DATA_CHANGED } from '@/lib/chat'

type BlockRow = Omit<TimeBlock, 'tasks'> & { time_block_tasks: { task_id: string; tasks: { id: string; title: string; status: string } | null }[] }
type BlockPatch = Partial<Pick<TimeBlock, 'start_at' | 'end_at' | 'title' | 'color'>>

const POLL_MS = 15 * 60 * 1000

/**
 * Everything a calendar surface needs for local days [rangeStart, rangeEnd):
 * Google events (15-min poll), LifeOS tasks, time blocks + optimistic block
 * mutations that roll back and set `error` on failure.
 */
export function useCalendarData(rangeStart: string, rangeEnd: string) {
  const [supabase] = useState(createClient)
  const [cal, setCal] = useState<CalendarResult | null>(null)
  const [calLoading, setCalLoading] = useState(false)
  const [calError, setCalError] = useState<string | null>(null)
  const [tasks, setTasks] = useState<DayTask[]>([])
  const [blocks, setBlocks] = useState<TimeBlock[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadCalendar = useCallback(async (refresh = false) => {
    setCalLoading(true)
    try {
      const r = await fetchCalendar(parseYmd(rangeStart), parseYmd(rangeEnd), refresh)
      setCal(r)
      setCalError(r.error)
    } catch (e) {
      setCalError(e instanceof Error ? e.message : String(e))
    } finally {
      setCalLoading(false)
    }
  }, [rangeStart, rangeEnd])

  const loadLocal = useCallback(async () => {
    const [{ data: t }, { data: b }] = await Promise.all([
      supabase.from('tasks').select('id,title,status,task_type,due_date')
        .gte('due_date', rangeStart).lt('due_date', rangeEnd).neq('status', 'rolled_over'),
      supabase.from('time_blocks').select('*, time_block_tasks(task_id, tasks(id,title,status))')
        .gte('end_at', parseYmd(rangeStart).toISOString()).lt('start_at', parseYmd(rangeEnd).toISOString()),
    ])
    setTasks((t as DayTask[]) ?? [])
    setBlocks(((b as BlockRow[]) ?? []).map(({ time_block_tasks, ...rest }) => ({
      ...rest,
      tasks: time_block_tasks.map(x => x.tasks).filter((x): x is NonNullable<typeof x> => !!x),
    })))
  }, [supabase, rangeStart, rangeEnd])

  useEffect(() => {
    // Fetch-on-range-change: the synchronous setCalLoading(true) is the intended loading flag.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCalendar()
    loadLocal()
    const t = setInterval(() => loadCalendar(), POLL_MS)
    return () => clearInterval(t)
  }, [loadCalendar, loadLocal])

  // Chat-applied changes (e.g. schedule_block) → reload blocks + tasks.
  useEffect(() => {
    const reload = () => { loadLocal() }
    window.addEventListener(DATA_CHANGED, reload)
    return () => window.removeEventListener(DATA_CHANGED, reload)
  }, [loadLocal])

  async function createBlock(start_at: string, end_at: string, task?: { id: string; title: string }) {
    setError(null)
    const tempId = `temp-${Math.random().toString(36).slice(2)}`
    const { data: { user } } = await supabase.auth.getUser()
    const optimistic: TimeBlock = {
      id: tempId, user_id: user?.id ?? '', title: null, start_at, end_at, color: 'indigo',
      created_at: new Date().toISOString(), tasks: task ? [{ id: task.id, title: task.title, status: 'pending' }] : [],
    }
    setBlocks(prev => [...prev, optimistic])
    const { data, error } = await supabase.from('time_blocks')
      .insert({ user_id: user?.id, start_at, end_at }).select('*').single()
    if (error || !data) {
      setBlocks(prev => prev.filter(b => b.id !== tempId))
      setError(error?.message ?? 'Could not create block')
      return
    }
    if (task) {
      const { error: linkErr } = await supabase.from('time_block_tasks').insert({ block_id: data.id, task_id: task.id, user_id: user?.id })
      if (linkErr) setError(linkErr.message)
    }
    setBlocks(prev => prev.map(b => (b.id === tempId ? { ...(data as TimeBlock), tasks: optimistic.tasks } : b)))
  }

  async function updateBlock(id: string, patch: BlockPatch) {
    setError(null)
    const before = blocks
    setBlocks(prev => prev.map(b => (b.id === id ? { ...b, ...patch } : b)))
    const { error } = await supabase.from('time_blocks').update(patch).eq('id', id)
    if (error) { setBlocks(before); setError(error.message) }
  }

  async function deleteBlock(id: string) {
    setError(null)
    const before = blocks
    setBlocks(prev => prev.filter(b => b.id !== id))
    const { error } = await supabase.from('time_blocks').delete().eq('id', id)
    if (error) { setBlocks(before); setError(error.message) }
  }

  async function assignTask(blockId: string, task: { id: string; title: string }) {
    const block = blocks.find(b => b.id === blockId)
    if (!block || block.tasks.some(t => t.id === task.id)) return
    setError(null)
    const before = blocks
    setBlocks(prev => prev.map(b => (b.id === blockId ? { ...b, tasks: [...b.tasks, { id: task.id, title: task.title, status: 'pending' }] } : b)))
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('time_block_tasks').insert({ block_id: blockId, task_id: task.id, user_id: user?.id })
    if (error) { setBlocks(before); setError(error.message) }
  }

  async function unassignTask(blockId: string, taskId: string) {
    setError(null)
    const before = blocks
    setBlocks(prev => prev.map(b => (b.id === blockId ? { ...b, tasks: b.tasks.filter(t => t.id !== taskId) } : b)))
    const { error } = await supabase.from('time_block_tasks').delete().eq('block_id', blockId).eq('task_id', taskId)
    if (error) { setBlocks(before); setError(error.message) }
  }

  return {
    supabase, cal, calLoading, calError, loadCalendar, tasks, blocks, error, setError,
    createBlock, updateBlock, deleteBlock, assignTask, unassignTask,
  }
}
