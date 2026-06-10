import { useState, useEffect, useRef, useCallback } from 'react'
import { Audio } from 'expo-av'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Animated,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import Constants from 'expo-constants'
import { supabase } from '../../lib/supabase'
import { log, warn, error as logError } from '../../lib/logger'
import { SkCard, SkKicker, SkCheck } from '../../components/Sk'
import { T, MONO, SHADOW_DARK_RAISED, SHADOW_LIGHT_RAISED, raisedShadowSm, insetBg } from '../../lib/theme'

const IS_EXPO_GO = Constants.appOwnership === 'expo'

type Category = 'Tasks' | 'Notes' | 'Contacts'
const CATS: Category[] = ['Tasks', 'Notes', 'Contacts']

export default function BraindumpScreen() {
  const [text, setText] = useState('')
  const [partial, setPartial] = useState('')
  const [categories, setCategories] = useState<Category[]>(['Tasks'])
  const [listening, setListening] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [voiceAvailable, setVoiceAvailable] = useState(false)
  const pulseScale = useRef(new Animated.Value(1)).current
  const pulseOpacity = useRef(new Animated.Value(0)).current
  const pendingRef = useRef('')
  const isStartingRef = useRef(false)
  const router = useRouter()

  useEffect(() => {
    log(`Braindump mount — IS_EXPO_GO=${IS_EXPO_GO}`)
    if (IS_EXPO_GO) {
      warn('Voice disabled in Expo Go — use dev client for mic')
      return
    }
    try {
      const Voice = require('@react-native-voice/voice').default
      Voice.isAvailable().then((a: boolean) => {
        log(`Voice.isAvailable → ${a}`)
        setVoiceAvailable(!!a)
      })
      Voice.onSpeechResults = (e: any) => {
        log(`onSpeechResults: ${JSON.stringify(e.value)}`)
        if (e.value?.[0]) {
          pendingRef.current = e.value[0]  // overwrite — fires multiple times with cumulative phrase
          setPartial(e.value[0])
        }
      }
      Voice.onSpeechPartialResults = (e: any) => {
        if (e.value?.[0]) setPartial(e.value[0])
      }
      Voice.onSpeechEnd = () => {
        log('onSpeechEnd')
        if (pendingRef.current) {
          setText(prev => prev ? prev + ' ' + pendingRef.current : pendingRef.current)
          pendingRef.current = ''
        }
        setListening(false)
        setPartial('')
      }
      Voice.onSpeechError = (e: any) => {
        logError(`onSpeechError: ${JSON.stringify(e)}`)
        pendingRef.current = ''
        setListening(false)
        setPartial('')
      }
      return () => Voice?.destroy().then(Voice?.removeAllListeners)
    } catch (e: any) {
      logError(`Voice require failed: ${e?.message}`)
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
    if (IS_EXPO_GO) {
      warn('Mic tap ignored — Expo Go, voice not available')
      return
    }
    let Voice: any
    try { Voice = require('@react-native-voice/voice').default } catch (e: any) {
      logError(`Voice require in toggleVoice failed: ${e?.message}`)
      return
    }
    if (listening) {
      log('Stopping voice')
      await Voice.stop()
      // onSpeechEnd should fire and commit pending — setListening(false) handled there
    } else {
      if (isStartingRef.current) { log('toggleVoice: already starting, ignoring tap'); return }
      isStartingRef.current = true
      try {
        log('Requesting audio permission + configuring session')
        const perm = await Audio.requestPermissionsAsync()
        log(`Audio permission: ${perm.status}`)
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true })
        log('Destroying stale session before start')
        await Voice.destroy()
        log('Starting voice en-US')
        await Voice.start('en-US')
        setListening(true)
      } catch (e: any) {
        logError(`Voice.start failed: ${e?.message}`)
        setListening(false)
      } finally {
        isStartingRef.current = false
      }
    }
  }

  async function handleSubmit() {
    if (!text.trim()) return
    log(`Submit — cats=${categories.join(',')} text_len=${text.trim().length}`)
    if (listening) {
      try { const V = require('@react-native-voice/voice').default; await V.stop() } catch {}
    }
    setSubmitting(true)
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    log(`Auth user=${user?.id ?? 'null'} err=${authErr?.message ?? 'none'}`)
    const jobs: PromiseLike<any>[] = []

    if (categories.includes('Tasks') || categories.includes('Contacts')) {
      const job = supabase.from('braindump_jobs').insert({
        raw_transcript: text.trim(), user_id: user?.id,
        categories: categories.filter(c => c !== 'Notes'),
      }).then(({ error: e }) => { log(`braindump_jobs insert err=${e?.message ?? 'ok'}`) })
      jobs.push(job)
    }
    if (categories.includes('Notes')) {
      const job = supabase.from('notes').insert({
        content: text.trim(), user_id: user?.id, source_platform: 'ios',
      }).then(({ error: e }) => { log(`notes insert err=${e?.message ?? 'ok'}`) })
      jobs.push(job)
    }
    await Promise.all(jobs)
    log('Submit done')
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
                  onPress={IS_EXPO_GO ? () => warn('Voice unavailable in Expo Go — needs dev client') : toggleVoice}
                  activeOpacity={0.85}
                  style={[
                    bd.micOuter,
                    listening ? { backgroundColor: insetBg } : { ...SHADOW_LIGHT_RAISED, ...SHADOW_DARK_RAISED },
                    IS_EXPO_GO && { opacity: 0.45 },
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

              {listening && partial ? (
                <View style={bd.partialBox}>
                  <Text style={bd.partialText}>…{partial}</Text>
                </View>
              ) : null}

              <Text style={bd.recHint}>
                {listening
                  ? '● REC — tap to stop'
                  : IS_EXPO_GO
                    ? 'Voice needs dev client. Type below.'
                    : voiceAvailable
                      ? 'Tap to record. Speak freely.'
                      : 'Voice unavailable. Type below.'}
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
  heading: { fontFamily: MONO, fontSize: 31, fontWeight: '600', color: T.ink, marginTop: 4 },
  recCard: { padding: 26, alignItems: 'center', gap: 18 },
  pulseRing: {
    position: 'absolute', width: 116, height: 116, borderRadius: 58,
    backgroundColor: T.sageDim + '50',
  },
  micOuter: { width: 116, height: 116, borderRadius: 58, backgroundColor: T.surface, alignItems: 'center', justifyContent: 'center' },
  micInner: { width: 78, height: 78, borderRadius: 39, backgroundColor: T.display, alignItems: 'center', justifyContent: 'center' },
  stopSquare: { width: 26, height: 26, borderRadius: 6, backgroundColor: T.clayFg },
  waveRow: { flexDirection: 'row', alignItems: 'flex-end', height: 32 },
  recHint: { fontFamily: MONO, fontSize: 14, color: T.faint, textAlign: 'center', letterSpacing: 0.5, lineHeight: 21 },
  partialBox: { backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, maxWidth: '100%' },
  partialText: { fontFamily: MONO, fontSize: 13, color: T.sageDim, fontStyle: 'italic', lineHeight: 19 },
  catRow: { flexDirection: 'row', gap: 9 },
  catChip: { flex: 1, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 12, backgroundColor: T.surface, alignItems: 'center', ...raisedShadowSm },
  catChipOn: { backgroundColor: T.display },
  catLabel: { fontFamily: MONO, fontSize: 13, color: T.faint, letterSpacing: 0.5, fontWeight: '500' },
  catLabelOn: { color: T.displayInk },
  textarea: { fontFamily: MONO, fontSize: 16, color: T.ink, lineHeight: 26, minHeight: 120 },
  submitBtn: { backgroundColor: T.display, borderRadius: 14, paddingVertical: 16, alignItems: 'center', ...raisedShadowSm },
  submitText: { fontFamily: MONO, fontSize: 16, fontWeight: '600', color: T.displayInk, letterSpacing: 0.5 },
  hint: { fontFamily: MONO, fontSize: 13, color: T.faint, textAlign: 'center', letterSpacing: 0.5 },
  success: { backgroundColor: '#1A2C1A', borderRadius: 18, padding: 32, alignItems: 'center', marginTop: 16 },
  successTitle: { fontFamily: MONO, fontSize: 22, fontWeight: '600', color: '#9FE3B0', marginBottom: 8 },
  successSub: { fontFamily: MONO, fontSize: 14, color: T.faint },
})
