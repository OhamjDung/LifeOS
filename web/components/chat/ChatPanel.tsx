'use client'

import { KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ymd } from '@/lib/planDates'
import { CHAT_COMMANDS, ChatMessage, MODEL_LABEL, applyChat, notifyDataChanged, sendChat } from '@/lib/chat'
import { useVoiceRecorder } from '@/lib/useVoiceRecorder'
import { Markdown } from './Markdown'
import { ProposalCard } from './ProposalCard'

const SUGGESTIONS = [
  '/prioritize',
  'What does my day look like?',
  'Plan my week around my goals',
  'Who should I reach out to?',
]

// Every write the chat can apply touches tasks, contacts, notes or blocks the page shows.
const refreshAfterApply = () => notifyDataChanged()

export function ChatPanel() {
  const [supabase] = useState(createClient)
  const [today] = useState(() => ymd(new Date()))
  const [viewDate, setViewDate] = useState(today)
  const [threads, setThreads] = useState<string[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyProposals, setBusyProposals] = useState<Set<string>>(new Set())
  const [model, setModel] = useState('deepseek-v4-flash')
  const [spent, setSpent] = useState(0)
  const [budget, setBudget] = useState(5)
  const [menuIdx, setMenuIdx] = useState(0)
  const lock = useRef(false)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const voice = useVoiceRecorder(text => setInput(prev => (prev ? `${prev} ${text}` : text)))

  // Settings + month spend + list of past days.
  useEffect(() => {
    const monthStart = new Date()
    monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0)
    Promise.all([
      supabase.from('user_settings').select('chat_model,chat_budget_usd').maybeSingle(),
      supabase.from('chat_messages').select('cost_usd').gte('created_at', monthStart.toISOString()),
      supabase.from('chat_threads').select('thread_date').order('thread_date', { ascending: false }).limit(30),
    ]).then(([s, c, t]) => {
      if (s.data?.chat_model) setModel(s.data.chat_model)
      if (s.data?.chat_budget_usd != null) setBudget(Number(s.data.chat_budget_usd))
      setSpent((c.data ?? []).reduce((n, r) => n + Number(r.cost_usd ?? 0), 0))
      setThreads((t.data ?? []).map(r => r.thread_date as string))
    })
  }, [supabase])

  const loadThread = useCallback(async (date: string) => {
    const { data: th } = await supabase.from('chat_threads').select('id').eq('thread_date', date).maybeSingle()
    if (!th) { setMessages([]); setLoaded(true); return }
    const { data } = await supabase.from('chat_messages').select('*').eq('thread_id', th.id).order('created_at')
    setMessages((data as ChatMessage[]) ?? [])
    setLoaded(true)
  }, [supabase])

  // Fetch-on-change; loadThread only sets state after its awaits.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadThread(viewDate) }, [viewDate, loadThread])

  useLayoutEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, sending])

  // Auto-grow the composer up to ~6 lines.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`
  }, [input])

  const readOnly = viewDate !== today
  const slashOpen = !readOnly && /^\/\w*$/.test(input)
  const menu = slashOpen ? CHAT_COMMANDS.filter(c => c.cmd.startsWith(input.toLowerCase())) : []

  async function send(text: string) {
    const t = text.trim()
    if (!t || lock.current || readOnly) return
    lock.current = true
    setSending(true)
    setError(null)
    setInput('')
    const temp: ChatMessage = {
      id: `temp-${Date.now()}`, thread_id: '', role: 'user', content: t, tool_trace: null, proposals: null,
      remembered: null, model: null, cost_usd: 0, created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, temp])
    try {
      const res = await sendChat(t)
      setMessages(prev => [...prev.filter(m => m.id !== temp.id), ...res.messages])
      if (res.model) setModel(res.model)
      if (res.spent != null) setSpent(res.spent)
      if (res.budget != null) setBudget(res.budget)
      if (!threads.includes(today)) setThreads(prev => [today, ...prev])
    } catch (e) {
      setMessages(prev => prev.filter(m => m.id !== temp.id))
      setInput(t)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
      lock.current = false
      inputRef.current?.focus()
    }
  }

  async function decide(msg: ChatMessage, decisions: { proposal_id: string; accept: boolean; choice?: string }[]) {
    const ids = decisions.map(d => d.proposal_id)
    if (ids.some(id => busyProposals.has(`${msg.id}:${id}`))) return
    setBusyProposals(prev => new Set([...prev, ...ids.map(id => `${msg.id}:${id}`)]))
    setError(null)
    try {
      const { message } = await applyChat(msg.id, decisions)
      setMessages(prev => prev.map(m => (m.id === message.id ? message : m)))
      if (decisions.some(d => d.accept)) refreshAfterApply()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyProposals(prev => {
        const next = new Set(prev)
        ids.forEach(id => next.delete(`${msg.id}:${id}`))
        return next
      })
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (menu.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMenuIdx(i => (i + 1) % menu.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMenuIdx(i => (i - 1 + menu.length) % menu.length); return }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && menu[menuIdx] && menu[menuIdx].cmd !== input)) {
        e.preventDefault()
        setInput(menu[Math.min(menuIdx, menu.length - 1)].cmd + ' ')
        setMenuIdx(0)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const overBudget = spent >= budget

  return (
    <div className="flex flex-col h-[75dvh] lg:h-[calc(100dvh-6.5rem)] min-h-[420px]">
      {/* Header */}
      <div className="flex items-center gap-2 pb-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-white">Assistant</h2>
          <p className="text-gray-400 text-xs mt-1">Talk through your day. Changes wait for your confirm.</p>
        </div>
        <button
          onClick={() => send('/model')}
          disabled={sending || readOnly}
          title="Switch model (/model)"
          className="px-2 py-1 rounded-lg text-[11px] font-semibold border border-gray-700 text-gray-400 hover:text-white disabled:opacity-40"
        >
          {MODEL_LABEL[model] ?? model}
        </button>
        <span
          className={`text-[11px] tabular-nums ${overBudget ? 'text-red-700 font-semibold' : 'text-gray-500'}`}
          title="AI spend this month / budget (Settings)"
        >
          ${spent.toFixed(2)} / ${budget.toFixed(0)}
        </span>
        <select
          value={viewDate}
          onChange={e => { setLoaded(false); setViewDate(e.target.value) }}
          aria-label="Conversation day"
          className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-[11px] text-gray-400 outline-none focus:border-indigo-500"
        >
          <option value={today}>Today</option>
          {threads.filter(d => d !== today).map(d => (
            <option key={d} value={d}>{new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</option>
          ))}
        </select>
      </div>

      {/* Messages */}
      <div
        className="flex-1 min-h-0 overflow-y-auto rounded-xl p-3 space-y-3"
        style={{ background: 'rgba(245,243,236,.45)', border: '1px solid rgba(28,26,20,0.08)' }}
        aria-live="polite"
      >
        {!loaded ? (
          <div className="space-y-3" aria-busy="true">
            {[0, 1].map(i => <div key={i} className="h-12 rounded-xl bg-gray-900/70 animate-pulse" style={{ width: `${70 - i * 20}%` }} />)}
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 animate-fade-in">
            <p className="text-sm text-white font-semibold">{readOnly ? 'No conversation that day.' : 'What’s on your mind?'}</p>
            {!readOnly && (
              <>
                <p className="text-xs text-gray-500 max-w-xs">Add tasks, log people you met, ask about your calendar, or type <code className="px-1 rounded bg-black/10">/</code> for commands.</p>
                <div className="flex flex-wrap justify-center gap-1.5 max-w-sm">
                  {SUGGESTIONS.map(s => (
                    <button key={s} onClick={() => send(s)} className="px-2.5 py-1 rounded-full text-[11px] border border-gray-700 text-gray-400 hover:text-white hover:border-indigo-500">
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          messages.map(m => {
            const pending = (m.proposals ?? []).filter(p => p.status === 'pending' && (!p.choices || p.choice))
            return m.role === 'user' ? (
              <div key={m.id} className="flex justify-end animate-slide-up">
                <div className={`max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-sm whitespace-pre-wrap break-words bg-indigo-600 text-[#EEF0E4] ${m.id.startsWith('temp-') ? 'opacity-80' : ''}`}>
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex flex-col gap-2 max-w-[92%] animate-slide-up">
                <div className="rounded-2xl rounded-bl-md px-3 py-2 text-sm text-white bg-gray-900 border border-black/5">
                  <Markdown text={m.content} />
                </div>
                {m.proposals?.map(p => (
                  <ProposalCard
                    key={p.id}
                    proposal={p}
                    busy={busyProposals.has(`${m.id}:${p.id}`)}
                    onDecide={(accept, choice) => decide(m, [{ proposal_id: p.id, accept, choice }])}
                  />
                ))}
                {pending.length > 1 && (
                  <button
                    onClick={() => decide(m, pending.map(p => ({ proposal_id: p.id, accept: true, choice: p.choice })))}
                    className="self-start px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-[#DEDAD2]"
                  >
                    Confirm all {pending.length}
                  </button>
                )}
                {m.remembered?.map(r => (
                  <span key={r} className="self-start text-[11px] px-2 py-0.5 rounded-full bg-black/5 text-gray-500 animate-pop">📝 Remembered: {r}</span>
                ))}
                {m.tool_trace && m.tool_trace.length > 0 && (
                  <details className="text-[10px] text-gray-500">
                    <summary className="cursor-pointer select-none">🔍 {m.tool_trace.length} step{m.tool_trace.length === 1 ? '' : 's'}</summary>
                    <ul className="mt-1 space-y-0.5 pl-3">
                      {m.tool_trace.map((t, i) => <li key={i}><code>{t.name}</code> — {t.summary.slice(0, 140)}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            )
          })
        )}
        {sending && (
          <div className="flex items-center gap-1 px-3 py-2.5 rounded-2xl rounded-bl-md bg-gray-900 w-fit animate-fade-in" aria-label="Assistant is thinking">
            {[0, 1, 2].map(i => (
              <span key={i} className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: `${i * 120}ms` }} />
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <div role="alert" className="mt-2 flex items-center gap-3 text-xs text-red-800 bg-red-100/60 border border-red-300 rounded-lg px-3 py-2 animate-slide-up">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss error" className="px-1">×</button>
        </div>
      )}
      {voice.error && <p role="alert" className="mt-1 text-[11px] text-red-700">{voice.error}</p>}

      {/* Composer */}
      {readOnly ? (
        <button onClick={() => { setLoaded(false); setViewDate(today) }} className="mt-3 py-2 rounded-xl text-xs border border-gray-700 text-gray-400 hover:text-white">
          Viewing a past day (read-only) — back to today
        </button>
      ) : (
        <div className="relative mt-3">
          {menu.length > 0 && (
            <ul role="listbox" className="absolute bottom-full mb-1.5 left-0 w-64 rounded-xl bg-gray-900 border border-gray-700 shadow-lg overflow-hidden animate-slide-up z-10">
              {menu.map((c, i) => (
                <li key={c.cmd} role="option" aria-selected={i === menuIdx}>
                  <button
                    onMouseDown={e => { e.preventDefault(); setInput(c.cmd + ' '); setMenuIdx(0); inputRef.current?.focus() }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-baseline gap-2 ${i === menuIdx ? 'bg-indigo-900/60' : 'hover:bg-black/5'}`}
                  >
                    <code className="font-semibold text-white">{c.cmd}</code>
                    <span className="text-gray-500">{c.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-end gap-2 rounded-2xl bg-[#EAE7E0] border border-gray-700 focus-within:border-indigo-500 px-2 py-1.5">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => { setInput(e.target.value); setMenuIdx(0) }}
              onKeyDown={onKeyDown}
              rows={1}
              disabled={overBudget}
              placeholder={overBudget ? 'Monthly budget reached — raise it in Settings' : voice.recording ? 'Listening…' : 'Ask, plan, or add…  ( / for commands )'}
              aria-label="Message the assistant"
              className="flex-1 resize-none bg-transparent outline-none text-sm text-white placeholder-gray-500 py-1 px-1 max-h-[150px]"
            />
            <button
              onClick={voice.toggle}
              disabled={voice.transcribing}
              aria-label={voice.recording ? 'Stop recording' : 'Record voice'}
              title={voice.recording ? 'Stop' : 'Voice'}
              className={`shrink-0 h-8 px-2 rounded-lg text-sm ${voice.recording ? 'bg-red-700 text-[#F3F1EA] animate-pulse' : 'text-gray-500 hover:text-white hover:bg-black/5'} disabled:opacity-40`}
            >
              {voice.recording ? `■ ${voice.seconds}s` : voice.transcribing ? '…' : '◉'}
            </button>
            <button
              onClick={() => send(input)}
              disabled={sending || !input.trim() || overBudget}
              aria-label="Send"
              className="shrink-0 h-8 w-8 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[#DEDAD2] text-sm font-bold disabled:opacity-30"
            >
              ↑
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
