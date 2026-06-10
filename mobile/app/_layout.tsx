import { useEffect, useState, Component, ReactNode } from 'react'
import { View, Text, Alert } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { Session } from '@supabase/supabase-js'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import {
  useFonts,
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
  IBMPlexMono_700Bold,
} from '@expo-google-fonts/ibm-plex-mono'
import * as SplashScreen from 'expo-splash-screen'
import { supabase, supabaseUrl } from '../lib/supabase'
import { runDailyTasksIfNeeded } from '../lib/dailyTasks'
import { syncWidgetToken } from '../lib/widgetSync'

// TOP-LEVEL: fires at module evaluation time, before any React render
const _BUILD_ID = process.env.EXPO_PUBLIC_BUILD_ID ?? 'local'
console.log('[LifeOS] ===== MODULE LOADED =====')
console.log('[LifeOS] BUILD_ID:', _BUILD_ID)
console.log('[LifeOS] SUPABASE_URL length:', (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').length)

SplashScreen.preventAutoHideAsync()

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null }
  static getDerivedStateFromError(e: Error) { return { error: e.message } }
  componentDidCatch(e: Error) { console.error('[LifeOS] ErrorBoundary caught:', e.message) }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: '#111' }}>
          <Text style={{ color: '#ff6b6b', fontSize: 14, textAlign: 'center', fontFamily: 'monospace' }}>
            {'[LifeOS crash]\n\n' + this.state.error}
          </Text>
        </View>
      )
    }
    return this.props.children
  }
}

export default function RootLayout() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const router = useRouter()
  const segments = useSegments()

  const [fontsLoaded] = useFonts({
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
    IBMPlexMono_700Bold,
  })

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync()
  }, [fontsLoaded])

  useEffect(() => {
    const urlLen = supabaseUrl?.length ?? 0
    const buildId = process.env.EXPO_PUBLIC_BUILD_ID ?? 'local'
    console.log('[LifeOS] startup — build:', buildId, 'supabaseUrl length:', urlLen, 'starts:', supabaseUrl?.slice(0, 15))
    Alert.alert(
      urlLen < 10 ? '⚠️ Config Error' : '🟢 LifeOS startup',
      `Build: ${buildId}\nURL length: ${urlLen}${urlLen < 10 ? '\n\nSUPABASE_URL missing — app will not work.' : ''}`,
    )

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        console.log('[LifeOS] getSession ok, session:', session ? 'exists' : 'null')
        setSession(session)
        if (session) runDailyTasksIfNeeded().catch(e => console.error('[LifeOS] dailyTasks:', e))
      })
      .catch(e => {
        console.error('[LifeOS] getSession failed:', e)
        setSession(null)
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      console.log('[LifeOS] authStateChange:', _e, 'session:', session ? 'exists' : 'null')
      setSession(session)
      syncWidgetToken(session?.access_token ?? null, session?.expires_at ?? null).catch(() => {})
      if (session) runDailyTasksIfNeeded().catch(e => console.error('[LifeOS] dailyTasks:', e))
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session === undefined) return
    const inAuth = segments[0] === '(auth)'
    if (!session && !inAuth) router.replace('/(auth)/login')
    if (session && inAuth) router.replace('/(tabs)/today')
  }, [session, segments])

  if (!fontsLoaded) return null

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false }} />
        <Text style={{ position: 'absolute', bottom: 6, right: 8, color: '#ffffff40', fontSize: 9, fontFamily: 'monospace' }} pointerEvents="none">
          {_BUILD_ID}
        </Text>
      </GestureHandlerRootView>
    </ErrorBoundary>
  )
}
