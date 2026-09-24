'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SessionTask, Task, Subtask } from '@/lib/types'

export function SessionTaskPanel({ sessionId, textColor, compact = false }: { sessionId: string; textColor: string; compact?: boolean }) {
  const supabase = createClient()
  const [sessionTasks, setSessionTasks] = useState<SessionTask[]>([])
  const [loaded, setLoaded] = useState(false)
  const [allTasks, setAllTasks] = useState<Task[]>([])
  const [allTasksLoaded, setAllTasksLoaded] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [subtaskDrafts, setSubtaskDrafts] = useState<Record<string, string>>({})
  const [subtasksByTask, setSubtasksByTask] = useState<Record<string, Subtask[]>>({})

  async function loadSessionTasks() {
    const { data } = await supabase
      .from('session_tasks')
      .select('*, task:tasks(*)')
      .eq('session_id', sessionId)
      .order('added_at', { ascending: true })
    const rows = ((data as SessionTask[]) ?? [])
      .sort((a, b) => Number(a.task?.status === 'done') - Number(b.task?.status === 'done'))
    setSessionTasks(rows)
    setLoaded(true)

    const taskIds = rows.map(r => r.task_id)
    if (taskIds.length > 0) {
      const { data: subData } = await supabase
        .from('subtasks')
        .select('*')
        .in('task_id', taskIds)
        .order('sort_order', { ascending: true })
      const grouped: Record<string, Subtask[]> = {}
      for (const st of (subData as Subtask[]) ?? []) {
        grouped[st.task_id] = [...(grouped[st.task_id] ?? []), st]
      }
      setSubtasksByTask(grouped)
    }
  }

  async function loadAllTasks() {
    // All pending tasks + tasks completed today (so a tick can be undone without
    // the row vanishing, and the list doesn't grow with every done task ever).
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const { data } = await supabase
      .from('tasks')
      .select('*')
      .or(`status.eq.pending,and(status.eq.done,updated_at.gte.${todayStart.toISOString()})`)
      .order('due_date', { ascending: true })
    setAllTasks((data as Task[]) ?? [])
    setAllTasksLoaded(true)
  }

  useEffect(() => {
    loadSessionTasks()
    loadAllTasks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  async function addExistingTask(task: Task) {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('session_tasks').insert({
      session_id: sessionId,
      task_id: task.id,
      user_id: user?.id,
      is_session_created: false,
    })
    loadSessionTasks()
  }

  async function quickAddTask() {
    const title = newTaskTitle.trim()
    if (!title) return
    setNewTaskTitle('')
    const { data: { user } } = await supabase.auth.getUser()
    const { data: task, error } = await supabase
      .from('tasks')
      .insert({
        user_id: user?.id,
        title,
        task_type: 'task',
        due_date: new Date().toISOString().slice(0, 10),
      })
      .select()
      .single()
    if (error || !task) return
    await supabase.from('session_tasks').insert({
      session_id: sessionId,
      task_id: task.id,
      user_id: user?.id,
      is_session_created: true,
    })
    loadSessionTasks()
    loadAllTasks()
  }

  async function toggleTaskDone(task: Task) {
    const newStatus = task.status === 'done' ? 'pending' : 'done'
    await supabase
      .from('tasks')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', task.id)
    loadSessionTasks()
    loadAllTasks()
  }

  async function unlinkTask(sessionTaskId: string) {
    await supabase.from('session_tasks').delete().eq('id', sessionTaskId)
    loadSessionTasks()
    loadAllTasks()
  }

  async function addSubtask(taskId: string) {
    const title = (subtaskDrafts[taskId] ?? '').trim()
    if (!title) return
    setSubtaskDrafts(prev => ({ ...prev, [taskId]: '' }))
    const { data: { user } } = await supabase.auth.getUser()
    const existing = subtasksByTask[taskId] ?? []
    await supabase.from('subtasks').insert({
      task_id: taskId,
      user_id: user?.id,
      title,
      sort_order: existing.length,
    })
    loadSessionTasks()
  }

  async function toggleSubtask(sub: Subtask) {
    const newStatus = sub.status === 'done' ? 'pending' : 'done'
    await supabase
      .from('subtasks')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', sub.id)
    loadSessionTasks()
  }

  async function deleteSubtask(id: string) {
    await supabase.from('subtasks').delete().eq('id', id)
    loadSessionTasks()
  }

  // compact = pop-out window: no heading, smaller type, tighter padding.
  const sm = compact ? 'text-xs' : 'text-sm'
  const xs = compact ? 'text-[11px]' : 'text-xs'
  const borderColor = textColor === '#DEDAD2' ? 'rgba(222,218,210,0.25)' : 'rgba(28,26,20,0.15)'
  const linkedIds = new Set(sessionTasks.map(st => st.task_id))
  const query = filterQuery.trim().toLowerCase()
  const addableTasks = allTasks
    .filter(t => !linkedIds.has(t.id))
    .filter(t => !query || t.title.toLowerCase().includes(query))
    .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done'))

  return (
    <div className={compact ? 'mt-2' : 'max-w-xl mx-auto mt-4'}>
      {!compact && <h3 className="text-sm font-medium mb-3 opacity-80">Session tasks</h3>}

      {!loaded ? (
        <p className="text-xs opacity-60">Loading…</p>
      ) : sessionTasks.length === 0 ? (
        <p className="text-xs italic opacity-60 mb-3">No tasks in this session yet.</p>
      ) : (
        <div className="space-y-2 mb-4">
          {sessionTasks.map(st => {
            const task = st.task
            const isDone = task?.status === 'done'
            return (
              <div key={st.id} className={`rounded-lg border ${compact ? 'p-2' : 'p-3'}`} style={{ borderColor }}>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => task && toggleTaskDone(task)}
                    className={`w-4 h-4 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
                      isDone ? 'bg-indigo-600 border-indigo-600' : 'hover:border-indigo-400'
                    }`}
                    style={{ borderColor: isDone ? undefined : borderColor }}
                  >
                    {isDone && <span className="text-[#DEDAD2] text-[9px] leading-none">✓</span>}
                  </button>
                  <span className={`${sm} flex-1 min-w-0 break-words ${isDone ? 'line-through opacity-50' : ''}`}>{task?.title}</span>
                  {st.is_session_created && !compact && (
                    <span className="text-[10px] uppercase tracking-wide opacity-50">session task</span>
                  )}
                  <button
                    onClick={() => unlinkTask(st.id)}
                    title="Remove from session"
                    className="text-xs opacity-50 hover:opacity-100 hover:text-red-500 px-1 transition-opacity"
                  >
                    ✕
                  </button>
                </div>
                {(subtasksByTask[st.task_id] ?? []).length > 0 && (
                  <ul className="mt-1.5 ml-6 space-y-1">
                    {subtasksByTask[st.task_id].map(sub => {
                      const subDone = sub.status === 'done'
                      return (
                        <li key={sub.id} className="flex items-center gap-2 group">
                          <button
                            onClick={() => toggleSubtask(sub)}
                            className={`w-3.5 h-3.5 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
                              subDone ? 'bg-indigo-600 border-indigo-600' : 'hover:border-indigo-400'
                            }`}
                            style={{ borderColor: subDone ? undefined : borderColor }}
                          >
                            {subDone && <span className="text-[#DEDAD2] text-[7px] leading-none">✓</span>}
                          </button>
                          <span className={`${xs} flex-1 min-w-0 break-words ${subDone ? 'line-through opacity-50' : 'opacity-70'}`}>
                            {sub.title}
                          </span>
                          <button
                            onClick={() => deleteSubtask(sub.id)}
                            title="Remove subtask"
                            className="text-[10px] opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-red-500 transition-opacity px-1"
                          >
                            ✕
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
                <div className={`flex gap-1.5 mt-2 ${compact ? 'ml-5' : 'ml-6'}`}>
                  <input
                    value={subtaskDrafts[st.task_id] ?? ''}
                    onChange={e => setSubtaskDrafts(prev => ({ ...prev, [st.task_id]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && addSubtask(st.task_id)}
                    placeholder="Add subtask…"
                    className={`flex-1 min-w-0 ${xs} px-2 py-1 rounded border bg-transparent outline-none`}
                    style={{ borderColor, color: textColor }}
                  />
                  <button onClick={() => addSubtask(st.task_id)} className={`shrink-0 ${xs} px-2 py-1 rounded border`} style={{ borderColor }}>
                    Add
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className={`flex gap-1.5 ${compact ? 'mb-4' : 'mb-6'}`}>
        <input
          value={newTaskTitle}
          onChange={e => setNewTaskTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && quickAddTask()}
          placeholder={compact ? 'Quick-add a task…' : 'Quick-add a new task for this session…'}
          className={`flex-1 min-w-0 ${sm} ${compact ? 'px-2 py-1.5' : 'px-3 py-2'} rounded-lg border bg-transparent outline-none`}
          style={{ borderColor, color: textColor }}
        />
        <button onClick={quickAddTask} className={`shrink-0 ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'} ${sm} rounded-lg bg-indigo-600 text-[#DEDAD2]`}>
          Add
        </button>
      </div>

      <h3 className={`${compact ? 'text-[11px]' : 'text-sm'} font-medium mb-2 opacity-80`}>Add existing tasks</h3>
      <input
        value={filterQuery}
        onChange={e => setFilterQuery(e.target.value)}
        placeholder="Filter…"
        className={`w-full min-w-0 ${sm} ${compact ? 'px-2 py-1.5' : 'px-3 py-2'} rounded-lg border bg-transparent outline-none mb-2`}
        style={{ borderColor, color: textColor }}
      />
      {!allTasksLoaded ? (
        <p className="text-xs opacity-60">Loading…</p>
      ) : addableTasks.length === 0 ? (
        <p className="text-xs italic opacity-60">No more tasks to add.</p>
      ) : (
        <div className="space-y-1.5">
          {addableTasks.map(t => {
            const isDone = t.status === 'done'
            return (
              <div
                key={t.id}
                className={`flex items-center gap-2 ${compact ? 'px-2 py-1.5' : 'px-3 py-2'} rounded-lg border hover:bg-black/5 transition-colors ${isDone ? 'opacity-60' : ''}`}
                style={{ borderColor }}
              >
                {/* Same check circle as the linked rows — marks the task done on the main board without linking it. */}
                <button
                  onClick={() => toggleTaskDone(t)}
                  title={isDone ? 'Mark pending' : 'Mark done'}
                  aria-label={`Mark "${t.title}" ${isDone ? 'pending' : 'done'}`}
                  className={`w-4 h-4 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
                    isDone ? 'bg-indigo-600 border-indigo-600' : 'hover:border-indigo-400'
                  }`}
                  style={{ borderColor: isDone ? undefined : borderColor }}
                >
                  {isDone && <span className="text-[#DEDAD2] text-[9px] leading-none">✓</span>}
                </button>
                <button
                  onClick={() => addExistingTask(t)}
                  title="Add to session"
                  className={`flex-1 min-w-0 text-left ${sm} break-words ${isDone ? 'line-through' : ''}`}
                >
                  {t.title}
                </button>
                <span className="shrink-0 text-[10px] uppercase tracking-wide opacity-40">+ add</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
