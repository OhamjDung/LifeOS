import { createClient } from '@/lib/supabase/server'
import { Contact, ContactEvent, TIER_INTERVALS } from '@/lib/types'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ContactDetail } from '@/components/ContactDetail'

const EVENT_LABELS: Record<string, string> = {
  photo_sent: 'Sent photo',
  message_sent: 'Sent message',
  met: 'Met in person',
  life_update: 'Life update',
  note: 'Note',
}

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: contactData, error }, { data: eventsData }] = await Promise.all([
    supabase.from('contacts').select('*').eq('id', id).single(),
    supabase
      .from('contact_events')
      .select('*')
      .eq('contact_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  if (error || !contactData) notFound()

  const contact = contactData as Contact
  const events = (eventsData as ContactEvent[]) ?? []
  const now = new Date()
  const daysSince = contact.last_contacted_at
    ? Math.floor((now.getTime() - new Date(contact.last_contacted_at).getTime()) / 86400000)
    : null
  const isOverdue = daysSince === null || daysSince > TIER_INTERVALS[contact.relationship_tier]

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/contacts" className="text-gray-500 hover:text-gray-300 text-sm">
          ← Contacts
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-16 h-16 rounded-full bg-indigo-900 flex items-center justify-center text-2xl font-bold text-indigo-300">
          {contact.name[0].toUpperCase()}
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">{contact.name}</h2>
          <p className="text-gray-500 text-sm capitalize mt-0.5">
            {contact.relationship_tier.replace('_', ' ')}
            {contact.how_we_met && ` · met via ${contact.how_we_met}`}
          </p>
        </div>
      </div>

      {/* Status bar */}
      <div className={`rounded-xl p-4 mb-6 ${isOverdue ? 'bg-red-950/40 border border-red-900/50' : 'bg-gray-900 border border-gray-800'}`}>
        <p className={`text-sm font-medium ${isOverdue ? 'text-red-400' : 'text-gray-400'}`}>
          {isOverdue
            ? `${daysSince === null ? 'Never contacted' : `${daysSince} days since last contact`} — reach out!`
            : `Last contact ${daysSince}d ago · next due in ${TIER_INTERVALS[contact.relationship_tier] - daysSince!}d`}
        </p>
      </div>

      <ContactProfile contact={contact} />

      <ContactDetail contact={contact} events={events} eventLabels={EVENT_LABELS} />
    </div>
  )
}

function ContactProfile({ contact }: { contact: Contact }) {
  const facts: [string, string | null][] = [
    ['Title', contact.title],
    ['Education', contact.education],
    ['Location', contact.location],
    ['Email', contact.email],
    ['Phone', contact.phone],
    ['LinkedIn', contact.linkedin],
  ].filter(([, v]) => v) as [string, string][]

  const longFields: [string, string | null][] = [
    ['Why a good contact', contact.why_good_contact],
    ['Less useful for', contact.less_useful_for],
    ['Rating / debrief', contact.rating],
    ['Next step', contact.next_step],
  ].filter(([, v]) => v) as [string, string][]

  if (facts.length === 0 && longFields.length === 0) return null

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 mb-6 space-y-4">
      {facts.length > 0 && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          {facts.map(([label, value]) => (
            <div key={label}>
              <p className="text-xs text-gray-600 uppercase tracking-wider mb-0.5">{label}</p>
              <p className="text-sm text-gray-300">{value}</p>
            </div>
          ))}
        </div>
      )}
      {longFields.length > 0 && (
        <div className={`space-y-3 ${facts.length > 0 ? 'pt-3 border-t border-gray-800' : ''}`}>
          {longFields.map(([label, value]) => (
            <div key={label}>
              <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">{label}</p>
              <p className="text-sm text-gray-400 whitespace-pre-wrap leading-relaxed">{value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
