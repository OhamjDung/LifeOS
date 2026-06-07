'use client'

import { useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Task, Contact, TaskType } from '@/lib/types'

interface Props {
  initialTasks: Task[]
  contacts: Pick<Contact, 'id' | 'name'>[]
  today: string
}

export function TaskList({ initialTasks, contacts, today }: Props) {
  const [tasks, setTasks] = useState(initialTasks)
  const [newTitle, setNewTitle] = useState('')
  const [newDate, setNewDate] = useState(today)
  const [newType, setNewType] = useState<TaskType>('task')
  const [newContactId, setNewContactId] = useState('')
  const [isPending, startTransition] = useTransition()
  const supabase = createClient()

  const pending = tasks.filter(t => t.status === 'pending')
  const done = tasks.filter(t => t.status === 'done')

  async function addTask(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim()) return

    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        title: newTitle.trim(),
        due_date: newDate,
        task_type: newType,
        contact_id: newContactId || null,
        user_id: user?.id,
      })
      .select()
      .single()

    if (!error && data) {
      setTasks(prev => [...prev, data as Task])
      setNewTitle('')
      setNewDate(today)
      setNewType('task')
      setNewContactId('')
    }
  }

  async function markDone(task: Task) {
    const newStatus = task.status === 'done' ? 'pending' : 'done'
    const { error } = await supabase
      .from('tasks')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', task.id)

    if (!error) {
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t))
    }
  }

  async function rollover(task: Task) {
    const next = new Date(task.due_date)
    next.setDate(next.getDate() + 1)
    const nextStr = next.toISOString().split('T')[0]

    startTransition(async () => {
      const { error } = await supabase
        .from('tasks')
        .update({ due_date: nextStr, status: 'rolled_over', updated_at: new Date().toISOString() })
        .eq('id', task.id)

      if (!error) {
        await supabase.from('task_rollovers').insert({
          task_id: task.id,
          from_date: task.due_date,
          to_date: nextStr,
        })
        setTasks(prev => prev.filter(t => t.id !== task.id))
      }
    })
  }

  async function deleteTask(id: string) {
    const { error } = await supabase.from('tasks').delete().eq('id', id)
    if (!error) setTasks(prev => prev.filter(t => t.id !== id))
  }

  return (
    <div className="space-y-6">
      {/* Add task form */}
      <form onSubmit={addTask} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="Add a task or event..."
            className="flex-1 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 text-sm"
          />
          <button
            type="submit"
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white text-sm font-medium transition-colors"
          >
            Add
          </button>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          {/* Type toggle */}
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            {(['task', 'event'] as TaskType[]).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setNewType(t)}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  newType === t
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {t === 'task' ? '☑ Task' : '📅 Event'}
              </button>
            ))}
          </div>

          {/* Date picker */}
          <input
            type="date"
            value={newDate}
            onChange={e => setNewDate(e.target.value)}
            className="px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 text-xs focus:outline-none focus:border-indigo-500"
          />

          {/* Contact selector for events */}
          {newType === 'event' && contacts.length > 0 && (
            <select
              value={newContactId}
              onChange={e => setNewContactId(e.target.value)}
              className="px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 text-xs focus:outline-none focus:border-indigo-500"
            >
              <option value="">No contact</option>
              {contacts.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>
      </form>

      {/* Task list */}
      {pending.length === 0 && done.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-8">No tasks today. Add one above.</p>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="space-y-2">
              {pending.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={() => markDone(task)}
                  onRollover={() => rollover(task)}
                  onDelete={() => deleteTask(task.id)}
                  disabled={isPending}
                />
              ))}
            </div>
          )}

          {done.length > 0 && (
            <div>
              <p className="text-xs text-gray-600 mb-2 uppercase tracking-wider">Completed</p>
              <div className="space-y-1 opacity-50">
                {done.map(task => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onToggle={() => markDone(task)}
                    onRollover={() => rollover(task)}
                    onDelete={() => deleteTask(task.id)}
                    disabled={isPending}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TaskRow({
  task, onToggle, onRollover, onDelete, disabled
}: {
  task: Task
  onToggle: () => void
  onRollover: () => void
  onDelete: () => void
  disabled: boolean
}) {
  const isDone = task.status === 'done'
  const isEvent = task.task_type === 'event'
  const rollovers = task.rollover_count ?? 0

  return (
    <div className={`group flex items-center gap-3 px-4 py-3 bg-gray-900 border rounded-xl hover:border-gray-700 transition-colors ${
      isEvent ? 'border-indigo-900/60' : 'border-gray-800'
    } ${rollovers >= 3 ? 'border-l-2 border-l-orange-500' : ''}`}>
      <button
        onClick={onToggle}
        disabled={disabled}
        className={`w-5 h-5 shrink-0 transition-colors flex items-center justify-center ${
          isEvent
            ? `rounded border-2 ${isDone ? 'bg-indigo-600 border-indigo-600' : 'border-gray-600 hover:border-indigo-400'}`
            : `rounded-full border-2 ${isDone ? 'bg-indigo-600 border-indigo-600' : 'border-gray-600 hover:border-indigo-400'}`
        }`}
      >
        {isDone && <span className="text-white text-xs leading-none">✓</span>}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {isEvent && <span className="text-xs text-indigo-400 shrink-0">📅</span>}
          <span className={`text-sm truncate ${isDone ? 'line-through text-gray-500' : 'text-gray-200'}`}>
            {task.title}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {rollovers > 0 && (
            <span className={`text-xs ${rollovers >= 3 ? 'text-orange-400' : 'text-gray-600'}`}>
              ↻{rollovers} {rollovers === 1 ? 'move' : 'moves'}
            </span>
          )}
          {task.due_date !== new Date().toISOString().split('T')[0] && (
            <span className="text-xs text-gray-600">{task.due_date}</span>
          )}
        </div>
      </div>

      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {!isDone && (
          <button
            onClick={onRollover}
            disabled={disabled}
            title="Move to next day"
            className="px-2 py-1 text-xs text-gray-500 hover:text-yellow-400 rounded transition-colors"
          >
            →tmrw
          </button>
        )}
        <button
          onClick={onDelete}
          disabled={disabled}
          className="px-2 py-1 text-xs text-gray-500 hover:text-red-400 rounded transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
