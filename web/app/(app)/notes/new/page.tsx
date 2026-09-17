'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function NewNotePage() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  const [error, setError] = useState('')
  const [draftKey, setDraftKey] = useState('')
  const lock = useRef(false)

  useEffect(() => {
    let cancelled = false
    void createClient().auth.getUser().then(({ data: { user } }) => {
      if (!user || cancelled) return
      const key = `new-note:${user.id}`
      try {
        const raw = localStorage.getItem(key)
        const draft = raw ? JSON.parse(raw) : null
        if (draft && typeof draft.title === 'string' && typeof draft.content === 'string') {
          setTitle(draft.title)
          setContent(draft.content)
        }
      } catch { /* optional storage */ }
      setDraftKey(key)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!draftKey) return
    try { localStorage.setItem(draftKey, JSON.stringify({ title, content })) } catch { /* optional storage */ }
  }, [draftKey, title, content])

  async function handleSave() {
    if (!content.trim() || lock.current || !draftKey) return
    lock.current = true
    setSaving(true)
    setError('')
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Sign in again to save')
      const { data, error: failure } = await supabase.from('notes')
        .insert({ user_id: user.id, title: title.trim() || null, content, source_platform: 'web' })
        .select('id').single()
      if (failure || !data) throw failure ?? new Error('Save failed')
      try { localStorage.removeItem(draftKey) } catch { /* optional storage */ }
      // Fire-and-forget: pg_cron would get to it within 2 min anyway; this just makes
      // the category appear on the detail page in seconds. Never awaited, never blocks save.
      void supabase.auth.getSession().then(({ data: { session } }) => fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fn-embed-note`,
        { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` } },
      )).catch(() => {})
      router.push(`/notes/${data.id}`)
      router.refresh()
    } catch {
      setError('Could not save your note. Your text is still here; please retry.')
      lock.current = false
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => router.back()}
          className="text-gray-500 hover:text-gray-300 text-sm"
        >
          ← Back
        </button>
        <button
          onClick={handleSave}
          disabled={!draftKey || saving || !content.trim()}
          className="ml-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-[#DEDAD2] text-sm rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Save note'}
        </button>
      </div>

      {error && <p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}
      <input
        aria-label="Note title"
        disabled={saving || !draftKey}
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Title (optional)"
        className="w-full bg-transparent text-2xl font-bold text-white placeholder-gray-600 outline-none mb-4"
      />

      <textarea
        aria-label="Note content"
        disabled={saving || !draftKey}
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Write anything…"
        rows={20}
        className="w-full bg-transparent text-gray-300 placeholder-gray-600 outline-none resize-none text-base leading-relaxed"
        autoFocus
      />
    </div>
  )
}
