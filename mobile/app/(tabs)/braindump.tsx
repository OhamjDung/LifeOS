import { useState, useEffect, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Animated,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import Constants from 'expo-constants'
import { supabase } from '../../lib/supabase'
import { SkCard, SkKicker, SkCheck } from '../../components/Sk'
import { T, MONO, SHADOW_DARK_RAISED, SHADOW_LIGHT_RAISED, raisedShadowSm, insetBg } from '../../lib/theme'

const IS_EXPO_GO = Constants.appOwnership === 'expo'

type Category = 'Tasks' | 'Notes' | 'Contacts'
const CATS: Category[] = ['Tasks', 'Notes', 'Contacts']

export default function BraindumpScreen() {
  const [text, setText] = useState('')
  const [categories, setCategories] = useState<Category[]>(['Tasks'])
  const [listening, setListening] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [voiceAvailable, setVoiceAvailable] = useState(false)
  const pulseScale = useRef(new Animated.Value(1)).current
  const pulseOpacity = useRef(new Animated.Value(0)).current
  const router = useRouter()

  useEffect(() => {
    if (IS_EXPO_GO) return
    try {
      const Voice = require('@react-native-voice/voice').default
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
      pulseScale.setValue(1)
      pulseOpacity.setValue(0.75)
      Animated.loop(Animated.parallel([
        Animated.timing(pulseScale, { toValue: 1.4, duration: 1400, useNativeDriver: true }),
        Animated.timing(pulseOpacity, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ])).start()
    } else {
      pulseScale.stopAnimation(); pulseScale.setValue(1)
      pulseOpacity.stopAnimation(); pulseOpacity.setValue(0)
    }
  }, [listening])

  function toggleCat(c: Category) {
    setCategories(prev => prev.includes(c)
      ? (prev.length > 1 ? prev.filter(x => x !== c) : prev)
      : [...prev, c])
  }

  async function toggleVoice() {
    if (IS_EXPO_GO) return
    let Voice: any
    try { Voice = require('@react-native-voice/voice').default } catch { return }
    if (listening) { await Voice.stop(); setListening(false) }
    else { try { await Voice.start('en-US'); setListening(true) } catch { setListening(false) } }
  }

  async function handleSubmit() {
    if (!text.trim()) return
    if (listening) {
      try { const V = require('@react-native-voice/voice').default; await V.stop() } catch {}
    }
    setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()
    const jobs: PromiseLike<any>[] = []

    if (categories.includes('Tasks') || categories.includes('Contacts')) {
      jobs.push(supabase.from('braindump_jobs').insert({
        raw_transcript: text.trim(), user_id: user?.id,
        categories: categories.filter(c => c !== 'Notes'),
      }))
    }
    if (categories.includes('Notes')) {
      jobs.push(supabase.from('notes').insert({
        content: text.trim(), user_id: user?.id, source_platform: 'ios',
      }))
    }
    await Promise.all(jobs)
    setSubmitting(false); setSubmitted(true); setText('')

    const dest = categories.includes('Notes') && !categories.includes('Tasks')
      ? '/(tabs)/notes' : '/(tabs)/today'
    setTimeout(() => { setSubmitted(false); router.replace(dest as any) }, 1500)
  }

  return (
    <LinearGradient colors={[T.bg, T.bg2]} start={{ x: 0.32, y: 0 }} end={{ x: 0.68, y: 1 }} style={{ flex: 1 }}>
    <SafeAreaView style={bd.safe}>
      <ScrollView contentContainerStyle={bd.scroll} keyboardShouldPersistTaps="handled">

        <View>
          <SkKicker>Voice braindump</SkKicker>
          <Text style={bd.heading}>{submitted ? 'Caught it.' : 'Empty your head.'}</Text>
        </View>

        {submitted ? (
          <View style={bd.success}>
            <Text style={bd.successTitle}>Submitted!</Text>
            <Text style={bd.successSub}>{categories.includes('Tasks') ? 'AI extracting tasks…' : 'Note saved.'}</Text>
          </View>
        ) : (
          <>
            {/* Big tactile record button */}
            <SkCard style={bd.recCard}>
              {/* Mic button with ripple ring */}
              <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                {/* Ripple ring — expands + fades while listening */}
                <Animated.View style={[
                  bd.pulseRing,
                  { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
                ]} />
                <TouchableOpacity
                  onPress={voiceAvailable ? toggleVoice : undefined}
                  activeOpacity={0.85}
                  style={[
                    bd.micOuter,
                    listening ? { backgroundColor: insetBg } : { ...SHADOW_LIGHT_RAISED, ...SHADOW_DARK_RAISED },
                  ]}
                >
                  <View style={[bd.micInner, listening && { backgroundColor: T.clay }]}>
                    {listening
                      ? <View style={bd.stopSquare} />
                      : <Text style={{ fontSize: 26, color: T.displayInk }}>◉</Text>
                    }
                  </View>
                </TouchableOpacity>
              </View>

              {listening ? (
                <View style={bd.waveRow}>
                  {Array.from({ length: 20 }).map((_, i) => (
                    <WaveBar key={i} delay={i * 0.06} />
                  ))}
                </View>
              ) : null}

              <Text style={bd.recHint}>
                {listening
                  ? '● REC — tap to stop'
                  : voiceAvailable
                    ? 'Tap to record. Speak freely.'
                    : 'Type below. Speak after dev client build.'}
              </Text>
            </SkCard>

            {/* Category chips */}
            <View style={bd.catRow}>
              {CATS.map(c => (
                <TouchableOpacity key={c} onPress={() => toggleCat(c)}
                  style={[bd.catChip, categories.includes(c) && bd.catChipOn]}>
                  <Text style={[bd.catLabel, categories.includes(c) && bd.catLabelOn]}>
                    {categories.includes(c) ? '✓ ' : ''}{c}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Text area */}
            <SkCard pressed style={{ padding: 16 }}>
              <TextInput
                style={bd.textarea}
                placeholder="I need to call Sarah, finish the report by Friday, grab groceries…"
                placeholderTextColor={T.faint}
                value={text} onChangeText={setText}
                multiline numberOfLines={8} textAlignVertical="top"
              />
            </SkCard>

            {/* Submit */}
            <TouchableOpacity
              style={[bd.submitBtn, (!text.trim() || submitting) && { opacity: 0.4 }]}
              onPress={handleSubmit} disabled={!text.trim() || submitting}
            >
              <Text style={bd.submitText}>{submitting ? 'Submitting…' : `Submit${categories.includes('Tasks') ? ' — extract tasks' : ''}`}</Text>
            </TouchableOpacity>

            <Text style={bd.hint}>
              {categories.includes('Tasks') ? 'Tasks appear in ~2 min after AI processing' : 'Note saved immediately'}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
    </LinearGradient>
  )
}

function WaveBar({ delay }: { delay: number }) {
  const h = useRef(new Animated.Value(5)).current
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(h, { toValue: 5 + Math.random() * 22, duration: 400 + Math.random() * 300, useNativeDriver: false }),
      Animated.timing(h, { toValue: 5, duration: 400 + Math.random() * 300, useNativeDriver: false }),
    ])).start()
  }, [])
  return <Animated.View style={{ width: 3, height: h, borderRadius: 2, backgroundColor: T.sageDim, marginHorizontal: 1.5 }} />
}

const bd = StyleSheet.create({
  safe:   { flex: 1 },
  scroll: { padding: T.padX, paddingTop: T.topPad - 30, gap: T.gap, paddingBottom: 32 },
  heading: { fontFamily: MONO, fontSize: 26, fontWeight: '600', color: T.ink, marginTop: 4 },
  recCard: { padding: 26, alignItems: 'center', gap: 18 },
  pulseRing: {
    position: 'absolute', width: 116, height: 116, borderRadius: 58,
    backgroundColor: T.sageDim + '50',
  },
  micOuter: { width: 116, height: 116, borderRadius: 58, backgroundColor: T.surface, alignItems: 'center', justifyContent: 'center' },
  micInner: { width: 78, height: 78, borderRadius: 39, backgroundColor: T.display, alignItems: 'center', justifyContent: 'center' },
  stopSquare: { width: 26, height: 26, borderRadius: 6, backgroundColor: T.clayFg },
  waveRow: { flexDirection: 'row', alignItems: 'flex-end', height: 32 },
  recHint: { fontFamily: MONO, fontSize: 11.5, color: T.faint, textAlign: 'center', letterSpacing: 0.5, lineHeight: 18 },
  catRow: { flexDirection: 'row', gap: 9 },
  catChip: { flex: 1, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 12, backgroundColor: T.surface, alignItems: 'center', ...raisedShadowSm },
  catChipOn: { backgroundColor: T.display },
  catLabel: { fontFamily: MONO, fontSize: 11, color: T.faint, letterSpacing: 0.5, fontWeight: '500' },
  catLabelOn: { color: T.displayInk },
  textarea: { fontFamily: MONO, fontSize: 13, color: T.ink, lineHeight: 22, minHeight: 120 },
  submitBtn: { backgroundColor: T.display, borderRadius: 14, paddingVertical: 16, alignItems: 'center', ...raisedShadowSm },
  submitText: { fontFamily: MONO, fontSize: 13, fontWeight: '600', color: T.displayInk, letterSpacing: 0.5 },
  hint: { fontFamily: MONO, fontSize: 11, color: T.faint, textAlign: 'center', letterSpacing: 0.5 },
  success: { backgroundColor: '#1A2C1A', borderRadius: 18, padding: 32, alignItems: 'center', marginTop: 16 },
  successTitle: { fontFamily: MONO, fontSize: 18, fontWeight: '600', color: '#9FE3B0', marginBottom: 8 },
  successSub: { fontFamily: MONO, fontSize: 12, color: T.faint },
})
