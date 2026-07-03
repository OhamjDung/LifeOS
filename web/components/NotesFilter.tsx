'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Note } from '@/lib/types'

const CATEGORY_COLORS: Record<string, string> = {
  Learning:  'bg-[#CDDBA6]/40 text-[#516439]',
  Reference: 'bg-[#5A5448]/10 text-[#5A5448]',
  Idea:      'bg-[#ECA06A]/25 text-[#9C4D29]',
  Meeting:   'bg-[#9FE3B0]/30 text-[#2D6B45]',
}

export function NotesFilter({ notes }: { notes: Note[] }) {
  const [query, setQuery] = useState('')

  const filtered = query.trim()
    ? notes.filter(n =>
        n.title?.toLowerCase().includes(query.toLowerCase()) ||
        n.content?.toLowerCase().includes(query.toLowerCase()) ||
        n.tags?.some(t => t.toLowerCase().includes(query.toLowerCase()))
      )
    : notes

  return (
    <>
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Filter by title, content, or tag…"
        className="w-full px-4 py-2.5 rounded-lg text-sm outline-none mb-6"
        style={{
          background: '#C4C1B7',
          border: '1px solid #B5B2A8',
          color: '#1C1A14',
          fontFamily: 'IBM Plex Mono, monospace',
        }}
      />

      {filtered.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-8">No notes match.</p>
      ) : (
        <div className="grid gap-3">
          {filtered.map(note => (
            <Link
              key={note.id}
              href={`/notes/${note.id}`}
              className="block rounded-xl p-5 transition-all hover:scale-[1.005]"
              style={{
                background: '#DEDAD2',
                border: '1px solid rgba(28,26,20,0.08)',
                boxShadow: '2px 2px 6px rgba(107,99,88,0.12), -1px -1px 4px rgba(255,255,255,0.5)',
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium truncate" style={{ color: '#1C1A14' }}>
                    {note.title || 'Untitled'}
                  </h3>
                  <p className="text-sm mt-1 line-clamp-2" style={{ color: '#837C6F' }}>
                    {note.content}
                  </p>
                </div>
                <div className="shrink-0 text-right flex flex-col items-end gap-1">
                  {note.category && (
                    <span className={`inline-block px-2 py-0.5 text-xs rounded-md font-medium ${CATEGORY_COLORS[note.category] ?? 'bg-[#5A5448]/10 text-[#5A5448]'}`}>
                      {note.category}
                    </span>
                  )}
                  <p className="text-xs" style={{ color: '#9E9890' }}>
                    {new Date(note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </p>
                </div>
              </div>
              {note.tags && note.tags.length > 0 && (
                <div className="flex gap-1.5 flex-wrap mt-3">
                  {note.tags.map(tag => (
                    <span key={tag} className="px-2 py-0.5 text-xs rounded" style={{ background: '#C4C1B7', color: '#5A5448' }}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
