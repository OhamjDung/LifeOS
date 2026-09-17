'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Task, Contact, TaskType, PersistedTaskGroup, TaskGroupColor } from '@/lib/types'
import { useTaskSelection } from '@/lib/taskSelection'

type GroupColor = TaskGroupColor

// Shape returned by fn-group-tasks (AI's raw suggestion, before it's persisted as task_groups rows).
interface AiGroupSuggestion {
  name: string
  color: GroupColor
  task_ids: string[]
}

const GROUP_COLORS: Record<
  GroupColor,
  { bg: string; border: string; dot: string; text: string; bar: string; barBg: string }
> = {
  indigo: {
    bg: 'bg-indigo-950/30',
    border: 'border-indigo-700/30',
    dot: 'bg-indigo-400',
    text: 'text-indigo-300',
    bar: 'bg-indigo-500',
    barBg: 'bg-indigo-900/30',
  },
  orange: {
    bg: 'bg-orange-950/20',
    border: 'border-orange-700/30',
    dot: 'bg-orange-400',
    text: 'text-orange-300',
    bar: 'bg-orange-500',
    barBg: 'bg-orange-900/20',
  },
  green: {
    bg: 'bg-green-950/20',
    border: 'border-green-700/30',
    dot: 'bg-green-400',
    text: 'text-green-300',
    bar: 'bg-green-500',
    barBg: 'bg-green-900/20',
  },
  yellow: {
    bg: 'bg-yellow-950/20',
    border: 'border-yellow-700/30',
    dot: 'bg-yellow-400',
    text: 'text-yellow-300',
    bar: 'bg-yellow-500',
    barBg: 'bg-yellow-900/20',
  },
  rose: {
    bg: 'bg-rose-950/20',
    border: 'border-rose-700/30',
    dot: 'bg-rose-400',
    text: 'text-rose-300',
    bar: 'bg-rose-500',
    barBg: 'bg-rose-900/20',
  },
  cyan: {
    bg: 'bg-cyan-950/20',
    border: 'border-cyan-700/30',
    dot: 'bg-cyan-400',
    text: 'text-cyan-300',
    bar: 'bg-cyan-500',
    barBg: 'bg-cyan-900/20',
  },
  purple: {
    bg: 'bg-purple-950/20',
    border: 'border-purple-700/30',
    dot: 'bg-purple-400',
    text: 'text-purple-300',
    bar: 'bg-purple-500',
    barBg: 'bg-purple-900/20',
  },
}

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
  const [editingDueId, setEditingDueId] = useState<string | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [dragSection, setDragSection] = useState<'followUp' | 'pending' | null>(null)
  // Group view state — groups are persisted (task_groups table + tasks.group_id), so they
  // survive tab switches/reload; groupView itself just remembers which display mode to default to.
  const [grouping, setGrouping] = useState(false)
  const [groupView, setGroupView] = useState(() => initialTasks.some(t => t.group_id))
  const [persistedGroups, setPersistedGroups] = useState<PersistedTaskGroup[]>([])
  const [groupError, setGroupError] = useState<string | null>(null)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [orderBy, setOrderBy] = useState<'created' | 'due'>('created')
  // Priority mode: while active, clicking a row stages/unstages it instead of opening the detail pane.
  // Staged selection only becomes real (`is_priority`) when priority mode is turned back off.
  const [priorityMode, setPriorityMode] = useState(false)
  const [stagedPriorityIds, setStagedPriorityIds] = useState<Set<string>>(new Set())
  const supabase = createClient()
  const { select, selected } = useTaskSelection()

  // B-screen detail pane owns its own edits (description, subtasks) — mirror them back
  // into this list's state so the A-screen row (badge, nested subtasks) stays live.
  useEffect(() => {
    if (!selected) return
    setTasks(prev => prev.map(t => (t.id === selected.id ? selected : t)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  useEffect(() => {
    supabase
      .from('task_groups')
      .select('*')
      .order('created_at', { ascending: true })
      .then(({ data }) => setPersistedGroups((data as PersistedTaskGroup[]) ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const mutationLocks = useRef(new Set<string>())
  const [mutationError, setMutationError] = useState('')

  async function updateTask(task: Task, patch: Partial<Task>) {
    if (task.id.startsWith('temp-') || mutationLocks.current.has(task.id)) return
    mutationLocks.current.add(task.id)
    setMutationError('')
    setTasks(previous => previous.map(item => item.id === task.id ? { ...item, ...patch } : item))
    try {
      const { error } = await supabase.from('tasks').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', task.id)
      if (error) throw error
    } catch {
      const rollback = Object.fromEntries(Object.keys(patch).map(key => [key, task[key as keyof Task]]))
      setTasks(previous => previous.map(item => item.id === task.id ? { ...item, ...rollback } : item))
      setMutationError('Could not save that change. It has been restored; please retry.')
    } finally { mutationLocks.current.delete(task.id) }
  }

  async function moveTaskToGroup(taskId: string, groupId: string | null) {
    const task = tasks.find(item => item.id === taskId)
    if (task) await updateTask(task, { group_id: groupId })
  }

  function handleGroupDragStart(taskId: string) {
    setDraggedTaskId(taskId)
  }

  function handleGroupDrop(groupId: string | null) {
    if (draggedTaskId) moveTaskToGroup(draggedTaskId, groupId)
    setDraggedTaskId(null)
  }

  function orderTasks(arr: Task[]) {
    // 'created' keeps the fetch order (rollover priority, then creation order) — leave as-is.
    const base =
      orderBy === 'due'
        ? [...arr].sort((a, b) =>
            a.due_date === b.due_date
              ? a.created_at.localeCompare(b.created_at)
              : a.due_date.localeCompare(b.due_date),
          )
        : arr
    // Stable partition: prioritized tasks float to top, ordering within each group untouched.
    return [...base].sort((a, b) => Number(b.is_priority) - Number(a.is_priority))
  }

  const followUp = orderTasks(tasks.filter(t => t.status === 'pending' && !!t.contact_id))
  const pending = orderTasks(tasks.filter(t => t.status === 'pending' && !t.contact_id))
  const done = tasks.filter(t => t.status === 'done')

  function togglePriorityMode() {
    if (!priorityMode) {
      setStagedPriorityIds(new Set(tasks.filter(t => t.is_priority).map(t => t.id)))
      setPriorityMode(true)
      return
    }
    // Turning off — commit staged selection as the real is_priority flags.
    const changed = tasks.filter(t => stagedPriorityIds.has(t.id) !== t.is_priority)
    setPriorityMode(false)
    if (changed.length === 0) return

    const prevTasks = tasks
    setTasks(prev => prev.map(t => ({ ...t, is_priority: stagedPriorityIds.has(t.id) })))

    const toPrioritize = changed.filter(t => stagedPriorityIds.has(t.id)).map(t => t.id)
    const toUnprioritize = changed.filter(t => !stagedPriorityIds.has(t.id)).map(t => t.id)
    const writes: PromiseLike<{ error: any }>[] = []
    if (toPrioritize.length > 0) {
      writes.push(
        supabase
          .from('tasks')
          .update({ is_priority: true, updated_at: new Date().toISOString() })
          .in('id', toPrioritize),
      )
    }
    if (toUnprioritize.length > 0) {
      writes.push(
        supabase
          .from('tasks')
          .update({ is_priority: false, updated_at: new Date().toISOString() })
          .in('id', toUnprioritize),
      )
    }
    Promise.all(writes).then(results => {
      if (results.some(r => r.error)) setTasks(prevTasks)
    })
  }

  function toggleStagedPriority(taskId: string) {
    setStagedPriorityIds(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title) return

    const dueDate = newDate
    const taskType = newType
    const contactId = newContactId || null
    setNewTitle('')
    setNewDate(today)
    setNewType('task')
    setNewContactId('')

    // Optimistic insert — paint the row now, reconcile with the real id once the insert returns.
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const userId = session?.user?.id ?? ''
    const tempId = `temp-${Date.now()}`
    const optimisticTask: Task = {
      id: tempId,
      user_id: userId,
      title,
      description: null,
      status: 'pending',
      task_type: taskType,
      due_date: dueDate,
      contact_id: contactId,
      rollover_count: 0,
      is_priority: false,
      raw_source: null,
      mode_at_creation: null,
      ai_merged_from: null,
      group_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tags: [],
      subtasks: [],
    }
    setTasks(prev => [...prev, optimisticTask])

    const { data, error } = await supabase
      .from('tasks')
      .insert({
        title,
        due_date: dueDate,
        task_type: taskType,
        contact_id: contactId,
        user_id: userId,
      })
      .select()
      .single()

    if (error || !data) {
      setTasks(prev => prev.filter(t => t.id !== tempId))
      return
    }
    setTasks(prev => prev.map(t => (t.id === tempId ? ({ ...data, tags: [], subtasks: [] } as Task) : t)))
  }

  async function markDone(task: Task) {
    await updateTask(task, { status: task.status === 'done' ? 'pending' : 'done' })
  }

  async function rollover(task: Task) {
    const next = new Date(task.due_date)
    next.setDate(next.getDate() + 1)
    const nextStr = next.toISOString().split('T')[0]

    const prevTasks = tasks
    setTasks(prev => prev.filter(t => t.id !== task.id))

    const { error } = await supabase
      .from('tasks')
      .update({ due_date: nextStr, status: 'rolled_over', updated_at: new Date().toISOString() })
      .eq('id', task.id)

    if (error) {
      setTasks(prevTasks)
      return
    }
    // Rollover count is secondary bookkeeping — the row already moved, don't undo the UI over it.
    const { error: insErr } = await supabase.from('task_rollovers').insert({
      task_id: task.id,
      from_date: task.due_date,
      to_date: nextStr,
    })
    if (insErr) console.error('task_rollovers insert failed', insErr)
  }

  async function saveEdit(task: Task) {
    const title = editTitle.trim()
    setEditingId(null)
    if (!title || title === task.title) return

    await updateTask(task, { title })
  }

  async function updateDueDate(task: Task, newDate: string) {
    setEditingDueId(null)
    if (!newDate || newDate === task.due_date) return

    await updateTask(task, { due_date: newDate })
  }

  async function deleteTask(id: string) {
    const prevTasks = tasks
    setTasks(prev => prev.filter(t => t.id !== id))

    const { error } = await supabase.from('tasks').delete().eq('id', id)
    if (error) setTasks(prevTasks)
  }

  async function toggleSubtask(taskId: string, subtaskId: string) {
    const task = tasks.find(t => t.id === taskId)
    const st = task?.subtasks?.find(s => s.id === subtaskId)
    if (!st) return
    const newStatus = st.status === 'done' ? 'pending' : 'done'

    const prevTasks = tasks
    setTasks(prev =>
      prev.map(t =>
        t.id === taskId
          ? { ...t, subtasks: (t.subtasks ?? []).map(s => (s.id === subtaskId ? { ...s, status: newStatus } : s)) }
          : t,
      ),
    )

    const { error } = await supabase
      .from('subtasks')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', subtaskId)

    if (error) setTasks(prevTasks)
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
      setDragIdx(null)
      setDragOverIdx(null)
      setDragSection(null)
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
    setDragIdx(null)
    setDragOverIdx(null)
    setDragSection(null)
  }

  function handleDragEnd() {
    setDragIdx(null)
    setDragOverIdx(null)
    setDragSection(null)
  }

  async function handleGroupTasks() {
    const activeTasks = [...followUp, ...pending]
    if (activeTasks.length < 2) return
    setGrouping(true)
    setGroupError(null)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const { data: { user } } = await supabase.auth.getUser()
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fn-group-tasks`
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          tasks: activeTasks.map(t => ({ id: t.id, title: t.title })),
        }),
      })
      if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText)
        throw new Error(`${resp.status}: ${errText.slice(0, 120)}`)
      }
      const data = await resp.json()
      const suggestions = (data.groups as AiGroupSuggestion[]) ?? []
      const aiUngroupedIds = (data.ungrouped_ids as string[]) ?? []
      if (suggestions.length === 0) {
        setGroupError('AI returned no groups — tasks may be too similar or too few.')
        return
      }

      // Persist each AI suggestion as a real task_groups row, then assign tasks to it —
      // this is what makes grouping survive a tab switch instead of living only in this component's state.
      const newGroups: PersistedTaskGroup[] = []
      const assignment: Record<string, string> = {}
      for (const s of suggestions) {
        const { data: created, error } = await supabase
          .from('task_groups')
          .insert({ user_id: user?.id, name: s.name, color: s.color })
          .select()
          .single()
        if (error || !created) continue
        newGroups.push(created as PersistedTaskGroup)
        for (const taskId of s.task_ids) assignment[taskId] = created.id
      }

      for (const g of newGroups) {
        const ids = Object.keys(assignment).filter(id => assignment[id] === g.id)
        if (ids.length > 0) {
          await supabase.from('tasks').update({ group_id: g.id, updated_at: new Date().toISOString() }).in('id', ids)
        }
      }
      if (aiUngroupedIds.length > 0) {
        await supabase.from('tasks').update({ group_id: null, updated_at: new Date().toISOString() }).in('id', aiUngroupedIds)
      }

      setPersistedGroups(prev => [...prev, ...newGroups])
      setTasks(prev =>
        prev.map(t => {
          if (assignment[t.id]) return { ...t, group_id: assignment[t.id] }
          if (aiUngroupedIds.includes(t.id)) return { ...t, group_id: null }
          return t
        }),
      )
      setGroupView(true)
    } catch (e: any) {
      setGroupError(e.message ?? 'Grouping failed.')
    } finally {
      setGrouping(false)
    }
  }

  function makeRowProps(task: Task) {
    const isOptimistic = task.id.startsWith('temp-')
    return {
      task,
      editingId,
      editTitle,
      onToggle: () => markDone(task),
      onRollover: () => rollover(task),
      onDelete: () => deleteTask(task.id),
      onToggleSubtask: (subtaskId: string) => toggleSubtask(task.id, subtaskId),
      onEditStart: () => {
        setEditingId(task.id)
        setEditTitle(task.title)
      },
      onEditChange: setEditTitle,
      onEditSave: () => saveEdit(task),
      onEditCancel: () => setEditingId(null),
      onSelect: () => (priorityMode ? toggleStagedPriority(task.id) : select(task)),
      disabled: isOptimistic,
      isOptimistic,
      priorityMode,
      isStagedPriority: stagedPriorityIds.has(task.id),
      isEditingDue: editingDueId === task.id,
      onDueClick: () => setEditingDueId(task.id),
      onDueChange: (v: string) => updateDueDate(task, v),
      onDueCancel: () => setEditingDueId(null),
    }
  }

  const activePendingCount = followUp.length + pending.length
  const hasGroups = tasks.some(t => t.group_id)

  return (
    <div className="space-y-4">
      {mutationError && <p role="alert" className="mb-3 text-sm text-red-700">{mutationError}</p>}

      {/* Order-by + group button toolbar */}
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">Order by</span>
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            {(['created', 'due'] as const).map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => setOrderBy(opt)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  orderBy === opt
                    ? 'bg-indigo-600 text-[#DEDAD2]'
                    : 'bg-gray-800 text-gray-400 hover:text-[#1C1A14]'
                }`}
              >
                {opt === 'created' ? 'Created' : 'Due date'}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={togglePriorityMode}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${
              priorityMode
                ? 'bg-yellow-600 border-yellow-600 text-[#DEDAD2]'
                : 'border-gray-700 text-gray-400 hover:text-yellow-300 hover:border-yellow-700/50'
            }`}
          >
            {priorityMode ? `★ Done (${stagedPriorityIds.size})` : '☆ Priority Mode'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={
              groupView
                ? () => { setGroupView(false); setGroupError(null) }
                : hasGroups
                  ? () => setGroupView(true)
                  : handleGroupTasks
            }
            disabled={grouping || (!groupView && !hasGroups && activePendingCount < 2)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-700 text-gray-400 hover:text-indigo-300 hover:border-indigo-700/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {grouping ? (
              <>
                <span className="inline-block animate-spin">◌</span>
                Grouping...
              </>
            ) : groupView ? (
              <>≡ List View</>
            ) : (
              <>⊞ {hasGroups ? 'Group View' : 'Group Similar'}</>
            )}
          </button>
          {groupView && (
            <button
              onClick={handleGroupTasks}
              disabled={grouping || activePendingCount < 2}
              className="text-xs text-gray-500 hover:text-indigo-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Re-run AI grouping"
            >
              ↻ Re-group with AI
            </button>
          )}
        </div>
        {groupError && (
          <span className="ml-3 text-xs text-red-400">{groupError}</span>
        )}
      </div>

      {/* Add task form */}
      <form
        onSubmit={addTask}
        className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3"
      >
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
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </form>

      {/* Task list */}
      {followUp.length === 0 && pending.length === 0 && done.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-8">No tasks today. Add one above.</p>
      ) : groupView ? (
        /* Group view — drag a task onto a group card (or the Other section) to move it */
        <div className="space-y-4">
          {persistedGroups
            .filter(g => tasks.some(t => t.group_id === g.id))
            .map(group => (
              <GroupCard
                key={group.id}
                group={group}
                tasks={tasks}
                ungroupedTasks={[...followUp, ...pending].filter(t => !t.group_id)}
                makeRowProps={makeRowProps}
                onDragStartTask={handleGroupDragStart}
                onDragEndTask={() => setDraggedTaskId(null)}
                onDropTask={() => handleGroupDrop(group.id)}
                onAssignTask={taskId => moveTaskToGroup(taskId, group.id)}
              />
            ))}
          {/* Ungrouped tasks */}
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={() => handleGroupDrop(null)}
            className="rounded-xl border border-dashed border-gray-700/60 p-3 min-h-[3rem]"
          >
            <p className="text-xs text-gray-600 uppercase tracking-wider mb-2">Other (drop here to ungroup)</p>
            <div className="space-y-2">
              {[...followUp, ...pending]
                .filter(t => !t.group_id)
                .map(task => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => handleGroupDragStart(task.id)}
                    onDragEnd={() => setDraggedTaskId(null)}
                    className="cursor-grab active:cursor-grabbing"
                  >
                    <TaskRow {...makeRowProps(task)} />
                  </div>
                ))}
            </div>
          </div>
        </div>
      ) : (
        /* Flat list view */
        <>
          {followUp.length > 0 && (
            <div className="space-y-2 mb-4">
              <p className="text-xs text-gray-600 uppercase tracking-wider mb-2">● Keep in Touch</p>
              {followUp.map((task, idx) => (
                <div
                  key={task.id}
                  draggable={orderBy === 'created' && !priorityMode}
                  onDragStart={() => handleDragStart(idx, 'followUp')}
                  onDragOver={e => handleDragOver(e, idx, 'followUp')}
                  onDrop={() => handleDrop(idx, 'followUp')}
                  onDragEnd={handleDragEnd}
                  className={`${orderBy === 'created' && !priorityMode ? 'cursor-grab active:cursor-grabbing' : ''} transition-all ${
                    dragOverIdx === idx && dragSection === 'followUp' && dragIdx !== idx
                      ? 'border-t-2 border-indigo-500 pt-0.5'
                      : ''
                  } ${dragIdx === idx && dragSection === 'followUp' ? 'opacity-40' : ''}`}
                >
                  <TaskRow {...makeRowProps(task)} />
                </div>
              ))}
            </div>
          )}

          {pending.length > 0 && (
            <div className="space-y-2">
              {pending.map((task, idx) => (
                <div
                  key={task.id}
                  draggable={orderBy === 'created'}
                  onDragStart={() => handleDragStart(idx, 'pending')}
                  onDragOver={e => handleDragOver(e, idx, 'pending')}
                  onDrop={() => handleDrop(idx, 'pending')}
                  onDragEnd={handleDragEnd}
                  className={`${orderBy === 'created' ? 'cursor-grab active:cursor-grabbing' : ''} transition-all ${
                    dragOverIdx === idx && dragSection === 'pending' && dragIdx !== idx
                      ? 'border-t-2 border-indigo-500 pt-0.5'
                      : ''
                  } ${dragIdx === idx && dragSection === 'pending' ? 'opacity-40' : ''}`}
                >
                  <TaskRow {...makeRowProps(task)} />
                </div>
              ))}
            </div>
          )}

          {done.length > 0 && (
            <div>
              <p className="text-xs text-gray-600 mb-2 uppercase tracking-wider">Completed</p>
              <div className="space-y-1 opacity-50">
                {done.map(task => (
                  <TaskRow key={task.id} {...makeRowProps(task)} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function GroupCard({
  group,
  tasks,
  ungroupedTasks,
  makeRowProps,
  onDragStartTask,
  onDragEndTask,
  onDropTask,
  onAssignTask,
}: {
  group: PersistedTaskGroup
  tasks: Task[]
  ungroupedTasks: Task[]
  makeRowProps: (task: Task) => React.ComponentProps<typeof TaskRow>
  onDragStartTask: (taskId: string) => void
  onDragEndTask: () => void
  onDropTask: () => void
  onAssignTask: (taskId: string) => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const colors = GROUP_COLORS[group.color as GroupColor] ?? GROUP_COLORS.indigo
  const groupTasks = tasks.filter(t => t.group_id === group.id)
  const pendingGroupTasks = groupTasks.filter(t => t.status !== 'done')
  const doneTasks = groupTasks.filter(t => t.status === 'done')
  const pct =
    groupTasks.length > 0 ? Math.round((doneTasks.length / groupTasks.length) * 100) : 0

  return (
    <div
      onDragOver={e => e.preventDefault()}
      onDrop={onDropTask}
      className={`rounded-xl border p-4 ${colors.bg} ${colors.border}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`} />
        <span className={`text-sm font-semibold ${colors.text}`}>{group.name}</span>
        <span className="text-xs text-gray-500 ml-auto">
          {doneTasks.length}/{groupTasks.length} done
        </span>
        <button
          onClick={() => setShowAdd(v => !v)}
          className={`text-xs px-1.5 py-0.5 rounded hover:bg-black/10 transition-colors ${colors.text}`}
          title="Add task to this group"
        >
          {showAdd ? '✕' : '+ add task'}
        </button>
      </div>
      {/* Progress bar */}
      <div className={`h-1.5 rounded-full mb-3 ${colors.barBg}`}>
        <div
          className={`h-1.5 rounded-full ${colors.bar} transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {showAdd && (
        <div className="mb-3 max-h-32 overflow-y-auto space-y-1 border border-black/10 rounded-lg p-2">
          {ungroupedTasks.length === 0 ? (
            <p className="text-xs text-gray-500 italic">No ungrouped tasks.</p>
          ) : (
            ungroupedTasks.map(t => (
              <button
                key={t.id}
                onClick={() => { onAssignTask(t.id); setShowAdd(false) }}
                className="block w-full text-left text-xs px-2 py-1 rounded hover:bg-black/10 transition-colors"
              >
                {t.title}
              </button>
            ))
          )}
        </div>
      )}

      {/* Tasks — draggable so they can be moved into another group or ungrouped */}
      <div className="space-y-1.5">
        {pendingGroupTasks.map(task => (
          <div
            key={task.id}
            draggable
            onDragStart={() => onDragStartTask(task.id)}
            onDragEnd={onDragEndTask}
            className="cursor-grab active:cursor-grabbing"
          >
            <TaskRow {...makeRowProps(task)} />
          </div>
        ))}
      </div>
    </div>
  )
}

function TaskRow({
  task,
  editingId,
  editTitle,
  onToggle,
  onRollover,
  onDelete,
  onToggleSubtask,
  onEditStart,
  onEditChange,
  onEditSave,
  onEditCancel,
  onSelect,
  disabled,
  isOptimistic,
  priorityMode,
  isStagedPriority,
  isEditingDue,
  onDueClick,
  onDueChange,
  onDueCancel,
}: {
  task: Task
  editingId: string | null
  editTitle: string
  onToggle: () => void
  onRollover: () => void
  onDelete: () => void
  onToggleSubtask: (subtaskId: string) => void
  onEditStart: () => void
  onEditChange: (v: string) => void
  onEditSave: () => void
  onEditCancel: () => void
  onSelect: () => void
  disabled: boolean
  isOptimistic?: boolean
  priorityMode?: boolean
  isStagedPriority?: boolean
  isEditingDue: boolean
  onDueClick: () => void
  onDueChange: (v: string) => void
  onDueCancel: () => void
}) {
  const isDone = task.status === 'done'
  const isEvent = task.task_type === 'event'
  const isContact = !!task.contact_id
  const rolls = task.rollover_count ?? 0
  const isEditing = editingId === task.id
  const dueStr = new Date(task.due_date + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
  const createdStr = new Date(task.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
  const subtasks = task.subtasks ?? []
  const subtaskDone = subtasks.filter(s => s.status === 'done').length

  return (
    <div>
    <div
      onClick={onSelect}
      className={`group flex items-center gap-3 px-4 py-3 bg-gray-900 border rounded-xl hover:border-gray-700 cursor-pointer transition-opacity ${
        isEvent ? 'border-indigo-900/60' : 'border-gray-800'
      } ${rolls >= 3 ? 'border-l-2 border-l-orange-500' : ''} ${isOptimistic ? 'opacity-60' : ''} ${
        priorityMode && isStagedPriority ? 'ring-2 ring-yellow-500/70 border-yellow-600/60' : ''
      }`}
    >
      <button
        onClick={e => {
          e.stopPropagation()
          onToggle()
        }}
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
            onClick={e => e.stopPropagation()}
            onChange={e => onEditChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onEditSave()
              if (e.key === 'Escape') onEditCancel()
            }}
            onBlur={onEditSave}
            className="w-full bg-gray-800 border border-indigo-500 rounded px-2 py-0.5 text-sm text-white outline-none"
          />
        ) : (
          <>
            <div className="flex items-center gap-2">
              {task.is_priority && <span className="text-xs text-yellow-500 shrink-0">★</span>}
              {isEvent && <span className="text-xs text-indigo-400 shrink-0">📅</span>}
              <span
                className={`text-sm truncate ${isDone ? 'line-through text-gray-500' : 'text-gray-200'}`}
                onDoubleClick={e => {
                  e.stopPropagation()
                  onEditStart()
                }}
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
              {subtasks.length > 0 && (
                <span className="text-xs text-gray-600">
                  ☑ {subtaskDone}/{subtasks.length}
                </span>
              )}
              <span className="text-xs text-gray-600">{createdStr}</span>
            </div>
          </>
        )}
      </div>

      {isEditingDue ? (
        <input
          type="date"
          autoFocus
          defaultValue={task.due_date}
          onClick={e => e.stopPropagation()}
          onChange={e => onDueChange(e.target.value)}
          onBlur={onDueCancel}
          onKeyDown={e => {
            if (e.key === 'Escape') onDueCancel()
          }}
          className="text-xs bg-gray-800 border border-indigo-500 rounded px-1.5 py-0.5 text-gray-200 outline-none shrink-0"
        />
      ) : (
        <span
          onClick={e => {
            e.stopPropagation()
            if (!disabled) onDueClick()
          }}
          title="Change due date"
          className="text-xs text-gray-500 shrink-0 whitespace-nowrap hover:text-indigo-300 hover:underline cursor-pointer"
        >
          Due {dueStr}
        </span>
      )}

      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {!isDone && !isEditing && (
          <button
            onClick={e => {
              e.stopPropagation()
              onEditStart()
            }}
            disabled={disabled}
            title="Edit"
            className="px-2 py-1 text-xs text-gray-500 hover:text-indigo-400 rounded transition-colors"
          >
            ✎
          </button>
        )}
        {!isDone && (
          <button
            onClick={e => {
              e.stopPropagation()
              onRollover()
            }}
            disabled={disabled}
            title="Move to next day"
            className="px-2 py-1 text-xs text-gray-500 hover:text-yellow-400 rounded transition-colors"
          >
            →tmrw
          </button>
        )}
        <button
          onClick={e => {
            e.stopPropagation()
            onDelete()
          }}
          disabled={disabled}
          className="px-2 py-1 text-xs text-gray-500 hover:text-red-400 rounded transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
    {subtasks.length > 0 && (
      <div className="ml-8 mt-1.5 space-y-1">
        {subtasks.map(st => (
          <div
            key={st.id}
            onClick={e => {
              e.stopPropagation()
              onToggleSubtask(st.id)
            }}
            className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer hover:text-gray-300"
          >
            <span
              className={`w-3 h-3 shrink-0 rounded-full border transition-colors ${
                st.status === 'done'
                  ? 'bg-indigo-600 border-indigo-600'
                  : 'border-gray-600'
              }`}
            />
            <span className={st.status === 'done' ? 'line-through text-gray-600' : 'text-gray-400'}>
              {st.title}
            </span>
          </div>
        ))}
      </div>
    )}
    </div>
  )
}
