import { useEffect, useState } from 'react'
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, Alert, TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Constants from 'expo-constants'
import { supabase } from '../../lib/supabase'

const IS_EXPO_GO = Constants.appOwnership === 'expo'

interface Anchor {
  id: string
  label: string
  mode: string
  latitude: number
  longitude: number
  radius_meters: number
}

const MODES = ['home', 'work', 'gym', 'default'] as const

export default function ModesScreen() {
  const [anchors, setAnchors] = useState<Anchor[]>([])
  const [label, setLabel] = useState('')
  const [mode, setMode] = useState<typeof MODES[number]>('home')
  const [saving, setSaving] = useState(false)
  const [geofenceActive, setGeofenceActive] = useState(false)
  const [locationAvailable, setLocationAvailable] = useState(false)

  useEffect(() => {
    fetchAnchors()
    setLocationAvailable(!IS_EXPO_GO)
  }, [])

  async function fetchAnchors() {
    const { data } = await supabase.from('location_anchors').select('*').order('created_at')
    if (data) setAnchors(data as Anchor[])
  }

  async function addCurrentLocation() {
    if (!label.trim()) return
    setSaving(true)
    let Location: any
    try {
      Location = require('expo-location')
    } catch {
      Alert.alert('Not available', 'Location requires a dev client build.')
      setSaving(false)
      return
    }

    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission denied', 'Location permission is required.')
      setSaving(false)
      return
    }

    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
    const { data: { user } } = await supabase.auth.getUser()

    await supabase.from('location_anchors').insert({
      user_id: user?.id,
      label: label.trim(),
      mode,
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      radius_meters: 150,
    })

    setLabel('')
    setSaving(false)
    await fetchAnchors()
  }

  async function activateGeofencing() {
    let startGeofencing: any
    try {
      startGeofencing = require('../../lib/geofence').startGeofencing
    } catch {
      Alert.alert('Not available', 'Geofencing requires a dev client build.')
      return
    }
    const success = await startGeofencing(anchors)
    if (success) {
      setGeofenceActive(true)
      Alert.alert('Geofencing active', 'LifeOS will now auto-switch modes when you arrive at your locations.')
    } else {
      Alert.alert('Permission required', 'Allow "Always" location access in Settings to enable auto mode switching.')
    }
  }

  async function deleteAnchor(id: string) {
    await supabase.from('location_anchors').delete().eq('id', id)
    await fetchAnchors()
  }

  return (
    <SafeAreaView style={s.safe}>
      <FlatList
        data={anchors}
        keyExtractor={a => a.id}
        ListHeaderComponent={
          <View style={s.container}>
            <Text style={s.heading}>Locations</Text>
            <Text style={s.sub}>Save locations to auto-switch modes.</Text>

            {!locationAvailable && (
              <View style={s.notice}>
                <Text style={s.noticeText}>📱 Location features require a dev client build</Text>
              </View>
            )}

            <View style={s.card}>
              <Text style={s.cardTitle}>Add current location</Text>
              <TextInput
                style={s.input}
                placeholder="Label (e.g. Home, Office, Gym)"
                placeholderTextColor="#6b7280"
                value={label}
                onChangeText={setLabel}
              />
              <View style={s.modeRow}>
                {MODES.map(m => (
                  <TouchableOpacity
                    key={m}
                    style={[s.modeBtn, mode === m && s.modeBtnActive]}
                    onPress={() => setMode(m)}
                  >
                    <Text style={[s.modeText, mode === m && s.modeTextActive]}>{m}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={[s.btn, (!label.trim() || saving) && s.btnDisabled]}
                onPress={addCurrentLocation}
                disabled={!label.trim() || saving}
              >
                <Text style={s.btnText}>{saving ? 'Saving…' : '📍 Save current location'}</Text>
              </TouchableOpacity>
            </View>

            {anchors.length > 0 && (
              <TouchableOpacity
                style={[s.activateBtn, geofenceActive && s.activateBtnOn]}
                onPress={activateGeofencing}
              >
                <Text style={s.activateBtnText}>
                  {geofenceActive ? '✅ Geofencing active' : '▶ Activate auto mode switching'}
                </Text>
              </TouchableOpacity>
            )}

            <Text style={s.sectionTitle}>Saved locations</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.row}>
            <View style={s.rowInfo}>
              <Text style={s.rowLabel}>{item.label}</Text>
              <Text style={s.rowMode}>{item.mode} · {item.radius_meters}m radius</Text>
            </View>
            <TouchableOpacity onPress={() => deleteAnchor(item.id)}>
              <Text style={s.deleteText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={<Text style={s.empty}>No locations saved yet.</Text>}
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111827' },
  container: { padding: 20 },
  heading: { fontSize: 28, fontWeight: '700', color: '#fff', marginTop: 8, marginBottom: 4 },
  sub: { fontSize: 13, color: '#6b7280', marginBottom: 24 },
  notice: {
    backgroundColor: '#1c1917', borderWidth: 1, borderColor: '#44403c',
    borderRadius: 10, padding: 12, marginBottom: 16,
  },
  noticeText: { color: '#a8a29e', fontSize: 13, textAlign: 'center' },
  card: { backgroundColor: '#1f2937', borderRadius: 14, padding: 16, marginBottom: 16 },
  cardTitle: { color: '#fff', fontWeight: '600', marginBottom: 12 },
  input: {
    backgroundColor: '#111827', borderWidth: 1, borderColor: '#374151',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: '#fff', fontSize: 14, marginBottom: 10,
  },
  modeRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  modeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#374151' },
  modeBtnActive: { borderColor: '#6366f1', backgroundColor: '#1e1b4b' },
  modeText: { color: '#6b7280', fontSize: 12 },
  modeTextActive: { color: '#a5b4fc' },
  btn: { backgroundColor: '#4f46e5', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '600' },
  activateBtn: {
    backgroundColor: '#1f2937', borderWidth: 1, borderColor: '#374151',
    borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 20,
  },
  activateBtnOn: { borderColor: '#16a34a', backgroundColor: '#052e16' },
  activateBtnText: { color: '#e5e7eb', fontWeight: '600' },
  sectionTitle: { color: '#9ca3af', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#1f2937',
  },
  rowInfo: { flex: 1 },
  rowLabel: { color: '#e5e7eb', fontSize: 15, fontWeight: '500' },
  rowMode: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  deleteText: { color: '#6b7280', fontSize: 16, paddingLeft: 12 },
  empty: { color: '#6b7280', fontSize: 14, paddingHorizontal: 20 },
})
