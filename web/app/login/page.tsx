'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else setMessage('Check email for confirmation link.')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      else router.push('/')
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#CCCAC0' }}>
      <div className="w-full max-w-sm p-8 rounded-2xl" style={{
        background: '#DEDAD2',
        border: '1px solid rgba(255,255,255,0.6)',
        boxShadow: '6px 6px 16px rgba(107,99,88,0.35), -4px -4px 12px rgba(255,255,255,0.7)',
      }}>
        <h1 className="text-2xl font-bold mb-1" style={{ color: '#1C1A14', fontFamily: 'IBM Plex Mono, monospace' }}>LifeOS</h1>
        <p className="text-sm mb-8" style={{ color: '#837C6F', fontFamily: 'IBM Plex Mono, monospace' }}>Your personal second brain.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="w-full px-4 py-2.5 rounded-lg text-sm outline-none"
            style={{
              background: '#C4C1B7',
              border: '1px solid #B5B2A8',
              color: '#1C1A14',
              fontFamily: 'IBM Plex Mono, monospace',
            }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            className="w-full px-4 py-2.5 rounded-lg text-sm outline-none"
            style={{
              background: '#C4C1B7',
              border: '1px solid #B5B2A8',
              color: '#1C1A14',
              fontFamily: 'IBM Plex Mono, monospace',
            }}
          />

          {error && <p className="text-red-600 text-sm">{error}</p>}
          {message && <p className="text-green-700 text-sm">{message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
            style={{
              background: '#516439',
              color: '#DEDAD2',
              fontFamily: 'IBM Plex Mono, monospace',
            }}
          >
            {loading ? 'Loading...' : isSignUp ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <button
          onClick={() => setIsSignUp(!isSignUp)}
          className="mt-4 w-full text-center text-sm transition-colors"
          style={{ color: '#837C6F', fontFamily: 'IBM Plex Mono, monospace' }}
        >
          {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
        </button>
      </div>
    </div>
  )
}
