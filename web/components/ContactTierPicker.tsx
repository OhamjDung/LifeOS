'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ContactTier, CONTACT_TIER_LABEL, CONTACT_TIER_DAYS } from '@/lib/types'

const TIERS: ContactTier[] = ['daily', 'weekly', 'biweekly', 'monthly']

// Segmented control for contacts.contact_tier. `compact` = short labels for list cards.
// Safe to nest inside a <Link>: clicks are stopped from bubbling.
export function ContactTierPicker({ contactId, tier, compact = false }: {
  contactId: string
  tier: ContactTier
  compact?: boolean
}) {
  const [current, setCurrent] = useState<ContactTier>(tier ?? 'weekly')
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  async function change(next: ContactTier) {
    if (next === current || saving) return
    setSaving(true)
    setCurrent(next)
    const supabase = createClient()
    const { error } = await supabase
      .from('contacts')
      .update({ contact_tier: next, updated_at: new Date().toISOString() })
      .eq('id', contactId)
    setSaving(false)
    if (error) { setCurrent(current); return }
    router.refresh()
  }

  return (
    <div
      className={`inline-flex rounded-lg border border-gray-700 overflow-hidden ${saving ? 'opacity-60' : ''}`}
      onClick={e => { e.preventDefault(); e.stopPropagation() }}
    >
      {TIERS.map(t => {
        const active = t === current
        return (
          <button
            key={t}
            type="button"
            onClick={() => change(t)}
            className={`${compact ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'} font-medium uppercase tracking-wider transition-colors ${
              active ? 'bg-indigo-600 text-[#DEDAD2]' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
            }`}
          >
            {compact ? `${CONTACT_TIER_DAYS[t]}d` : CONTACT_TIER_LABEL[t]}
          </button>
        )
      })}
    </div>
  )
}
