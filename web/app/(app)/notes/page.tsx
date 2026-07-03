import { createClient } from '@/lib/supabase/server'
import { Note } from '@/lib/types'
import Link from 'next/link'
import { NotesPendingChecker } from '@/components/NotesPendingChecker'
import { NotesFilter } from '@/components/NotesFilter'

export default async function NotesPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('notes')
    .select('id, title, content, category, tags, created_at, processing_status')
    .order('created_at', { ascending: false })
    .limit(50)

  const notes = (data as Note[]) ?? []
  const pendingCount = notes.filter(n => n.processing_status === 'pending' || n.processing_status === 'processing').length

  return (
    <div className="p-8 max-w-4xl">
      <NotesPendingChecker pendingCount={pendingCount} />
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Notes</h2>
        <Link
          href="/notes/new"
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-[#DEDAD2] text-sm rounded-lg transition-colors"
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
        <NotesFilter notes={notes} />
      )}
    </div>
  )
}
