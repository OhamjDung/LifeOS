'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SessionTask, Task, Subtask } from '@/lib/types'

export function SessionTaskPanel({ sessionId, textColor }: { sessionId: string; textColor: string }) {
  const supabase = createClient()
  const [sessionTasks, setSessionTasks] = useState<SessionTask[]>([])
  const [loaded, setLoaded] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Task[]>([])
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

  useEffect(() => {
    loadSessionTasks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    const linkedIds = new Set(sessionTasks.map(st => st.task_id))
    const handle = setTimeout(async () => {
      const { data } = await supabase
        .from('tasks')
        .select('*')
        .eq('status', 'pending')
        .ilike('title', `%${searchQuery.trim()}%`)
        .limit(10)
      setSearchResults(((data as Task[]) ?? []).filter(t => !linkedIds.has(t.id)))
    }, 250)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, sessionTasks])

  async function addExistingTask(task: Task) {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('session_tasks').insert({
      session_id: sessionId,
      task_id: task.id,
      user_id: user?.id,
      is_session_created: false,
    })
    setSearchQuery('')
    setSearchResults([])
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

  return (
    <div className="max-w-xl mx-auto mt-4">
      <h3 className="text-sm font-medium mb-3 opacity-80">Session tasks</h3>

      {!loaded ? (
        <p className="text-xs opacity-60">Loading…</p>
      ) : sessionTasks.length === 0 ? (
        <p className="text-xs italic opacity-60 mb-3">No tasks in this session yet.</p>
      ) : (
        <div className="space-y-2 mb-4">
          {sessionTasks.map(st => (
            <div key={st.id} className="rounded-lg p-3 border" style={{ borderColor }}>
              <div className="flex items-center justify-between">
                <span className="text-sm">{st.task?.title}</span>
                {st.is_session_created && (
                  <span className="text-[10px] uppercase tracking-wide opacity-50">session task</span>
                )}
              </div>
              {(subtasksByTask[st.task_id] ?? []).length > 0 && (
                <ul className="mt-1.5 ml-3 space-y-0.5">
                  {subtasksByTask[st.task_id].map(sub => (
                    <li key={sub.id} className="text-xs opacity-70">
                      · {sub.title}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2 mt-2">
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
          ))}
        </div>
      )}

      <div className="space-y-2">
        <div className="relative">
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search existing tasks to add…"
            className="w-full text-sm px-3 py-2 rounded-lg border bg-transparent outline-none"
            style={{ borderColor, color: textColor }}
          />
          {searchResults.length > 0 && (
            <div className="absolute z-10 w-full mt-1 rounded-lg border bg-[#DEDAD2] text-[#1C1A14] max-h-48 overflow-y-auto" style={{ borderColor: 'rgba(28,26,20,0.15)' }}>
              {searchResults.map(t => (
                <button
                  key={t.id}
                  onClick={() => addExistingTask(t)}
                  className="block w-full text-left px-3 py-2 text-sm hover:bg-black/5"
                >
                  {t.title}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2">
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
      </div>
    </div>
  )
}
