import { createClient } from 'jsr:@supabase/supabase-js@2'
import OpenAI from 'npm:openai'
import {
  CHAT_MODELS, Usage, addDaysYmd, addUsage, compactionCut, costUsd, localDate, localTime, mondayOfYmd,
  parseCommand, shortId, truncate, weekdayName,
} from '../_shared/chatCore.ts'
import {
  Ctx, Proposal, TOOLS, TurnState, applyProposal, calendarLines, contactOverdue, formatTaskLine, groupNames, planLines, runTool,
} from '../_shared/chatTools.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const openai = new OpenAI({ baseURL: 'https://api.deepseek.com', apiKey: Deno.env.get('DEEPSEEK_TOKEN')! })

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const MAX_TOOL_ROUNDS = 6
const CLAIMS_ACTION = /\b(queu(e|ed|ing)|i(’|')ve (added|created|scheduled|updated|logged|saved)|added (it|that|them)|created (it|the)|logged (it|that))\b/i
const LOOP_BUDGET_MS = 100_000 // stay well inside the edge function wall clock
const HISTORY_LIMIT = 60

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam
type Row = { id: string; role: 'user' | 'assistant'; content: string; proposals: Proposal[] | null; created_at: string }

// deno-lint-ignore no-explicit-any
async function complete(model: string, messages: Msg[], extra: Record<string, any> = {}) {
  return await openai.chat.completions.create({
    model,
    messages,
    // Thinking mode off: it rejects forced tool_choice and needs reasoning_content
    // round-tripped in tool loops. Plain mode is what fn-process-braindump runs on.
    // @ts-expect-error DeepSeek-specific param
    thinking: { type: 'disabled' },
    ...extra,
  })
}

// ───────────── context ─────────────

const PERSONA = `You are the planning assistant inside LifeOS, the user's personal task/planner app. Be efficient but warm: short, direct, friendly — no filler, no lectures. Use light markdown (short bullets, **bold** sparingly). Never show raw ids to the user.

How you act:
- You can READ tasks, notes, contacts, the calendar and the planner with tools. The system context below already has today's tasks, this week's plan and today's calendar — don't re-fetch those.
- Every change (tasks, subtasks, contacts, notes, time blocks) is a PROPOSAL the user confirms with a button. You MUST actually call the write tool in the same turn — writing "queued"/"added" without a tool call does nothing and the user sees no confirm card. After the call, say in one line what you queued. Never claim something is done until it's applied.
- The planner (year/month/week goals) is read-only for you: reference it, suggest changes in words, but you can't edit it.
- Use \`remember\` for durable facts about the user (preferences, priorities, constraints, routines) — sparingly, never for one-off tasks.
- Ask a clarifying question only when you truly can't act. Prefer sensible defaults (e.g. due today).
- Push back honestly when useful: e.g. a task rolled over 5+ times → suggest doing it, shrinking it, scheduling it, or dropping it.
- Contacts carry a category (family/work/friend/other) and why they're useful — capture those when the user tells you about someone.

When weighing priorities, in this order: 1) due date / overdue, 2) overdue contacts to reach out to, 3) calendar load that day (busy day → fewer, smaller tasks), 4) rollover count (how long it's been avoided), 5) planner goals (this week's items and month goals). Also group similar tasks so they can be batched.`

const PRIORITIZE = `/prioritize mode — act as a sharp, caring coach:
1. If you haven't yet this conversation, first ask 2–4 targeted questions in ONE message (e.g. energy/time available today, hard deadlines, anything blocked, what would make today a win). Keep them short and numbered. Stop and wait.
2. Once answered, give a concrete plan: a ranked "Do now / Next / Later / Drop or defer" list using the weighting order, grouping similar tasks. Call out avoided tasks and contacts to ping.
3. Then propose supporting changes with tools where it clearly helps: star the top items (update_tasks is_priority), reschedule what won't fit (due_date), and optionally schedule_block time for the top 1–3 around existing calendar events. Keep proposals minimal.`

async function buildSystemPrompt(ctx: Ctx, thread: { summary: string | null }, mode: 'normal' | 'prioritize'): Promise<string> {
  const { admin: sb, userId, today, tz } = ctx
  const monday = mondayOfYmd(today)
  const [memRes, taskRes, upRes, groups, contactsRes, prevRes, cal, plan] = await Promise.all([
    sb.from('chat_memories').select('content').eq('user_id', userId).order('created_at').limit(60),
    sb.from('tasks').select('id,title,due_date,status,task_type,is_priority,rollover_count,group_id').eq('user_id', userId)
      .eq('status', 'pending').lte('due_date', today).order('is_priority', { ascending: false }).order('rollover_count', { ascending: false }).limit(100),
    sb.from('tasks').select('id,title,due_date,status,task_type,is_priority,rollover_count,group_id').eq('user_id', userId)
      .eq('status', 'pending').gt('due_date', today).lte('due_date', addDaysYmd(today, 7)).order('due_date').limit(40),
    groupNames(ctx),
    sb.from('contacts').select('id,name,category,contact_tier,last_contacted_at').eq('user_id', userId).limit(500),
    sb.from('chat_threads').select('thread_date,summary').eq('user_id', userId).lt('thread_date', today)
      .not('summary', 'is', null).order('thread_date', { ascending: false }).limit(1),
    calendarLines(ctx, today, today).catch(() => ({ configured: false, byDay: new Map<string, string[]>(), error: 'unavailable' })),
    planLines(ctx, today.slice(0, 8) + '01', { weeksOnly: monday }).catch(() => '(planner unavailable)'),
  ])
  const overdueContacts = (contactsRes.data ?? [])
    .map(c => ({ c, od: contactOverdue(c) }))
    .filter(x => x.od !== null)
    .sort((a, b) => (b.od ?? 0) - (a.od ?? 0))
    .slice(0, 10)
  const todayTasks = taskRes.data ?? []
  const upcoming = upRes.data ?? []
  const calToday = cal.byDay.get(today) ?? []

  const parts = [
    PERSONA,
    `Now: ${weekdayName(today)} ${today}, ${localTime(tz, new Date())} (${tz}).`,
    `## What you remember about the user\n${(memRes.data ?? []).map(m => `- ${m.content}`).join('\n') || '(nothing yet)'}`,
    `## Planner (this year, this month, this week) — read-only\n${plan}`,
    `## Today's tasks incl. overdue (${todayTasks.length}) [id | title | due | flags]\n${todayTasks.map(t => formatTaskLine(ctx, t, groups)).join('\n') || '(none)'}`,
    `## Next 7 days (${upcoming.length})\n${upcoming.map(t => formatTaskLine(ctx, t, groups)).join('\n') || '(none)'}`,
    `## Today's calendar${cal.configured ? '' : ' (Google Calendar not connected)'}\n${calToday.join('\n') || '(nothing scheduled)'}`,
    `## Contacts overdue for a check-in\n${overdueContacts.map(({ c, od }) => `${shortId(c.id)} | ${c.name}${c.category ? ` (${c.category})` : ''} | ${c.contact_tier} | ${c.last_contacted_at ? `overdue ${od}d` : 'never contacted'}`).join('\n') || '(none)'}`,
  ]
  const prev = prevRes.data?.[0]
  if (prev?.summary) parts.push(`## Recap of your last conversation (${prev.thread_date})\n${prev.summary}`)
  if (thread.summary) parts.push(`## Earlier in today's conversation (summarized)\n${thread.summary}`)
  if (mode === 'prioritize') parts.push(PRIORITIZE)
  return parts.join('\n\n')
}

function historyMessages(rows: Row[]): Msg[] {
  return rows.map(r => {
    if (r.role === 'user') return { role: 'user', content: r.content }
    const notes = (r.proposals ?? []).map(p => `${p.id} ${p.title} — ${p.status}${p.result ? ` (${p.result})` : ''}`)
    return { role: 'assistant', content: r.content + (notes.length ? `\n[proposals: ${notes.join('; ')}]` : '') }
  })
}

// ───────────── memory compaction (Claude-Code style) ─────────────

async function summarize(model: string, previousSummary: string | null, rows: Row[], existingMemories: string[]): Promise<{ summary: string; memories: string[]; usage: Usage }> {
  const transcript = historyMessages(rows).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')
  const res = await complete(model, [
    {
      role: 'system',
      content: `You compress a planning-assistant conversation so it can be dropped from context.
Return JSON: {"summary": string, "memories": string[]}.
- summary: <=150 words. What was discussed/decided, what was proposed and whether applied, open threads. Fold in the previous summary if given.
- memories: NEW durable facts about the user worth keeping across days (preferences, priorities, constraints, routines, important people/goals). Not one-off tasks. Skip anything already in the existing list. Max 5, each one short sentence. Often [].`,
    },
    {
      role: 'user',
      content: `${previousSummary ? `Previous summary:\n${previousSummary}\n\n` : ''}Existing memories:\n${existingMemories.map(m => `- ${m}`).join('\n') || '(none)'}\n\nConversation:\n${truncate(transcript, 60000)}`,
    },
  ], { response_format: { type: 'json_object' } })
  let parsed: { summary?: unknown; memories?: unknown } = {}
  try { parsed = JSON.parse(res.choices[0].message.content ?? '{}') } catch { /* keep empty */ }
  const lower = new Set(existingMemories.map(m => m.toLowerCase()))
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 2000) : (previousSummary ?? ''),
    memories: (Array.isArray(parsed.memories) ? parsed.memories : [])
      .filter((m): m is string => typeof m === 'string' && !!m.trim() && !lower.has(m.trim().toLowerCase()))
      .slice(0, 5).map(m => m.trim().slice(0, 300)),
    usage: res.usage ?? {},
  }
}

/** Compact `rows` (oldest first) of a thread into its summary + long-term memories. */
async function compactThread(ctx: Ctx, model: string, thread: { id: string; summary: string | null }, rows: Row[]): Promise<{ usage: Usage; remembered: string[] }> {
  if (!rows.length) return { usage: {}, remembered: [] }
  const { data: mem } = await ctx.admin.from('chat_memories').select('content').eq('user_id', ctx.userId)
  const r = await summarize(model, thread.summary, rows, (mem ?? []).map(m => m.content as string))
  await ctx.admin.from('chat_threads').update({ summary: r.summary, compacted_through: rows[rows.length - 1].created_at }).eq('id', thread.id)
  if (r.memories.length) {
    await ctx.admin.from('chat_memories').insert(r.memories.map(content => ({ user_id: ctx.userId, content, source: 'auto' })))
  }
  thread.summary = r.summary
  return { usage: r.usage, remembered: r.memories }
}

async function monthSpend(userId: string): Promise<number> {
  const start = new Date()
  start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0)
  const { data } = await admin.from('chat_messages').select('cost_usd').eq('user_id', userId).gte('created_at', start.toISOString())
  return (data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
}

// ───────────── handlers ─────────────

async function handleSend(userId: string, body: { text?: string; tz?: string }) {
  const text = (body.text ?? '').trim().slice(0, 8000)
  if (!text) return json({ error: 'Empty message' }, 400)
  const tz = typeof body.tz === 'string' && body.tz.length < 64 ? body.tz : 'UTC'
  const today = localDate(tz)
  const ctx: Ctx = { admin, userId, today, tz, idCache: {} }

  const { data: settings } = await admin.from('user_settings').select('chat_model,chat_budget_usd').eq('user_id', userId).maybeSingle()
  let model: string = settings?.chat_model ?? CHAT_MODELS.flash
  const budget = Number(settings?.chat_budget_usd ?? 5)

  // Thread for the user's local day (created lazily).
  let { data: thread } = await admin.from('chat_threads').select('id,summary,compacted_through').eq('user_id', userId).eq('thread_date', today).maybeSingle()
  const isNewThread = !thread
  if (!thread) {
    const { data: created, error } = await admin.from('chat_threads')
      .upsert({ user_id: userId, thread_date: today }, { onConflict: 'user_id,thread_date' })
      .select('id,summary,compacted_through').single()
    if (error || !created) return json({ error: error?.message ?? 'thread create failed' }, 500)
    thread = created
  }

  const saveTurn = async (reply: string, extra: Record<string, unknown> = {}) => {
    const { data: rows, error } = await admin.from('chat_messages').insert([
      { thread_id: thread!.id, user_id: userId, role: 'user', content: text },
      { thread_id: thread!.id, user_id: userId, role: 'assistant', content: reply, ...extra },
    // defaultToNull:false — the two rows have different keys; without it PostgREST
    // writes NULL (not the column default) for keys only the other row has.
    ], { defaultToNull: false }).select('*')
    if (error) throw new Error(error.message)
    return rows
  }

  const { command, rest } = parseCommand(text)

  // ── local commands (no model call) ──
  if (command === 'help') {
    return json({ messages: await saveTurn(
      '**Commands**\n- `/prioritize` — I ask a few questions, then rank your day and propose changes\n- `/model` — switch between Flash (fast, cheap) and Pro (smarter)\n- `/memory` — what I remember about you (edit in ⚙ Settings)\n\nOr just talk: "add call mom tomorrow", "what\'s on Thursday?", "met Sarah from Stripe yesterday, she can help with referrals".',
    ) })
  }
  if (command === 'memory') {
    const { data: mem } = await admin.from('chat_memories').select('content').eq('user_id', userId).order('created_at')
    return json({ messages: await saveTurn(mem?.length
      ? `**What I remember** (edit in ⚙ Settings):\n${mem.map(m => `- ${m.content}`).join('\n')}`
      : 'I don\'t have any long-term memories about you yet. I pick them up as we talk, or add some in ⚙ Settings.') })
  }
  if (command === 'model') {
    const want = /pro/i.test(rest) ? CHAT_MODELS.pro : /flash/i.test(rest) ? CHAT_MODELS.flash
      : model === CHAT_MODELS.pro ? CHAT_MODELS.flash : CHAT_MODELS.pro
    await admin.from('user_settings').upsert({ user_id: userId, chat_model: want, updated_at: new Date().toISOString() })
    return json({
      model: want,
      messages: await saveTurn(want === CHAT_MODELS.pro
        ? 'Switched to **Pro** — better at planning and nuance, ~4× the cost. `/model` again to go back.'
        : 'Switched to **Flash** — fast and cheap. `/model pro` for harder planning.'),
    })
  }

  const spent = await monthSpend(userId)
  if (spent >= budget) {
    return json({ messages: await saveTurn(`You've hit this month's chat budget ($${spent.toFixed(2)} of $${budget.toFixed(2)}). Raise it in ⚙ Settings to keep going.`) })
  }

  let usage: Usage = {}
  const remembered: string[] = []

  // New day: fold the most recent earlier thread into its summary + long-term memory first.
  if (isNewThread) {
    const { data: prev } = await admin.from('chat_threads').select('id,summary,compacted_through').eq('user_id', userId)
      .lt('thread_date', today).order('thread_date', { ascending: false }).limit(1).maybeSingle()
    if (prev) {
      let q = admin.from('chat_messages').select('id,role,content,proposals,created_at').eq('thread_id', prev.id).order('created_at')
      if (prev.compacted_through) q = q.gt('created_at', prev.compacted_through)
      const { data: rows } = await q.limit(200)
      if (rows?.length) {
        try {
          const r = await compactThread(ctx, CHAT_MODELS.flash, prev, rows as Row[])
          usage = addUsage(usage, r.usage)
          remembered.push(...r.remembered)
        } catch (e) { console.error('[fn-chat] prev-thread compaction failed', e) }
      }
    }
  }

  // History of today's thread after the last compaction; compact again if it's grown too big.
  let hq = admin.from('chat_messages').select('id,role,content,proposals,created_at').eq('thread_id', thread.id).order('created_at', { ascending: false }).limit(HISTORY_LIMIT)
  if (thread.compacted_through) hq = hq.gt('created_at', thread.compacted_through)
  let history = ((await hq).data ?? []).reverse() as Row[]
  const cut = compactionCut(history)
  if (cut > 0) {
    try {
      const r = await compactThread(ctx, CHAT_MODELS.flash, thread, history.slice(0, cut))
      usage = addUsage(usage, r.usage)
      remembered.push(...r.remembered)
      history = history.slice(cut)
    } catch (e) { console.error('[fn-chat] compaction failed', e) }
  }

  const mode = command === 'prioritize' ? 'prioritize' : 'normal'
  const userContent = command === 'prioritize' ? (rest || 'Help me prioritize today.') : text
  const messages: Msg[] = [
    { role: 'system', content: await buildSystemPrompt(ctx, thread, mode) },
    ...historyMessages(history),
    { role: 'user', content: userContent },
  ]

  const state: TurnState = { proposals: [], remembered: [], trace: [] }
  const started = Date.now()
  let nudged = false
  let reply = ''
  try {
    for (let round = 0; ; round++) {
      const last = round >= MAX_TOOL_ROUNDS || Date.now() - started > LOOP_BUDGET_MS
      const res = await complete(model, messages, last ? {} : { tools: TOOLS, tool_choice: 'auto' })
      console.log('[fn-chat] usage', JSON.stringify(res.usage))
      usage = addUsage(usage, res.usage)
      const msg = res.choices[0].message
      const calls = msg.tool_calls ?? []
      if (!calls.length || last) {
        reply = (msg.content ?? '').trim()
        // Guard: the model sometimes *says* it queued a change without calling a tool.
        // Nudge once so the user actually gets a confirm card.
        if (!last && !nudged && state.proposals.length === 0 && CLAIMS_ACTION.test(reply)) {
          nudged = true
          messages.push({ role: 'assistant', content: reply })
          messages.push({ role: 'user', content: '[system] Your reply claims a change but you made no tool call, so nothing was queued. Call the right write tool now (or, if no change is wanted, reply without claiming one).' })
          continue
        }
        break
      }
      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: calls })
      for (const call of calls) {
        const out = call.type === 'function'
          ? await runTool(ctx, call.function.name, call.function.arguments, state)
          : 'Unsupported tool call type.'
        messages.push({ role: 'tool', tool_call_id: call.id, content: out })
      }
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    console.error('[fn-chat] model error', m)
    return json({ error: `The model call failed: ${m.slice(0, 300)}` }, 502)
  }
  if (!reply) reply = state.proposals.length ? 'Here\'s what I\'d do — confirm below.' : 'Done.'
  remembered.push(...state.remembered)

  const cost = costUsd(model, usage)
  const rows = await saveTurn(reply, {
    tool_trace: state.trace.length ? state.trace : null,
    proposals: state.proposals.length ? state.proposals : null,
    remembered: remembered.length ? remembered : null,
    model,
    prompt_tokens: usage.prompt_tokens ?? 0,
    completion_tokens: usage.completion_tokens ?? 0,
    cost_usd: cost,
  })
  return json({ messages: rows, spent: spent + cost, budget, model })
}

async function handleApply(userId: string, body: { message_id?: string; decisions?: { proposal_id: string; accept: boolean; choice?: string }[]; tz?: string }) {
  if (!body.message_id || !Array.isArray(body.decisions)) return json({ error: 'Bad request' }, 400)
  const { data: row } = await admin.from('chat_messages').select('id,proposals').eq('id', body.message_id).eq('user_id', userId).maybeSingle()
  if (!row?.proposals) return json({ error: 'No proposals on that message' }, 404)
  const tz = typeof body.tz === 'string' ? body.tz : 'UTC'
  const ctx: Ctx = { admin, userId, today: localDate(tz), tz, idCache: {} }
  const proposals = row.proposals as Proposal[]
  for (const d of body.decisions) {
    const p = proposals.find(x => x.id === d.proposal_id)
    if (!p || p.status !== 'pending') continue // already handled — idempotent
    if (!d.accept) { p.status = 'rejected'; continue }
    try {
      p.result = await applyProposal(ctx, p, d.choice)
      if (d.choice) p.choice = d.choice
      p.status = 'applied'
    } catch (e) {
      p.status = 'failed'
      p.result = e instanceof Error ? e.message : String(e)
    }
  }
  const { data: updated, error } = await admin.from('chat_messages').update({ proposals }).eq('id', row.id).select('*').single()
  if (error) return json({ error: error.message }, 500)
  return json({ message: updated })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Unauthorized' }, 401)
  const { data: { user }, error: authError } = await admin.auth.getUser(token)
  if (authError || !user) return json({ error: 'Unauthorized' }, 401)

  const body = await req.json().catch(() => ({}))
  try {
    if (body.action === 'apply') return await handleApply(user.id, body)
    return await handleSend(user.id, body)
  } catch (e) {
    console.error('[fn-chat] unhandled', e)
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
