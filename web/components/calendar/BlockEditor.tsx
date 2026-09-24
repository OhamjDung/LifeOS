'use client'

import { useEffect, useState } from 'react'
import { BLOCK_COLORS, BlockColor, TimeBlock, formatTime } from '@/lib/calendar'

export function BlockEditor({
  block,
  onSave,
  onDelete,
  onUnassign,
  onClose,
}: {
  block: TimeBlock
  onSave: (patch: { title: string | null; color: BlockColor }) => void
  onDelete: () => void
  onUnassign: (taskId: string) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(block.title ?? '')
  const [color, setColor] = useState<BlockColor>(block.color)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = () => onSave({ title: title.trim() || null, color })
  const day = new Date(block.start_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4 animate-fade-in"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div role="dialog" aria-modal="true" aria-label="Edit time block"
        className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-gray-900 border border-gray-700 p-5 space-y-3 animate-slide-up"
        style={{ boxShadow: '0 20px 50px rgba(28,26,20,0.25)' }}
      >
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-bold text-white">Time block</h3>
          <span className="text-[11px] text-gray-500">{day} · {formatTime(block.start_at)} – {formatTime(block.end_at)}</span>
        </div>
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save() }}
          placeholder="Title (optional — defaults to first task)"
          className="w-full bg-[#EAE7E0] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-indigo-500"
        />
        <div className="flex gap-2">
          {(Object.keys(BLOCK_COLORS) as BlockColor[]).map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Color ${c}`}
              aria-pressed={color === c}
              className={`w-7 h-7 rounded-full border-2 ${color === c ? 'scale-110' : ''}`}
              style={{ background: BLOCK_COLORS[c].bg, borderColor: color === c ? BLOCK_COLORS[c].border : 'transparent' }}
            />
          ))}
        </div>
        <div>
          <p className="text-[11px] text-gray-500 mb-1">Tasks in this block</p>
          {block.tasks.length === 0 ? (
            <p className="text-xs text-gray-500 italic">Drag tasks from the list onto the block.</p>
          ) : (
            <ul className="space-y-1">
              {block.tasks.map(t => (
                <li key={t.id} className="flex items-center gap-2 text-xs text-white">
                  <span className={`flex-1 truncate ${t.status === 'done' ? 'line-through opacity-50' : ''}`}>{t.title}</span>
                  <button onClick={() => onUnassign(t.id)} aria-label={`Remove ${t.title} from block`} className="px-1.5 text-gray-500 hover:text-red-700">×</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button onClick={onDelete} className="px-3 py-2 rounded-lg text-xs text-red-700 hover:bg-red-700/10">Delete block</button>
          <div className="flex-1" />
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-xs text-gray-500 hover:text-white">Cancel</button>
          <button onClick={save} className="px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-[#DEDAD2]">Save</button>
        </div>
      </div>
    </div>
  )
}
