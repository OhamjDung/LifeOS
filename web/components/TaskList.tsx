'use client'

import { useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Task, Contact, TaskType } from '@/lib/types'

interface Props {
  initialTasks: Task[]
  contacts: Pick<Contact, 'id' | 'name'>[]
  today: string
}

function datePlus(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

export function TaskList({ initialTasks, contacts, today }: Props) {
  const [tasks, setTasks] = useState(initialTasks)
  const [newTitle, setNewTitle] = useState('')
  const [newDate, setNewDate] = useState(today)
  const [newType, setNewType] = useState<TaskType>('task')
  const [newContactId, setNewContactId] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [isPending, startTransition] = useTransition()
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [dragSection, setDragSection] = useState<'followUp' | 'pending' | null>(null)
  const supabase = createClient()

  const followUp = tasks.filter(t => t.status === 'pending' && !!t.contact_id)
  const pending = tasks.filter(t => t.status === 'pending' && !t.contact_id)
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
      setTasks(prev => [...prev, { ...data, tags: [] } as Task])
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

  async function saveEdit(task: Task) {
    if (!editTitle.trim() || editTitle.trim() === task.title) {
      setEditingId(null)
      return
    }
    const { error } = await supabase
      .from('tasks')
      .update({ title: editTitle.trim(), updated_at: new Date().toISOString() })
      .eq('id', task.id)

    if (!error) {
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, title: editTitle.trim() } : t))
    }
    setEditingId(null)
  }

  async function deleteTask(id: string) {
    const { error } = await supabase.from('tasks').delete().eq('id', id)
    if (!error) setTasks(prev => prev.filter(t => t.id !== id))
  }

  function handleDragStart(idx: number, section: 'followUp' | 'pending') {
    setDragIdx(idx)
    setDragSection(section)
  }

  function handleDragOver(e: React.DragEvent, idx: number, section: 'followUp' | 'pending') {
    e.preventDefault()
    if (section !== dragSection) return
    setDragOverIdx(idx)
  }

  function handleDrop(idx: number, section: 'followUp' | 'pending') {
    if (dragIdx === null || dragSection !== section || dragIdx === idx) {
      setDragIdx(null); setDragOverIdx(null); setDragSection(null)
      return
    }
    const src = section === 'followUp' ? followUp : pending
    const reordered = [...src]
    const [moved] = reordered.splice(dragIdx, 1)
    reordered.splice(idx, 0, moved)
    setTasks(
      section === 'followUp'
        ? [...reordered, ...pending, ...done]
        : [...followUp, ...reordered, ...done],
    )
    setDragIdx(null); setDragOverIdx(null); setDragSection(null)
  }

  function handleDragEnd() {
    setDragIdx(null); setDragOverIdx(null); setDragSection(null)
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
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-[#DEDAD2] text-sm font-medium transition-colors"
          >
            Add
          </button>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {/* Type toggle */}
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            {(['task', 'event'] as TaskType[]).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setNewType(t)}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  newType === t
                    ? 'bg-indigo-600 text-[#DEDAD2]'
                    : 'bg-gray-800 text-gray-400 hover:text-[#1C1A14]'
                }`}
              >
                {t === 'task' ? '◉ Task' : '☐ Event'}
              </button>
            ))}
          </div>

          {/* Date presets */}
          <div className="flex gap-1">
            {[
              { label: 'Today', days: 0 },
              { label: 'Tmrw', days: 1 },
              { label: '+2', days: 2 },
              { label: '+7', days: 7 },
            ].map(({ label, days }) => {
              const d = datePlus(days)
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setNewDate(d)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    newDate === d
                      ? 'bg-indigo-600 text-[#DEDAD2]'
                      : 'bg-gray-800 text-gray-400 hover:text-[#1C1A14]'
                  }`}
                >
                  {label}
                </button>
              )
            })}
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
      {followUp.length === 0 && pending.length === 0 && done.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-8">No tasks today. Add one above.</p>
      ) : (
        <>
          {followUp.length > 0 && (
            <div className="space-y-2 mb-4">
              <p className="text-xs text-gray-600 uppercase tracking-wider mb-2">● Keep in Touch</p>
              {followUp.map((task, idx) => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={() => handleDragStart(idx, 'followUp')}
                  onDragOver={e => handleDragOver(e, idx, 'followUp')}
                  onDrop={() => handleDrop(idx, 'followUp')}
                  onDragEnd={handleDragEnd}
                  className={`cursor-grab active:cursor-grabbing transition-all ${
                    dragOverIdx === idx && dragSection === 'followUp' && dragIdx !== idx
                      ? 'border-t-2 border-indigo-500 pt-0.5'
                      : ''
                  } ${dragIdx === idx && dragSection === 'followUp' ? 'opacity-40' : ''}`}
                >
                  <TaskRow
                    task={task}
                    editingId={editingId}
                    editTitle={editTitle}
                    onToggle={() => markDone(task)}
                    onRollover={() => rollover(task)}
                    onDelete={() => deleteTask(task.id)}
                    onEditStart={() => { setEditingId(task.id); setEditTitle(task.title) }}
                    onEditChange={setEditTitle}
                    onEditSave={() => saveEdit(task)}
                    onEditCancel={() => setEditingId(null)}
                    disabled={isPending}
                  />
                </div>
              ))}
            </div>
          )}

          {pending.length > 0 && (
            <div className="space-y-2">
              {pending.map((task, idx) => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={() => handleDragStart(idx, 'pending')}
                  onDragOver={e => handleDragOver(e, idx, 'pending')}
                  onDrop={() => handleDrop(idx, 'pending')}
                  onDragEnd={handleDragEnd}
                  className={`cursor-grab active:cursor-grabbing transition-all ${
                    dragOverIdx === idx && dragSection === 'pending' && dragIdx !== idx
                      ? 'border-t-2 border-indigo-500 pt-0.5'
                      : ''
                  } ${dragIdx === idx && dragSection === 'pending' ? 'opacity-40' : ''}`}
                >
                  <TaskRow
                    task={task}
                    editingId={editingId}
                    editTitle={editTitle}
                    onToggle={() => markDone(task)}
                    onRollover={() => rollover(task)}
                    onDelete={() => deleteTask(task.id)}
                    onEditStart={() => { setEditingId(task.id); setEditTitle(task.title) }}
                    onEditChange={setEditTitle}
                    onEditSave={() => saveEdit(task)}
                    onEditCancel={() => setEditingId(null)}
                    disabled={isPending}
                  />
                </div>
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
                    editingId={editingId}
                    editTitle={editTitle}
                    onToggle={() => markDone(task)}
                    onRollover={() => rollover(task)}
                    onDelete={() => deleteTask(task.id)}
                    onEditStart={() => { setEditingId(task.id); setEditTitle(task.title) }}
                    onEditChange={setEditTitle}
                    onEditSave={() => saveEdit(task)}
                    onEditCancel={() => setEditingId(null)}
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
  task, editingId, editTitle, onToggle, onRollover, onDelete,
  onEditStart, onEditChange, onEditSave, onEditCancel, disabled,
}: {
  task: Task
  editingId: string | null
  editTitle: string
  onToggle: () => void
  onRollover: () => void
  onDelete: () => void
  onEditStart: () => void
  onEditChange: (v: string) => void
  onEditSave: () => void
  onEditCancel: () => void
  disabled: boolean
}) {
  const isDone = task.status === 'done'
  const isEvent = task.task_type === 'event'
  const isContact = !!task.contact_id
  const rolls = task.rollover_count ?? 0
  const isEditing = editingId === task.id

  return (
    <div className={`group flex items-center gap-3 px-4 py-3 bg-gray-900 border rounded-xl hover:border-gray-700 transition-colors ${
      isEvent ? 'border-indigo-900/60' : 'border-gray-800'
    } ${rolls >= 3 ? 'border-l-2 border-l-orange-500' : ''}`}>
      <button
        onClick={onToggle}
        disabled={disabled}
        className={`w-5 h-5 shrink-0 transition-colors flex items-center justify-center ${
          isEvent
            ? `rounded border-2 ${isDone ? 'bg-indigo-600 border-indigo-600' : 'border-gray-600 hover:border-indigo-400'}`
            : `rounded-full border-2 ${isDone ? 'bg-indigo-600 border-indigo-600' : 'border-gray-600 hover:border-indigo-400'}`
        }`}
      >
        {isDone && <span className="text-[#DEDAD2] text-xs leading-none">✓</span>}
      </button>

      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            autoFocus
            value={editTitle}
            onChange={e => onEditChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onEditSave(); if (e.key === 'Escape') onEditCancel() }}
            onBlur={onEditSave}
            className="w-full bg-gray-800 border border-indigo-500 rounded px-2 py-0.5 text-sm text-white outline-none"
          />
        ) : (
          <>
            <div className="flex items-center gap-2">
              {isEvent && <span className="text-xs text-indigo-400 shrink-0">📅</span>}
              <span
                className={`text-sm truncate ${isDone ? 'line-through text-gray-500' : 'text-gray-200'}`}
                onDoubleClick={onEditStart}
              >
                {task.title}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {isContact && !isDone ? (
                <span className="text-xs text-orange-400">● KEEP IN TOUCH</span>
              ) : rolls > 0 ? (
                <span className={`text-xs ${rolls >= 3 ? 'text-orange-400' : 'text-gray-600'}`}>
                  ↻{rolls} {rolls === 1 ? 'move' : 'moves'}
                </span>
              ) : task.tags?.[0] ? (
                <span className="text-xs px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded">
                  {task.tags[0].name}
                </span>
              ) : null}
              {task.due_date !== new Date().toISOString().split('T')[0] && (
                <span className="text-xs text-gray-600">{task.due_date}</span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {!isDone && !isEditing && (
          <button
            onClick={onEditStart}
            disabled={disabled}
            title="Edit"
            className="px-2 py-1 text-xs text-gray-500 hover:text-indigo-400 rounded transition-colors"
          >
            ✎
          </button>
        )}
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
