'use client'

import { ReactNode, useEffect, useState } from 'react'
import { useTaskSelection } from '@/lib/taskSelection'
import { createClient } from '@/lib/supabase/client'
import { Task, Subtask, SubtaskStatus } from '@/lib/types'

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

  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [loadingSubtasks, setLoadingSubtasks] = useState(true)
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [newSubtaskGroup, setNewSubtaskGroup] = useState('')
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null)
  const [editSubtaskTitle, setEditSubtaskTitle] = useState('')
  const [editSubtaskGroup, setEditSubtaskGroup] = useState('')
  const [addingChildId, setAddingChildId] = useState<string | null>(null)
  const [childDraft, setChildDraft] = useState('')

  useEffect(() => {
    let cancelled = false
    supabase
      .from('subtasks')
      .select('*')
      .eq('task_id', task.id)
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return
        const fetched = (data as Subtask[]) ?? []
        setSubtasks(fetched)
        setLoadingSubtasks(false)
        onUpdate({ ...task, subtasks: fetched })
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
    const trimmed = descDraft.trim()
    const prevDescription = task.description
    // Paint immediately — close the editor and show the new text before the write confirms.
    onUpdate({ ...task, description: trimmed || null })
    setEditingDesc(false)

    const { error } = await supabase
      .from('tasks')
      .update({ description: trimmed || null, updated_at: new Date().toISOString() })
      .eq('id', task.id)

    if (error) {
      onUpdate({ ...task, description: prevDescription })
      setDescDraft(prevDescription ?? '')
    }
  }

  async function addSubtask(e: React.FormEvent) {
    e.preventDefault()
    const title = newSubtaskTitle.trim()
    if (!title) return
    const group_name = newSubtaskGroup.trim() || null
    setNewSubtaskTitle('')
    setNewSubtaskGroup('')

    const {
      data: { session },
    } = await supabase.auth.getSession()
    const userId = session?.user?.id ?? ''
    const tempId = `temp-${Date.now()}`
    const optimisticSubtask: Subtask = {
      id: tempId,
      task_id: task.id,
      user_id: userId,
      title,
      group_name,
      parent_subtask_id: null,
      status: 'pending',
      sort_order: subtasks.length,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setSubtasks(prev => {
      const next = [...prev, optimisticSubtask]
      onUpdate({ ...task, subtasks: next })
      return next
    })

    const { data, error } = await supabase
      .from('subtasks')
      .insert({
        task_id: task.id,
        user_id: userId,
        title,
        group_name,
        parent_subtask_id: null,
        sort_order: subtasks.length,
      })
      .select()
      .single()

    if (error || !data) {
      setSubtasks(prev => {
        const next = prev.filter(s => s.id !== tempId)
        onUpdate({ ...task, subtasks: next })
        return next
      })
      return
    }
    setSubtasks(prev => {
      const next = prev.map(s => (s.id === tempId ? (data as Subtask) : s))
      onUpdate({ ...task, subtasks: next })
      return next
    })
  }

  // Sub-tasks can nest to any depth (parent_subtask_id is self-referential) — this adds
  // a child under an existing subtask rather than a new root-level one.
  async function addChildSubtask(parentId: string) {
    const title = childDraft.trim()
    if (!title) return
    setChildDraft('')
    setAddingChildId(null)

    const {
      data: { session },
    } = await supabase.auth.getSession()
    const userId = session?.user?.id ?? ''
    const siblingCount = subtasks.filter(s => s.parent_subtask_id === parentId).length
    const tempId = `temp-${Date.now()}`
    const optimisticSubtask: Subtask = {
      id: tempId,
      task_id: task.id,
      user_id: userId,
      title,
      group_name: null,
      parent_subtask_id: parentId,
      status: 'pending',
      sort_order: siblingCount,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setSubtasks(prev => {
      const next = [...prev, optimisticSubtask]
      onUpdate({ ...task, subtasks: next })
      return next
    })

    const { data, error } = await supabase
      .from('subtasks')
      .insert({
        task_id: task.id,
        user_id: userId,
        title,
        group_name: null,
        parent_subtask_id: parentId,
        sort_order: siblingCount,
      })
      .select()
      .single()

    if (error || !data) {
      setSubtasks(prev => {
        const next = prev.filter(s => s.id !== tempId)
        onUpdate({ ...task, subtasks: next })
        return next
      })
      return
    }
    setSubtasks(prev => {
      const next = prev.map(s => (s.id === tempId ? (data as Subtask) : s))
      onUpdate({ ...task, subtasks: next })
      return next
    })
  }

  async function toggleSubtask(st: Subtask) {
    const newStatus: SubtaskStatus = st.status === 'done' ? 'pending' : 'done'
    const prevSubtasks = subtasks
    setSubtasks(prev => {
      const next = prev.map(s => (s.id === st.id ? { ...s, status: newStatus } : s))
      onUpdate({ ...task, subtasks: next })
      return next
    })

    const { error } = await supabase
      .from('subtasks')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', st.id)

    if (error) {
      setSubtasks(prevSubtasks)
      onUpdate({ ...task, subtasks: prevSubtasks })
    }
  }

  function collectDescendantIds(id: string, all: Subtask[]): string[] {
    const children = all.filter(s => s.parent_subtask_id === id)
    return children.flatMap(c => [c.id, ...collectDescendantIds(c.id, all)])
  }

  async function deleteSubtask(id: string) {
    const prevSubtasks = subtasks
    // DB cascades the delete to descendants — mirror that locally so the tree doesn't
    // show orphaned children after their parent disappears.
    const toRemove = new Set([id, ...collectDescendantIds(id, subtasks)])
    setSubtasks(prev => {
      const next = prev.filter(s => !toRemove.has(s.id))
      onUpdate({ ...task, subtasks: next })
      return next
    })

    const { error } = await supabase.from('subtasks').delete().eq('id', id)
    if (error) {
      setSubtasks(prevSubtasks)
      onUpdate({ ...task, subtasks: prevSubtasks })
    }
  }

  function startEditSubtask(st: Subtask) {
    setEditingSubtaskId(st.id)
    setEditSubtaskTitle(st.title)
    setEditSubtaskGroup(st.group_name ?? '')
  }

  async function saveSubtaskEdit(st: Subtask) {
    const title = editSubtaskTitle.trim()
    setEditingSubtaskId(null)
    if (!title) return
    const group_name = editSubtaskGroup.trim() || null

    const prevSubtasks = subtasks
    setSubtasks(prev => {
      const next = prev.map(s => (s.id === st.id ? { ...s, title, group_name } : s))
      onUpdate({ ...task, subtasks: next })
      return next
    })

    const { error } = await supabase
      .from('subtasks')
      .update({ title, group_name, updated_at: new Date().toISOString() })
      .eq('id', st.id)

    if (error) {
      setSubtasks(prevSubtasks)
      onUpdate({ ...task, subtasks: prevSubtasks })
    }
  }

  // Groups only apply at the root level — nested children just follow their parent regardless of group.
  const rootSubtasks = subtasks.filter(s => !s.parent_subtask_id)
  const groupOrder: (string | null)[] = []
  for (const s of rootSubtasks) {
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
                  className="px-3 py-1 text-xs rounded bg-indigo-600 text-[#DEDAD2] hover:bg-indigo-500 transition-colors"
                >
                  Save
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
                const items = rootSubtasks.filter(s => (s.group_name ?? null) === g)
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
                        <SubtaskNode
                          key={st.id}
                          subtask={st}
                          allSubtasks={subtasks}
                          depth={0}
                          editingSubtaskId={editingSubtaskId}
                          editSubtaskTitle={editSubtaskTitle}
                          editSubtaskGroup={editSubtaskGroup}
                          addingChildId={addingChildId}
                          childDraft={childDraft}
                          onToggle={toggleSubtask}
                          onDelete={deleteSubtask}
                          onEditStart={startEditSubtask}
                          onEditTitleChange={setEditSubtaskTitle}
                          onEditGroupChange={setEditSubtaskGroup}
                          onEditSave={saveSubtaskEdit}
                          onEditCancel={() => setEditingSubtaskId(null)}
                          onStartAddChild={id => { setAddingChildId(id); setChildDraft('') }}
                          onChildDraftChange={setChildDraft}
                          onAddChild={addChildSubtask}
                          onCancelAddChild={() => { setAddingChildId(null); setChildDraft('') }}
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

function SubtaskNode({
  subtask,
  allSubtasks,
  depth,
  editingSubtaskId,
  editSubtaskTitle,
  editSubtaskGroup,
  addingChildId,
  childDraft,
  onToggle,
  onDelete,
  onEditStart,
  onEditTitleChange,
  onEditGroupChange,
  onEditSave,
  onEditCancel,
  onStartAddChild,
  onChildDraftChange,
  onAddChild,
  onCancelAddChild,
}: {
  subtask: Subtask
  allSubtasks: Subtask[]
  depth: number
  editingSubtaskId: string | null
  editSubtaskTitle: string
  editSubtaskGroup: string
  addingChildId: string | null
  childDraft: string
  onToggle: (s: Subtask) => void
  onDelete: (id: string) => void
  onEditStart: (s: Subtask) => void
  onEditTitleChange: (v: string) => void
  onEditGroupChange: (v: string) => void
  onEditSave: (s: Subtask) => void
  onEditCancel: () => void
  onStartAddChild: (id: string) => void
  onChildDraftChange: (v: string) => void
  onAddChild: (parentId: string) => void
  onCancelAddChild: () => void
}) {
  const children = allSubtasks.filter(s => s.parent_subtask_id === subtask.id)
  const indent = { marginLeft: depth > 0 ? 20 : 0 }

  return (
    <div>
      <SubtaskRow
        subtask={subtask}
        isOptimistic={subtask.id.startsWith('temp-')}
        isEditing={editingSubtaskId === subtask.id}
        editTitle={editSubtaskTitle}
        editGroup={editSubtaskGroup}
        onToggle={() => onToggle(subtask)}
        onDelete={() => onDelete(subtask.id)}
        onEditStart={() => onEditStart(subtask)}
        onEditTitleChange={onEditTitleChange}
        onEditGroupChange={onEditGroupChange}
        onEditSave={() => onEditSave(subtask)}
        onEditCancel={onEditCancel}
        onAddChildStart={() => onStartAddChild(subtask.id)}
      />

      {addingChildId === subtask.id && (
        <div className="flex gap-2 mt-1 mb-1" style={indent}>
          <input
            autoFocus
            value={childDraft}
            onChange={e => onChildDraftChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onAddChild(subtask.id)
              if (e.key === 'Escape') onCancelAddChild()
            }}
            placeholder="Add sub-task..."
            className="flex-1 min-w-[100px] px-2 py-1 bg-white border border-indigo-500 rounded text-xs outline-none"
            style={{ color: '#1C1A14' }}
          />
          <button onClick={() => onAddChild(subtask.id)} className="text-xs text-green-700 hover:text-green-800 px-1">
            ✓
          </button>
          <button onClick={onCancelAddChild} className="text-xs text-gray-500 hover:text-red-500 px-1">
            ✕
          </button>
        </div>
      )}

      {children.length > 0 && (
        <div className="space-y-1" style={indent}>
          {children.map(child => (
            <SubtaskNode
              key={child.id}
              subtask={child}
              allSubtasks={allSubtasks}
              depth={depth + 1}
              editingSubtaskId={editingSubtaskId}
              editSubtaskTitle={editSubtaskTitle}
              editSubtaskGroup={editSubtaskGroup}
              addingChildId={addingChildId}
              childDraft={childDraft}
              onToggle={onToggle}
              onDelete={onDelete}
              onEditStart={onEditStart}
              onEditTitleChange={onEditTitleChange}
              onEditGroupChange={onEditGroupChange}
              onEditSave={onEditSave}
              onEditCancel={onEditCancel}
              onStartAddChild={onStartAddChild}
              onChildDraftChange={onChildDraftChange}
              onAddChild={onAddChild}
              onCancelAddChild={onCancelAddChild}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SubtaskRow({
  subtask,
  isEditing,
  isOptimistic,
  editTitle,
  editGroup,
  onToggle,
  onDelete,
  onEditStart,
  onEditTitleChange,
  onEditGroupChange,
  onEditSave,
  onEditCancel,
  onAddChildStart,
}: {
  subtask: Subtask
  isEditing: boolean
  isOptimistic?: boolean
  editTitle: string
  editGroup: string
  onToggle: () => void
  onDelete: () => void
  onEditStart: () => void
  onEditTitleChange: (v: string) => void
  onEditGroupChange: (v: string) => void
  onEditSave: () => void
  onEditCancel: () => void
  onAddChildStart: () => void
}) {
  const isDone = subtask.status === 'done'

  return (
    <div
      className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-black/5 transition-colors ${isOptimistic ? 'opacity-60' : ''}`}
    >
      <button
        onClick={onToggle}
        disabled={isOptimistic}
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
            onClick={onAddChildStart}
            disabled={isOptimistic}
            title="Add sub-task"
            className="text-[10px] px-1 hover:text-indigo-600 disabled:opacity-50"
            style={{ color: '#837C6F' }}
          >
            ＋
          </button>
          <button
            onClick={onEditStart}
            disabled={isOptimistic}
            title="Edit"
            className="text-[10px] px-1 hover:text-indigo-600 disabled:opacity-50"
            style={{ color: '#837C6F' }}
          >
            ✎
          </button>
          <button
            onClick={onDelete}
            disabled={isOptimistic}
            title="Delete"
            className="text-[10px] px-1 hover:text-red-500 disabled:opacity-50"
            style={{ color: '#837C6F' }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
