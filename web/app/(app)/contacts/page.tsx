import { createClient } from '@/lib/supabase/server'
import { Contact, CONTACT_TIER_DAYS, CONTACT_TIER_LABEL } from '@/lib/types'
import { LogContactButton } from '@/components/LogContactButton'
import Link from 'next/link'

export default async function ContactsPage() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('contacts')
    .select('*')
    .order('last_contacted_at', { ascending: true, nullsFirst: true })

  const contacts = (data as Contact[]) ?? []
  const now = Date.now()

  function daysSince(c: Contact) {
    if (!c.last_contacted_at) return null
    return Math.floor((now - new Date(c.last_contacted_at).getTime()) / 86400000)
  }

  function overdueDays(c: Contact) {
    const tierDays = CONTACT_TIER_DAYS[c.contact_tier ?? 'weekly']
    const days = daysSince(c)
    if (days === null) return tierDays + 1
    return days - tierDays
  }

  const sorted = [...contacts].sort((a, b) => overdueDays(b) - overdueDays(a))
  const overdueCount = sorted.filter(c => overdueDays(c) >= 0).length

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white">Contacts</h2>
          {overdueCount > 0 && (
            <p className="text-sm text-red-400 mt-1">{overdueCount} overdue</p>
          )}
        </div>
        <Link
          href="/contacts/new"
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-[#DEDAD2] text-sm rounded-lg transition-colors"
        >
          + Add contact
        </Link>
      </div>

      {sorted.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg mb-2">No contacts yet.</p>
          <Link href="/contacts/new" className="text-indigo-400 hover:text-indigo-300 text-sm">
            Add your first contact →
          </Link>
        </div>
      ) : (
        <div className="grid gap-2">
          {sorted.map(contact => {
            const days = daysSince(contact)
            const od = overdueDays(contact)
            const isOverdue = od >= 0
            const tierDays = CONTACT_TIER_DAYS[contact.contact_tier ?? 'weekly']
            const initials = contact.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

            return (
              <Link
                key={contact.id}
                href={`/contacts/${contact.id}`}
                className={`flex items-center gap-4 bg-gray-900 border rounded-xl p-4 hover:border-gray-700 transition-colors ${
                  isOverdue ? 'border-red-900/50' : 'border-gray-800'
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${
                  isOverdue ? 'bg-red-950 text-red-300 ring-1 ring-red-700' : 'bg-indigo-900 text-indigo-300'
                }`}>
                  {initials}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white">{contact.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-500">
                      {CONTACT_TIER_LABEL[contact.contact_tier ?? 'weekly']}
                    </span>
                    {contact.how_we_met && (
                      <span className="text-xs text-gray-600">· {contact.how_we_met}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    {isOverdue ? (
                      <p className="text-sm font-medium text-red-400">{od}d overdue</p>
                    ) : (
                      <p className="text-sm text-gray-400">
                        {days === null ? 'Never' : `${days}d ago`}
                      </p>
                    )}
                    <p className="text-xs text-gray-600">every {tierDays}d</p>
                  </div>
                  <LogContactButton contactId={contact.id} />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
