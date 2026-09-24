'use client'

import { useState } from 'react'
import { Proposal } from '@/lib/chat'

const STATUS: Record<Proposal['status'], { label: string; cls: string }> = {
  pending: { label: 'Needs confirm', cls: 'bg-[#EBD9A8] text-[#6B4F12]' },
  applied: { label: '✓ Done', cls: 'bg-indigo-900 text-indigo-950' },
  rejected: { label: 'Skipped', cls: 'bg-black/5 text-gray-500' },
  failed: { label: 'Failed', cls: 'bg-red-100 text-red-800' },
}

export function ProposalCard({
  proposal,
  busy,
  onDecide,
}: {
  proposal: Proposal
  busy: boolean
  onDecide: (accept: boolean, choice?: string) => void
}) {
  const [choice, setChoice] = useState<string | undefined>(proposal.choice)
  const pending = proposal.status === 'pending'
  const needsChoice = pending && !!proposal.choices && !choice
  const s = STATUS[proposal.status]

  return (
    <div
      className={`rounded-xl border p-3 animate-slide-up ${pending ? 'border-[#C9A94F]/60 bg-[#F3EEDD]' : 'border-black/10 bg-[#EAE7E0]'}`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <p className="flex-1 text-xs font-semibold text-white">{proposal.title}</p>
        <span className={`text-[9px] font-semibold tracking-wide px-1.5 py-0.5 rounded ${s.cls}`}>{s.label}</span>
      </div>
      <ul className="space-y-0.5 text-[12px] text-gray-300 whitespace-pre-wrap break-words">
        {proposal.lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>

      {pending && proposal.choices && (
        <fieldset className="mt-2 space-y-1">
          <legend className="text-[11px] text-gray-500 mb-1">This name matches existing contacts — which is it?</legend>
          {proposal.choices.map(c => (
            <label key={c.id} className="flex items-center gap-2 text-xs text-white cursor-pointer">
              <input type="radio" name={`choice-${proposal.id}`} checked={choice === c.id} onChange={() => setChoice(c.id)} className="accent-[#516439]" />
              {c.label}
            </label>
          ))}
        </fieldset>
      )}

      {pending ? (
        <div className="flex gap-2 mt-2.5">
          <button
            onClick={() => onDecide(true, choice)}
            disabled={busy || needsChoice}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-[#DEDAD2] disabled:opacity-40"
          >
            {busy ? 'Applying…' : 'Confirm'}
          </button>
          <button
            onClick={() => onDecide(false)}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:text-white hover:bg-black/5 disabled:opacity-40"
          >
            Skip
          </button>
        </div>
      ) : proposal.result ? (
        <p className={`mt-1.5 text-[11px] animate-fade-in ${proposal.status === 'failed' ? 'text-red-700' : 'text-indigo-600'}`}>{proposal.result}</p>
      ) : null}
    </div>
  )
}
