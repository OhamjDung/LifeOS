import { useEffect, useState, useCallback, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, Modal, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { useFocusEffect } from 'expo-router'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import { supabase, supabaseUrl } from '../../lib/supabase'
import { Task, Tag, CONTACT_TIER_DAYS, ContactTier } from '../../lib/types'
import { syncWidgetTasks } from '../../lib/widgetSync'
import { SkCard, SkKicker, SkChip, SkCheck, SkIconBtn, SkTagBadge } from '../../components/Sk'
import { T, MONO, raisedShadowSm, insetBg } from '../../lib/theme'

const todayStr = new Date().toISOString().split('T')[0]
const pad = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

// ── Tag selector ──────────────────────────────────────────────

function TagSelector({ tags, selected, onToggle, onAdd, onDelete }: {
  tags: Tag[]; selected: string[]
  onToggle: (id: string) => void; onAdd: (name: string) => void; onDelete: (id: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  function submit() {
    const t = newName.trim()
    setNewName(''); setAdding(false)
    if (t) onAdd(t)
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      style={{ marginBottom: 8 }} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
      {tags.map(tag => (
        <TouchableOpacity key={tag.id}
          style={[ts.tagChip, selected.includes(tag.id) && ts.tagChipOn]}
          onPress={() => onToggle(tag.id)}
          onLongPress={() => Alert.alert('Delete tag', `Delete "${tag.name}"?`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => onDelete(tag.id) },
          ])}>
          <Text style={[ts.tagChipText, selected.includes(tag.id) && ts.tagChipTextOn]}>{tag.name}</Text>
        </TouchableOpacity>
      ))}
      {adding ? (
        <TextInput style={ts.tagInput} value={newName} onChangeText={setNewName}
          onSubmitEditing={submit} onBlur={() => { setNewName(''); setAdding(false) }}
          autoFocus placeholder="name…" placeholderTextColor={T.faint} returnKeyType="done" />
      ) : (
        <TouchableOpacity style={ts.tagAdd} onPress={() => setAdding(true)}>
          <Text style={ts.tagAddText}>+ tag</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  )
}

// ── Inline calendar ───────────────────────────────────────────

function CalendarView() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [calTasks, setCalTasks] = useState<Task[]>([])
  const [selectedDay, setSelectedDay] = useState(now.getDate())

  const fetchMonth = useCallback(async () => {
    const start = `${year}-${pad(month + 1)}-01`
    const daysInM = new Date(year, month + 1, 0).getDate()
    const end = `${year}-${pad(month + 1)}-${pad(daysInM)}`
    const { data } = await supabase.from('tasks')
      .select('id,title,task_type,due_date,status')
      .gte('due_date', start).lte('due_date', end).neq('status', 'rolled_over')
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
  const daysInM = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(firstDOW).fill(null), ...Array.from({ length: daysInM }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)

  const selDateStr = `${year}-${pad(month + 1)}-${pad(selectedDay)}`
  const selItems = byDate[selDateStr] || []
  const isThisMonth = year === now.getFullYear() && month === now.getMonth()
  const todayDay = now.getDate()

  return (
    <View style={{ gap: T.gap }}>
      <SkCard style={{ padding: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text style={cal.monthLabel}>{MONTHS[month].slice(0,3).toUpperCase()} {year}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <SkIconBtn size={28} onPress={() => navigate(-1)}><Text style={{ color: T.faint, fontSize: 18 }}>‹</Text></SkIconBtn>
            <SkIconBtn size={28} onPress={() => navigate(1)}><Text style={{ color: T.faint, fontSize: 18 }}>›</Text></SkIconBtn>
          </View>
        </View>
        <View style={{ flexDirection: 'row', marginBottom: 4 }}>
          {['S','M','T','W','T','F','S'].map((d, i) => (
            <Text key={i} style={cal.dayHeader}>{d}</Text>
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {cells.map((day, i) => {
            if (!day) return <View key={i} style={cal.cell} />
            const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`
            const items = byDate[dateStr] || []
            const isToday = isThisMonth && day === todayDay
            const isSel = day === selectedDay
            const hasEvent = items.some(t => t.task_type === 'event')
            return (
              <TouchableOpacity key={i} style={[cal.cell, isSel && cal.cellSel]} onPress={() => setSelectedDay(day)} activeOpacity={0.7}>
                <View style={[cal.dayNumWrap, isToday && cal.dayNumToday]}>
                  <Text style={[cal.dayNum, isToday && { color: '#fff', fontWeight: '700' }, isSel && { color: T.displayInk }]}>{day}</Text>
                </View>
                {items.length > 0 && (
                  <View style={{ width: hasEvent ? 5 : 4, height: hasEvent ? 5 : 4, borderRadius: 3, backgroundColor: isSel ? T.displayInk : hasEvent ? T.sageDim : T.clay, marginTop: 2 }} />
                )}
              </TouchableOpacity>
            )
          })}
        </View>
      </SkCard>

      <SkKicker>{isThisMonth && selectedDay === todayDay ? `Today · ${MONTHS[month].slice(0,3)} ${todayDay}` : `${MONTHS[month].slice(0,3)} ${selectedDay}`}</SkKicker>
      <View style={{ gap: T.listGap }}>
        {selItems.length === 0
          ? <Text style={{ fontFamily: MONO, fontSize: 12, color: T.faint, textAlign: 'center', paddingVertical: 16 }}>Nothing scheduled.</Text>
          : selItems.map((t, idx) => (
            <SkCard key={t.id || idx} borderLeft={t.task_type === 'event' ? T.sageDim : undefined}
              style={{ paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 22, height: 22, borderRadius: t.task_type === 'event' ? 6 : 11, backgroundColor: insetBg }} />
              <Text style={{ fontFamily: MONO, fontSize: 12.5, color: T.ink, fontWeight: '500', flex: 1 }} numberOfLines={1}>{t.title}</Text>
            </SkCard>
          ))}
      </View>
    </View>
  )
}

// ── Main screen ───────────────────────────────────────────────

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
  const [view, setView] = useState<'list' | 'cal'>('list')
  const [tabFilter, setTabFilter] = useState<'ongoing' | 'done'>('ongoing')

  const fetchTasks = useCallback(async () => {
    try {
      await supabase.from('tasks')
        .update({ due_date: todayStr, status: 'pending', updated_at: new Date().toISOString() })
        .eq('status', 'pending').lt('due_date', todayStr)
      const { data } = await supabase.from('tasks')
        .select('*, task_tags(tag_id, tags(id,name))')
        .eq('due_date', todayStr).neq('status', 'rolled_over')
        .order('rollover_count', { ascending: false })
        .order('created_at', { ascending: true })
      if (data) {
        const mapped = data.map((t: any) => ({
          ...t, tags: (t.task_tags ?? []).map((tt: any) => tt?.tags).filter(Boolean),
        })) as Task[]
        setTasks(mapped)
        syncWidgetTasks(mapped).catch(() => {})
      }
    } catch (e) {
      console.error('[LifeOS] fetchTasks error:', e)
    }
    setLoading(false)
  }, [])

  const fetchTags = useCallback(async () => {
    try {
      const { data } = await supabase.from('tags').select('*').order('name')
      if (data) setTags(data as Tag[])
    } catch (e) {
      console.error('[LifeOS] fetchTags error:', e)
    }
  }, [])

  useEffect(() => {
    fetchTags()
    const ch = supabase.channel('tasks-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, fetchTasks)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [fetchTasks])

  useFocusEffect(useCallback(() => { fetchTasks() }, [fetchTasks]))

  async function addTag(name: string) {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.from('tags').insert({ name, user_id: user?.id }).select('*').single()
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
    const { data: ins } = await supabase.from('tasks').insert({
      title: newTitle.trim(), due_date: newDate, task_type: newType, user_id: user?.id,
    }).select('id').single()
    if (ins?.id) {
      if (selectedTags.length > 0)
        await supabase.from('task_tags').insert(selectedTags.map(tag_id => ({ task_id: ins.id, tag_id })))
      else autoTagTask(ins.id, newTitle.trim())
    }
    setNewTitle(''); setNewDate(todayStr); setNewType('task'); setSelectedTags([])
    setAdding(false); fetchTasks()
  }

  async function toggleTask(task: Task) {
    const next = task.status === 'done' ? 'pending' : 'done'
    await supabase.from('tasks').update({ status: next, updated_at: new Date().toISOString() }).eq('id', task.id)
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
  const displayList = tabFilter === 'ongoing' ? pending : done

  return (
    <LinearGradient colors={[T.bg, T.bg2]} start={{ x: 0.32, y: 0 }} end={{ x: 0.68, y: 1 }} style={{ flex: 1 }}>
    <SafeAreaView style={ts.safe}>
      <ScrollView contentContainerStyle={ts.scroll} keyboardShouldPersistTaps="handled">

        <View style={ts.headerRow}>
          <View>
            <SkKicker>Task list</SkKicker>
            <Text style={ts.heading}>Today</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <SkChip>{pad(pending.length)} LEFT</SkChip>
            <SkIconBtn active={view === 'cal'} onPress={() => setView(v => v === 'list' ? 'cal' : 'list')} size={38}>
              <Text style={{ fontSize: 15 }}>📅</Text>
            </SkIconBtn>
          </View>
        </View>

        {view === 'cal' ? <CalendarView /> : (
          <>
            {/* Ongoing / Done toggle */}
            <View style={[ts.toggle, { backgroundColor: insetBg }]}>
              {(['ongoing', 'done'] as const).map(s => (
                <TouchableOpacity key={s} onPress={() => setTabFilter(s)}
                  style={[ts.toggleBtn, tabFilter === s && ts.toggleBtnOn]}>
                  <Text style={[ts.toggleText, tabFilter === s && ts.toggleTextOn]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Add task */}
            <SkCard pressed style={{ paddingLeft: 16, paddingRight: 6, paddingVertical: 8 }}>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
                {(['task', 'event'] as const).map(tp => (
                  <TouchableOpacity key={tp} onPress={() => setNewType(tp)}
                    style={[ts.typeBtn, newType === tp && ts.typeBtnOn]}>
                    <Text style={[ts.typeBtnText, newType === tp && ts.typeBtnTextOn]}>
                      {tp === 'task' ? '☑ TASK' : '□ EVENT'}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={ts.datePickBtn} onPress={() => setShowDateModal(true)}>
                  <Text style={ts.datePickText}>{newDate === todayStr ? 'TODAY' : newDate}</Text>
                </TouchableOpacity>
              </View>
              <TagSelector tags={tags} selected={selectedTags} onToggle={toggleTag} onAdd={addTag} onDelete={deleteTag} />
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <TextInput style={ts.addInput} placeholder="Add a task…" placeholderTextColor={T.faint}
                  value={newTitle} onChangeText={setNewTitle} onSubmitEditing={addTask} returnKeyType="done" />
                <TouchableOpacity style={[ts.addBtn, raisedShadowSm]} onPress={addTask} disabled={adding || !newTitle.trim()}>
                  <Text style={ts.addBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </SkCard>

            {/* Task list */}
            <View style={{ gap: T.listGap }}>
              {displayList.length === 0 && !loading && (
                <Text style={ts.empty}>Nothing here yet.</Text>
              )}
              {displayList.map(t => (
                <TaskRow key={t.id} task={t} onToggle={() => toggleTask(t)} onRollover={() => rollover(t)} />
              ))}
            </View>
          </>
        )}

      </ScrollView>

      <Modal visible={showDateModal} transparent animationType="slide">
        <View style={ts.modalOverlay}>
          <View style={ts.modalBox}>
            <Text style={ts.modalTitle}>Schedule for</Text>
            {[{ label: 'Today', days: 0 }, { label: 'Tomorrow', days: 1 },
              { label: 'Day after tomorrow', days: 2 }, { label: 'Next week', days: 7 }].map(({ label, days }) => {
              const d = new Date(); d.setDate(d.getDate() + days)
              const str = d.toISOString().split('T')[0]
              return (
                <TouchableOpacity key={days} style={ts.dateOpt} onPress={() => { setNewDate(str); setShowDateModal(false) }}>
                  <Text style={ts.dateOptText}>{label}</Text>
                  <Text style={ts.dateOptSub}>{str}</Text>
                </TouchableOpacity>
              )
            })}
            <TextInput style={ts.customInput} placeholder="Custom (YYYY-MM-DD)"
              placeholderTextColor={T.faint} value={customDate} onChangeText={setCustomDate}
              returnKeyType="done"
              onSubmitEditing={() => {
                if (/^\d{4}-\d{2}-\d{2}$/.test(customDate)) {
                  setNewDate(customDate); setCustomDate(''); setShowDateModal(false)
                }
              }} />
            <TouchableOpacity onPress={() => setShowDateModal(false)} style={{ marginTop: 16, alignItems: 'center' }}>
              <Text style={{ fontFamily: MONO, fontSize: 14, color: T.sage }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
    </LinearGradient>
  )
}

// ── Task row ──────────────────────────────────────────────────

function TaskRow({ task, onToggle, onRollover }: { task: Task; onToggle: () => void; onRollover: () => void }) {
  const swipeRef = useRef<Swipeable>(null)
  const done = task.status === 'done'
  const isEvent = task.task_type === 'event'
  const isContact = !!task.contact_id
  const rolls = task.rollover_count ?? 0
  const urgent = rolls >= 3
  // Spec: urgent && !done → clay  |  event type → sageDim  |  otherwise → none
  const borderColor = urgent && !done ? T.clay : isEvent ? T.sageDim : undefined

  function handleSwipe(dir: 'left' | 'right') {
    swipeRef.current?.close()
    if (dir === 'right') onToggle()
    if (dir === 'left' && !done) onRollover()
  }

  return (
    <Swipeable ref={swipeRef}
      renderLeftActions={() => (
        <View style={[ts.swipe, ts.swipeDone]}>
          <Text style={ts.swipeText}>{done ? '↩ UNDO' : '✓ DONE'}</Text>
        </View>
      )}
      renderRightActions={() => !done ? (
        <View style={[ts.swipe, ts.swipeRoll]}>
          <Text style={ts.swipeText}>→ TMRW</Text>
        </View>
      ) : null}
      onSwipeableOpen={handleSwipe}
      friction={1.5} leftThreshold={40} rightThreshold={40}
      overshootLeft={false} overshootRight={false}
    >
      <SkCard
        borderLeft={borderColor}
        style={{ paddingHorizontal: 14, paddingVertical: T.cardPadY, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: done ? 0.6 : 1 }}
      >
        <SkCheck done={done} onPress={onToggle} square={isEvent} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[ts.taskTitle, done && ts.taskTitleDone]} numberOfLines={2}>{task.title}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {(isContact || isEvent) && !done
              ? <Text style={ts.keepInTouch}>● KEEP IN TOUCH</Text>
              : rolls > 0
                ? <Text style={[ts.rollBadge, urgent && { color: T.clay }]}>↺{rolls} MOVED</Text>
                : task.tags?.[0]
                  ? <SkTagBadge label={task.tags[0].name} />
                  : null
            }
          </View>
        </View>
        {!done && (
          <TouchableOpacity onPress={onRollover} style={[ts.rollBtn, raisedShadowSm]}>
            <Text style={ts.rollBtnText}>→ TMRW</Text>
          </TouchableOpacity>
        )}
      </SkCard>
    </Swipeable>
  )
}

const ts = StyleSheet.create({
  safe:    { flex: 1 },
  scroll:  { padding: T.padX, paddingTop: T.topPad - 30, gap: T.gap, paddingBottom: 32 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heading: { fontFamily: MONO, fontSize: 26, fontWeight: '600', color: T.ink, marginTop: 4 },
  toggle:  { flexDirection: 'row', padding: 4, borderRadius: 999, alignSelf: 'flex-start' },
  toggleBtn:    { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999 },
  toggleBtnOn:  { backgroundColor: T.display },
  toggleText:   { fontFamily: MONO, fontSize: 11, color: T.faint, letterSpacing: 0.5 },
  toggleTextOn: { color: T.displayInk, fontWeight: '600' },
  typeBtn:      { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, borderWidth: 1, borderColor: T.line },
  typeBtnOn:    { backgroundColor: T.display, borderColor: T.display },
  typeBtnText:  { fontFamily: MONO, fontSize: 10, color: T.faint, letterSpacing: 0.5 },
  typeBtnTextOn: { color: T.displayInk },
  datePickBtn:  { marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, borderWidth: 1, borderColor: T.line },
  datePickText: { fontFamily: MONO, fontSize: 10, color: T.faint, letterSpacing: 0.5 },
  tagChip:      { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface },
  tagChipOn:    { backgroundColor: T.display, borderColor: T.display },
  tagChipText:  { fontFamily: MONO, fontSize: 11, color: T.faint },
  tagChipTextOn: { color: T.displayInk },
  tagAdd:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: T.line },
  tagAddText:   { fontFamily: MONO, fontSize: 11, color: T.faint },
  tagInput:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: T.sage, color: T.ink, fontSize: 11, minWidth: 80, fontFamily: MONO },
  addInput:     { flex: 1, fontFamily: MONO, fontSize: 13, color: T.ink, paddingVertical: 10 },
  addBtn:       { width: 38, height: 38, borderRadius: 12, backgroundColor: T.sage, alignItems: 'center', justifyContent: 'center' },
  addBtnText:   { color: '#EEF0E6', fontSize: 22, lineHeight: 26 },
  taskTitle:     { fontFamily: MONO, fontSize: 13, color: T.ink, fontWeight: '500', lineHeight: 18 },
  taskTitleDone: { textDecorationLine: 'line-through', color: T.faint },
  rollBadge:    { fontFamily: MONO, fontSize: 9, color: T.faint, letterSpacing: 1 },
  keepInTouch:  { fontFamily: MONO, fontSize: 9, color: T.clay, letterSpacing: 1 },
  rollBtn:      { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, backgroundColor: T.surface },
  rollBtnText:  { fontFamily: MONO, fontSize: 9, color: T.faint, letterSpacing: 0.5 },
  empty:        { fontFamily: MONO, fontSize: 12, color: T.faint, textAlign: 'center', paddingVertical: 24 },
  swipe:        { flex: 1, justifyContent: 'center', paddingHorizontal: 20, borderRadius: 18 },
  swipeDone:    { backgroundColor: '#3D6B4A' },
  swipeRoll:    { backgroundColor: '#3C4E6E' },
  swipeText:    { fontFamily: MONO, fontSize: 11, color: '#EEF0E6', fontWeight: '600', letterSpacing: 0.5 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalBox:     { backgroundColor: T.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle:   { fontFamily: MONO, fontSize: 14, fontWeight: '600', color: T.ink, marginBottom: 16 },
  dateOpt:      { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: T.line, flexDirection: 'row', justifyContent: 'space-between' },
  dateOptText:  { fontFamily: MONO, fontSize: 14, color: T.ink },
  dateOptSub:   { fontFamily: MONO, fontSize: 12, color: T.faint },
  customInput:  { marginTop: 12, borderWidth: 1, borderColor: T.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontFamily: MONO, fontSize: 13, color: T.ink },
})

const cal = StyleSheet.create({
  monthLabel:  { fontFamily: MONO, fontSize: 13, fontWeight: '600', color: T.ink, letterSpacing: 1 },
  dayHeader:   { flex: 1, textAlign: 'center', fontFamily: MONO, fontSize: 8.5, color: T.faint, letterSpacing: 0.5 },
  cell:        { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 9, paddingVertical: 2 },
  cellSel:     { backgroundColor: T.display },
  dayNumWrap:  { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dayNumToday: { backgroundColor: T.sage },
  dayNum:      { fontFamily: MONO, fontSize: 12, color: T.ink },
})
