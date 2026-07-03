'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Note } from '@/lib/types'

export function NoteEditor({ note }: { note: Note }) {
  const router = useRouter()
  const supabase = createClient()
  const [title, setTitle] = useState(note.title ?? '')
  const [content, setContent] = useState(note.content)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [liveStatus, setLiveStatus] = useState(note.processing_status)
  const [liveCategory, setLiveCategory] = useState(note.category)
  const [liveTags, setLiveTags] = useState(note.tags ?? [])
  const dirty = title !== (note.title ?? '') || content !== note.content

  useEffect(() => {
    // Always trigger on load — fn-embed-note processes ALL pending notes, returns fast if none
    supabase.auth.getSession().then(({ data: { session } }) => triggerEmbed(session))

    const channel = supabase
      .channel(`note-${note.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'notes',
        filter: `id=eq.${note.id}`,
      }, (payload) => {
        const n = payload.new as any
        console.log('[note] realtime update:', n.processing_status, 'category:', n.category, 'tags:', n.tags)
        setLiveStatus(n.processing_status)
        if (n.category) setLiveCategory(n.category)
        if (n.tags) setLiveTags(n.tags)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [note.id])

  async function triggerEmbed(session: any) {
    console.log('[note] triggering fn-embed-note...')
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fn-embed-note`,
      { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` } },
    ).catch((e) => { console.error('[note] fn-embed-note error:', e); return null })
    if (res) {
      const body = await res.json().catch(() => null)
      console.log('[note] fn-embed-note response:', res.status, body)
    }
  }

  async function handleSave() {
    if (!content.trim()) return
    setSaving(true)
    setLiveStatus('pending')
    await supabase
      .from('notes')
      .update({
        title: title.trim() || null,
        content: content.trim(),
        processing_status: 'pending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', note.id)
    console.log('[note] saved, waiting for categorization...')
    setSaving(false)

    const { data: { session } } = await supabase.auth.getSession()
    await triggerEmbed(session)
  }

  async function handleDelete() {
    if (!confirm('Delete this note?')) return
    setDeleting(true)
    await supabase.from('notes').delete().eq('id', note.id)
    router.push('/notes')
  }

  const isPending = liveStatus === 'pending' || liveStatus === 'processing'

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-[#DEDAD2] text-sm rounded-lg transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {isPending && (
            <span className="text-xs text-gray-500 animate-pulse">⟳ Categorizing…</span>
          )}
          {liveCategory && !isPending && (
            <span className="px-2 py-0.5 bg-indigo-900/50 text-indigo-300 text-xs rounded-md">{liveCategory}</span>
          )}
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-red-500 hover:text-red-400 text-sm disabled:opacity-40"
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>

      {liveTags.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mb-4">
          {liveTags.map(tag => (
            <span key={tag} className="px-2 py-0.5 bg-gray-800 text-gray-400 text-xs rounded">{tag}</span>
          ))}
        </div>
      )}

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
