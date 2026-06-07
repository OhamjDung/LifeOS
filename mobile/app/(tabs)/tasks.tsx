import { useEffect, useState, useCallback, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Alert, Modal, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import { supabase, supabaseUrl } from '../../lib/supabase'
import { Task, Tag, CONTACT_TIER_DAYS, ContactTier } from '../../lib/types'

const todayStr = new Date().toISOString().split('T')[0]
const pad = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

// ── Tag selector ─────────────────────────────────────────────────────────

function TagSelector({ tags, selected, onToggle, onAdd, onDelete }: {
  tags: Tag[]; selected: string[]
  onToggle: (id: string) => void
  onAdd: (name: string) => void
  onDelete: (id: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  function submit() {
    const trimmed = newName.trim()
    setNewName('')
    setAdding(false)
    if (trimmed) onAdd(trimmed)
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tagRow}
      contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
      {tags.map(tag => (
        <TouchableOpacity key={tag.id}
          style={[s.tagChip, selected.includes(tag.id) && s.tagChipActive]}
          onPress={() => onToggle(tag.id)}
          onLongPress={() => Alert.alert('Delete tag', `Delete "${tag.name}"?`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => onDelete(tag.id) },
          ])}
        >
          <Text style={[s.tagChipText, selected.includes(tag.id) && s.tagChipTextActive]}>{tag.name}</Text>
        </TouchableOpacity>
      ))}
      {adding ? (
        <TextInput style={s.tagInput} value={newName} onChangeText={setNewName}
          onSubmitEditing={submit}
          onBlur={() => { setNewName(''); setAdding(false) }}
          autoFocus placeholder="name…" placeholderTextColor="#6b7280" returnKeyType="done"
        />
      ) : (
        <TouchableOpacity style={s.tagChipAdd} onPress={() => setAdding(true)}>
          <Text style={s.tagChipAddText}>+ tag</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  )
}

// ── Inline calendar view ──────────────────────────────────────────────────

function CalendarView() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [calTasks, setCalTasks] = useState<Task[]>([])
  const [selectedDate, setSelectedDate] = useState(todayStr)

  const fetchMonth = useCallback(async () => {
    const start = `${year}-${pad(month + 1)}-01`
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const end = `${year}-${pad(month + 1)}-${pad(daysInMonth)}`
    const { data } = await supabase
      .from('tasks')
      .select('id, title, task_type, due_date, status')
      .gte('due_date', start)
      .lte('due_date', end)
      .neq('status', 'rolled_over')
    if (data) setCalTasks(data as Task[])
  }, [year, month])

  useEffect(() => { fetchMonth() }, [fetchMonth])

  function navigate(dir: -1 | 1) {
    const d = new Date(year, month + dir)
    setYear(d.getFullYear()); setMonth(d.getMonth())
  }

  const byDate: Record<string, Task[]> = {}
  calTasks.forEach(t => { if (!byDate[t.due_date]) byDate[t.due_date] = []; byDate[t.due_date].push(t) })

  const firstDOW = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(firstDOW).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)

  const selectedTasks = byDate[selectedDate] || []
  const CELL = 50

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={cs.header}>
        <TouchableOpacity onPress={() => navigate(-1)} style={cs.navBtn}>
          <Text style={cs.navArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={cs.monthTitle}>{MONTHS[month]} {year}</Text>
        <TouchableOpacity onPress={() => navigate(1)} style={cs.navBtn}>
          <Text style={cs.navArrow}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={cs.dayHeaders}>
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <Text key={i} style={[cs.dayHeader, { width: CELL }]}>{d}</Text>
        ))}
      </View>

      <View style={cs.grid}>
        {cells.map((day, i) => {
          if (!day) return <View key={i} style={[cs.cell, { width: CELL, minHeight: CELL }]} />
          const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`
          const dayTasks = byDate[dateStr] || []
          const isToday = dateStr === todayStr
          const isSelected = dateStr === selectedDate
          const events = dayTasks.filter(t => t.task_type === 'event')
          const dotCount = Math.min(dayTasks.filter(t => t.task_type === 'task').length, 3)

          return (
            <TouchableOpacity key={i}
              style={[cs.cell, { width: CELL, minHeight: CELL }, isSelected && cs.cellSelected]}
              onPress={() => setSelectedDate(dateStr)} activeOpacity={0.7}
            >
              <View style={[cs.dayNumWrap, isToday && cs.dayNumToday]}>
                <Text style={[cs.dayNum, isToday && cs.dayNumTodayText]}>{day}</Text>
              </View>
              {events.slice(0, 2).map(e => (
                <Text key={e.id} style={cs.eventLabel} numberOfLines={1}>{e.title}</Text>
              ))}
              {dotCount > 0 && (
                <View style={cs.dots}>
                  {Array.from({ length: dotCount }).map((_, di) => <View key={di} style={cs.dot} />)}
                </View>
              )}
            </TouchableOpacity>
          )
        })}
      </View>

      <View style={cs.detail}>
        <Text style={cs.detailTitle}>
          {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric',
          })}
        </Text>
        {selectedTasks.length === 0
          ? <Text style={cs.empty}>Nothing scheduled</Text>
          : selectedTasks.map(t => (
            <View key={t.id} style={[cs.taskRow, t.task_type === 'event' && cs.taskRowEvent]}>
              <Text style={[cs.taskTitle, t.status === 'done' && cs.taskTitleDone]} numberOfLines={2}>
                {t.task_type === 'event' ? '📅 ' : ''}{t.title}
              </Text>
            </View>
          ))
        }
      </View>
    </ScrollView>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────

export default function TasksScreen() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [newTitle, setNewTitle] = useState('')
  const [newType, setNewType] = useState<'task' | 'event'>('task')
  const [newDate, setNewDate] = useState(todayStr)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [showDateModal, setShowDateModal] = useState(false)
  const [customDate, setCustomDate] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list')

  const fetchTasks = useCallback(async () => {
    await supabase.from('tasks')
      .update({ due_date: todayStr, status: 'pending', updated_at: new Date().toISOString() })
      .eq('status', 'pending').lt('due_date', todayStr)

    const { data } = await supabase.from('tasks')
      .select('*, task_tags(tag_id, tags(id, name))')
      .eq('due_date', todayStr).neq('status', 'rolled_over')
      .order('rollover_count', { ascending: false })
      .order('created_at', { ascending: true })

    if (data) setTasks(data.map((t: any) => ({
      ...t, tags: (t.task_tags || []).map((tt: any) => tt.tags).filter(Boolean),
    })) as Task[])
    setLoading(false)
  }, [])

  const fetchTags = useCallback(async () => {
    const { data } = await supabase.from('tags').select('*').order('name')
    if (data) setTags(data as Tag[])
  }, [])

  useEffect(() => {
    fetchTags()
    const channel = supabase.channel('tasks-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, fetchTasks)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchTasks])

  useFocusEffect(useCallback(() => { fetchTasks() }, [fetchTasks]))

  async function addTag(name: string) {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.from('tags')
      .insert({ name, user_id: user?.id }).select('*').single()
    if (error) { Alert.alert('Tag error', error.message); return }
    if (data) setTags(prev => [...prev, data as Tag].sort((a, b) => a.name.localeCompare(b.name)))
  }

  async function deleteTag(id: string) {
    await supabase.from('tags').delete().eq('id', id)
    setTags(prev => prev.filter(t => t.id !== id))
    setSelectedTags(prev => prev.filter(t => t !== id))
  }

  function toggleTag(id: string) {
    setSelectedTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
  }

  async function autoTagTask(taskId: string, title: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session || tags.length === 0) return
      fetch(`${supabaseUrl}/functions/v1/fn-auto-tag`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId, title }),
      }).catch(() => {})
    } catch {}
  }

  async function addTask() {
    if (!newTitle.trim()) return
    setAdding(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data: inserted } = await supabase.from('tasks').insert({
      title: newTitle.trim(), due_date: newDate,
      task_type: newType, user_id: user?.id,
    }).select('id').single()

    if (inserted?.id) {
      if (selectedTags.length > 0) {
        await supabase.from('task_tags').insert(selectedTags.map(tag_id => ({ task_id: inserted.id, tag_id })))
      } else {
        autoTagTask(inserted.id, newTitle.trim())
      }
    }
    setNewTitle(''); setNewDate(todayStr); setNewType('task'); setSelectedTags([])
    setAdding(false); fetchTasks()
  }

  async function checkFollowup(task: Task) {
    if (task.task_type !== 'event' || !task.tags || task.tags.length === 0) return
    const taskTagIds = task.tags.map(t => t.id)
    const { data: contacts } = await supabase.from('contacts').select('id, name, contact_tier, last_contacted_at')
    if (!contacts) return
    const nearDue = contacts.filter(c => {
      const tierDays = CONTACT_TIER_DAYS[(c.contact_tier || 'weekly') as ContactTier]
      const days = c.last_contacted_at
        ? Math.floor((Date.now() - new Date(c.last_contacted_at).getTime()) / 86400000) : tierDays + 1
      return (tierDays - days) <= 2
    })
    const matching: string[] = []
    for (const c of nearDue) {
      const { data: ct } = await supabase.from('contact_tags').select('tag_id').eq('contact_id', c.id)
      if (ct?.some((r: any) => taskTagIds.includes(r.tag_id))) matching.push(c.name)
    }
    if (matching.length > 0) Alert.alert('Follow up?',
      `Based on this event:\n${matching.map(n => `• ${n}`).join('\n')}`, [{ text: 'OK' }])
  }

  async function toggleTask(task: Task) {
    const newStatus = task.status === 'done' ? 'pending' : 'done'
    await supabase.from('tasks').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', task.id)
    if (newStatus === 'done') checkFollowup(task)
    fetchTasks()
  }

  async function rollover(task: Task) {
    const next = new Date(task.due_date); next.setDate(next.getDate() + 1)
    const nextStr = next.toISOString().split('T')[0]
    await supabase.from('tasks').update({ due_date: nextStr, status: 'rolled_over', updated_at: new Date().toISOString() }).eq('id', task.id)
    await supabase.from('task_rollovers').insert({ task_id: task.id, from_date: task.due_date, to_date: nextStr })
    fetchTasks()
  }

  const pending = tasks.filter(t => t.status === 'pending')
  const done = tasks.filter(t => t.status === 'done')

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.topBar}>
        <View>
          <Text style={s.heading}>Today</Text>
          <Text style={s.date}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
        </View>
        <TouchableOpacity style={s.viewToggle} onPress={() => setViewMode(v => v === 'list' ? 'calendar' : 'list')}>
          <Text style={s.viewToggleText}>{viewMode === 'list' ? '📅' : '✅'}</Text>
        </TouchableOpacity>
      </View>

      {viewMode === 'calendar' ? (
        <View style={{ flex: 1, paddingHorizontal: 16 }}>
          <CalendarView />
        </View>
      ) : (
        <View style={s.container}>
          <View style={s.addBox}>
            <View style={s.typeRow}>
              {(['task', 'event'] as const).map(t => (
                <TouchableOpacity key={t} style={[s.typeBtn, newType === t && s.typeBtnActive]} onPress={() => setNewType(t)}>
                  <Text style={[s.typeText, newType === t && s.typeTextActive]}>{t === 'task' ? '☑ Task' : '📅 Event'}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={s.dateBtn} onPress={() => setShowDateModal(true)}>
                <Text style={s.dateBtnText}>{newDate === todayStr ? 'Today' : newDate}</Text>
              </TouchableOpacity>
            </View>
            <TagSelector tags={tags} selected={selectedTags} onToggle={toggleTag} onAdd={addTag} onDelete={deleteTag} />
            <View style={s.inputRow}>
              <TextInput style={s.input} placeholder={newType === 'event' ? 'Event name…' : 'Add a task…'}
                placeholderTextColor="#6b7280" value={newTitle} onChangeText={setNewTitle}
                onSubmitEditing={addTask} returnKeyType="done"
              />
              <TouchableOpacity style={s.addBtn} onPress={addTask} disabled={adding || !newTitle.trim()}>
                <Text style={s.addBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <FlatList
            data={[...pending, ...done]}
            keyExtractor={t => t.id}
            renderItem={({ item }) => (
              <TaskRow task={item} onToggle={() => toggleTask(item)} onRollover={() => rollover(item)} />
            )}
            ListEmptyComponent={!loading ? <Text style={s.empty}>No tasks today. Add one above.</Text> : null}
            contentContainerStyle={{ paddingBottom: 32 }}
          />
        </View>
      )}

      <Modal visible={showDateModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>Schedule for</Text>
            {[{ label: 'Today', days: 0 }, { label: 'Tomorrow', days: 1 },
              { label: 'Day after tomorrow', days: 2 }, { label: 'Next week', days: 7 }].map(({ label, days }) => {
              const d = new Date(); d.setDate(d.getDate() + days)
              const str = d.toISOString().split('T')[0]
              return (
                <TouchableOpacity key={days} style={s.dateOption} onPress={() => { setNewDate(str); setShowDateModal(false) }}>
                  <Text style={s.dateOptionText}>{label}</Text>
                  <Text style={s.dateOptionSub}>{str}</Text>
                </TouchableOpacity>
              )
            })}
            <View style={s.customRow}>
              <TextInput style={s.customInput} placeholder="Custom date (YYYY-MM-DD)"
                placeholderTextColor="#6b7280" value={customDate} onChangeText={setCustomDate}
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (/^\d{4}-\d{2}-\d{2}$/.test(customDate)) {
                    setNewDate(customDate); setCustomDate(''); setShowDateModal(false)
                  }
                }}
              />
            </View>
            <TouchableOpacity onPress={() => setShowDateModal(false)} style={s.cancelBtn}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

// ── TaskRow ───────────────────────────────────────────────────────────────

function TaskRow({ task, onToggle, onRollover }: { task: Task; onToggle: () => void; onRollover: () => void }) {
  const swipeRef = useRef<Swipeable>(null)
  const done = task.status === 'done'
  const isEvent = task.task_type === 'event'
  const rollovers = task.rollover_count ?? 0

  function handleSwipe(direction: 'left' | 'right') {
    swipeRef.current?.close()
    if (direction === 'right') onToggle()
    if (direction === 'left' && !done) onRollover()
  }

  return (
    <Swipeable ref={swipeRef}
      renderLeftActions={() => (
        <View style={[s.swipeAction, s.swipeActionComplete]}>
          <Text style={s.swipeActionText}>{done ? '↩ Undo' : '✓ Done'}</Text>
        </View>
      )}
      renderRightActions={() => !done ? (
        <View style={[s.swipeAction, s.swipeActionRollover]}>
          <Text style={s.swipeActionText}>→ Tmrw</Text>
        </View>
      ) : null}
      onSwipeableOpen={handleSwipe}
      overshootLeft={false} overshootRight={false}
      friction={1.5} leftThreshold={40} rightThreshold={40}
    >
      <View style={[s.row, isEvent && s.rowEvent, rollovers >= 3 && s.rowUrgent]}>
        <TouchableOpacity onPress={onToggle} style={[s.circle, isEvent && s.circleEvent, done && s.circleDone]}>
          {done && <Text style={{ color: '#fff', fontSize: 10 }}>✓</Text>}
        </TouchableOpacity>
        <View style={s.rowContent}>
          <View style={s.rowTitleRow}>
            {isEvent && <Text style={s.eventIcon}>📅 </Text>}
            <Text style={[s.rowTitle, done && s.rowTitleDone]} numberOfLines={2}>{task.title}</Text>
          </View>
          {rollovers > 0 && (
            <Text style={[s.rolloverBadge, rollovers >= 3 && s.rolloverBadgeUrgent]}>
              ↻{rollovers} {rollovers === 1 ? 'move' : 'moves'}
            </Text>
          )}
          {task.tags && task.tags.length > 0 && (
            <View style={s.taskTagRow}>
              {task.tags.map(tag => (
                <View key={tag.id} style={s.taskTag}>
                  <Text style={s.taskTagText}>{tag.name}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        {!done && (
          <TouchableOpacity onPress={onRollover} style={s.rollBtn}>
            <Text style={s.rollText}>→tmrw</Text>
          </TouchableOpacity>
        )}
      </View>
    </Swipeable>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111827' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  heading: { fontSize: 28, fontWeight: '700', color: '#fff' },
  date: { fontSize: 13, color: '#6b7280', marginBottom: 4 },
  viewToggle: { padding: 8, marginTop: 4 },
  viewToggleText: { fontSize: 22 },
  container: { flex: 1, paddingHorizontal: 20 },
  addBox: { backgroundColor: '#1f2937', borderRadius: 14, padding: 12, marginBottom: 20 },
  typeRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  typeBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: '#374151' },
  typeBtnActive: { borderColor: '#6366f1', backgroundColor: '#1e1b4b' },
  typeText: { color: '#6b7280', fontSize: 12 },
  typeTextActive: { color: '#a5b4fc' },
  dateBtn: { marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: '#374151' },
  dateBtnText: { color: '#9ca3af', fontSize: 12 },
  tagRow: { marginBottom: 8 },
  tagChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#374151', backgroundColor: '#111827' },
  tagChipActive: { borderColor: '#6366f1', backgroundColor: '#1e1b4b' },
  tagChipText: { color: '#6b7280', fontSize: 12 },
  tagChipTextActive: { color: '#a5b4fc' },
  tagChipAdd: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#374151', borderStyle: 'dashed' },
  tagChipAddText: { color: '#4b5563', fontSize: 12 },
  tagInput: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#6366f1', color: '#fff', fontSize: 12, minWidth: 80, backgroundColor: '#111827' },
  inputRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, backgroundColor: '#111827', borderWidth: 1, borderColor: '#374151', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: '#fff', fontSize: 15 },
  addBtn: { backgroundColor: '#4f46e5', borderRadius: 10, width: 44, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#fff', fontSize: 22, lineHeight: 26 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1f2937', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: 'transparent' },
  rowEvent: { borderLeftColor: '#6366f1' },
  rowUrgent: { borderLeftColor: '#f97316' },
  circle: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#4b5563', alignItems: 'center', justifyContent: 'center' },
  circleEvent: { borderRadius: 4 },
  circleDone: { backgroundColor: '#4f46e5', borderColor: '#4f46e5' },
  rowContent: { flex: 1 },
  rowTitleRow: { flexDirection: 'row', alignItems: 'center' },
  eventIcon: { fontSize: 12 },
  rowTitle: { flex: 1, color: '#e5e7eb', fontSize: 15 },
  rowTitleDone: { textDecorationLine: 'line-through', color: '#6b7280' },
  rolloverBadge: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  rolloverBadgeUrgent: { color: '#f97316' },
  taskTagRow: { flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  taskTag: { backgroundColor: '#1e1b4b', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  taskTagText: { color: '#818cf8', fontSize: 10 },
  rollBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  rollText: { color: '#6b7280', fontSize: 11 },
  empty: { color: '#6b7280', textAlign: 'center', marginTop: 40, fontSize: 14 },
  swipeAction: { flex: 1, justifyContent: 'center', paddingHorizontal: 20, borderRadius: 12, marginBottom: 8 },
  swipeActionComplete: { backgroundColor: '#166534' },
  swipeActionRollover: { backgroundColor: '#1e3a5f' },
  swipeActionText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#1f2937', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 16 },
  dateOption: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#374151', flexDirection: 'row', justifyContent: 'space-between' },
  dateOptionText: { color: '#e5e7eb', fontSize: 15 },
  dateOptionSub: { color: '#6b7280', fontSize: 13 },
  customRow: { paddingVertical: 12 },
  customInput: { backgroundColor: '#111827', borderWidth: 1, borderColor: '#374151', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: '#fff', fontSize: 14 },
  cancelBtn: { marginTop: 16, alignItems: 'center' },
  cancelText: { color: '#6366f1', fontSize: 15 },
})

// Calendar sub-component styles
const cs = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, marginTop: 8 },
  navBtn: { padding: 8 },
  navArrow: { color: '#6366f1', fontSize: 28, lineHeight: 30 },
  monthTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  dayHeaders: { flexDirection: 'row', marginBottom: 4 },
  dayHeader: { textAlign: 'center', color: '#6b7280', fontSize: 11, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { paddingVertical: 4, paddingHorizontal: 2, borderRadius: 8 },
  cellSelected: { backgroundColor: '#1e1b4b' },
  dayNumWrap: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 2, alignSelf: 'center' },
  dayNumToday: { backgroundColor: '#6366f1' },
  dayNum: { color: '#e5e7eb', fontSize: 12, fontWeight: '500' },
  dayNumTodayText: { color: '#fff', fontWeight: '700' },
  eventLabel: { color: '#818cf8', fontSize: 9, lineHeight: 11, paddingHorizontal: 2 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 2, marginTop: 2 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#6b7280' },
  detail: { marginTop: 20, backgroundColor: '#1f2937', borderRadius: 14, padding: 16 },
  detailTitle: { color: '#9ca3af', fontSize: 13, fontWeight: '600', marginBottom: 12 },
  empty: { color: '#4b5563', fontSize: 14 },
  taskRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#374151' },
  taskRowEvent: { borderLeftWidth: 3, borderLeftColor: '#6366f1', paddingLeft: 8 },
  taskTitle: { color: '#e5e7eb', fontSize: 14 },
  taskTitleDone: { textDecorationLine: 'line-through', color: '#4b5563' },
})
