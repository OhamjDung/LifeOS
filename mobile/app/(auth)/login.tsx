import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, Alert,
} from 'react-native'
import { supabase } from '../../lib/supabase'

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')

  async function handleAuth() {
    if (!email || !password) return
    setLoading(true)
    const fn = mode === 'signin'
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({ email, password })
    const { error } = await fn
    if (error) Alert.alert('Error', error.message)
    setLoading(false)
  }

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.inner}>
        <Text style={s.title}>LifeOS</Text>
        <Text style={s.sub}>Your second brain</Text>

        <TextInput
          style={s.input}
          placeholder="Email"
          placeholderTextColor="#6b7280"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={s.input}
          placeholder="Password"
          placeholderTextColor="#6b7280"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity style={s.btn} onPress={handleAuth} disabled={loading}>
          <Text style={s.btnText}>
            {loading ? '…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setMode(m => m === 'signin' ? 'signup' : 'signin')}>
          <Text style={s.toggle}>
            {mode === 'signin' ? "No account? Sign up" : "Have an account? Sign in"}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827' },
  inner: { flex: 1, justifyContent: 'center', padding: 32 },
  title: { fontSize: 36, fontWeight: '700', color: '#fff', marginBottom: 4 },
  sub: { fontSize: 14, color: '#6b7280', marginBottom: 40 },
  input: {
    backgroundColor: '#1f2937', borderWidth: 1, borderColor: '#374151',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    color: '#fff', fontSize: 15, marginBottom: 12,
  },
  btn: {
    backgroundColor: '#4f46e5', borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 4, marginBottom: 16,
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  toggle: { color: '#6366f1', textAlign: 'center', fontSize: 14 },
})
