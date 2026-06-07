'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function BraindumpPage() {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setSubmitting(true)

    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('braindump_jobs').insert({
      raw_transcript: text.trim(),
      user_id: user?.id,
    })

    setSubmitting(false)
    setSubmitted(true)
    setText('')
    setTimeout(() => {
      router.push('/tasks')
    }, 1500)
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white">Braindump</h2>
        <p className="text-gray-400 text-sm mt-1">
          Dump everything on your mind. AI will extract tasks in the background.
        </p>
      </div>

      {submitted ? (
        <div className="bg-green-950/40 border border-green-900/50 rounded-xl p-6 text-center">
          <p className="text-green-400 font-medium">Submitted! AI is processing your braindump.</p>
          <p className="text-gray-500 text-sm mt-1">Redirecting to tasks…</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="I need to call Sarah back, also the project deadline is Friday, buy groceries on the way home, schedule dentist…"
            rows={12}
            autoFocus
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-5 py-4 text-gray-200 placeholder-gray-600 outline-none focus:border-indigo-500 resize-none text-base leading-relaxed"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-600">
              Tasks appear in ~2 min after AI processing.
            </p>
            <button
              type="submit"
              disabled={submitting || !text.trim()}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
            >
              {submitting ? 'Submitting…' : 'Submit braindump'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
