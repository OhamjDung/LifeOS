import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '../lib/supabase'
import { T, MONO, raisedShadowSm } from '../lib/theme'

export default function ConnectWidgetScreen() {
  const { widget_id } = useLocalSearchParams<{ widget_id: string }>()
  const [status, setStatus] = useState<'idle' | 'connecting' | 'done' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState('')
  const router = useRouter()

  async function connect() {
    if (!widget_id) { setErrMsg('No widget ID in URL'); setStatus('error'); return }
    setStatus('connecting')
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (!user) { setErrMsg(authErr?.message ?? 'Not logged in'); setStatus('error'); return }
    const { error } = await supabase
      .from('widget_registrations')
      .upsert({ widget_id, user_id: user.id }, { onConflict: 'widget_id' })
    if (error) { setErrMsg(error.message); setStatus('error'); return }
    setStatus('done')
    setTimeout(() => router.replace('/(tabs)/today'), 1800)
  }

  return (
    <LinearGradient colors={[T.bg, T.bg2]} start={{ x: 0.32, y: 0 }} end={{ x: 0.68, y: 1 }} style={{ flex: 1 }}>
      <SafeAreaView style={s.safe}>
        <View style={s.box}>
          {status === 'done' ? (
            <>
              <Text style={s.iconText}>✓</Text>
              <Text style={s.heading}>Widget connected!</Text>
              <Text style={s.sub}>Your widget will show today's tasks. It refreshes every 15 min.</Text>
            </>
          ) : (
            <>
              <Text style={s.iconText}>◉</Text>
              <Text style={s.heading}>Connect widget</Text>
              <Text style={s.sub}>
                {status === 'error'
                  ? `Error: ${errMsg}`
                  : 'Link your LifeOS widget to this account. Tasks will appear within 15 minutes.'}
              </Text>
              <TouchableOpacity
                style={[s.btn, raisedShadowSm, status === 'connecting' && { opacity: 0.5 }]}
                onPress={connect}
                disabled={status === 'connecting'}
              >
                <Text style={s.btnText}>{status === 'connecting' ? 'Connecting…' : 'Connect'}</Text>
              </TouchableOpacity>
              {status !== 'error' && (
                <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
                  <Text style={s.cancel}>Cancel</Text>
                </TouchableOpacity>
              )}
              {status === 'error' && (
                <TouchableOpacity onPress={() => setStatus('idle')} style={{ marginTop: 16 }}>
                  <Text style={s.cancel}>Try again</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </SafeAreaView>
    </LinearGradient>
  )
}

const s = StyleSheet.create({
  safe:    { flex: 1, justifyContent: 'center' },
  box:     { margin: 24, backgroundColor: T.surface, borderRadius: 24, padding: 32, alignItems: 'center', gap: 16 },
  iconText: { fontSize: 42, color: T.sage, lineHeight: 50 },
  heading: { fontFamily: MONO, fontSize: 22, fontWeight: '600', color: T.ink, textAlign: 'center' },
  sub:     { fontFamily: MONO, fontSize: 14, color: T.mute, textAlign: 'center', lineHeight: 22 },
  btn:     { backgroundColor: T.display, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 32, alignItems: 'center', alignSelf: 'stretch' },
  btnText: { fontFamily: MONO, fontSize: 16, fontWeight: '600', color: T.displayInk, letterSpacing: 0.5 },
  cancel:  { fontFamily: MONO, fontSize: 14, color: T.faint },
})
