// fn-chat tools. READ tools run immediately and return text to the model.
// WRITE tools never touch data at call time: they become Proposals the user
// confirms in the UI (spec B2 = "preview + Confirm"), applied later by applyProposal().
// `remember` is the one exception — memories auto-save (shown as chips, editable in /settings).

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import {
  addDaysYmd, localDate, localTime, mondayOfYmd, resolveId, shortId, truncate, weekdayName, zonedToUtcIso,
} from './chatCore.ts'
import { cosineSimilarity, jinaEmbed } from './embed.ts'
import { INSERT_FIELDS, mergePatch, namesCollide } from './contacts.ts'
import { getCalendarEvents } from './calendar.ts'

export interface Ctx {
  admin: SupabaseClient
  userId: string
  today: string // user's local date
  tz: string
  idCache: Partial<Record<'tasks' | 'contacts', string[]>>
}

export type ProposalStatus = 'pending' | 'applied' | 'rejected' | 'failed'
export interface Proposal {
  id: string
  tool: string
  // deno-lint-ignore no-explicit-any
  args: any
  title: string
  lines: string[]
  /** For contacts that collide with existing names: user picks one (or 'new'). */
  choices?: { id: string; label: string }[]
  choice?: string
  status: ProposalStatus
  result?: string
}

export interface TurnState {
  proposals: Proposal[]
  remembered: string[]
  trace: { name: string; args: unknown; summary: string }[]
}

const TIER_DAYS: Record<string, number> = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 }
const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const str = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)

function dueLabel(ctx: Ctx, due: string): string {
  if (due === ctx.today) return 'today'
  if (due === addDaysYmd(ctx.today, 1)) return 'tomorrow'
  const diff = Math.round((Date.parse(due) - Date.parse(ctx.today)) / 86400000)
  if (diff < 0) return `${due} (${-diff}d overdue)`
  if (diff < 7) return `${weekdayName(due).slice(0, 3)} ${due}`
  return due
}

async function ids(ctx: Ctx, table: 'tasks' | 'contacts'): Promise<string[]> {
  if (ctx.idCache[table]) return ctx.idCache[table]!
  let list: string[] = []
  if (table === 'tasks') {
    const [{ data: pending }, { data: recent }] = await Promise.all([
      ctx.admin.from('tasks').select('id').eq('user_id', ctx.userId).eq('status', 'pending').limit(1000),
      ctx.admin.from('tasks').select('id').eq('user_id', ctx.userId).neq('status', 'pending')
        .order('updated_at', { ascending: false }).limit(300),
    ])
    list = [...(pending ?? []), ...(recent ?? [])].map(r => r.id as string)
  } else {
    const { data } = await ctx.admin.from('contacts').select('id').eq('user_id', ctx.userId).limit(1000)
    list = (data ?? []).map(r => r.id as string)
  }
  ctx.idCache[table] = list
  return list
}

// ───────────────────────── tool schemas ─────────────────────────

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'function' as const,
  function: { name, description, parameters: { type: 'object', properties, required } },
})
const TASK_FIELDS = {
  title: { type: 'string' },
  due_date: { type: 'string', description: 'YYYY-MM-DD (user local). Infer from "tomorrow", "Friday", etc.' },
  task_type: { type: 'string', enum: ['task', 'event'], description: 'event = a calendar-style appointment' },
  description: { type: 'string' },
  is_priority: { type: 'boolean', description: 'star it as a priority' },
}
const CONTACT_FIELDS = {
  title: { type: 'string', description: 'Role and company' },
  education: { type: 'string' }, location: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' },
  linkedin: { type: 'string' }, how_we_met: { type: 'string' },
  why_good_contact: { type: 'string', description: 'Why this person is useful to the user, one reason per line' },
  less_useful_for: { type: 'string' }, rating: { type: 'string' }, next_step: { type: 'string' },
  category: { type: 'string', enum: ['family', 'work', 'friend', 'other'] },
  contact_tier: { type: 'string', enum: ['daily', 'weekly', 'biweekly', 'monthly'], description: 'Keep-in-touch cadence. Only for a new person or if the user states a cadence.' },
  relationship_tier: { type: 'string', enum: ['family', 'close_friend', 'friend', 'acquaintance'] },
}

export const READ_TOOLS = new Set(['list_tasks', 'get_task', 'search_notes', 'list_contacts', 'get_contact', 'get_calendar', 'get_plan', 'remember'])

export const TOOLS = [
  fn('list_tasks', 'List the user\'s tasks. The system prompt already has today/overdue — call this for other scopes or searches.', {
    scope: { type: 'string', enum: ['today', 'overdue', 'upcoming', 'all_pending', 'done_recent'], description: 'today includes overdue; upcoming = next 14 days; done_recent = completed in the last 7 days' },
    query: { type: 'string', description: 'Optional substring filter on title' },
  }, ['scope']),
  fn('get_task', 'Full details of one task: description, nested subtasks, tags, linked contact, scheduled time blocks.', { id: { type: 'string' } }, ['id']),
  fn('search_notes', 'Semantic search over the user\'s notes. Use when the user refers to something they wrote down.', { query: { type: 'string' } }, ['query']),
  fn('list_contacts', 'List contacts with cadence, category and last-contacted info.', {
    query: { type: 'string', description: 'Optional name/title substring' },
    overdue_only: { type: 'boolean' },
    category: { type: 'string', enum: ['family', 'work', 'friend', 'other'] },
  }),
  fn('get_contact', 'Full profile of one contact plus recent interactions.', { id: { type: 'string' } }, ['id']),
  fn('get_calendar', 'Google Calendar events, time blocks and LifeOS events for a local date range (max 31 days).', {
    from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD inclusive' },
  }, ['from', 'to']),
  fn('get_plan', 'The user\'s planner (read-only): year goals, month goals and weekly items for a month.', {
    month: { type: 'string', description: 'YYYY-MM, default current month' },
  }),
  fn('remember', 'Save a durable fact about the user to long-term memory (preferences, priorities, constraints, routines). Not for tasks.', {
    fact: { type: 'string', description: 'One short sentence, e.g. "Works best on deep tasks before noon"' },
  }, ['fact']),

  fn('create_tasks', 'PROPOSE new tasks (user confirms before anything is created).', {
    tasks: {
      type: 'array',
      items: { type: 'object', properties: { ...TASK_FIELDS, subtasks: { type: 'array', items: { type: 'string' } } }, required: ['title'] },
    },
  }, ['tasks']),
  fn('update_tasks', 'PROPOSE edits to existing tasks: rename, reschedule (due_date), star/unstar (is_priority), complete (status "done") or reopen, description.', {
    updates: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, ...TASK_FIELDS, status: { type: 'string', enum: ['pending', 'done'] } },
        required: ['id'],
      },
    },
  }, ['updates']),
  fn('delete_tasks', 'PROPOSE deleting tasks.', { ids: { type: 'array', items: { type: 'string' } } }, ['ids']),
  fn('add_subtasks', 'PROPOSE adding subtasks to a task.', {
    task_id: { type: 'string' }, titles: { type: 'array', items: { type: 'string' } },
  }, ['task_id', 'titles']),
  fn('upsert_contact', 'PROPOSE creating a contact or updating one (set existing_id when it is someone already in the contacts list). Include an interaction only if it ALREADY happened.', {
    existing_id: { type: 'string' },
    name: { type: 'string' },
    ...CONTACT_FIELDS,
    interaction: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['met', 'message_sent'] },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        summary: { type: 'string' },
      },
      required: ['type'],
    },
  }, ['name']),
  fn('create_note', 'PROPOSE saving a note (it will be embedded + auto-categorized).', {
    title: { type: 'string' }, content: { type: 'string' },
  }, ['content']),
  fn('schedule_block', 'PROPOSE a time block on the user\'s calendar, optionally with tasks assigned to it.', {
    date: { type: 'string', description: 'YYYY-MM-DD' },
    start: { type: 'string', description: 'HH:MM 24h local' },
    end: { type: 'string', description: 'HH:MM 24h local' },
    title: { type: 'string' },
    task_ids: { type: 'array', items: { type: 'string' } },
  }, ['date', 'start', 'end']),
]

// ───────────────────────── read tools ─────────────────────────

type TaskRow = { id: string; title: string; due_date: string; status: string; task_type: string; is_priority: boolean; rollover_count: number; group_id: string | null }

export function formatTaskLine(ctx: Ctx, t: TaskRow, groups?: Map<string, string>): string {
  const bits = [shortId(t.id), t.title, `due ${dueLabel(ctx, t.due_date)}`]
  if (t.is_priority) bits.push('★')
  if (t.rollover_count) bits.push(`↻${t.rollover_count}`)
  if (t.task_type === 'event') bits.push('event')
  if (t.status === 'done') bits.push('done')
  if (t.group_id && groups?.get(t.group_id)) bits.push(`group:${groups.get(t.group_id)}`)
  return bits.join(' | ')
}

export async function groupNames(ctx: Ctx): Promise<Map<string, string>> {
  const { data } = await ctx.admin.from('task_groups').select('id,name').eq('user_id', ctx.userId)
  return new Map((data ?? []).map(g => [g.id as string, g.name as string]))
}

async function listTasks(ctx: Ctx, a: { scope?: string; query?: string }): Promise<string> {
  let q = ctx.admin.from('tasks').select('id,title,due_date,status,task_type,is_priority,rollover_count,group_id').eq('user_id', ctx.userId)
  const scope = a.scope ?? 'today'
  if (scope === 'done_recent') {
    q = q.eq('status', 'done').gte('updated_at', new Date(Date.now() - 7 * 86400000).toISOString()).order('updated_at', { ascending: false })
  } else {
    q = q.eq('status', 'pending')
    if (scope === 'today') q = q.lte('due_date', ctx.today)
    else if (scope === 'overdue') q = q.lt('due_date', ctx.today)
    else if (scope === 'upcoming') q = q.gt('due_date', ctx.today).lte('due_date', addDaysYmd(ctx.today, 14))
    q = q.order('due_date').order('rollover_count', { ascending: false })
  }
  if (a.query) q = q.ilike('title', `%${a.query.replace(/[%_]/g, '')}%`)
  const [{ data, error }, groups] = await Promise.all([q.limit(150), groupNames(ctx)])
  if (error) return `Error: ${error.message}`
  if (!data?.length) return `No tasks for scope "${scope}"${a.query ? ` matching "${a.query}"` : ''}.`
  return `${data.length} task(s) [id | title | due | flags]:\n` + (data as TaskRow[]).map(t => formatTaskLine(ctx, t, groups)).join('\n')
}

async function getTask(ctx: Ctx, a: { id?: string }): Promise<string> {
  const id = resolveId(a.id, await ids(ctx, 'tasks'))
  if (!id) return `Unknown task id "${a.id}". Use an id from the task list.`
  const [{ data: t }, { data: subs }, { data: blocks }] = await Promise.all([
    ctx.admin.from('tasks').select('*, task_tags(tags(name)), contacts(name)').eq('id', id).eq('user_id', ctx.userId).maybeSingle(),
    ctx.admin.from('subtasks').select('id,title,status,parent_subtask_id,group_name,sort_order').eq('task_id', id).order('sort_order'),
    ctx.admin.from('time_block_tasks').select('time_blocks(start_at,end_at,title)').eq('task_id', id),
  ])
  if (!t) return 'Task not found.'
  const lines = [
    `${t.title} [${shortId(t.id)}] — ${t.status}, due ${dueLabel(ctx, t.due_date)}${t.is_priority ? ', ★ priority' : ''}${t.rollover_count ? `, rolled over ${t.rollover_count}×` : ''}${t.task_type === 'event' ? ', event' : ''}`,
  ]
  const tags = (t.task_tags ?? []).map((x: { tags: { name: string } | null }) => x.tags?.name).filter(Boolean)
  if (tags.length) lines.push(`tags: ${tags.join(', ')}`)
  if (t.contacts?.name) lines.push(`contact: ${t.contacts.name}`)
  if (t.description) lines.push(`description: ${truncate(t.description, 1500)}`)
  const byParent = new Map<string | null, typeof subs>()
  for (const s of subs ?? []) {
    const k = (s.parent_subtask_id as string | null) ?? null
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(s)
  }
  const walk = (parent: string | null, depth: number) => {
    for (const s of byParent.get(parent) ?? []) {
      lines.push(`${'  '.repeat(depth)}- [${s.status === 'done' ? 'x' : ' '}] ${s.title}${s.group_name ? ` (${s.group_name})` : ''}`)
      walk(s.id as string, depth + 1)
    }
  }
  if (subs?.length) { lines.push('subtasks:'); walk(null, 1) }
  for (const b of blocks ?? []) {
    const tb = (b as unknown as { time_blocks: { start_at: string; end_at: string; title: string | null } | null }).time_blocks
    if (tb) lines.push(`scheduled: ${localDate(ctx.tz, new Date(tb.start_at))} ${localTime(ctx.tz, new Date(tb.start_at))}–${localTime(ctx.tz, new Date(tb.end_at))}${tb.title ? ` (${tb.title})` : ''}`)
  }
  return lines.join('\n')
}

async function searchNotes(ctx: Ctx, a: { query?: string }): Promise<string> {
  if (!a.query?.trim()) return 'Missing query.'
  const [emb] = await jinaEmbed([a.query.trim()], 'retrieval.query')
  const { data, error } = await ctx.admin.rpc('search_notes', {
    query_embedding: JSON.stringify(emb), match_count: 6, p_user_id: ctx.userId, similarity_threshold: 0.45,
  })
  if (error) return `Error: ${error.message}`
  if (!data?.length) return 'No matching notes.'
  return (data as { title: string | null; chunk_text: string; similarity: number }[])
    .map(n => `• ${n.title ?? '(untitled)'} (match ${n.similarity.toFixed(2)}): ${truncate(n.chunk_text.replace(/\s+/g, ' '), 400)}`)
    .join('\n')
}

function daysSince(iso: string | null): number | null {
  return iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : null
}

export function contactOverdue(c: { contact_tier: string | null; last_contacted_at: string | null }): number | null {
  const d = daysSince(c.last_contacted_at)
  const limit = TIER_DAYS[c.contact_tier ?? 'monthly'] ?? 30
  if (d === null) return limit // never contacted: treat as due now
  return d > limit ? d - limit : null
}

async function listContacts(ctx: Ctx, a: { query?: string; overdue_only?: boolean; category?: string }): Promise<string> {
  let q = ctx.admin.from('contacts').select('id,name,title,category,contact_tier,relationship_tier,last_contacted_at,next_step').eq('user_id', ctx.userId)
  if (a.query) q = q.or(`name.ilike.%${a.query.replace(/[%_,()]/g, '')}%,title.ilike.%${a.query.replace(/[%_,()]/g, '')}%`)
  if (a.category) q = q.eq('category', a.category)
  const { data, error } = await q.order('name').limit(300)
  if (error) return `Error: ${error.message}`
  let rows = data ?? []
  if (a.overdue_only) rows = rows.filter(c => contactOverdue(c) !== null)
  if (!rows.length) return 'No contacts match.'
  return rows.slice(0, 80).map(c => {
    const d = daysSince(c.last_contacted_at)
    const od = contactOverdue(c)
    return [shortId(c.id), c.name, c.title ?? '', c.category ?? '', c.contact_tier, d === null ? 'never contacted' : `last ${d}d ago`, od !== null ? `OVERDUE${od ? ` by ${od}d` : ''}` : '', c.next_step ? `next: ${c.next_step}` : '']
      .filter(Boolean).join(' | ')
  }).join('\n') + (rows.length > 80 ? `\n…${rows.length - 80} more` : '')
}

async function getContact(ctx: Ctx, a: { id?: string }): Promise<string> {
  const id = resolveId(a.id, await ids(ctx, 'contacts'))
  if (!id) return `Unknown contact id "${a.id}".`
  const [{ data: c }, { data: ev }] = await Promise.all([
    ctx.admin.from('contacts').select('*').eq('id', id).eq('user_id', ctx.userId).maybeSingle(),
    ctx.admin.from('contact_events').select('event_type,body,created_at').eq('contact_id', id).order('created_at', { ascending: false }).limit(5),
  ])
  if (!c) return 'Contact not found.'
  const fields = ['title', 'category', 'relationship_tier', 'contact_tier', 'education', 'location', 'email', 'phone', 'linkedin', 'how_we_met', 'why_good_contact', 'less_useful_for', 'rating', 'next_step']
  const lines = [`${c.name} [${shortId(c.id)}]`, ...fields.filter(f => c[f]).map(f => `${f}: ${c[f]}`)]
  lines.push(`last contacted: ${c.last_contacted_at ? `${daysSince(c.last_contacted_at)}d ago` : 'never'}`)
  for (const e of ev ?? []) lines.push(`- ${e.created_at.slice(0, 10)} ${e.event_type}${e.body ? `: ${truncate(e.body, 200)}` : ''}`)
  return lines.join('\n')
}

export async function calendarLines(ctx: Ctx, from: string, to: string): Promise<{ configured: boolean; byDay: Map<string, string[]>; error: string | null }> {
  const byDay = new Map<string, string[]>()
  const push = (d: string, s: string) => { if (d >= from && d <= to) { if (!byDay.has(d)) byDay.set(d, []); byDay.get(d)!.push(s) } }
  const rangeStart = new Date(from + 'T00:00:00Z').getTime() - 86400000
  const rangeEnd = new Date(to + 'T00:00:00Z').getTime() + 2 * 86400000
  const [cal, { data: blocks }, { data: events }] = await Promise.all([
    getCalendarEvents(ctx.admin, ctx.userId, new Date(rangeStart), new Date(rangeEnd)),
    ctx.admin.from('time_blocks').select('start_at,end_at,title,time_block_tasks(tasks(title,status))').eq('user_id', ctx.userId)
      .gte('end_at', new Date(rangeStart).toISOString()).lt('start_at', new Date(rangeEnd).toISOString()).order('start_at'),
    ctx.admin.from('tasks').select('title,due_date,status').eq('user_id', ctx.userId).eq('task_type', 'event')
      .gte('due_date', from).lte('due_date', to).neq('status', 'rolled_over'),
  ])
  for (const e of cal.events) {
    if (e.allDay) {
      for (let d = e.start; d < e.end; d = addDaysYmd(d, 1)) push(d, `all-day: ${e.title}`)
    } else {
      const s = new Date(e.start), en = new Date(e.end)
      push(localDate(ctx.tz, s), `${localTime(ctx.tz, s)}–${localTime(ctx.tz, en)} ${e.title}${e.location ? ` @ ${e.location}` : ''}`)
    }
  }
  for (const b of blocks ?? []) {
    const s = new Date(b.start_at), en = new Date(b.end_at)
    const tasks = ((b.time_block_tasks ?? []) as unknown as { tasks: { title: string; status: string } | null }[])
      .map(x => x.tasks).filter(Boolean).map(t => `${t!.title}${t!.status === 'done' ? ' ✓' : ''}`)
    push(localDate(ctx.tz, s), `${localTime(ctx.tz, s)}–${localTime(ctx.tz, en)} [time block] ${b.title ?? ''}${tasks.length ? ` → ${tasks.join(', ')}` : ''}`.replace(/ +/g, ' '))
  }
  for (const t of events ?? []) push(t.due_date, `LifeOS event: ${t.title}${t.status === 'done' ? ' ✓' : ''}`)
  return { configured: cal.configured, byDay, error: cal.error }
}

async function getCalendar(ctx: Ctx, a: { from?: string; to?: string }): Promise<string> {
  if (!isYmd(a.from) || !isYmd(a.to) || a.to < a.from) return 'from/to must be YYYY-MM-DD with to >= from.'
  const to = a.to > addDaysYmd(a.from, 30) ? addDaysYmd(a.from, 30) : a.to
  const { configured, byDay, error } = await calendarLines(ctx, a.from, to)
  const out: string[] = []
  if (!configured) out.push('(Google Calendar not connected — only LifeOS events and time blocks shown.)')
  if (error) out.push(`(Calendar sync error: ${error}; showing cached events.)`)
  for (let d = a.from; d <= to; d = addDaysYmd(d, 1)) {
    const items = byDay.get(d)
    out.push(`${weekdayName(d).slice(0, 3)} ${d}: ${items?.length ? items.join('; ') : 'free'}`)
  }
  return out.join('\n')
}

export async function planLines(ctx: Ctx, monthKey: string, opts: { weeksOnly?: string } = {}): Promise<string> {
  const year = monthKey.slice(0, 4)
  const first = new Date(monthKey + 'T12:00:00Z')
  const mondays: string[] = []
  for (let d = new Date(first); d.getUTCMonth() === first.getUTCMonth(); d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === 1) mondays.push(d.toISOString().slice(0, 10))
  }
  const weeks = opts.weeksOnly ? [opts.weeksOnly] : mondays
  const { data } = await ctx.admin.from('plan_goals').select('id,level,title,description,category,status,period_start,period_end,parent_id,sort_order')
    .eq('user_id', ctx.userId)
    .or(`and(level.eq.year,period_start.eq.${year}-01-01),and(level.eq.month,period_start.lte.${monthKey},period_end.gte.${monthKey}),and(level.eq.week,period_start.in.(${weeks.join(',') || '1900-01-01'}))`)
    .order('sort_order')
  const goals = data ?? []
  const byId = new Map(goals.map(g => [g.id, g]))
  const st = (s: string) => (s === 'done' ? '✓done' : s === 'in_progress' ? 'in progress' : 'not started')
  const fmt = (g: typeof goals[number]) => `${g.title} [${st(g.status)}${g.category ? `, ${g.category}` : ''}]${g.description ? ` — ${truncate(g.description, 160)}` : ''}`
  const out: string[] = []
  const yearGoals = goals.filter(g => g.level === 'year')
  const monthGoals = goals.filter(g => g.level === 'month')
  const weekGoals = goals.filter(g => g.level === 'week')
  out.push(`${year} goals: ${yearGoals.length ? '' : 'none'}`)
  for (const g of yearGoals) out.push(`  • ${fmt(g)}`)
  out.push(`${monthKey.slice(0, 7)} month goals: ${monthGoals.length ? '' : 'none'}`)
  for (const g of monthGoals) {
    const n = weekGoals.filter(w => w.parent_id === g.id).length
    const parent = g.parent_id ? byId.get(g.parent_id)?.title : null
    out.push(`  • ${fmt(g)}${parent ? ` (→ ${parent})` : ''}${opts.weeksOnly ? '' : ` — ${n} weekly item(s)`}`)
  }
  for (const w of weeks) {
    const items = weekGoals.filter(g => g.period_start === w)
    out.push(`Week of ${w}: ${items.length ? '' : 'nothing planned'}`)
    for (const g of items) {
      const parent = g.parent_id ? byId.get(g.parent_id)?.title : null
      out.push(`  • ${fmt(g)}${parent ? ` (→ ${parent})` : ''}`)
    }
  }
  return out.join('\n')
}

async function remember(ctx: Ctx, a: { fact?: string }, state: TurnState): Promise<string> {
  const fact = str(a.fact, 300)
  if (!fact) return 'Nothing to remember.'
  const { data: existing } = await ctx.admin.from('chat_memories').select('content').eq('user_id', ctx.userId)
  if ((existing ?? []).some(m => (m.content as string).toLowerCase() === fact.toLowerCase())) return 'Already remembered.'
  const { error } = await ctx.admin.from('chat_memories').insert({ user_id: ctx.userId, content: fact, source: 'auto' })
  if (error) return `Error: ${error.message}`
  state.remembered.push(fact)
  return 'Saved to memory.'
}

// ───────────────────────── write tools → proposals ─────────────────────────

type Prepared = Omit<Proposal, 'id' | 'status'> | { error: string }

async function prepareCreateTasks(ctx: Ctx, a: { tasks?: unknown[] }): Promise<Prepared> {
  const tasks = (Array.isArray(a.tasks) ? a.tasks : []).slice(0, 25).map(raw => {
    const t = raw as Record<string, unknown>
    return {
      title: str(t.title, 300),
      due_date: isYmd(t.due_date) ? t.due_date : ctx.today,
      task_type: t.task_type === 'event' ? 'event' : 'task',
      description: str(t.description, 4000),
      is_priority: t.is_priority === true,
      subtasks: (Array.isArray(t.subtasks) ? t.subtasks : []).map(s => str(s, 300)).filter(Boolean) as string[],
    }
  }).filter(t => t.title) as { title: string; due_date: string; task_type: string; description?: string; is_priority: boolean; subtasks: string[] }[]
  if (!tasks.length) return { error: 'No valid tasks (each needs a title).' }

  // Near-duplicate warning against pending tasks (one Jina call). Best effort.
  const warnings = new Map<number, string>()
  try {
    const { data: existing } = await ctx.admin.from('tasks').select('title').eq('user_id', ctx.userId).eq('status', 'pending')
      .order('created_at', { ascending: false }).limit(200)
    const titles = (existing ?? []).map(e => e.title as string)
    if (titles.length) {
      const embs = await jinaEmbed([...tasks.map(t => t.title), ...titles])
      tasks.forEach((_, i) => {
        let best = -1, bestIdx = -1
        titles.forEach((__, j) => {
          const s = cosineSimilarity(embs[i], embs[tasks.length + j])
          if (s > best) { best = s; bestIdx = j }
        })
        if (best > 0.85) warnings.set(i, titles[bestIdx])
      })
    }
  } catch { /* dedup is advisory only */ }

  return {
    tool: 'create_tasks',
    args: { tasks },
    title: `Create ${tasks.length} task${tasks.length === 1 ? '' : 's'}`,
    lines: tasks.map((t, i) =>
      `＋ ${t.title} — ${dueLabel(ctx, t.due_date)}${t.is_priority ? ' ★' : ''}${t.task_type === 'event' ? ' (event)' : ''}` +
      `${t.subtasks.length ? ` · ${t.subtasks.length} subtasks` : ''}${warnings.has(i) ? ` · ⚠ very similar to “${warnings.get(i)}”` : ''}`),
  }
}

async function prepareUpdateTasks(ctx: Ctx, a: { updates?: unknown[] }): Promise<Prepared> {
  const known = await ids(ctx, 'tasks')
  const updates: { id: string; patch: Record<string, unknown> }[] = []
  for (const raw of (Array.isArray(a.updates) ? a.updates : []).slice(0, 50)) {
    const u = raw as Record<string, unknown>
    const id = resolveId(u.id as string, known)
    if (!id) return { error: `Unknown task id "${u.id}". Use ids from the task list.` }
    const patch: Record<string, unknown> = {}
    if (str(u.title)) patch.title = str(u.title, 300)
    if (isYmd(u.due_date)) patch.due_date = u.due_date
    if (typeof u.is_priority === 'boolean') patch.is_priority = u.is_priority
    if (u.status === 'done' || u.status === 'pending') patch.status = u.status
    if (typeof u.description === 'string') patch.description = u.description.slice(0, 4000) || null
    if (u.task_type === 'task' || u.task_type === 'event') patch.task_type = u.task_type
    if (Object.keys(patch).length) updates.push({ id, patch })
  }
  if (!updates.length) return { error: 'No valid changes.' }
  const { data: rows } = await ctx.admin.from('tasks').select('id,title').in('id', updates.map(u => u.id)).eq('user_id', ctx.userId)
  const title = new Map((rows ?? []).map(r => [r.id, r.title]))
  const describe = (p: Record<string, unknown>) => [
    p.status === 'done' ? 'mark done' : p.status === 'pending' ? 'reopen' : '',
    p.due_date ? `due → ${dueLabel(ctx, p.due_date as string)}` : '',
    p.is_priority === true ? '★ on' : p.is_priority === false ? '★ off' : '',
    p.title ? `rename → “${p.title}”` : '',
    'description' in p ? 'edit description' : '',
    p.task_type ? `type → ${p.task_type}` : '',
  ].filter(Boolean).join(', ')
  const allDone = updates.every(u => u.patch.status === 'done' && Object.keys(u.patch).length === 1)
  return {
    tool: 'update_tasks',
    args: { updates },
    title: allDone ? `Complete ${updates.length} task${updates.length === 1 ? '' : 's'}` : `Update ${updates.length} task${updates.length === 1 ? '' : 's'}`,
    lines: updates.map(u => `✎ ${title.get(u.id) ?? u.id}: ${describe(u.patch)}`),
  }
}

async function prepareDeleteTasks(ctx: Ctx, a: { ids?: unknown[] }): Promise<Prepared> {
  const known = await ids(ctx, 'tasks')
  const list: string[] = []
  for (const r of (Array.isArray(a.ids) ? a.ids : []).slice(0, 50)) {
    const id = resolveId(r as string, known)
    if (!id) return { error: `Unknown task id "${r}".` }
    list.push(id)
  }
  if (!list.length) return { error: 'No ids.' }
  const { data: rows } = await ctx.admin.from('tasks').select('id,title').in('id', list).eq('user_id', ctx.userId)
  return {
    tool: 'delete_tasks',
    args: { ids: list },
    title: `Delete ${list.length} task${list.length === 1 ? '' : 's'}`,
    lines: (rows ?? []).map(r => `✕ ${r.title}`),
  }
}

async function prepareAddSubtasks(ctx: Ctx, a: { task_id?: string; titles?: unknown[] }): Promise<Prepared> {
  const id = resolveId(a.task_id, await ids(ctx, 'tasks'))
  if (!id) return { error: `Unknown task id "${a.task_id}".` }
  const titles = (Array.isArray(a.titles) ? a.titles : []).map(t => str(t, 300)).filter(Boolean).slice(0, 30) as string[]
  if (!titles.length) return { error: 'No subtask titles.' }
  const { data: t } = await ctx.admin.from('tasks').select('title').eq('id', id).maybeSingle()
  return {
    tool: 'add_subtasks',
    args: { task_id: id, titles },
    title: `Add ${titles.length} subtask${titles.length === 1 ? '' : 's'} to “${t?.title ?? 'task'}”`,
    lines: titles.map(s => `  ◦ ${s}`),
  }
}

async function prepareUpsertContact(ctx: Ctx, a: Record<string, unknown>): Promise<Prepared> {
  const name = str(a.name, 200)
  if (!name) return { error: 'Contact needs a name.' }
  const fields: Record<string, string> = {}
  for (const k of [...INSERT_FIELDS, 'contact_tier', 'relationship_tier'] as const) {
    const v = str(a[k], 2000)
    if (v) fields[k] = v
  }
  const it = a.interaction as Record<string, unknown> | undefined
  const interaction = it?.type
    ? { type: it.type === 'message_sent' ? 'message_sent' : 'met', date: isYmd(it.date) ? it.date : ctx.today, summary: str(it.summary, 1000) ?? null }
    : null
  const { data: all } = await ctx.admin.from('contacts').select('id,name,title').eq('user_id', ctx.userId)
  const contacts = all ?? []
  const explicit = resolveId(a.existing_id as string, contacts.map(c => c.id as string))
  const matches = explicit ? [] : contacts.filter(c => namesCollide(c.name as string, name))
  const target = explicit ?? (matches.length === 0 ? 'new' : undefined)
  const targetRow = explicit ? contacts.find(c => c.id === explicit) : null

  const lines = Object.entries(fields).map(([k, v]) => `  ${k.replace(/_/g, ' ')}: ${truncate(v, 160)}`)
  if (interaction) lines.push(`  log: ${interaction.type === 'met' ? 'met' : 'messaged'} on ${interaction.date}${interaction.summary ? ` — ${interaction.summary}` : ''}`)
  return {
    tool: 'upsert_contact',
    args: { name, fields, interaction },
    title: targetRow ? `Update contact ${targetRow.name}` : matches.length ? `Contact “${name}” — which person?` : `New contact ${name}`,
    lines: lines.length ? lines : ['  (no new details)'],
    ...(target ? { choice: target } : {
      choices: [
        ...matches.map(m => {
          const t = ((m.title as string | null) ?? '').split(/\r?\n/)[0].trim()
          return { id: m.id as string, label: `Update ${m.name}${t ? ` (${t.length > 60 ? t.slice(0, 57) + '…' : t})` : ''}` }
        }),
        { id: 'new', label: `Create new “${name}”` },
      ],
    }),
  }
}

function prepareCreateNote(_ctx: Ctx, a: { title?: string; content?: string }): Prepared {
  const content = str(a.content, 20000)
  if (!content) return { error: 'Note needs content.' }
  const title = str(a.title, 200) ?? null
  return {
    tool: 'create_note',
    args: { title, content },
    title: `Save note${title ? ` “${title}”` : ''}`,
    lines: [truncate(content, 300)],
  }
}

async function prepareScheduleBlock(ctx: Ctx, a: Record<string, unknown>): Promise<Prepared> {
  if (!isYmd(a.date)) return { error: 'date must be YYYY-MM-DD.' }
  const start = zonedToUtcIso(a.date, String(a.start ?? ''), ctx.tz)
  const end = zonedToUtcIso(a.date, String(a.end ?? ''), ctx.tz)
  if (!start || !end || end <= start) return { error: 'start/end must be HH:MM with end after start.' }
  const known = await ids(ctx, 'tasks')
  const taskIds: string[] = []
  for (const r of (Array.isArray(a.task_ids) ? a.task_ids : []).slice(0, 10)) {
    const id = resolveId(r as string, known)
    if (!id) return { error: `Unknown task id "${r}".` }
    taskIds.push(id)
  }
  const { data: rows } = taskIds.length ? await ctx.admin.from('tasks').select('id,title').in('id', taskIds) : { data: [] }
  const title = str(a.title, 200) ?? null
  return {
    tool: 'schedule_block',
    args: { start_at: start, end_at: end, title, task_ids: taskIds },
    title: `Block ${weekdayName(a.date).slice(0, 3)} ${localTime(ctx.tz, new Date(start))}–${localTime(ctx.tz, new Date(end))}${title ? ` · ${title}` : ''}`,
    lines: (rows ?? []).map(r => `  ☐ ${r.title}`),
  }
}

// ───────────────────────── dispatch ─────────────────────────

export async function runTool(ctx: Ctx, name: string, rawArgs: string, state: TurnState): Promise<string> {
  // deno-lint-ignore no-explicit-any
  let a: any
  try { a = rawArgs ? JSON.parse(rawArgs) : {} } catch { return 'Invalid JSON arguments.' }
  let out: string
  try {
    if (READ_TOOLS.has(name)) {
      out = name === 'list_tasks' ? await listTasks(ctx, a)
        : name === 'get_task' ? await getTask(ctx, a)
        : name === 'search_notes' ? await searchNotes(ctx, a)
        : name === 'list_contacts' ? await listContacts(ctx, a)
        : name === 'get_contact' ? await getContact(ctx, a)
        : name === 'get_calendar' ? await getCalendar(ctx, a)
        : name === 'get_plan' ? await planLines(ctx, (typeof a.month === 'string' && /^\d{4}-\d{2}$/.test(a.month) ? a.month : ctx.today.slice(0, 7)) + '-01')
        : await remember(ctx, a, state)
      state.trace.push({ name, args: a, summary: truncate(out, 200) })
      return truncate(out)
    }
    const prepared: Prepared | null =
      name === 'create_tasks' ? await prepareCreateTasks(ctx, a)
      : name === 'update_tasks' ? await prepareUpdateTasks(ctx, a)
      : name === 'delete_tasks' ? await prepareDeleteTasks(ctx, a)
      : name === 'add_subtasks' ? await prepareAddSubtasks(ctx, a)
      : name === 'upsert_contact' ? await prepareUpsertContact(ctx, a)
      : name === 'create_note' ? prepareCreateNote(ctx, a)
      : name === 'schedule_block' ? await prepareScheduleBlock(ctx, a)
      : null
    if (!prepared) return `Unknown tool ${name}.`
    if ('error' in prepared) {
      state.trace.push({ name, args: a, summary: `error: ${prepared.error}` })
      return `Could not propose: ${prepared.error}`
    }
    const p: Proposal = { ...prepared, id: `p${state.proposals.length + 1}`, status: 'pending' }
    state.proposals.push(p)
    state.trace.push({ name, args: a, summary: `proposed ${p.id}: ${p.title}` })
    return `Queued as ${p.id} ("${p.title}") — NOT applied yet. The user will see a confirm card with these lines:\n${p.lines.join('\n')}\n` +
      (p.choices ? 'The name matches existing contacts; the card asks the user which one. Mention that briefly.' : 'Refer to it briefly; do not repeat every line.')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    state.trace.push({ name, args: a, summary: `error: ${msg}` })
    return `Tool error: ${msg}`
  }
}

// ───────────────────────── apply (after user confirms) ─────────────────────────

export async function applyProposal(ctx: Ctx, p: Proposal, choice?: string): Promise<string> {
  const { admin, userId } = ctx
  const now = new Date().toISOString()
  switch (p.tool) {
    case 'create_tasks': {
      let n = 0
      for (const t of p.args.tasks as { title: string; due_date: string; task_type: string; description?: string; is_priority: boolean; subtasks: string[] }[]) {
        const { data, error } = await admin.from('tasks').insert({
          user_id: userId, title: t.title, due_date: t.due_date, task_type: t.task_type,
          description: t.description ?? null, is_priority: t.is_priority, raw_source: 'chat',
        }).select('id').single()
        if (error || !data) throw new Error(error?.message ?? 'insert failed')
        if (t.subtasks.length) {
          const { error: sErr } = await admin.from('subtasks').insert(
            t.subtasks.map((s, i) => ({ user_id: userId, task_id: data.id, title: s, sort_order: i, status: 'pending' })))
          if (sErr) throw new Error(sErr.message)
        }
        n++
      }
      return `Created ${n} task${n === 1 ? '' : 's'}`
    }
    case 'update_tasks': {
      const updates = p.args.updates as { id: string; patch: Record<string, unknown> }[]
      const { data: rows } = await admin.from('tasks').select('id').in('id', updates.map(u => u.id)).eq('user_id', userId)
      const alive = new Set((rows ?? []).map(r => r.id))
      let n = 0
      for (const u of updates) {
        if (!alive.has(u.id)) continue // deleted since the proposal — skip quietly
        const { error } = await admin.from('tasks').update({ ...u.patch, updated_at: now }).eq('id', u.id).eq('user_id', userId)
        if (error) throw new Error(error.message)
        n++
      }
      const gone = updates.length - n
      return `Updated ${n} task${n === 1 ? '' : 's'}${gone ? ` (${gone} no longer exist)` : ''}`
    }
    case 'delete_tasks': {
      const { data, error } = await admin.from('tasks').delete().in('id', p.args.ids).eq('user_id', userId).select('id')
      if (error) throw new Error(error.message)
      return `Deleted ${data?.length ?? 0} task${data?.length === 1 ? '' : 's'}`
    }
    case 'add_subtasks': {
      const { data: t } = await admin.from('tasks').select('id').eq('id', p.args.task_id).eq('user_id', userId).maybeSingle()
      if (!t) throw new Error('That task no longer exists')
      const { data: last } = await admin.from('subtasks').select('sort_order').eq('task_id', t.id).order('sort_order', { ascending: false }).limit(1)
      const base = ((last?.[0]?.sort_order as number | undefined) ?? -1) + 1
      const { error } = await admin.from('subtasks').insert(
        (p.args.titles as string[]).map((s, i) => ({ user_id: userId, task_id: t.id, title: s, sort_order: base + i, status: 'pending' })))
      if (error) throw new Error(error.message)
      return `Added ${p.args.titles.length} subtask${p.args.titles.length === 1 ? '' : 's'}`
    }
    case 'upsert_contact': {
      const target = choice ?? p.choice
      if (!target) throw new Error('Pick which contact this is')
      if (p.choices && !p.choices.some(c => c.id === target)) throw new Error('Invalid choice')
      const { name, fields, interaction } = p.args as { name: string; fields: Record<string, string>; interaction: { type: string; date: string; summary: string | null } | null }
      let contactId: string
      let verb: string
      if (target === 'new') {
        const row: Record<string, unknown> = { user_id: userId, name, contact_tier: fields.contact_tier ?? 'monthly', relationship_tier: fields.relationship_tier ?? 'acquaintance' }
        for (const k of INSERT_FIELDS) row[k] = fields[k] ?? null
        const { data, error } = await admin.from('contacts').insert(row).select('id').single()
        if (error || !data) throw new Error(error?.message ?? 'insert failed')
        contactId = data.id
        verb = `Added ${name}`
      } else {
        const { data: current } = await admin.from('contacts').select('*').eq('id', target).eq('user_id', userId).maybeSingle()
        if (!current) throw new Error('That contact no longer exists')
        const patch = mergePatch(current, fields)
        if (Object.keys(patch).length) {
          const { error } = await admin.from('contacts').update({ ...patch, updated_at: now }).eq('id', target)
          if (error) throw new Error(error.message)
        }
        contactId = target
        verb = `Updated ${current.name}`
      }
      if (interaction) {
        // Explicit created_at so trg_last_contacted backdates last_contacted_at to the real day.
        const { error } = await admin.from('contact_events').insert({
          user_id: userId, contact_id: contactId, event_type: interaction.type, body: interaction.summary, created_at: `${interaction.date}T12:00:00Z`,
        })
        if (error) throw new Error(error.message)
        verb += ` · logged ${interaction.type === 'met' ? 'meeting' : 'message'}`
      }
      return verb
    }
    case 'create_note': {
      const { error } = await admin.from('notes').insert({
        user_id: userId, title: p.args.title, content: p.args.content, source_platform: 'web', processing_status: 'pending',
      })
      if (error) throw new Error(error.message)
      return 'Note saved'
    }
    case 'schedule_block': {
      const { data, error } = await admin.from('time_blocks').insert({
        user_id: userId, start_at: p.args.start_at, end_at: p.args.end_at, title: p.args.title,
      }).select('id').single()
      if (error || !data) throw new Error(error?.message ?? 'insert failed')
      if (p.args.task_ids.length) {
        const { data: alive } = await admin.from('tasks').select('id').in('id', p.args.task_ids).eq('user_id', userId)
        if (alive?.length) {
          const { error: lErr } = await admin.from('time_block_tasks').insert(alive.map(t => ({ block_id: data.id, task_id: t.id, user_id: userId })))
          if (lErr) throw new Error(lErr.message)
        }
      }
      return 'Time block added'
    }
  }
  throw new Error(`Unknown proposal type ${p.tool}`)
}
