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

      <ContactDetail contact={contact} events={events} eventLabels={EVENT_LABELS} />
    </div>
  )
}
