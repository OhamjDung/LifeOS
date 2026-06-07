import { createClient } from '@/lib/supabase/server'
import { Contact, TIER_INTERVALS } from '@/lib/types'
import Link from 'next/link'

const TIER_LABEL: Record<string, string> = {
  family: 'Family',
  close_friend: 'Close friend',
  friend: 'Friend',
  acquaintance: 'Acquaintance',
}

const TIER_COLOR: Record<string, string> = {
  family: 'text-rose-400',
  close_friend: 'text-orange-400',
  friend: 'text-yellow-400',
  acquaintance: 'text-gray-400',
}

export default async function ContactsPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('contacts')
    .select('*')
    .order('last_contacted_at', { ascending: true, nullsFirst: true })

  const contacts = (data as Contact[]) ?? []
  const now = new Date()

  function daysSince(contact: Contact) {
    if (!contact.last_contacted_at) return null
    return Math.floor((now.getTime() - new Date(contact.last_contacted_at).getTime()) / 86400000)
  }

  function isOverdue(contact: Contact) {
    const days = daysSince(contact)
    if (days === null) return true
    return days > TIER_INTERVALS[contact.relationship_tier]
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-white">Contacts</h2>
        <Link
          href="/contacts/new"
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors"
        >
          + Add contact
        </Link>
      </div>

      {contacts.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg mb-2">No contacts yet.</p>
          <Link href="/contacts/new" className="text-indigo-400 hover:text-indigo-300 text-sm">
            Add your first contact →
          </Link>
        </div>
      ) : (
        <div className="grid gap-2">
          {contacts.map(contact => {
            const days = daysSince(contact)
            const overdue = isOverdue(contact)
            return (
              <Link
                key={contact.id}
                href={`/contacts/${contact.id}`}
                className="flex items-center gap-4 bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-indigo-900 flex items-center justify-center text-sm font-semibold text-indigo-300 shrink-0">
                  {contact.name[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-white">{contact.name}</p>
                    {overdue && (
                      <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="Overdue" />
                    )}
                  </div>
                  <p className={`text-xs mt-0.5 ${TIER_COLOR[contact.relationship_tier]}`}>
                    {TIER_LABEL[contact.relationship_tier]}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm text-gray-400">
                    {days === null ? 'Never' : `${days}d ago`}
                  </p>
                  <p className="text-xs text-gray-600">
                    every {TIER_INTERVALS[contact.relationship_tier]}d
                  </p>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
