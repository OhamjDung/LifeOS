import { Tabs } from 'expo-router'

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#111827', borderTopColor: '#1f2937' },
        tabBarActiveTintColor: '#6366f1',
        tabBarInactiveTintColor: '#6b7280',
      }}
    >
      <Tabs.Screen name="tasks"     options={{ title: 'Tasks',     tabBarIcon: ({ color }) => <TabIcon label="✅" color={color} /> }} />
      <Tabs.Screen name="braindump" options={{ title: 'Braindump', tabBarIcon: ({ color }) => <TabIcon label="🧠" color={color} /> }} />
      <Tabs.Screen name="notes"     options={{ title: 'Notes',     tabBarIcon: ({ color }) => <TabIcon label="📝" color={color} /> }} />
      <Tabs.Screen name="contacts"  options={{ title: 'Contacts',  tabBarIcon: ({ color }) => <TabIcon label="👥" color={color} /> }} />
      <Tabs.Screen name="modes"     options={{ title: 'Modes',     tabBarIcon: ({ color }) => <TabIcon label="📍" color={color} /> }} />
      {/* Hidden routes — merged into Tasks and Notes */}
      <Tabs.Screen name="calendar"  options={{ href: null }} />
      <Tabs.Screen name="search"    options={{ href: null }} />
    </Tabs>
  )
}

function TabIcon({ label, color }: { label: string; color: string }) {
  const { Text } = require('react-native')
  return <Text style={{ fontSize: 18 }}>{label}</Text>
}
