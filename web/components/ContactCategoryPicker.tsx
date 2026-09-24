'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CONTACT_CATEGORIES, CONTACT_CATEGORY_COLOR, ContactCategory } from '@/lib/types'

// Chips for contacts.category (family / work / friend / other). Click the active
// one again to clear it. Safe to nest inside a <Link>: clicks don't bubble.
export function ContactCategoryPicker({ contactId, category, compact = false }: {
  contactId: string
  category: ContactCategory | null
  compact?: boolean
}) {
  const [current, setCurrent] = useState<ContactCategory | null>(category)
  const [error, setError] = useState('')
  const lock = useRef(false)

  async function change(next: ContactCategory) {
    if (lock.current) return
    lock.current = true
    const value = next === current ? null : next
    const before = current
    setCurrent(value)
    setError('')
    const { error } = await createClient()
      .from('contacts')
      .update({ category: value, updated_at: new Date().toISOString() })
      .eq('id', contactId)
    if (error) { setCurrent(before); setError('Could not save category') }
    lock.current = false
  }

  // Compact (list cards): only the chosen category shows until hovered/focused.
  return (
    <div
      aria-label="Contact category"
      title={error || undefined}
      className={`group/cat inline-flex items-center gap-1 ${compact ? '' : 'flex-wrap'}`}
      onClick={e => { e.preventDefault(); e.stopPropagation() }}
    >
      {CONTACT_CATEGORIES.map(c => {
        const active = c === current
        const color = CONTACT_CATEGORY_COLOR[c]
        return (
          <button
            key={c}
            type="button"
            aria-pressed={active}
            onClick={() => change(c)}
            className={`${compact ? 'px-1.5 py-0 text-[10px]' : 'px-2.5 py-0.5 text-xs'} rounded-full border font-medium capitalize ${
              compact && !active && current ? 'hidden group-hover/cat:inline-block group-focus-within/cat:inline-block' : ''
            }`}
            style={{
              borderColor: active ? color : 'rgba(28,26,20,0.15)',
              background: active ? color : 'transparent',
              color: active ? '#F3F1EA' : '#6B6358',
            }}
          >
            {c}
          </button>
        )
      })}
      {error && <span role="alert" className="text-[10px] text-red-700">{error}</span>}
    </div>
  )
}
