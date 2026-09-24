'use client'

import { useState } from 'react'

/**
 * Fixed top-right bin for planner cards. Faint when idle, grows while a card is
 * being dragged, turns red when the card is over it. Dropping deletes.
 */
export function TrashDropZone({ dragging, onDrop }: { dragging: boolean; onDrop: () => void }) {
  const [over, setOver] = useState(false)

  return (
    <div
      aria-label="Drag a card here to delete it"
      title="Drag a card here to delete it"
      onDragOver={e => { if (dragging) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); if (dragging) onDrop() }}
      className={`fixed z-40 top-16 sm:top-4 right-4 flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed select-none transition-all duration-200 ${
        over
          ? 'w-40 h-24 scale-110 border-red-700 bg-red-700/15 text-red-700 shadow-lg'
          : dragging
          ? 'w-36 h-20 border-red-700/50 bg-[#DEDAD2]/95 text-red-700/80 shadow-md animate-pop'
          : 'w-11 h-11 border-transparent bg-[#DEDAD2]/80 text-gray-500 opacity-60 hover:opacity-100'
      }`}
      style={{ boxShadow: dragging ? '0 8px 24px rgba(28,26,20,0.18)' : undefined }}
    >
      <svg
        width={dragging ? 22 : 18} height={dragging ? 22 : 18} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
        className={`pointer-events-none ${over ? 'animate-bounce' : ''}`}
      >
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
      </svg>
      {dragging && <span className="pointer-events-none text-xs font-semibold">{over ? 'Let go' : 'Delete'}</span>}
    </div>
  )
}
