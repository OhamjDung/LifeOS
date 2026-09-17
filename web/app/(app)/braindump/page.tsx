'use client'

import { useState, useRef, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import DeleteTasksModal from '@/components/DeleteTasksModal'
import { BraindumpJob, ContactInteractionLogged, PendingContact } from '@/lib/types'
import ResolveContactsModal, { ContactResolution } from '@/components/ResolveContactsModal'

type Category = 'Tasks' | 'Notes' | 'Contacts'
const CATS: Category[] = ['Tasks', 'Notes', 'Contacts']
type DeleteCandidate = { id: string; title: string }

interface HistoryEntry {
  id: string
  createdAt: string
  categories: Category[]
  transcript: string
  status: 'extracting' | 'done' | 'failed'
  created: string[]
  merged: string[]
  contactsCreated: string[]
  contactsUpdated: string[]
  interactionsLogged: ContactInteractionLogged[]
  pendingContacts: PendingContact[]
  noteContent?: string
  logs: string[]
  errors: string[]
}

function jobToEntry(job: BraindumpJob): HistoryEntry {
  const categories = (job.categories?.length ? job.categories : ['Tasks']) as Category[]
  return {
    id: job.id,
    createdAt: job.created_at,
    categories,
    transcript: job.raw_transcript ?? '',
    status: job.processing_status === 'done' ? 'done' : job.processing_status === 'failed' ? 'failed' : 'extracting',
    created: job.result?.created ?? [],
    merged: job.result?.merged ?? [],
    contactsCreated: job.result?.contactsCreated ?? [],
    contactsUpdated: job.result?.contactsUpdated ?? [],
    interactionsLogged: job.result?.interactionsLogged ?? [],
    pendingContacts: job.result?.pendingContacts ?? [],
    logs: job.result?.logs ?? [],
    errors: job.result?.errors ?? (job.last_error ? [job.last_error] : []),
  }
}

export default function BraindumpPage() {
  const [text, setText] = useState('')
  const [categories, setCategories] = useState<Category[]>(['Tasks'])
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [duration, setDuration] = useState(0)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [openDebugId, setOpenDebugId] = useState<string | null>(null)
  const [deleteCandidates, setDeleteCandidates] = useState<DeleteCandidate[]>([])
  const [reviewJobId, setReviewJobId] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<any>(null)
  const supabase = createClient()

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('braindump_jobs')
        .select('id, user_id, audio_path, raw_transcript, categories, processing_status, retry_count, last_error, result, created_at')
        .order('created_at', { ascending: false })
        .limit(20)
      setHistory((data as BraindumpJob[] ?? []).map(jobToEntry))
      setHistoryLoaded(true)
    })()
  }, [])

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

  async function handleReprompt(entry: HistoryEntry, instruction: string) {
    if (!instruction.trim()) return
    const { data: { user } } = await supabase.auth.getUser()
    const { data: { session } } = await supabase.auth.getSession()

    const combined = `Original braindump: ${entry.transcript}\n\nCurrent extracted tasks: ${JSON.stringify(entry.created)}\n\nAdjustment: ${instruction.trim()}`
    const { data: job, error } = await supabase
      .from('braindump_jobs')
      .insert({ raw_transcript: combined, user_id: user?.id, categories: entry.categories.filter(c => c !== 'Notes') })
      .select('id, created_at')
      .single()

    if (error || !job) return
    setHistory(prev => [{
      id: job.id,
      createdAt: job.created_at,
      categories: entry.categories,
      transcript: `Adjustment on previous dump: ${instruction.trim()}`,
      status: 'extracting',
      created: [], merged: [], contactsCreated: [], contactsUpdated: [], interactionsLogged: [], pendingContacts: [], logs: [], errors: [],
    }, ...prev])
    runExtraction(job.id, session)
  }

  async function handleContactsResolved(jobId: string, resolutions: ContactResolution[]) {
    setReviewJobId(null)
    const entry = history.find(h => h.id === jobId)
    if (!entry) return
    const next: HistoryEntry = {
      ...entry,
      contactsCreated: [...entry.contactsCreated, ...resolutions.filter(r => r.created).map(r => r.name)],
      contactsUpdated: [...entry.contactsUpdated, ...resolutions.filter(r => !r.created).map(r => r.name)],
      interactionsLogged: [
        ...entry.interactionsLogged,
        ...resolutions.filter(r => r.interaction).map(r => ({ name: r.name, type: r.interaction!.type, date: r.interaction!.date })),
      ],
      pendingContacts: [],
    }
    setHistory(prev => prev.map(h => h.id === jobId ? next : h))
    // Persist so the card doesn't re-prompt after reload.
    const { data: job } = await supabase.from('braindump_jobs').select('result').eq('id', jobId).single()
    if (job) {
      await supabase.from('braindump_jobs').update({
        result: {
          ...(job.result ?? {}),
          contactsCreated: next.contactsCreated,
          contactsUpdated: next.contactsUpdated,
          interactionsLogged: next.interactionsLogged,
          pendingContacts: [],
        },
      }).eq('id', jobId)
    }
  }

  async function runExtraction(jobId: string, session: any) {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fn-process-braindump`,
        { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}` } },
      )
      const body = await res.json().catch(() => null)
      console.log('[braindump] fn-process-braindump response:', res.status, body)
      if (body?.logs?.length) body.logs.forEach((l: string) => console.log('[braindump][reasoning]', l))
      if (body?.errors?.length) body.errors.forEach((e: string) => console.error('[braindump][error]', e))

      setHistory(prev => prev.map(h => h.id === jobId ? {
        ...h,
        status: res.ok && !body?.errors?.length ? 'done' : 'failed',
        created: body?.created ?? [],
        merged: body?.merged ?? [],
        contactsCreated: body?.contactsCreated ?? [],
        contactsUpdated: body?.contactsUpdated ?? [],
        interactionsLogged: body?.interactionsLogged ?? [],
        pendingContacts: (body?.pendingContacts ?? []).filter((pc: PendingContact & { jobId?: string }) => !pc.jobId || pc.jobId === jobId),
        logs: body?.logs ?? [],
        errors: body?.errors ?? (res.ok ? [] : [`HTTP ${res.status}${body ? ': ' + JSON.stringify(body) : ''}`]),
      } : h))
      if (body?.pendingDeletions?.length) setDeleteCandidates(prev => [...prev, ...body.pendingDeletions])
      if (body?.pendingContacts?.some((pc: { jobId?: string }) => !pc.jobId || pc.jobId === jobId)) setReviewJobId(jobId)
    } catch (err: any) {
      console.error('[braindump] fn-process-braindump error:', err)
      setHistory(prev => prev.map(h => h.id === jobId ? { ...h, status: 'failed', errors: [err?.message ?? 'Processing failed'] } : h))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const full = text.trim()
    if (!full) return

    setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data: { session } } = await supabase.auth.getSession()

    const needsProcessing = categories.includes('Tasks') || categories.includes('Contacts')

    if (needsProcessing) {
      const { data: job, error } = await supabase
        .from('braindump_jobs')
        .insert({
          raw_transcript: full,
          user_id: user?.id,
          categories: categories.filter(c => c !== 'Notes'),
        })
        .select('id, created_at')
        .single()

      if (!error && job) {
        setHistory(prev => [{
          id: job.id,
          createdAt: job.created_at,
          categories,
          transcript: full,
          status: 'extracting',
          created: [], merged: [], contactsCreated: [], contactsUpdated: [], interactionsLogged: [], pendingContacts: [], logs: [], errors: [],
          noteContent: categories.includes('Notes') ? full : undefined,
        }, ...prev])
        runExtraction(job.id, session)
      }
    }

    if (categories.includes('Notes')) {
      await supabase.from('notes').insert({ content: full, user_id: user?.id, source_platform: 'web' })
      if (!needsProcessing) {
        setHistory(prev => [{
          id: `note-${Date.now()}`,
          createdAt: new Date().toISOString(),
          categories,
          transcript: full,
          status: 'done',
          created: [], merged: [], contactsCreated: [], contactsUpdated: [], interactionsLogged: [], pendingContacts: [], logs: [], errors: [],
          noteContent: full,
        }, ...prev])
      }
    }

    setText('')
    setSubmitting(false)
  }

  const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

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

      {/* Right: history feed */}
      <div className="w-1/2 p-8 overflow-y-auto min-w-0 space-y-4">
        <h3 className="text-lg font-bold text-white">History</h3>
        {historyLoaded && history.length === 0 && (
          <p className="text-gray-700 text-sm">Results appear here after submit.</p>
        )}
        {history.map(entry => (
          <HistoryCard
            key={entry.id}
            entry={entry}
            debugOpen={openDebugId === entry.id}
            onToggleDebug={() => setOpenDebugId(id => id === entry.id ? null : entry.id)}
            onReprompt={instruction => handleReprompt(entry, instruction)}
            onReviewContacts={() => setReviewJobId(entry.id)}
          />
        ))}
      </div>

      {reviewJobId && (() => {
        const entry = history.find(h => h.id === reviewJobId)
        if (!entry || entry.pendingContacts.length === 0) return null
        return (
          <ResolveContactsModal
            pending={entry.pendingContacts}
            onClose={() => setReviewJobId(null)}
            onResolved={res => handleContactsResolved(reviewJobId, res)}
          />
        )
      })()}

      {deleteCandidates.length > 0 && (
        <DeleteTasksModal
          candidates={deleteCandidates}
          onClose={() => setDeleteCandidates([])}
          onConfirm={() => setDeleteCandidates([])}
        />
      )}
    </div>
  )
}

function HistoryCard({ entry, debugOpen, onToggleDebug, onReprompt, onReviewContacts }: {
  entry: HistoryEntry
  debugOpen: boolean
  onToggleDebug: () => void
  onReprompt: (instruction: string) => void
  onReviewContacts: () => void
}) {
  const [reprompt, setReprompt] = useState('')
  const [reprompting, setReprompting] = useState(false)
  const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3">
        <p className="text-[11px] text-gray-600">{fmtWhen(entry.createdAt)} · {entry.categories.join(' + ')}</p>
        {entry.status === 'extracting' && <span className="text-xs text-gray-600 animate-pulse">extracting…</span>}
        {entry.status === 'failed' && <span className="text-xs text-red-500">failed</span>}
      </div>
      <p className="px-4 pt-2 pb-3 text-sm text-gray-400 leading-relaxed line-clamp-3 whitespace-pre-wrap border-b border-gray-800">
        {entry.transcript}
      </p>

      <div className="p-4 space-y-3">
        {entry.categories.includes('Tasks') && (
          <ResultSection
            icon="◉" label="Tasks extracted" color="indigo"
            loading={entry.status === 'extracting'}
            items={entry.created} merged={entry.merged}
            emptyMsg="No new tasks found."
            link={{ href: '/tasks', label: 'View tasks →' }}
          />
        )}

        {entry.categories.includes('Contacts') && (
          <ResultSection
            icon="●" label="Contacts" color="orange"
            loading={entry.status === 'extracting'}
            items={[
              ...entry.contactsCreated,
              ...entry.contactsUpdated.map(n => n + ' — updated'),
              ...entry.interactionsLogged.map(i => (i.type === 'met' ? 'Met ' : 'Messaged ') + i.name + ' · ' + i.date),
            ]}
            emptyMsg="No contacts found."
            link={{ href: '/contacts', label: 'View contacts →' }}
          />
        )}

        {entry.pendingContacts.length > 0 && (
          <button
            type="button"
            onClick={onReviewContacts}
            className="w-full flex items-center justify-between rounded-xl border border-orange-700/60 bg-orange-950/20 px-4 py-3 text-left hover:bg-orange-950/40 transition-colors"
          >
            <span className="text-xs text-orange-400">
              ⚠ {entry.pendingContacts.length} contact{entry.pendingContacts.length === 1 ? '' : 's'} match existing names — not saved yet
            </span>
            <span className="text-xs font-medium text-orange-300">Resolve →</span>
          </button>
        )}

        {entry.categories.includes('Notes') && entry.noteContent && (
          <ResultSection
            icon="📝" label="Note saved" color="green"
            loading={false} items={[]}
            body={entry.noteContent}
            link={{ href: '/notes', label: 'View notes →' }}
          />
        )}

        {entry.errors.length > 0 && (
          <div className="rounded-xl p-4 bg-red-950/30 border border-red-900/50">
            <p className="text-red-400 text-xs font-medium uppercase tracking-wider mb-2">⚠ Errors</p>
            {entry.errors.map((e, i) => <p key={i} className="text-red-500 text-xs font-mono mb-1">{e}</p>)}
          </div>
        )}

        {(entry.logs.length > 0 || entry.errors.length > 0) && (
          <div className="rounded-xl border border-gray-800 bg-gray-950">
            <button
              type="button"
              onClick={onToggleDebug}
              className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-500 uppercase tracking-wider hover:text-gray-400"
            >
              <span>🔍 Debug reasoning ({entry.logs.length})</span>
              <span>{debugOpen ? '▲' : '▼'}</span>
            </button>
            {debugOpen && (
              <div className="px-4 pb-4 space-y-1 max-h-80 overflow-y-auto">
                {entry.logs.map((line, i) => (
                  <p key={i} className="text-[11px] font-mono text-gray-500 leading-relaxed whitespace-pre-wrap break-words">{line}</p>
                ))}
                {entry.logs.length === 0 && <p className="text-xs text-gray-700">No trace returned.</p>}
              </div>
            )}
          </div>
        )}

        {entry.status !== 'extracting' && (entry.categories.includes('Tasks') || entry.categories.includes('Contacts')) && (
          <div className="flex gap-2 pt-1">
            <input
              type="text"
              value={reprompt}
              onChange={e => setReprompt(e.target.value)}
              placeholder="Adjust: also add… / remove…"
              disabled={reprompting}
              className="flex-1 px-3 py-2 bg-gray-950 border border-gray-800 rounded-lg text-gray-200 placeholder-gray-600 outline-none focus:border-indigo-500 text-xs disabled:opacity-50"
            />
            <button
              type="button"
              onClick={async () => { if (!reprompt.trim()) return; setReprompting(true); await onReprompt(reprompt); setReprompt(''); setReprompting(false) }}
              disabled={reprompting || !reprompt.trim()}
              className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-[#DEDAD2] text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
            >
              {reprompting ? '…' : 'Re-extract'}
            </button>
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
