import { useState, useEffect, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Animated,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import Constants from 'expo-constants'
import { supabase } from '../../lib/supabase'

const IS_EXPO_GO = Constants.appOwnership === 'expo'

type Category = 'tasks' | 'notes' | 'contacts'

const CATEGORIES: { key: Category; label: string; desc: string }[] = [
  { key: 'tasks',    label: '✅ Tasks',    desc: 'Extract to-do items' },
  { key: 'notes',    label: '📝 Notes',    desc: 'Save as a note too' },
  { key: 'contacts', label: '👥 Contacts', desc: 'Include people context' },
]

export default function BraindumpScreen() {
  const [text, setText] = useState('')
  const [categories, setCategories] = useState<Category[]>(['tasks'])
  const [listening, setListening] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [voiceAvailable, setVoiceAvailable] = useState(false)
  const pulse = useRef(new Animated.Value(1)).current
  const router = useRouter()

  useEffect(() => {
    if (IS_EXPO_GO) return
    let Voice: any = null
    try {
      Voice = require('@react-native-voice/voice').default
      Voice.isAvailable().then((a: boolean) => setVoiceAvailable(!!a))
      Voice.onSpeechResults = (e: any) => {
        if (e.value?.[0]) setText(prev => prev ? prev + ' ' + e.value[0] : e.value[0])
      }
      Voice.onSpeechEnd = () => setListening(false)
      Voice.onSpeechError = () => setListening(false)
      return () => Voice?.destroy().then(Voice?.removeAllListeners)
    } catch {
      setVoiceAvailable(false)
    }
  }, [])

  useEffect(() => {
    if (listening) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.15, duration: 600, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start()
    } else {
      pulse.stopAnimation()
      pulse.setValue(1)
    }
  }, [listening])

  function toggleCategory(cat: Category) {
    setCategories(prev =>
      prev.includes(cat) ? (prev.length > 1 ? prev.filter(c => c !== cat) : prev) : [...prev, cat]
    )
  }

  async function toggleVoice() {
    if (IS_EXPO_GO) return
    let Voice: any = null
    try { Voice = require('@react-native-voice/voice').default } catch { return }
    if (listening) {
      await Voice.stop()
      setListening(false)
    } else {
      try { await Voice.start('en-US'); setListening(true) } catch { setListening(false) }
    }
  }

  async function handleSubmit() {
    if (!text.trim()) return
    if (listening) {
      try { const Voice = require('@react-native-voice/voice').default; await Voice.stop() } catch {}
    }
    setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()

    const jobs: Promise<any>[] = []

    // Always insert braindump_job if tasks or contacts selected
    if (categories.includes('tasks') || categories.includes('contacts')) {
      jobs.push(supabase.from('braindump_jobs').insert({
        raw_transcript: text.trim(),
        user_id: user?.id,
        categories: categories.filter(c => c !== 'notes'),
      }))
    }

    // Also create a note if notes selected
    if (categories.includes('notes')) {
      jobs.push(supabase.from('notes').insert({
        content: text.trim(),
        user_id: user?.id,
        source_platform: 'ios',
      }))
    }

    await Promise.all(jobs)

    setSubmitting(false)
    setSubmitted(true)
    setText('')

    const dest = categories.includes('notes') && !categories.includes('tasks')
      ? '/(tabs)/notes' : '/(tabs)/tasks'

    setTimeout(() => {
      setSubmitted(false)
      router.replace(dest as any)
    }, 1500)
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
        <Text style={s.heading}>Braindump</Text>
        <Text style={s.sub}>Speak or type freely. AI extracts structure in ~2 min.</Text>

        {submitted ? (
          <View style={s.success}>
            <Text style={s.successText}>Submitted!</Text>
            <Text style={s.successSub}>
              {categories.includes('tasks') ? 'AI extracting tasks…' : 'Note saved.'}
            </Text>
          </View>
        ) : (
          <>
            {/* Category chips */}
            <View style={s.categoryRow}>
              {CATEGORIES.map(({ key, label, desc }) => (
                <TouchableOpacity key={key}
                  style={[s.catChip, categories.includes(key) && s.catChipActive]}
                  onPress={() => toggleCategory(key)}
                >
                  <Text style={[s.catLabel, categories.includes(key) && s.catLabelActive]}>{label}</Text>
                  <Text style={[s.catDesc, categories.includes(key) && s.catDescActive]}>{desc}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {voiceAvailable && (
              <View style={s.voiceRow}>
                <Animated.View style={{ transform: [{ scale: pulse }] }}>
                  <TouchableOpacity style={[s.micBtn, listening && s.micBtnActive]} onPress={toggleVoice}>
                    <Text style={s.micIcon}>{listening ? '⏹' : '🎙'}</Text>
                  </TouchableOpacity>
                </Animated.View>
                <Text style={s.voiceHint}>{listening ? 'Listening… tap to stop' : 'Tap to speak'}</Text>
              </View>
            )}

            <TextInput style={s.textarea}
              placeholder="I need to call Sarah back, also the project deadline is Friday, and I ran into Alex today…"
              placeholderTextColor="#6b7280"
              value={text} onChangeText={setText}
              multiline numberOfLines={10} textAlignVertical="top"
            />

            <TouchableOpacity style={[s.btn, (!text.trim() || submitting) && s.btnDisabled]}
              onPress={handleSubmit} disabled={!text.trim() || submitting}>
              <Text style={s.btnText}>{submitting ? 'Submitting…' : 'Submit'}</Text>
            </TouchableOpacity>

            <Text style={s.hint}>
              {categories.includes('tasks') ? 'Tasks extracted in ~2 min via AI' : ''}
              {categories.includes('tasks') && categories.includes('notes') ? ' · ' : ''}
              {categories.includes('notes') ? 'Saved as note immediately' : ''}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111827' },
  container: { padding: 20, flexGrow: 1 },
  heading: { fontSize: 28, fontWeight: '700', color: '#fff', marginTop: 8, marginBottom: 4 },
  sub: { fontSize: 13, color: '#6b7280', marginBottom: 20 },
  categoryRow: { flexDirection: 'row', gap: 8, marginBottom: 20, flexWrap: 'wrap' },
  catChip: { flex: 1, minWidth: 90, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: '#374151', backgroundColor: '#1f2937' },
  catChipActive: { borderColor: '#6366f1', backgroundColor: '#1e1b4b' },
  catLabel: { color: '#9ca3af', fontSize: 13, fontWeight: '600', marginBottom: 2 },
  catLabelActive: { color: '#a5b4fc' },
  catDesc: { color: '#4b5563', fontSize: 11 },
  catDescActive: { color: '#818cf8' },
  voiceRow: { alignItems: 'center', marginBottom: 20, gap: 10 },
  micBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#1f2937', borderWidth: 2, borderColor: '#374151', alignItems: 'center', justifyContent: 'center' },
  micBtnActive: { borderColor: '#ef4444', backgroundColor: '#450a0a' },
  micIcon: { fontSize: 28 },
  voiceHint: { color: '#6b7280', fontSize: 13 },
  textarea: { backgroundColor: '#1f2937', borderWidth: 1, borderColor: '#374151', borderRadius: 16, padding: 16, color: '#e5e7eb', fontSize: 16, minHeight: 160, marginBottom: 16, lineHeight: 24 },
  btn: { backgroundColor: '#4f46e5', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 12 },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  hint: { color: '#4b5563', fontSize: 12, textAlign: 'center', minHeight: 16 },
  success: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#052e16', borderRadius: 16, padding: 32, marginTop: 40 },
  successText: { color: '#4ade80', fontSize: 18, fontWeight: '600', marginBottom: 8 },
  successSub: { color: '#6b7280', fontSize: 13 },
})
