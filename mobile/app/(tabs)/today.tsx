import { useState, useCallback, useRef } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { useFocusEffect, useRouter } from 'expo-router'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import { supabase } from '../../lib/supabase'
import { Task, Contact, CONTACT_TIER_DAYS, ContactTier } from '../../lib/types'
import { SkCard, SkKicker, SkCheck, SkSectionHead, SkTagBadge } from '../../components/Sk'
import { T, MONO, raisedShadowSm } from '../../lib/theme'

const pad2 = (n: number) => String(n).padStart(2, '0')

export default function TodayScreen() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const router = useRouter()

  const todayStr = new Date().toISOString().split('T')[0]

  const load = useCallback(async () => {
    try {
      const [{ data: t }, { data: c }] = await Promise.all([
        supabase.from('tasks')
          .select('*, task_tags(tag_id, tags(id,name))')
          .eq('due_date', todayStr)
          .neq('status', 'rolled_over')
          .order('rollover_count', { ascending: false }),
        supabase.from('contacts').select('*'),
      ])
      if (t) setTasks(t.map((x: any) => ({ ...x, tags: (x.task_tags ?? []).map((tt: any) => tt?.tags).filter(Boolean) })))
      if (c) setContacts(c as Contact[])
    } catch (e) {
      console.error('[LifeOS] today load error:', e)
    }
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  const pending = tasks.filter(t => t.status === 'pending')
  const done = tasks.filter(t => t.status === 'done')
  const overdue = contacts.filter(c => {
    const tierDays = CONTACT_TIER_DAYS[(c.contact_tier || 'weekly') as ContactTier]
    const days = c.last_contacted_at
      ? Math.floor((Date.now() - new Date(c.last_contacted_at).getTime()) / 86400000)
      : tierDays + 1
    return days >= tierDays
  }).sort((a, b) => {
    const dA = a.last_contacted_at ? Math.floor((Date.now() - new Date(a.last_contacted_at).getTime()) / 86400000) : 999
    const dB = b.last_contacted_at ? Math.floor((Date.now() - new Date(b.last_contacted_at).getTime()) / 86400000) : 999
    return dB - dA
  })

  const top4 = pending.slice(0, 4)

  async function toggleTask(id: string, status: string) {
    const next = status === 'done' ? 'pending' : 'done'
    await supabase.from('tasks').update({ status: next }).eq('id', id)
    load()
  }

  async function rolloverTask(task: Task) {
    const next = new Date(task.due_date); next.setDate(next.getDate() + 1)
    const nextStr = next.toISOString().split('T')[0]
    await supabase.from('tasks').update({ due_date: nextStr, status: 'rolled_over', updated_at: new Date().toISOString() }).eq('id', task.id)
    await supabase.from('task_rollovers').insert({ task_id: task.id, from_date: task.due_date, to_date: nextStr })
    load()
  }

  const now = new Date()
  const dateChip = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()

  return (
    <LinearGradient colors={[T.bg, T.bg2]} start={{ x: 0.32, y: 0 }} end={{ x: 0.68, y: 1 }} style={{ flex: 1 }}>
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={s.row}>
          <View>
            <SkKicker>Life OS</SkKicker>
            <Text style={s.heading}>Good morning.</Text>
          </View>
          <View style={[s.dateChip, raisedShadowSm]}>
            <Text style={s.dateChipText}>{dateChip}</Text>
          </View>
        </View>

        {/* LCD readout */}
        <SkCard style={s.lcdOuter}>
          <View style={s.lcdPanel}>
            {([
              ['TASKS',      pending.length,  T.displayInk],
              ['DONE',       done.length,     '#9FE3B0'],
              ['REACH OUT',  overdue.length,  '#ECA06A'],
            ] as [string, number, string][]).map(([label, val, color], i) => (
              <View key={label} style={[s.lcdCell, i > 0 && s.lcdDivider]}>
                <Text style={[s.lcdNum, { color, textShadowColor: color + '55', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 13 }]}>
                  {pad2(val)}
                </Text>
                <Text style={s.lcdLabel}>{label}</Text>
              </View>
            ))}
          </View>
        </SkCard>

        {/* Up next */}
        <SkSectionHead label="Up next" right={
          <TouchableOpacity onPress={() => router.push('/(tabs)/tasks')}>
            <Text style={s.navLink}>ALL TASKS →</Text>
          </TouchableOpacity>
        } />
        <View style={{ gap: T.listGap }}>
          {top4.length === 0
            ? <Text style={s.empty}>Nothing pending.</Text>
            : top4.map(t => (
              <TodayTaskRow key={t.id} task={t} onToggle={() => toggleTask(t.id, t.status)} onRollover={() => rolloverTask(t)} />
            ))}
        </View>

        {/* Reach out */}
        {overdue.length > 0 && (
          <>
            <SkSectionHead label="Reach out" right={
              <TouchableOpacity onPress={() => router.push('/(tabs)/contacts')}>
                <Text style={s.navLink}>PEOPLE →</Text>
              </TouchableOpacity>
            } />
            <SkCard style={s.avatarRow}>
              {overdue.slice(0, 3).map(c => {
                const tierDays = CONTACT_TIER_DAYS[(c.contact_tier || 'weekly') as ContactTier]
                const days = c.last_contacted_at
                  ? Math.floor((Date.now() - new Date(c.last_contacted_at).getTime()) / 86400000)
                  : tierDays + 1
                const overdueDays = days - tierDays
                const initials = c.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                return (
                  <TouchableOpacity key={c.id} style={s.avatarItem}
                    onPress={() => router.push('/(tabs)/contacts')}>
                    <View style={[s.avatar, raisedShadowSm]}>
                      <Text style={s.avatarInitials}>{initials}</Text>
                    </View>
                    <Text style={s.avatarName} numberOfLines={1}>{c.name}</Text>
                    <Text style={s.avatarOverdue}>{overdueDays}D OVERDUE</Text>
                  </TouchableOpacity>
                )
              })}
            </SkCard>
          </>
        )}

      </ScrollView>
    </SafeAreaView>
    </LinearGradient>
  )
}

function TodayTaskRow({ task, onToggle, onRollover }: { task: Task; onToggle: () => void; onRollover: () => void }) {
  const swipeRef = useRef<Swipeable>(null)
  const done = task.status === 'done'
  const isEvent = task.task_type === 'event'
  const isContact = !!task.contact_id
  const rolls = task.rollover_count ?? 0
  const urgent = rolls >= 3
  const borderColor = urgent && !done ? T.clay : isEvent ? T.sageDim : undefined

  function handleSwipe(dir: 'left' | 'right') {
    swipeRef.current?.close()
    if (dir === 'right') onToggle()
    if (dir === 'left' && !done) onRollover()
  }

  return (
    <Swipeable ref={swipeRef}
      renderLeftActions={() => (
        <View style={[s.swipe, s.swipeDone]}>
          <Text style={s.swipeText}>{done ? '↩ UNDO' : '✓ DONE'}</Text>
        </View>
      )}
      renderRightActions={() => !done ? (
        <View style={[s.swipe, s.swipeRoll]}>
          <Text style={s.swipeText}>→ TMRW</Text>
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
          <Text style={[s.taskTitle, done && s.taskTitleDone]} numberOfLines={1}>{task.title}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {(isContact || isEvent) && !done
              ? <Text style={s.keepInTouch}>● KEEP IN TOUCH</Text>
              : rolls > 0
                ? <Text style={[s.rollBadge, urgent && { color: T.clay }]}>↺{rolls} MOVED</Text>
                : task.tags?.[0]
                  ? <SkTagBadge label={task.tags[0].name} />
                  : null
            }
          </View>
        </View>
      </SkCard>
    </Swipeable>
  )
}

const s = StyleSheet.create({
  safe:     { flex: 1 },
  scroll:   { padding: T.padX, paddingTop: T.topPad - 30, gap: T.gap, paddingBottom: 32 },
  row:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heading:  { fontFamily: MONO, fontSize: 27, fontWeight: '600', color: T.ink, marginTop: 6, letterSpacing: -0.5 },
  dateChip: { backgroundColor: T.display, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9, marginTop: 2 },
  dateChipText: { fontFamily: MONO, fontSize: 10, color: T.displayInk, letterSpacing: 1 },
  lcdOuter: { padding: 9 },
  lcdPanel: { backgroundColor: T.display, borderRadius: 13, paddingVertical: 16, flexDirection: 'row',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.55, shadowRadius: 10, elevation: 0 },
  lcdCell:  { flex: 1, alignItems: 'center' },
  lcdDivider: { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.09)' },
  lcdNum:   { fontFamily: MONO, fontWeight: '700', fontSize: 33, lineHeight: 36 },
  lcdLabel: { fontFamily: MONO, fontSize: 8, letterSpacing: 1.5, color: 'rgba(255,255,255,0.42)', marginTop: 8 },
  navLink:  { fontFamily: MONO, fontSize: 10.5, color: T.sage, letterSpacing: 1 },
  avatarRow: { padding: 14, flexDirection: 'row' },
  avatarItem: { flex: 1, alignItems: 'center' },
  avatar:   { width: 46, height: 46, borderRadius: 23, backgroundColor: T.display, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  avatarInitials: { fontFamily: MONO, fontWeight: '700', fontSize: 15, color: '#ECA06A' },
  avatarName: { fontFamily: MONO, fontSize: 11, color: T.ink, fontWeight: '500' },
  avatarOverdue: { fontFamily: MONO, fontSize: 8.5, color: T.clay, marginTop: 2, letterSpacing: 0.5 },
  taskTitle: { fontFamily: MONO, fontSize: 13, color: T.ink, fontWeight: '500', lineHeight: 18 },
  taskTitleDone: { textDecorationLine: 'line-through', color: T.faint },
  rollBadge:    { fontFamily: MONO, fontSize: 9, color: T.faint, letterSpacing: 1 },
  keepInTouch:  { fontFamily: MONO, fontSize: 9, color: T.clay, letterSpacing: 1 },
  empty: { fontFamily: MONO, fontSize: 12, color: T.faint, textAlign: 'center', paddingVertical: 24 },
  swipe:     { flex: 1, justifyContent: 'center', paddingHorizontal: 20, borderRadius: 18 },
  swipeDone: { backgroundColor: '#3D6B4A' },
  swipeRoll: { backgroundColor: '#3C4E6E' },
  swipeText: { fontFamily: MONO, fontSize: 11, color: '#EEF0E6', fontWeight: '600', letterSpacing: 0.5 },
})
