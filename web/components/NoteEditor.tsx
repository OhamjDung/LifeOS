'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Note } from '@/lib/types'

export function NoteEditor({ note }: { note: Note }) {
  const router = useRouter()
  const [title, setTitle] = useState(note.title ?? '')
  const [content, setContent] = useState(note.content)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const dirty = title !== (note.title ?? '') || content !== note.content

  async function handleSave() {
    if (!content.trim()) return
    setSaving(true)
    const supabase = createClient()
    await supabase
      .from('notes')
      .update({
        title: title.trim() || null,
        content: content.trim(),
        processing_status: 'pending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', note.id)
    setSaving(false)
    router.refresh()
  }

  async function handleDelete() {
    if (!confirm('Delete this note?')) return
    setDeleting(true)
    const supabase = createClient()
    await supabase.from('notes').delete().eq('id', note.id)
    router.push('/notes')
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-red-500 hover:text-red-400 text-sm disabled:opacity-40"
        >
          {deleting ? 'Deleting…' : 'Delete'}
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
        rows={24}
        className="w-full bg-transparent text-gray-300 placeholder-gray-600 outline-none resize-none text-base leading-relaxed"
      />
    </div>
  )
}
