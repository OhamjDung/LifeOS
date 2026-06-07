'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Contact, ContactEvent } from '@/lib/types'

const EVENT_TYPES = ['met', 'message_sent', 'photo_sent', 'life_update', 'note'] as const

export function ContactDetail({
  contact,
  events,
  eventLabels,
}: {
  contact: Contact
  events: ContactEvent[]
  eventLabels: Record<string, string>
}) {
  const router = useRouter()
  const [eventType, setEventType] = useState<typeof EVENT_TYPES[number]>('met')
  const [body, setBody] = useState('')
  const [logging, setLogging] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [lifeUpdate, setLifeUpdate] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)

  async function draftMessage() {
    setDrafting(true)
    setDraft(null)
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fn-draft-catchup`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ contact_id: contact.id, life_update_text: lifeUpdate || undefined }),
      }
    )
    const { draft: text } = await res.json()
    setDraft(text ?? null)
    setDrafting(false)
  }

  async function logEvent() {
    if (!body.trim() && eventType === 'note') return
    setLogging(true)
    const supabase = createClient()
    await supabase.from('contact_events').insert({
      contact_id: contact.id,
      event_type: eventType,
      body: body.trim() || null,
    })
    setBody('')
    setLogging(false)
    router.refresh()
  }

  async function handleDelete() {
    if (!confirm(`Delete ${contact.name}? This cannot be undone.`)) return
    setDeleting(true)
    const supabase = createClient()
    await supabase.from('contacts').delete().eq('id', contact.id)
    router.push('/contacts')
  }

  return (
    <div>
      {/* Log interaction */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
        <h3 className="font-medium text-white mb-4">Log interaction</h3>
        <div className="flex flex-wrap gap-2 mb-3">
          {EVENT_TYPES.map(t => (
            <button
              key={t}
              onClick={() => setEventType(t)}
              className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                eventType === t
                  ? 'border-indigo-500 bg-indigo-900/30 text-indigo-300'
                  : 'border-gray-700 text-gray-400 hover:border-gray-600'
              }`}
            >
              {eventLabels[t]}
            </button>
          ))}
        </div>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Notes (optional)"
          rows={2}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 placeholder-gray-600 outline-none focus:border-indigo-500 resize-none mb-3"
        />
        <button
          onClick={logEvent}
          disabled={logging}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
        >
          {logging ? 'Logging…' : 'Log'}
        </button>
      </section>

      {/* Timeline */}
      <section className="mb-8">
        <h3 className="font-medium text-white mb-4">Timeline</h3>
        {events.length === 0 ? (
          <p className="text-gray-500 text-sm">No interactions logged yet.</p>
        ) : (
          <div className="space-y-3">
            {events.map(ev => (
              <div key={ev.id} className="flex gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-2 shrink-0" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-300">{eventLabels[ev.event_type]}</span>
                    <span className="text-xs text-gray-600">
                      {new Date(ev.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {ev.body && <p className="text-sm text-gray-500 mt-0.5">{ev.body}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* AI Draft Message */}
      <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
        <h3 className="font-medium text-white mb-3">Draft catch-up message</h3>
        <input
          type="text"
          value={lifeUpdate}
          onChange={e => setLifeUpdate(e.target.value)}
          placeholder="Anything to mention? (optional)"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 placeholder-gray-600 outline-none focus:border-indigo-500 mb-3"
        />
        <button
          onClick={draftMessage}
          disabled={drafting}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
        >
          {drafting ? 'Drafting…' : 'Draft message'}
        </button>
        {draft && (
          <div className="mt-4 p-4 bg-gray-800 rounded-lg border border-gray-700">
            <p className="text-gray-200 text-sm leading-relaxed">{draft}</p>
            <button
              onClick={() => navigator.clipboard.writeText(draft)}
              className="mt-2 text-xs text-indigo-400 hover:text-indigo-300"
            >
              Copy
            </button>
          </div>
        )}
      </section>

      <button
        onClick={handleDelete}
        disabled={deleting}
        className="text-red-500 hover:text-red-400 text-sm disabled:opacity-40"
      >
        {deleting ? 'Deleting…' : 'Delete contact'}
      </button>
    </div>
  )
}
