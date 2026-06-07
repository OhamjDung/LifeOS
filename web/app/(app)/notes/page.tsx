import { createClient } from '@/lib/supabase/server'
import { Note } from '@/lib/types'
import Link from 'next/link'

export default async function NotesPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('notes')
    .select('id, title, content, category, tags, created_at, processing_status')
    .order('created_at', { ascending: false })

  const notes = (data as Note[]) ?? []

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-white">Notes</h2>
        <Link
          href="/notes/new"
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors"
        >
          + New note
        </Link>
      </div>

      {notes.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg mb-2">No notes yet.</p>
          <Link href="/notes/new" className="text-indigo-400 hover:text-indigo-300 text-sm">
            Create your first note →
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {notes.map(note => (
            <Link
              key={note.id}
              href={`/notes/${note.id}`}
              className="block bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="font-medium text-white truncate">
                    {note.title || 'Untitled'}
                  </h3>
                  <p className="text-gray-500 text-sm mt-1 line-clamp-2">
                    {note.content}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {note.category && (
                    <span className="inline-block px-2 py-0.5 bg-indigo-900/50 text-indigo-300 text-xs rounded-md mb-1">
                      {note.category}
                    </span>
                  )}
                  <p className="text-gray-600 text-xs">
                    {new Date(note.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
              {note.tags && note.tags.length > 0 && (
                <div className="flex gap-1.5 flex-wrap mt-3">
                  {note.tags.map(tag => (
                    <span key={tag} className="px-2 py-0.5 bg-gray-800 text-gray-400 text-xs rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
