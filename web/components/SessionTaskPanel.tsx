'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SessionTask, Task, Subtask } from '@/lib/types'

export function SessionTaskPanel({ sessionId, textColor }: { sessionId: string; textColor: string }) {
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
    const rows = (data as SessionTask[]) ?? []
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
    const { data } = await supabase
      .from('tasks')
      .select('*')
      .eq('status', 'pending')
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

  const borderColor = textColor === '#DEDAD2' ? 'rgba(222,218,210,0.25)' : 'rgba(28,26,20,0.15)'
  const linkedIds = new Set(sessionTasks.map(st => st.task_id))
  const query = filterQuery.trim().toLowerCase()
  const addableTasks = allTasks
    .filter(t => !linkedIds.has(t.id))
    .filter(t => !query || t.title.toLowerCase().includes(query))

  return (
    <div className="max-w-xl mx-auto mt-4">
      <h3 className="text-sm font-medium mb-3 opacity-80">Session tasks</h3>

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
              <div key={st.id} className="rounded-lg p-3 border" style={{ borderColor }}>
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
                  <span className={`text-sm flex-1 ${isDone ? 'line-through opacity-50' : ''}`}>{task?.title}</span>
                  {st.is_session_created && (
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
                  <ul className="mt-1.5 ml-6 space-y-0.5">
                    {subtasksByTask[st.task_id].map(sub => (
                      <li key={sub.id} className="text-xs opacity-70">
                        · {sub.title}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-2 mt-2 ml-6">
                  <input
                    value={subtaskDrafts[st.task_id] ?? ''}
                    onChange={e => setSubtaskDrafts(prev => ({ ...prev, [st.task_id]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && addSubtask(st.task_id)}
                    placeholder="Add subtask…"
                    className="flex-1 text-xs px-2 py-1 rounded border bg-transparent outline-none"
                    style={{ borderColor, color: textColor }}
                  />
                  <button onClick={() => addSubtask(st.task_id)} className="text-xs px-2 py-1 rounded border" style={{ borderColor }}>
                    Add
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex gap-2 mb-6">
        <input
          value={newTaskTitle}
          onChange={e => setNewTaskTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && quickAddTask()}
          placeholder="Quick-add a new task for this session…"
          className="flex-1 text-sm px-3 py-2 rounded-lg border bg-transparent outline-none"
          style={{ borderColor, color: textColor }}
        />
        <button onClick={quickAddTask} className="px-3 py-2 text-sm rounded-lg bg-indigo-600 text-[#DEDAD2]">
          Add
        </button>
      </div>

      <h3 className="text-sm font-medium mb-2 opacity-80">Add existing tasks</h3>
      <input
        value={filterQuery}
        onChange={e => setFilterQuery(e.target.value)}
        placeholder="Filter…"
        className="w-full text-sm px-3 py-2 rounded-lg border bg-transparent outline-none mb-2"
        style={{ borderColor, color: textColor }}
      />
      {!allTasksLoaded ? (
        <p className="text-xs opacity-60">Loading…</p>
      ) : addableTasks.length === 0 ? (
        <p className="text-xs italic opacity-60">No more pending tasks to add.</p>
      ) : (
        <div className="space-y-1.5">
          {addableTasks.map(t => (
            <button
              key={t.id}
              onClick={() => addExistingTask(t)}
              className="w-full text-left text-sm px-3 py-2 rounded-lg border hover:bg-black/5 transition-colors"
              style={{ borderColor }}
            >
              {t.title}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
