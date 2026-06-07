import { useState, useCallback } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { supabase } from '../../lib/supabase'

interface CalTask {
  id: string
  title: string
  task_type: string
  due_date: string
  status: string
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_HEADERS = ['S','M','T','W','T','F','S']
const pad = (n: number) => String(n).padStart(2, '0')
const todayStr = new Date().toISOString().split('T')[0]

export default function CalendarScreen() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [tasks, setTasks] = useState<CalTask[]>([])
  const [selectedDate, setSelectedDate] = useState<string>(todayStr)

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
    if (data) setTasks(data as CalTask[])
  }, [year, month])

  useFocusEffect(useCallback(() => { fetchMonth() }, [fetchMonth]))

  function navigate(dir: -1 | 1) {
    const d = new Date(year, month + dir)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
  }

  const firstDOW = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const byDate: Record<string, CalTask[]> = {}
  tasks.forEach(t => {
    if (!byDate[t.due_date]) byDate[t.due_date] = []
    byDate[t.due_date].push(t)
  })

  const cells: (number | null)[] = [
    ...Array(firstDOW).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const selectedTasks = byDate[selectedDate] || []

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Month nav */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigate(-1)} style={s.navBtn}>
            <Text style={s.navArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={s.monthTitle}>{MONTHS[month]} {year}</Text>
          <TouchableOpacity onPress={() => navigate(1)} style={s.navBtn}>
            <Text style={s.navArrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Day-of-week headers */}
        <View style={s.dayHeaders}>
          {DAY_HEADERS.map((d, i) => (
            <Text key={i} style={s.dayHeader}>{d}</Text>
          ))}
        </View>

        {/* Grid */}
        <View style={s.grid}>
          {cells.map((day, i) => {
            if (!day) return <View key={i} style={s.cell} />
            const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`
            const dayTasks = byDate[dateStr] || []
            const isToday = dateStr === todayStr
            const isSelected = dateStr === selectedDate
            const events = dayTasks.filter(t => t.task_type === 'event')
            const dotCount = Math.min(dayTasks.filter(t => t.task_type === 'task').length, 3)

            return (
              <TouchableOpacity
                key={i}
                style={[s.cell, isSelected && s.cellSelected]}
                onPress={() => setSelectedDate(dateStr)}
                activeOpacity={0.7}
              >
                <View style={[s.dayNumWrap, isToday && s.dayNumToday]}>
                  <Text style={[s.dayNum, isToday && s.dayNumTodayText]}>{day}</Text>
                </View>
                {events.slice(0, 2).map(e => (
                  <Text key={e.id} style={s.eventLabel} numberOfLines={1}>
                    {e.title}
                  </Text>
                ))}
                {dotCount > 0 && (
                  <View style={s.dots}>
                    {Array.from({ length: dotCount }).map((_, di) => (
                      <View key={di} style={s.dot} />
                    ))}
                  </View>
                )}
              </TouchableOpacity>
            )
          })}
        </View>

        {/* Selected day detail */}
        <View style={s.detail}>
          <Text style={s.detailTitle}>
            {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', {
              weekday: 'long', month: 'long', day: 'numeric',
            })}
          </Text>
          {selectedTasks.length === 0 ? (
            <Text style={s.empty}>Nothing scheduled</Text>
          ) : (
            selectedTasks.map(t => (
              <View key={t.id} style={[s.taskRow, t.task_type === 'event' && s.taskRowEvent]}>
                <Text style={[s.taskTitle, t.status === 'done' && s.taskTitleDone]} numberOfLines={2}>
                  {t.task_type === 'event' ? '📅 ' : ''}{t.title}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const CELL_SIZE = 52

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111827' },
  scroll: { padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  navBtn: { padding: 8 },
  navArrow: { color: '#6366f1', fontSize: 28, lineHeight: 30 },
  monthTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  dayHeaders: { flexDirection: 'row', marginBottom: 4 },
  dayHeader: {
    width: CELL_SIZE, textAlign: 'center',
    color: '#6b7280', fontSize: 11, fontWeight: '600',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: CELL_SIZE,
    minHeight: CELL_SIZE,
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRadius: 8,
  },
  cellSelected: { backgroundColor: '#1e1b4b' },
  dayNumWrap: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2, alignSelf: 'center',
  },
  dayNumToday: { backgroundColor: '#6366f1' },
  dayNum: { color: '#e5e7eb', fontSize: 12, fontWeight: '500' },
  dayNumTodayText: { color: '#fff', fontWeight: '700' },
  eventLabel: { color: '#818cf8', fontSize: 9, lineHeight: 11, paddingHorizontal: 2 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 2, marginTop: 2 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#6b7280' },
  detail: {
    marginTop: 20, backgroundColor: '#1f2937',
    borderRadius: 14, padding: 16,
  },
  detailTitle: { color: '#9ca3af', fontSize: 13, fontWeight: '600', marginBottom: 12 },
  empty: { color: '#4b5563', fontSize: 14 },
  taskRow: {
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#374151',
    borderLeftWidth: 0,
  },
  taskRowEvent: { borderLeftWidth: 3, borderLeftColor: '#6366f1', paddingLeft: 8 },
  taskTitle: { color: '#e5e7eb', fontSize: 14 },
  taskTitleDone: { textDecorationLine: 'line-through', color: '#4b5563' },
})
