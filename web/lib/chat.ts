import { createClient } from './supabase/client'

export type ProposalStatus = 'pending' | 'applied' | 'rejected' | 'failed'
export interface Proposal {
  id: string
  tool: string
  title: string
  lines: string[]
  choices?: { id: string; label: string }[]
  choice?: string
  status: ProposalStatus
  result?: string
}

export interface ChatMessage {
  id: string
  thread_id: string
  role: 'user' | 'assistant'
  content: string
  tool_trace: { name: string; args: unknown; summary: string }[] | null
  proposals: Proposal[] | null
  remembered: string[] | null
  model: string | null
  cost_usd: number
  created_at: string
}

export const CHAT_COMMANDS = [
  { cmd: '/prioritize', hint: 'Grill me, then rank my day' },
  { cmd: '/model', hint: 'Switch Flash ↔ Pro' },
  { cmd: '/memory', hint: 'What you remember about me' },
  { cmd: '/help', hint: 'What can you do?' },
]

export const MODEL_LABEL: Record<string, string> = {
  'deepseek-v4-flash': 'Flash',
  'deepseek-v4-pro': 'Pro',
}

/** Fired after the chat applies changes so the task list + calendar can refetch. */
export const DATA_CHANGED = 'lifeos:data-changed'
export function notifyDataChanged() {
  window.dispatchEvent(new CustomEvent(DATA_CHANGED))
}

export function userTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await createClient().auth.getSession()
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/fn-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify({ ...body, tz: userTimeZone() }),
  })
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
  if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`)
  return json as T
}

export const sendChat = (text: string) =>
  call<{ messages: ChatMessage[]; spent?: number; budget?: number; model?: string }>({ action: 'send', text })

export const applyChat = (message_id: string, decisions: { proposal_id: string; accept: boolean; choice?: string }[]) =>
  call<{ message: ChatMessage }>({ action: 'apply', message_id, decisions })
