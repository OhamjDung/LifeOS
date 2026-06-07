'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

interface SearchResult {
  note_id: string
  title: string | null
  chunk_text: string
  similarity: number
}

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const supabase = createClient()

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setSearched(true)

    const { data: { session } } = await supabase.auth.getSession()

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fn-search-notes`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ query: query.trim(), limit: 8 }),
      }
    )

    const { results: data } = await res.json()
    setResults(data ?? [])
    setLoading(false)
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white">Search notes</h2>
        <p className="text-gray-400 text-sm mt-1">Semantic search across your knowledge base.</p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2 mb-8">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="What do you know about…"
          autoFocus
          className="flex-1 px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
        >
          {loading ? '…' : 'Search'}
        </button>
      </form>

      {searched && !loading && results.length === 0 && (
        <p className="text-gray-500 text-sm">No relevant notes found. Try different words.</p>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((r, i) => (
            <Link
              key={`${r.note_id}-${i}`}
              href={`/notes/${r.note_id}`}
              className="block bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-4 mb-2">
                <h3 className="font-medium text-white">{r.title || 'Untitled'}</h3>
                <span className="text-xs text-gray-600 shrink-0">
                  {Math.round(r.similarity * 100)}% match
                </span>
              </div>
              <p className="text-gray-400 text-sm line-clamp-3">{r.chunk_text}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
