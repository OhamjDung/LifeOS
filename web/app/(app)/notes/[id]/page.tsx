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
    <div className="p-4 sm:p-8 max-w-3xl">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/notes" className="text-gray-500 hover:text-gray-300 text-sm">
          ← Notes
        </Link>
      </div>

      <NoteEditor key={note.id} note={note} />
    </div>
  )
}
