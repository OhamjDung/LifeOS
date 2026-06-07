import { createClient } from '@/lib/supabase/server'
import { Note } from '@/lib/types'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { NoteEditor } from '@/components/NoteEditor'

export default async function NoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) notFound()

  const note = data as Note

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/notes" className="text-gray-500 hover:text-gray-300 text-sm">
          ← Notes
        </Link>
        <div className="ml-auto flex items-center gap-3">
          {note.category && (
            <span className="px-2 py-0.5 bg-indigo-900/50 text-indigo-300 text-xs rounded-md">
              {note.category}
            </span>
          )}
          {note.processing_status === 'pending' || note.processing_status === 'processing' ? (
            <span className="text-xs text-gray-500">Categorizing…</span>
          ) : null}
        </div>
      </div>

      {note.tags && note.tags.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mb-4">
          {note.tags.map(tag => (
            <span key={tag} className="px-2 py-0.5 bg-gray-800 text-gray-400 text-xs rounded">
              {tag}
            </span>
          ))}
        </div>
      )}

      <NoteEditor note={note} />
    </div>
  )
}
