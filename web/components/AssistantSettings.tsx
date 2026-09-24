'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Memory = { id: string; content: string; source: 'auto' | 'user'; created_at: string }

const card = 'rounded-xl p-4 sm:p-5 bg-gray-900 border border-gray-700'
const input = 'bg-[#EAE7E0] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-indigo-500'

export function AssistantSettings() {
  const [supabase] = useState(createClient)
  const [loaded, setLoaded] = useState(false)
  const [model, setModel] = useState('deepseek-v4-flash')
  const [budget, setBudget] = useState('5')
  const [spent, setSpent] = useState(0)
  const [memories, setMemories] = useState<Memory[]>([])
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const lock = useRef(false)

  useEffect(() => {
    const monthStart = new Date()
    monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0)
    Promise.all([
      supabase.from('user_settings').select('chat_model,chat_budget_usd').maybeSingle(),
      supabase.from('chat_messages').select('cost_usd').gte('created_at', monthStart.toISOString()),
      supabase.from('chat_memories').select('*').order('created_at'),
    ]).then(([s, c, m]) => {
      if (s.data?.chat_model) setModel(s.data.chat_model)
      if (s.data?.chat_budget_usd != null) setBudget(String(s.data.chat_budget_usd))
      setSpent((c.data ?? []).reduce((n, r) => n + Number(r.cost_usd ?? 0), 0))
      setMemories((m.data as Memory[]) ?? [])
      setLoaded(true)
    })
  }, [supabase])

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, rollback?: () => void) {
    if (lock.current) return false
    lock.current = true
    setError(null)
    try {
      const { error } = await fn()
      if (error) { rollback?.(); setError(error.message); return false }
      return true
    } finally {
      lock.current = false
    }
  }

  async function saveAssistant() {
    const b = Math.max(0, Math.min(100, Number(budget) || 0))
    const { data: { user } } = await supabase.auth.getUser()
    const ok = await run(() => supabase.from('user_settings').upsert({
      user_id: user?.id, chat_model: model, chat_budget_usd: b, updated_at: new Date().toISOString(),
    }))
    if (ok) { setBudget(String(b)); setSaved(true); setTimeout(() => setSaved(false), 1500) }
  }

  async function addMemory() {
    const content = draft.trim()
    if (!content) return
    const { data: { user } } = await supabase.auth.getUser()
    let row: Memory | null = null
    const ok = await run(async () => {
      const res = await supabase.from('chat_memories').insert({ user_id: user?.id, content, source: 'user' }).select('*').single()
      row = res.data as Memory | null
      return res
    })
    if (ok && row) { setMemories(prev => [...prev, row!]); setDraft('') }
  }

  async function saveEdit() {
    if (!editing) return
    const content = editing.text.trim()
    if (!content) return removeMemory(editing.id)
    const before = memories
    setMemories(prev => prev.map(m => (m.id === editing.id ? { ...m, content } : m)))
    const id = editing.id
    setEditing(null)
    await run(() => supabase.from('chat_memories').update({ content }).eq('id', id), () => setMemories(before))
  }

  async function removeMemory(id: string) {
    const before = memories
    setMemories(prev => prev.filter(m => m.id !== id))
    setEditing(null)
    await run(() => supabase.from('chat_memories').delete().eq('id', id), () => setMemories(before))
  }

  if (!loaded) return <div className={`${card} h-40 animate-pulse`} aria-busy="true" />

  return (
    <>
      <section className={card}>
        <h3 className="text-sm font-bold text-white">Assistant</h3>
        <p className="text-xs text-gray-500 mt-1 mb-3">
          The chat on the Tasks page. Flash is fast and cheap; Pro plans better and costs ~4×. You can also type <code className="px-1 rounded bg-black/10">/model</code> in the chat.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-500">
            <span className="block mb-1">Model</span>
            <select value={model} onChange={e => setModel(e.target.value)} className={input}>
              <option value="deepseek-v4-flash">Flash</option>
              <option value="deepseek-v4-pro">Pro</option>
            </select>
          </label>
          <label className="text-xs text-gray-500">
            <span className="block mb-1">Monthly budget (USD)</span>
            <input type="number" min={0} max={100} step={1} value={budget} onChange={e => setBudget(e.target.value)} className={`${input} w-28`} />
          </label>
          <button onClick={saveAssistant} className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[#DEDAD2]">
            {saved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          This month: <b className="text-white tabular-nums">${spent.toFixed(3)}</b> of ${Number(budget || 0).toFixed(2)}
        </p>
        <div className="mt-1.5 h-1.5 rounded-full bg-black/10 overflow-hidden">
          <div className="h-full rounded-full bg-indigo-600 transition-[width] duration-500"
            style={{ width: `${Math.min(100, (spent / Math.max(0.01, Number(budget) || 0.01)) * 100)}%` }} />
        </div>
      </section>

      <section className={card}>
        <h3 className="text-sm font-bold text-white">Memory</h3>
        <p className="text-xs text-gray-500 mt-1 mb-3">
          Long-term facts the assistant keeps about you across days. It adds some on its own (📝 in the chat); edit or remove anything here.
        </p>
        {memories.length === 0 ? (
          <p className="text-xs text-gray-500 italic mb-3">Nothing yet.</p>
        ) : (
          <ul className="space-y-1.5 mb-3">
            {memories.map(m => (
              <li key={m.id} className="group flex items-start gap-2 animate-fade-in">
                {editing?.id === m.id ? (
                  <input
                    autoFocus
                    value={editing.text}
                    onChange={e => setEditing({ id: m.id, text: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null) }}
                    onBlur={saveEdit}
                    className={`${input} flex-1 py-1`}
                  />
                ) : (
                  <button onClick={() => setEditing({ id: m.id, text: m.content })} className="flex-1 text-left text-sm text-white py-1 px-2 -mx-2 rounded-lg hover:bg-black/5" title="Click to edit">
                    {m.content}
                    {m.source === 'auto' && <span className="ml-2 text-[10px] text-gray-500">auto</span>}
                  </button>
                )}
                <button onClick={() => removeMemory(m.id)} aria-label={`Forget: ${m.content}`} title="Forget" className="px-2 py-1 text-gray-500 hover:text-red-700 rounded-lg hover:bg-red-700/10">×</button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addMemory() }}
            placeholder="e.g. School comes first this semester"
            className={`${input} flex-1`}
          />
          <button onClick={addMemory} disabled={!draft.trim()} className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[#DEDAD2] disabled:opacity-40">
            Add
          </button>
        </div>
        {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
      </section>
    </>
  )
}
