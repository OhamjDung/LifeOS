'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function NewNotePage() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!content.trim()) return
    setSaving(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('notes')
      .insert({ title: title.trim() || null, content: content.trim() })
      .select('id')
      .single()
    if (!error && data) {
      console.log('[note] created, triggering fn-embed-note...')
      const { data: { session } } = await supabase.auth.getSession()
      fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fn-embed-note`,
        { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` } },
      ).then(r => r.json()).then(b => console.log('[note] fn-embed-note response:', b)).catch(console.error)
      router.push(`/notes/${data.id}`)
    } else {
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
          disabled={saving || !content.trim()}
          className="ml-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-[#DEDAD2] text-sm rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Save note'}
        </button>
      </div>

      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Title (optional)"
        className="w-full bg-transparent text-2xl font-bold text-white placeholder-gray-600 outline-none mb-4"
      />

      <textarea
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
