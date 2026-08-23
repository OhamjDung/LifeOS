'use client'

import { ReactNode, useEffect, useState } from 'react'
import { useTaskSelection } from '@/lib/taskSelection'
import { createClient } from '@/lib/supabase/client'
import { Task, Subtask } from '@/lib/types'

const cardStyle = {
  background: '#DEDAD2',
  border: '1px solid rgba(28,26,20,0.1)',
  boxShadow: '2px 2px 6px rgba(107,99,88,0.1)',
}

export function TaskDetailPane({ children }: { children: ReactNode }) {
  const { selected, select } = useTaskSelection()

  if (!selected) return <>{children}</>

  return (
    <TaskDetail
      key={selected.id}
      task={selected}
      onClose={() => select(null)}
      onUpdate={updated => select(updated)}
    />
  )
}

function TaskDetail({
  task,
  onClose,
  onUpdate,
}: {
  task: Task
  onClose: () => void
  onUpdate: (task: Task) => void
}) {
  const supabase = createClient()

  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState(task.description ?? '')
  const [savingDesc, setSavingDesc] = useState(false)

  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [loadingSubtasks, setLoadingSubtasks] = useState(true)
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [newSubtaskGroup, setNewSubtaskGroup] = useState('')
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null)
  const [editSubtaskTitle, setEditSubtaskTitle] = useState('')
  const [editSubtaskGroup, setEditSubtaskGroup] = useState('')

  useEffect(() => {
    let cancelled = false
    supabase
      .from('subtasks')
      .select('*')
      .eq('task_id', task.id)
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return
        setSubtasks((data as Subtask[]) ?? [])
        setLoadingSubtasks(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id])

  const isEvent = task.task_type === 'event'
  const isDone = task.status === 'done'
  const dueStr = new Date(task.due_date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  async function saveDescription() {
    setSavingDesc(true)
    const trimmed = descDraft.trim()
    const { error } = await supabase
      .from('tasks')
      .update({ description: trimmed || null, updated_at: new Date().toISOString() })
      .eq('id', task.id)
    setSavingDesc(false)
    if (!error) {
      onUpdate({ ...task, description: trimmed || null })
      setEditingDesc(false)
    }
  }

  async function addSubtask(e: React.FormEvent) {
    e.preventDefault()
    if (!newSubtaskTitle.trim()) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('subtasks')
      .insert({
        task_id: task.id,
        user_id: user?.id,
        title: newSubtaskTitle.trim(),
        group_name: newSubtaskGroup.trim() || null,
        sort_order: subtasks.length,
      })
      .select()
      .single()

    if (!error && data) {
      setSubtasks(prev => [...prev, data as Subtask])
      setNewSubtaskTitle('')
      setNewSubtaskGroup('')
    }
  }

  async function toggleSubtask(st: Subtask) {
    const newStatus = st.status === 'done' ? 'pending' : 'done'
    const { error } = await supabase
      .from('subtasks')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', st.id)
    if (!error) {
      setSubtasks(prev => prev.map(s => (s.id === st.id ? { ...s, status: newStatus } : s)))
    }
  }

  async function deleteSubtask(id: string) {
    const { error } = await supabase.from('subtasks').delete().eq('id', id)
    if (!error) setSubtasks(prev => prev.filter(s => s.id !== id))
  }

  function startEditSubtask(st: Subtask) {
    setEditingSubtaskId(st.id)
    setEditSubtaskTitle(st.title)
    setEditSubtaskGroup(st.group_name ?? '')
  }

  async function saveSubtaskEdit(st: Subtask) {
    const title = editSubtaskTitle.trim()
    if (!title) {
      setEditingSubtaskId(null)
      return
    }
    const group_name = editSubtaskGroup.trim() || null
    const { error } = await supabase
      .from('subtasks')
      .update({ title, group_name, updated_at: new Date().toISOString() })
      .eq('id', st.id)
    if (!error) {
      setSubtasks(prev => prev.map(s => (s.id === st.id ? { ...s, title, group_name } : s)))
    }
    setEditingSubtaskId(null)
  }

  // Preserve first-seen order of groups; ungrouped subtasks render under a plain "Subtasks" label.
  const groupOrder: (string | null)[] = []
  for (const s of subtasks) {
    const g = s.group_name ?? null
    if (!groupOrder.includes(g)) groupOrder.push(g)
  }
  const doneCount = subtasks.filter(s => s.status === 'done').length

  return (
    <div className="relative">
      <button
        onClick={onClose}
        title="Close and show calendar"
        className="absolute top-0 right-0 w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors z-10"
      >
        ✕
      </button>

      <div className="pr-10">
        <div className="flex items-start gap-2 mb-1">
          {isEvent && <span className="text-indigo-400 shrink-0 mt-0.5">📅</span>}
          <h2 className="text-xl font-bold text-white break-words min-w-0">{task.title}</h2>
        </div>
        <p className="text-gray-400 text-xs mb-6">{dueStr}</p>

        <div className="rounded-xl p-4 space-y-3" style={cardStyle}>
          <DetailRow label="Type" value={isEvent ? 'Event' : 'Task'} />
          <DetailRow label="Status" value={isDone ? 'Done' : 'Pending'} />
          {(task.rollover_count ?? 0) > 0 && (
            <DetailRow label="Rolled over" value={`${task.rollover_count}x`} />
          )}
          {task.tags?.[0] && <DetailRow label="Tag" value={task.tags[0].name} />}
        </div>

        {/* Description / content section */}
        <div className="mt-4 rounded-xl p-4" style={cardStyle}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium" style={{ color: '#1C1A14' }}>
              Description
            </h3>
            {!editingDesc && (
              <button
                onClick={() => {
                  setDescDraft(task.description ?? '')
                  setEditingDesc(true)
                }}
                className="text-xs hover:text-indigo-600 transition-colors"
                style={{ color: '#837C6F' }}
              >
                ✎ Edit
              </button>
            )}
          </div>

          {editingDesc ? (
            <div className="space-y-2">
              <textarea
                autoFocus
                value={descDraft}
                onChange={e => setDescDraft(e.target.value)}
                rows={4}
                placeholder="Add a description..."
                className="w-full px-3 py-2 bg-white/50 border border-gray-400/40 rounded-lg text-sm outline-none focus:border-indigo-500 resize-y"
                style={{ color: '#1C1A14' }}
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setEditingDesc(false)}
                  className="px-3 py-1 text-xs rounded hover:opacity-70 transition-opacity"
                  style={{ color: '#837C6F' }}
                >
                  Cancel
                </button>
                <button
                  onClick={saveDescription}
                  disabled={savingDesc}
                  className="px-3 py-1 text-xs rounded bg-indigo-600 text-[#DEDAD2] hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                >
                  {savingDesc ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          ) : task.description ? (
            <p className="text-sm whitespace-pre-wrap" style={{ color: '#1C1A14' }}>
              {task.description}
            </p>
          ) : (
            <p className="text-xs italic" style={{ color: '#837C6F' }}>
              No description yet.
            </p>
          )}
        </div>

        {/* Subtasks */}
        <div className="mt-4 rounded-xl p-4" style={cardStyle}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium" style={{ color: '#1C1A14' }}>
              Subtasks
            </h3>
            {subtasks.length > 0 && (
              <span className="text-xs" style={{ color: '#837C6F' }}>
                {doneCount}/{subtasks.length} done
              </span>
            )}
          </div>

          {loadingSubtasks ? (
            <p className="text-xs mb-3" style={{ color: '#837C6F' }}>
              Loading...
            </p>
          ) : subtasks.length === 0 ? (
            <p className="text-xs italic mb-3" style={{ color: '#837C6F' }}>
              No subtasks yet.
            </p>
          ) : (
            <div className="space-y-3 mb-3">
              {groupOrder.map(g => {
                const items = subtasks.filter(s => (s.group_name ?? null) === g)
                return (
                  <div key={g ?? '__ungrouped'}>
                    {g && (
                      <p
                        className="text-[11px] uppercase tracking-wider mb-1"
                        style={{ color: '#837C6F' }}
                      >
                        {g}
                      </p>
                    )}
                    <div className="space-y-1">
                      {items.map(st => (
                        <SubtaskRow
                          key={st.id}
                          subtask={st}
                          isEditing={editingSubtaskId === st.id}
                          editTitle={editSubtaskTitle}
                          editGroup={editSubtaskGroup}
                          onToggle={() => toggleSubtask(st)}
                          onDelete={() => deleteSubtask(st.id)}
                          onEditStart={() => startEditSubtask(st)}
                          onEditTitleChange={setEditSubtaskTitle}
                          onEditGroupChange={setEditSubtaskGroup}
                          onEditSave={() => saveSubtaskEdit(st)}
                          onEditCancel={() => setEditingSubtaskId(null)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <form onSubmit={addSubtask} className="flex flex-wrap gap-2">
            <input
              value={newSubtaskTitle}
              onChange={e => setNewSubtaskTitle(e.target.value)}
              placeholder="Add subtask..."
              className="flex-1 min-w-[120px] px-3 py-1.5 bg-white/50 border border-gray-400/40 rounded-lg text-xs outline-none focus:border-indigo-500"
              style={{ color: '#1C1A14' }}
            />
            <input
              value={newSubtaskGroup}
              onChange={e => setNewSubtaskGroup(e.target.value)}
              placeholder="Group (optional)"
              className="w-32 px-3 py-1.5 bg-white/50 border border-gray-400/40 rounded-lg text-xs outline-none focus:border-indigo-500"
              style={{ color: '#1C1A14' }}
            />
            <button
              type="submit"
              className="px-3 py-1.5 text-xs rounded-lg bg-indigo-600 text-[#DEDAD2] hover:bg-indigo-500 transition-colors"
            >
              Add
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span style={{ color: '#837C6F' }}>{label}</span>
      <span style={{ color: '#1C1A14' }}>{value}</span>
    </div>
  )
}

function SubtaskRow({
  subtask,
  isEditing,
  editTitle,
  editGroup,
  onToggle,
  onDelete,
  onEditStart,
  onEditTitleChange,
  onEditGroupChange,
  onEditSave,
  onEditCancel,
}: {
  subtask: Subtask
  isEditing: boolean
  editTitle: string
  editGroup: string
  onToggle: () => void
  onDelete: () => void
  onEditStart: () => void
  onEditTitleChange: (v: string) => void
  onEditGroupChange: (v: string) => void
  onEditSave: () => void
  onEditCancel: () => void
}) {
  const isDone = subtask.status === 'done'

  return (
    <div className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-black/5 transition-colors">
      <button
        onClick={onToggle}
        className={`w-4 h-4 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
          isDone ? 'bg-indigo-600 border-indigo-600' : 'border-gray-400 hover:border-indigo-400'
        }`}
      >
        {isDone && <span className="text-[#DEDAD2] text-[9px] leading-none">✓</span>}
      </button>

      {isEditing ? (
        <div className="flex-1 flex flex-wrap gap-1 items-center">
          <input
            autoFocus
            value={editTitle}
            onChange={e => onEditTitleChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onEditSave()
              if (e.key === 'Escape') onEditCancel()
            }}
            className="flex-1 min-w-[100px] px-2 py-0.5 bg-white border border-indigo-500 rounded text-xs outline-none"
            style={{ color: '#1C1A14' }}
          />
          <input
            value={editGroup}
            onChange={e => onEditGroupChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onEditSave()
              if (e.key === 'Escape') onEditCancel()
            }}
            placeholder="Group"
            className="w-24 px-2 py-0.5 bg-white border border-indigo-500 rounded text-xs outline-none"
            style={{ color: '#1C1A14' }}
          />
          <button onClick={onEditSave} className="text-xs text-green-700 hover:text-green-800 px-1">
            ✓
          </button>
          <button onClick={onEditCancel} className="text-xs text-gray-500 hover:text-red-500 px-1">
            ✕
          </button>
        </div>
      ) : (
        <span
          onDoubleClick={onEditStart}
          className={`flex-1 text-xs truncate ${isDone ? 'line-through' : ''}`}
          style={{ color: isDone ? '#837C6F' : '#1C1A14' }}
        >
          {subtask.title}
        </span>
      )}

      {!isEditing && (
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onEditStart}
            title="Edit"
            className="text-[10px] px-1 hover:text-indigo-600"
            style={{ color: '#837C6F' }}
          >
            ✎
          </button>
          <button
            onClick={onDelete}
            title="Delete"
            className="text-[10px] px-1 hover:text-red-500"
            style={{ color: '#837C6F' }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
