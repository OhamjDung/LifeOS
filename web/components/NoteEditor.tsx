'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Note } from '@/lib/types'

export function NoteEditor({ note }: { note: Note }) {
  const router = useRouter()
  const supabase = createClient()
  const [title, setTitle] = useState(note.title ?? '')
  const [content, setContent] = useState(note.content)
  const [saved, setSaved] = useState({ title: note.title ?? '', content: note.content })
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [metadata, setMetadata] = useState(note)
  const busy = useRef(false)
  const removing = useRef(false)
  const storageKey = `note-draft:${note.user_id}:${note.id}`
  const dirty = title !== saved.title || content !== saved.content

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem(storageKey)
        const draft = raw ? JSON.parse(raw) : null
        if (draft && typeof draft.title === 'string' && typeof draft.content === 'string') {
          setTitle(draft.title)
          setContent(draft.content)
        }
      } catch { /* Browser storage is optional. */ }
      setReady(true)
    }, 0)
    const channel = supabase.channel(`note-${note.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notes', filter: `id=eq.${note.id}` }, payload => {
        // Background metadata must never replace text or move the cursor.
        setMetadata(payload.new as Note)
      }).subscribe()
    return () => { clearTimeout(timer); void supabase.removeChannel(channel) }
  }, [note.id, storageKey, supabase])

  const save = useCallback(async () => {
    if (!ready || busy.current || removing.current || !dirty || !content.trim()) return
    busy.current = true
    setSaving(true)
    setError('')
    const snapshot = { title, content }
    try {
      let mutation = supabase.from('notes').update({
        title: title.trim() || null, content,
        processing_status: 'pending', retry_count: 0,
        updated_at: new Date().toISOString(),
      }).eq('id', note.id).eq('content', saved.content)
      mutation = saved.title.trim() ? mutation.eq('title', saved.title.trim()) : mutation.is('title', null)
      const { data, error: failure } = await mutation.select('id').single()
      if (failure || !data) throw failure ?? new Error('Save failed')
      setSaved(snapshot)
      setMetadata(previous => ({ ...previous, processing_status: 'pending' }))
    } catch {
      setError('Could not save, or this note changed elsewhere. Reload to review conflicts before retrying; your draft is retained on this device when storage is available.')
    } finally {
      busy.current = false
      setSaving(false)
    }
  }, [ready, content, dirty, note.id, saved, supabase, title])

  useEffect(() => {
    if (!ready) return
    try {
      if (dirty) localStorage.setItem(storageKey, JSON.stringify({ title, content }))
      else localStorage.removeItem(storageKey)
    } catch { /* Database save still works when storage is full. */ }
    if (!dirty || saving || error || deleting) return
    const timer = window.setTimeout(() => { void save() }, 1000)
    return () => clearTimeout(timer)
  }, [title, content, dirty, ready, storageKey, saving, error, deleting, save])

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (dirty) { event.preventDefault(); event.returnValue = '' }
    }
    function retry() { if (dirty) void save() }
    window.addEventListener('beforeunload', warn)
    window.addEventListener('online', retry)
    return () => {
      window.removeEventListener('beforeunload', warn)
      window.removeEventListener('online', retry)
    }
  }, [dirty, save])

  async function changeCategory(category: string) {
    if (busy.current || removing.current) return
    busy.current = true
    setSaving(true)
    setError('')
    try {
      const patch = category ? { category, category_locked: true } : { category_locked: false, processing_status: 'pending', retry_count: 0 }
      const { data, error: failure } = await supabase.from('notes').update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', note.id).select('*').single()
      if (failure || !data) throw failure ?? new Error('Update failed')
      setMetadata(data as Note)
    } catch { setError('Could not update category. Please try again.') }
    finally { busy.current = false; setSaving(false) }
  }

  async function remove() {
    if (busy.current || removing.current || !confirm('Delete this note?')) return
    removing.current = true
    setDeleting(true)
    try {
      const { data, error: failure } = await supabase.from('notes').delete().eq('id', note.id).select('id').single()
      if (failure || !data) throw failure ?? new Error('Delete failed')
      try { localStorage.removeItem(storageKey) } catch { /* optional storage */ }
      router.push('/notes')
      router.refresh()
    } catch {
      setError('Could not delete this note. Please try again.')
      removing.current = false
      setDeleting(false)
    }
  }

  return <div className="editor-surface" onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 's') { event.preventDefault(); void save() }
  }}>
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <button onClick={() => void save()} disabled={!ready || saving || deleting || !dirty || !content.trim()}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-[#DEDAD2] disabled:opacity-50">
        {saving ? 'Saving…' : error ? 'Retry save' : dirty ? 'Save now' : 'Saved'}
      </button>
      <span role="status" className="text-xs text-gray-400">
        {metadata.processing_status === 'failed' ? 'Categorization unavailable; your note is safe.' :
          ['pending', 'processing'].includes(metadata.processing_status) ? 'Categorization queued' : metadata.category}
      </span>
      <button onClick={() => void remove()} disabled={deleting || saving} className="ml-auto text-sm text-red-700 disabled:opacity-50">
        {deleting ? 'Deleting…' : 'Delete'}
      </button>
    </div>
    <label className="mb-4 flex flex-wrap items-center gap-2 text-xs text-gray-400">
      Category
      <select aria-label="Note category" disabled={saving || deleting}
        value={metadata.category_locked ? metadata.category ?? '' : ''}
        onChange={event => void changeCategory(event.target.value)} className="rounded-lg border border-gray-700 bg-gray-900 p-2">
        <option value="">Automatic</option>
        {['Work', 'Personal', 'Learning', 'Health', 'Finance', 'Ideas', 'Reference', 'Other'].map(category =>
          <option key={category} value={category}>{category}</option>)}
      </select>
      {metadata.category_locked && <span>Manual category · preserved during processing</span>}
    </label>
    <div className="mb-4 flex flex-wrap gap-2">{metadata.tags?.map(tag =>
      <span key={tag} className="rounded-md bg-gray-800 px-2 py-1 text-xs text-gray-300">{tag}</span>)}</div>
    <input aria-label="Note title" value={title} onChange={event => setTitle(event.target.value)}
      placeholder="Title (optional)" className="mb-4 w-full bg-transparent text-2xl font-bold text-white" />
    <textarea aria-label="Note content" value={content} onChange={event => setContent(event.target.value)}
      rows={24} className="w-full resize-y bg-transparent text-base leading-relaxed text-gray-200" />
  </div>
}
