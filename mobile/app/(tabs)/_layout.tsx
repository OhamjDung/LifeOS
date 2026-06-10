import { Tabs } from 'expo-router'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { T, MONO } from '../../lib/theme'

// Analog monospace icons — one character, no emoji
const ICONS: Record<string, string> = {
  today:     '⌂',
  tasks:     '☐',
  braindump: '◉',
  notes:     '≡',
  contacts:  '○',
  modes:     '◎',
  logs:      '▤',
}

const LABELS: Record<string, string> = {
  today:     'TODAY',
  tasks:     'TASKS',
  braindump: 'DUMP',
  notes:     'NOTES',
  contacts:  'PEOPLE',
  modes:     'MODES',
  logs:      'LOGS',
}

function SkTabBar({ state, descriptors, navigation }: any) {
  const insets = useSafeAreaInsets()
  const TABS = ['today', 'tasks', 'braindump', 'notes', 'contacts', 'modes', 'logs']

  return (
    <LinearGradient colors={[T.bg, T.bg2]} start={{ x: 0.32, y: 0 }} end={{ x: 0.68, y: 1 }}
      style={[bar.wrap, { paddingBottom: insets.bottom + 6 }]}>
      {TABS.map((name) => {
        const routeIdx = state.routes.findIndex((r: any) => r.name === name)
        const isFocused = routeIdx !== -1 && state.index === routeIdx

        const onPress = () => {
          if (routeIdx === -1) return
          navigation.navigate(name)
        }

        return (
          <TouchableOpacity key={name} onPress={onPress} activeOpacity={0.75}
            style={[bar.item, isFocused && bar.itemActive]}>
            <Text style={[bar.icon, { color: isFocused ? T.sage : T.faint }]}>
              {ICONS[name]}
            </Text>
            <Text style={[bar.label, { color: isFocused ? T.sage : T.faint }]}>
              {LABELS[name]}
            </Text>
          </TouchableOpacity>
        )
      })}
    </LinearGradient>
  )
}

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <SkTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="today"     />
      <Tabs.Screen name="tasks"     />
      <Tabs.Screen name="braindump" />
      <Tabs.Screen name="notes"     />
      <Tabs.Screen name="contacts"  />
      <Tabs.Screen name="modes"     />
      <Tabs.Screen name="logs"      />
      <Tabs.Screen name="calendar"  options={{ href: null }} />
      <Tabs.Screen name="search"    options={{ href: null }} />
    </Tabs>
  )
}

const bar = StyleSheet.create({
  wrap: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.6)',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    paddingTop: 10,
    shadowColor: '#948D7E',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 10,
  },
  item: {
    alignItems: 'center',
    gap: 2,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRadius: 10,
    flex: 1,
  },
  itemActive: {
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  icon: {
    fontSize: 22,
    lineHeight: 26,
  },
  label: {
    fontFamily: MONO,
    fontSize: 9,
    letterSpacing: 0.5,
    fontWeight: '500',
  },
})
