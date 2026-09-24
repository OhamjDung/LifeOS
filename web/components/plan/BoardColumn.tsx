'use client'

import { ReactNode, useState } from 'react'

/** A kanban column: header, cards, quick-add input, and a drop zone for the tail. */
export function BoardColumn({
  header,
  isCurrent,
  canDrop,
  onDropAtEnd,
  onQuickAdd,
  addLabel = '+ add',
  children,
  footer,
}: {
  header: ReactNode
  isCurrent?: boolean
  canDrop: boolean
  onDropAtEnd: () => void
  onQuickAdd: (title: string) => void
  addLabel?: string
  children: ReactNode
  footer?: ReactNode
}) {
  const [over, setOver] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  function submit() {
    const t = draft.trim()
    if (t) onQuickAdd(t)
    setDraft('')
  }

  return (
    <section
      onDragOver={e => { if (canDrop) { e.preventDefault(); setOver(true) } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false) }}
      onDrop={e => { e.preventDefault(); setOver(false); onDropAtEnd() }}
      className={`flex flex-col w-[78vw] sm:w-64 shrink-0 rounded-xl p-2.5 transition-colors ${
        over ? 'bg-indigo-900/60' : isCurrent ? 'bg-[#D6D3C9]' : 'bg-gray-900/70'
      }`}
      style={{ border: isCurrent ? '1px solid rgba(81,100,57,0.35)' : '1px solid rgba(28,26,20,0.08)' }}
    >
      <div className="px-1 pb-2">{header}</div>
      <div className="flex flex-col gap-2 min-h-12">{children}</div>
      {adding ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') { setDraft(''); setAdding(false) }
          }}
          onBlur={() => { submit(); setAdding(false) }}
          placeholder="Title, Enter to add"
          className="mt-2 w-full bg-[#EAE7E0] border border-indigo-500 rounded-lg px-2.5 py-1.5 text-[13px] text-white placeholder-gray-500 outline-none animate-fade-in"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-2 w-full text-left px-2 py-1.5 rounded-lg text-xs text-gray-500 hover:text-white hover:bg-black/5"
        >
          {addLabel}
        </button>
      )}
      {footer}
    </section>
  )
}
