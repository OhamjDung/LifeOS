'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from './supabase/client'

/**
 * Mic → MediaRecorder → fn-transcribe (Groq Whisper). Calls `onText` with the
 * transcript. Same pipeline as /braindump.
 */
export function useVoiceRecorder(onText: (text: string) => void) {
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const onTextRef = useRef(onText)
  useEffect(() => { onTextRef.current = onText })

  useEffect(() => {
    if (!recording) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [recording])

  async function transcribe(blob: Blob, mimeType: string) {
    try {
      const { data: { session } } = await createClient().auth.getSession()
      const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'ogg'
      const form = new FormData()
      form.append('audio', blob, `recording.${ext}`)
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fn-transcribe`, {
        method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` }, body: form,
      })
      if (!res.ok) throw new Error(`Transcription failed (${res.status})`)
      const { text } = await res.json()
      if (typeof text === 'string' && text.trim()) onTextRef.current(text.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setTranscribing(false)
    }
  }

  async function toggle() {
    setError(null)
    if (recording) {
      recorder.current?.stop()
      setRecording(false)
      setStartedAt(null)
      setTranscribing(true)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunks.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunks.current.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        transcribe(new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' }), mr.mimeType)
      }
      mr.start(1000)
      recorder.current = mr
      setStartedAt(Date.now())
      setNow(Date.now())
      setRecording(true)
    } catch {
      setError('Microphone unavailable — check browser permissions.')
    }
  }

  const seconds = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0
  return { recording, transcribing, seconds, error, toggle }
}
