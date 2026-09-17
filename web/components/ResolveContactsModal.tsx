'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PendingContact } from '@/lib/types'
import { applyPendingContact } from '@/lib/contactMerge'

const FIELD_LABELS: Record<string, string> = {
  title: 'Title', education: 'Education', location: 'Location', email: 'Email', phone: 'Phone',
  linkedin: 'LinkedIn', how_we_met: 'How we met', why_good_contact: 'Why good contact',
  less_useful_for: 'Less useful for', rating: 'Rating', next_step: 'Next step',
  contact_tier: 'Contact tier', relationship_tier: 'Relationship',
}

export type ContactResolution = { name: string; created: boolean; interaction: PendingContact['interaction'] }

export default function ResolveContactsModal({
  pending,
  onClose,
  onResolved,
}: {
  pending: PendingContact[]
  onClose: () => void
  onResolved: (resolutions: ContactResolution[]) => void
}) {
  const supabase = createClient()
  // index → contact id to update, or 'new'
  const [choice, setChoice] = useState<Record<number, string>>(() =>
    Object.fromEntries(pending.map((pc, i) => [i, pc.matches[0]?.id ?? 'new'])),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setSaving(true)
    setError(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not signed in'); setSaving(false); return }
    const resolutions: ContactResolution[] = []
    try {
      for (let i = 0; i < pending.length; i++) {
        const pc = pending[i]
        const target = choice[i] ?? 'new'
        const { created } = await applyPendingContact(supabase, user.id, pc, target)
        const displayName = created ? pc.name : (pc.matches.find(m => m.id === target)?.name ?? pc.name)
        resolutions.push({ name: displayName, created, interaction: pc.interaction })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
      setSaving(false)
      return
    }
    setSaving(false)
    onResolved(resolutions)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-orange-900/50 bg-gray-900 flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-gray-800">
          <h3 className="text-lg font-bold text-white">Which contact?</h3>
          <p className="text-xs text-gray-500 mt-1">
            Your braindump mentioned people whose names match existing contacts. Pick who to update, or create a new contact.
          </p>
        </div>

        <div className="overflow-y-auto px-5 py-3 space-y-5">
          {pending.map((pc, i) => {
            const fieldEntries = Object.entries(pc.fields)
            return (
              <div key={i} className="space-y-2">
                <div>
                  <p className="text-sm font-semibold text-gray-200">{pc.name}</p>
                  {pc.interaction && (
                    <p className="text-[11px] text-orange-400">
                      {pc.interaction.type === 'met' ? 'Met' : 'Messaged'} · {pc.interaction.date}
                      {pc.interaction.summary ? ` — ${pc.interaction.summary}` : ''}
                    </p>
                  )}
                  {fieldEntries.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {fieldEntries.map(([k, v]) => (
                        <p key={k} className="text-[11px] text-gray-500 line-clamp-2">
                          <span className="text-gray-600">{FIELD_LABELS[k] ?? k}:</span> {v}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  {pc.matches.map(m => (
                    <Option
                      key={m.id}
                      selected={choice[i] === m.id}
                      onSelect={() => setChoice(prev => ({ ...prev, [i]: m.id }))}
                      label={`Update → ${m.name}`}
                      sub={[m.title, m.location].filter(Boolean).join(' · ') || 'no details yet'}
                    />
                  ))}
                  <Option
                    selected={choice[i] === 'new'}
                    onSelect={() => setChoice(prev => ({ ...prev, [i]: 'new' }))}
                    label="Create new contact"
                    sub={`A separate "${pc.name}"`}
                  />
                </div>
              </div>
            )
          })}
        </div>

        <div className="px-5 py-4 border-t border-gray-800 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-50"
          >
            Later
          </button>
          <div className="flex items-center gap-3">
            {error && <span className="text-xs text-red-500">{error}</span>}
            <button
              type="button"
              onClick={handleConfirm}
              disabled={saving}
              className="px-5 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-[#DEDAD2] text-sm font-medium rounded-lg transition-colors"
            >
              {saving ? 'Saving…' : 'Apply'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Option({ selected, onSelect, label, sub }: { selected: boolean; onSelect: () => void; label: string; sub: string }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-start gap-3 py-2 px-2 rounded-lg text-left transition-colors ${selected ? 'bg-gray-800' : 'hover:bg-gray-800/60'}`}
    >
      <span className={`mt-1 w-3.5 h-3.5 shrink-0 rounded-full border ${selected ? 'border-orange-500 bg-orange-500' : 'border-gray-600'}`} />
      <span>
        <span className={`block text-sm ${selected ? 'text-gray-200' : 'text-gray-400'}`}>{label}</span>
        <span className="block text-[11px] text-gray-600">{sub}</span>
      </span>
    </button>
  )
}
