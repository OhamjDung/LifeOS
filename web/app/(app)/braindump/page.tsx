'use client'

import { useState, useRef, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

type Category = 'Tasks' | 'Notes' | 'Contacts'
const CATS: Category[] = ['Tasks', 'Notes', 'Contacts']

type ResultState =
  | { type: 'idle' }
  | { type: 'extracting'; categories: Category[]; noteContent?: string }
  | { type: 'done'; created: string[]; merged: string[]; noteContent?: string; categories: Category[]; originalTranscript?: string }
  | { type: 'error'; message: string }

export default function BraindumpPage() {
  const [text, setText] = useState('')
  const [categories, setCategories] = useState<Category[]>(['Tasks'])
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [duration, setDuration] = useState(0)
  const [result, setResult] = useState<ResultState>({ type: 'idle' })
  const [reprompt, setReprompt] = useState('')
  const [reprompting, setReprompting] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<any>(null)
  const supabase = createClient()

  useEffect(() => {
    if (recording) {
      setDuration(0)
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [recording])

  async function toggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop()
      setRecording(false)
      setTranscribing(true)
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : ''
        const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        chunksRef.current = []
        mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
        mr.onstop = async () => {
          stream.getTracks().forEach(t => t.stop())
          const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
          await transcribeBlob(blob, mr.mimeType)
        }
        mr.start(1000)
        mediaRecorderRef.current = mr
        setRecording(true)
      } catch (err) {
        console.error('[braindump] mic access failed:', err)
      }
    }
  }

  async function transcribeBlob(blob: Blob, mimeType: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'ogg'
      const form = new FormData()
      form.append('audio', blob, `recording.${ext}`)
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fn-transcribe`,
        { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` }, body: form },
      )
      if (!res.ok) throw new Error(`transcribe failed: ${res.status}`)
      const { text: transcript } = await res.json()
      if (transcript?.trim()) setText(prev => (prev ? prev + ' ' + transcript.trim() : transcript.trim()))
    } catch (err) {
      console.error('[braindump] transcription error:', err)
    } finally {
      setTranscribing(false)
    }
  }

  function toggleCat(c: Category) {
    setCategories(prev =>
      prev.includes(c)
        ? (prev.length > 1 ? prev.filter(x => x !== c) : prev)
        : [...prev, c],
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const full = text.trim()
    if (!full) return

    setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()
    const jobs: PromiseLike<any>[] = []

    if (categories.includes('Tasks') || categories.includes('Contacts')) {
      jobs.push(supabase.from('braindump_jobs').insert({
        raw_transcript: full,
        user_id: user?.id,
        categories: categories.filter(c => c !== 'Notes'),
      }))
    }
    if (categories.includes('Notes')) {
      jobs.push(supabase.from('notes').insert({
        content: full,
        user_id: user?.id,
        source_platform: 'web',
      }))
    }
    await Promise.all(jobs)

    // Show extracting state immediately
    const originalTranscript = full
    setResult({
      type: 'extracting',
      categories,
      noteContent: categories.includes('Notes') ? full : undefined,
    })
    setText('')
    setReprompt('')
    setSubmitting(false)

    // Trigger AI processing for tasks/contacts
    if (categories.includes('Tasks') || categories.includes('Contacts')) {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fn-process-braindump`,
          { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` } },
        )
        const body = await res.json().catch(() => null)
        console.log('[braindump] fn-process-braindump response:', res.status, body)
        setResult({
          type: 'done',
          created: body?.created ?? [],
          merged: body?.merged ?? [],
          noteContent: categories.includes('Notes') ? originalTranscript : undefined,
          categories,
          originalTranscript,
        })
      } catch (err: any) {
        console.error('[braindump] fn-process-braindump error:', err)
        setResult({ type: 'error', message: err?.message ?? 'Processing failed' })
      }
    } else {
      // Notes only — done immediately
      setResult({
        type: 'done',
        created: [],
        merged: [],
        noteContent: originalTranscript,
        categories,
        originalTranscript,
      })
    }
  }

  async function handleReprompt(e: React.FormEvent) {
    e.preventDefault()
    if (!reprompt.trim() || result.type !== 'done') return
    const instruction = reprompt.trim()
    setReprompting(true)
    setReprompt('')

    const originalTranscript = result.originalTranscript ?? ''
    const currentTasks = result.created

    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: { session } } = await supabase.auth.getSession()

      // Insert new braindump job with original transcript + adjustment instruction
      const combined = `Original braindump: ${originalTranscript}\n\nCurrent extracted tasks: ${JSON.stringify(currentTasks)}\n\nAdjustment: ${instruction}`
      await supabase.from('braindump_jobs').insert({
        raw_transcript: combined,
        user_id: user?.id,
        categories: result.categories.filter(c => c !== 'Notes'),
      })

      setResult(prev => prev.type === 'done' ? { ...prev, created: prev.created } : prev)

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fn-process-braindump`,
        { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` } },
      )
      const body = await res.json().catch(() => null)

      setResult(prev => prev.type === 'done' ? {
        ...prev,
        created: [...prev.created, ...(body?.created ?? [])],
        merged: [...prev.merged, ...(body?.merged ?? [])],
      } : prev)
    } catch (err: any) {
      console.error('[braindump] reprompt error:', err)
    } finally {
      setReprompting(false)
    }
  }

  const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="flex min-h-screen">
      {/* Left: form */}
      <div className="w-1/2 shrink-0 p-8 overflow-y-auto" style={{ borderRight: '1px solid rgba(28,26,20,0.1)' }}>
        <div className="mb-8 max-w-lg">
          <h2 className="text-2xl font-bold text-white">Empty your head.</h2>
          <p className="text-gray-400 text-sm mt-1">Speak or type freely.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
          {/* Record button */}
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={toggleRecording}
              disabled={transcribing}
              className={`w-20 h-20 rounded-full flex items-center justify-center text-2xl transition-all disabled:opacity-40 ${
                recording
                  ? 'bg-red-900/50 border-2 border-red-500 text-red-400 animate-pulse'
                  : 'bg-gray-800 border-2 border-gray-700 text-gray-400 hover:border-indigo-500 hover:text-indigo-400'
              }`}
            >
              {recording ? '■' : transcribing ? '…' : '◉'}
            </button>
            {recording && <p className="text-xs text-red-400 tracking-widest">● REC {fmtDuration(duration)} — click to stop</p>}
            {transcribing && <p className="text-xs text-gray-400 tracking-widest">Transcribing…</p>}
          </div>

          {/* Category chips */}
          <div className="flex gap-2">
            {CATS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => toggleCat(c)}
                className={`flex-1 py-2.5 px-3 rounded-xl border text-sm font-medium transition-colors ${
                  categories.includes(c)
                    ? 'border-indigo-500 bg-indigo-900/30 text-indigo-300'
                    : 'border-gray-700 text-gray-500 hover:border-gray-600'
                }`}
              >
                {categories.includes(c) ? '✓ ' : ''}{c}
              </button>
            ))}
          </div>

          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="I need to call Sarah back, also the project deadline is Friday, buy groceries…"
            rows={8}
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-5 py-4 text-gray-200 placeholder-gray-600 outline-none focus:border-indigo-500 resize-none text-base leading-relaxed"
          />

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-600">
              {categories.includes('Tasks') ? 'Tasks appear after AI processing.' : 'Note saved immediately.'}
            </p>
            <button
              type="submit"
              disabled={submitting || !text.trim()}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-[#DEDAD2] font-medium rounded-lg transition-colors"
            >
              {submitting ? 'Submitting…' : categories.includes('Tasks') ? 'Submit — extract tasks' : 'Submit'}
            </button>
          </div>
        </form>
      </div>

      {/* Right: results panel */}
      <div className="w-1/2 p-8 overflow-y-auto min-w-0">
        {result.type === 'idle' ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-700 text-sm">Results appear here after submit.</p>
          </div>
        ) : result.type === 'extracting' ? (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-white">Processing…</h3>
            {result.categories.includes('Tasks') && (
              <ResultSection
                icon="◉"
                label="Tasks"
                color="indigo"
                loading
                items={[]}
              />
            )}
            {result.categories.includes('Contacts') && (
              <ResultSection
                icon="●"
                label="Contacts"
                color="orange"
                loading
                items={[]}
              />
            )}
            {result.categories.includes('Notes') && result.noteContent && (
              <ResultSection
                icon="📝"
                label="Note saved"
                color="green"
                loading={false}
                items={[]}
                body={result.noteContent}
              />
            )}
          </div>
        ) : result.type === 'done' ? (
          <div className="flex flex-col gap-6 h-full">
            <div className="space-y-6 flex-1">
              <h3 className="text-lg font-bold text-white">Done.</h3>

              {result.categories.includes('Tasks') && (
                <ResultSection
                  icon="◉"
                  label="Tasks extracted"
                  color="indigo"
                  loading={false}
                  items={result.created}
                  merged={result.merged}
                  emptyMsg="No new tasks found."
                  link={{ href: '/tasks', label: 'View tasks →' }}
                />
              )}

              {result.categories.includes('Contacts') && (
                <ResultSection
                  icon="●"
                  label="Contacts"
                  color="orange"
                  loading={false}
                  items={[]}
                  emptyMsg="Contact extraction runs in background."
                  link={{ href: '/contacts', label: 'View contacts →' }}
                />
              )}

              {result.categories.includes('Notes') && result.noteContent && (
                <ResultSection
                  icon="📝"
                  label="Note saved"
                  color="green"
                  loading={false}
                  items={[]}
                  body={result.noteContent}
                  link={{ href: '/notes', label: 'View notes →' }}
                />
              )}
            </div>

            {/* Reprompt box */}
            {(result.categories.includes('Tasks') || result.categories.includes('Contacts')) && (
              <form onSubmit={handleReprompt} className="mt-auto">
                <p className="text-xs text-gray-600 mb-2 uppercase tracking-wider">Adjust output</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={reprompt}
                    onChange={e => setReprompt(e.target.value)}
                    placeholder="e.g. also add: email the client, remove the grocery task"
                    disabled={reprompting}
                    className="flex-1 px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-600 outline-none focus:border-indigo-500 text-sm disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={reprompting || !reprompt.trim()}
                    className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-[#DEDAD2] text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                  >
                    {reprompting ? '…' : 'Re-extract'}
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <div className="rounded-xl p-4 bg-red-950/30 border border-red-900/50">
            <p className="text-red-400 text-sm font-medium">Processing failed</p>
            <p className="text-red-600 text-xs mt-1">{result.message}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function ResultSection({
  icon, label, color, loading, items, merged, emptyMsg, body, link,
}: {
  icon: string
  label: string
  color: 'indigo' | 'orange' | 'green'
  loading: boolean
  items: string[]
  merged?: string[]
  emptyMsg?: string
  body?: string
  link?: { href: string; label: string }
}) {
  const borderColor = { indigo: 'border-indigo-900/60', orange: 'border-orange-900/60', green: 'border-green-900/60' }[color]
  const textColor = { indigo: 'text-indigo-400', orange: 'text-orange-400', green: 'text-green-400' }[color]
  const dotColor = { indigo: 'bg-indigo-500', orange: 'bg-orange-500', green: 'bg-green-500' }[color]

  return (
    <div className={`rounded-xl border p-4 ${borderColor} bg-gray-900`}>
      <div className="flex items-center justify-between mb-3">
        <p className={`text-xs font-medium uppercase tracking-wider ${textColor}`}>
          {icon} {label}
        </p>
        {loading && (
          <span className="text-xs text-gray-600 animate-pulse">extracting…</span>
        )}
        {link && !loading && (
          <Link href={link.href} className={`text-xs ${textColor} hover:underline`}>{link.label}</Link>
        )}
      </div>

      {body ? (
        <p className="text-sm text-gray-400 leading-relaxed line-clamp-6 whitespace-pre-wrap">{body}</p>
      ) : loading ? (
        <div className="space-y-2">
          {[80, 60, 72].map(w => (
            <div key={w} className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${dotColor} opacity-30`} />
              <div className="h-3 rounded bg-gray-800 animate-pulse" style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
      ) : items.length === 0 && !merged?.length ? (
        <p className="text-xs text-gray-600">{emptyMsg}</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((title, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
              <span className="text-sm text-gray-300">{title}</span>
            </div>
          ))}
          {merged?.map((title, i) => (
            <div key={`m${i}`} className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-gray-600" />
              <span className="text-sm text-gray-500 line-through">{title} (merged)</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
