import { useEffect, useRef, useState } from 'react'
import { View, Text, TouchableOpacity, FlatList, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { subscribe, clearLogs } from '../../lib/logger'
import { T, MONO } from '../../lib/theme'

type LogEntry = { ts: string; msg: string; level: 'info' | 'warn' | 'error' }

export default function LogsScreen() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const listRef = useRef<FlatList>(null)

  useEffect(() => subscribe(setEntries), [])

  useEffect(() => {
    if (entries.length > 0) listRef.current?.scrollToEnd({ animated: false })
  }, [entries.length])

  const COLOR: Record<string, string> = { info: T.ink, warn: '#E8B84B', error: '#E05A5A' }

  return (
    <LinearGradient colors={[T.bg, T.bg2]} start={{ x: 0.32, y: 0 }} end={{ x: 0.68, y: 1 }} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={s.header}>
          <Text style={s.title}>LOGS</Text>
          <TouchableOpacity onPress={clearLogs} style={s.clearBtn}>
            <Text style={s.clearText}>CLEAR</Text>
          </TouchableOpacity>
        </View>
        <FlatList
          ref={listRef}
          data={entries}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={s.list}
          renderItem={({ item }) => (
            <View style={s.row}>
              <Text style={[s.ts]}>{item.ts}</Text>
              <Text style={[s.msg, { color: COLOR[item.level] }]}>{item.msg}</Text>
            </View>
          )}
          ListEmptyComponent={<Text style={s.empty}>No logs yet.</Text>}
        />
      </SafeAreaView>
    </LinearGradient>
  )
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontFamily: MONO, fontSize: 13, fontWeight: '700', color: T.ink, letterSpacing: 1 },
  clearBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: T.surface, borderRadius: 8 },
  clearText: { fontFamily: MONO, fontSize: 10, color: T.faint, letterSpacing: 0.5 },
  list: { paddingHorizontal: 12, paddingBottom: 32, gap: 2 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  ts: { fontFamily: MONO, fontSize: 9.5, color: T.faint, minWidth: 80 },
  msg: { fontFamily: MONO, fontSize: 10.5, flex: 1, lineHeight: 15 },
  empty: { fontFamily: MONO, fontSize: 11, color: T.faint, textAlign: 'center', marginTop: 40 },
})
