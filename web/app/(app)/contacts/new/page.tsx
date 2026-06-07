'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const TIERS = ['family', 'close_friend', 'friend', 'acquaintance'] as const

export default function NewContactPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [howWeMet, setHowWeMet] = useState('')
  const [tier, setTier] = useState<typeof TIERS[number]>('friend')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('contacts')
      .insert({
        name: name.trim(),
        how_we_met: howWeMet.trim() || null,
        relationship_tier: tier,
      })
      .select('id')
      .single()
    if (!error && data) {
      router.push(`/contacts/${data.id}`)
    } else {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-lg">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-300 text-sm">
          ← Back
        </button>
        <h2 className="text-xl font-bold text-white">New contact</h2>
      </div>

      <div className="space-y-5">
        <div>
          <label className="block text-sm text-gray-400 mb-1.5">Name *</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Full name"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1.5">How we met</label>
          <input
            type="text"
            value={howWeMet}
            onChange={e => setHowWeMet(e.target.value)}
            placeholder="College, work, conference…"
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-600 outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1.5">Relationship tier</label>
          <div className="grid grid-cols-2 gap-2">
            {TIERS.map(t => (
              <button
                key={t}
                onClick={() => setTier(t)}
                className={`py-2.5 px-3 rounded-lg border text-sm transition-colors ${
                  tier === t
                    ? 'border-indigo-500 bg-indigo-900/30 text-indigo-300'
                    : 'border-gray-700 text-gray-400 hover:border-gray-600'
                }`}
              >
                {t.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Add contact'}
        </button>
      </div>
    </div>
  )
}
