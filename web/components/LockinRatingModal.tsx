'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function LockinRatingModal({
  sessionId,
  round,
  onDone,
}: {
  sessionId: string
  round: number
  onDone: () => void
}) {
  const supabase = createClient()
  const [rating, setRating] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(value: number | null) {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('session_rounds').insert({
      session_id: sessionId,
      user_id: user?.id,
      round,
      lockin_rating: value,
    })
    onDone()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#DEDAD2] text-[#1C1A14] rounded-xl p-6 max-w-sm w-full text-center">
        <h3 className="text-lg font-bold mb-1">Round {round} done</h3>
        <p className="text-sm opacity-70 mb-5">How locked in were you?</p>

        <div className="flex items-center justify-center gap-2 mb-6">
          {[1, 2, 3, 4, 5].map(n => (
            <button
              key={n}
              onClick={() => setRating(n)}
              disabled={saving}
              className="text-3xl leading-none transition-transform hover:scale-110"
            >
              {rating !== null && n <= rating ? '★' : '☆'}
            </button>
          ))}
        </div>

        <div className="flex gap-2 justify-center">
          <button
            onClick={() => submit(null)}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg hover:opacity-70"
          >
            Skip
          </button>
          <button
            onClick={() => submit(rating)}
            disabled={saving || rating === null}
            className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-[#DEDAD2] font-medium disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
