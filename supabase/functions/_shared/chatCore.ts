// Pure helpers for fn-chat (no Deno / network) — unit-tested in tests/chat-core.test.mjs.

export const CHAT_MODELS = {
  flash: 'deepseek-v4-flash',
  pro: 'deepseek-v4-pro',
} as const
export type ChatModel = typeof CHAT_MODELS[keyof typeof CHAT_MODELS]

// USD per 1M tokens, DeepSeek PEAK rates (api-docs.deepseek.com/quick_start/pricing,
// checked 2026-09-24). Peak is the conservative choice for the budget cap.
export const PRICES: Record<string, { hit: number; miss: number; out: number }> = {
  'deepseek-v4-flash': { hit: 0.006, miss: 0.3, out: 1.2 },
  'deepseek-v4-pro': { hit: 0.044, miss: 1.32, out: 3.96 },
}

export interface Usage {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

export function costUsd(model: string, u: Usage): number {
  const p = PRICES[model] ?? PRICES['deepseek-v4-pro']
  const prompt = num(u.prompt_tokens)
  const hit = num(u.prompt_cache_hit_tokens)
  const miss = u.prompt_cache_miss_tokens != null ? num(u.prompt_cache_miss_tokens) : Math.max(0, prompt - hit)
  return (hit * p.hit + miss * p.miss + num(u.completion_tokens) * p.out) / 1_000_000
}

export function addUsage(a: Usage, b: Usage | undefined | null): Usage {
  if (!b) return a
  return {
    prompt_tokens: num(a.prompt_tokens) + num(b.prompt_tokens),
    completion_tokens: num(a.completion_tokens) + num(b.completion_tokens),
    prompt_cache_hit_tokens: num(a.prompt_cache_hit_tokens) + num(b.prompt_cache_hit_tokens),
    prompt_cache_miss_tokens: num(a.prompt_cache_miss_tokens) + num(b.prompt_cache_miss_tokens),
  }
}

/** Model-facing ids: first 8 hex chars of the uuid (saves tokens, still unique per user in practice). */
export function shortId(uuid: string): string {
  return uuid.slice(0, 8)
}

/** Resolve a full uuid or a unique prefix against known ids. Ambiguous/unknown → null. */
export function resolveId(ref: string | undefined | null, ids: Iterable<string>): string | null {
  if (!ref) return null
  const r = ref.trim().toLowerCase()
  if (r.length < 4) return null
  let found: string | null = null
  for (const id of ids) {
    if (id === r) return id
    if (id.startsWith(r)) {
      if (found) return null
      found = id
    }
  }
  return found
}

/** Local calendar date (YYYY-MM-DD) for an instant in an IANA time zone. */
export function localDate(tz: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}

export function localTime(tz: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(at)
  } catch {
    return at.toISOString().slice(11, 16)
  }
}

export function addDaysYmd(day: string, n: number): string {
  const d = new Date(day + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Monday (YYYY-MM-DD) of the week containing `day`. */
export function mondayOfYmd(day: string): string {
  const d = new Date(day + 'T12:00:00Z')
  return addDaysYmd(day, -((d.getUTCDay() + 6) % 7))
}

export function weekdayName(day: string): string {
  return new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
}

export const estimateTokens = (s: string) => Math.ceil(s.length / 4)

export type Command = 'prioritize' | 'model' | 'memory' | 'help' | null
export function parseCommand(text: string): { command: Command; rest: string } {
  const m = /^\/(\w+)\b\s*([\s\S]*)$/.exec(text.trim())
  if (!m) return { command: null, rest: text.trim() }
  const name = m[1].toLowerCase()
  const known: Command[] = ['prioritize', 'model', 'memory', 'help']
  if (name === 'prio' || name === 'priority') return { command: 'prioritize', rest: m[2].trim() }
  return known.includes(name as Command) ? { command: name as Command, rest: m[2].trim() } : { command: null, rest: text.trim() }
}

/**
 * Which history messages to fold into the summary so the remaining tail fits
 * `keepTokens`. Returns the count of oldest messages to compact (0 = nothing).
 */
export function compactionCut(messages: { content: string }[], triggerTokens = 12000, keepTokens = 5000): number {
  const total = messages.reduce((n, m) => n + estimateTokens(m.content), 0)
  if (total <= triggerTokens) return 0
  let tail = 0
  let i = messages.length
  while (i > 0 && tail + estimateTokens(messages[i - 1].content) <= keepTokens) {
    tail += estimateTokens(messages[i - 1].content)
    i--
  }
  return Math.max(1, i)
}

export function truncate(s: string, max = 6000): string {
  return s.length <= max ? s : s.slice(0, max) + `\n…(truncated ${s.length - max} chars)`
}

/** Offset (ms) of `tz` from UTC at instant `at` (e.g. Chicago CDT → −5h). */
function tzOffsetMs(tz: string, at: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(at)).map(p => [p.type, p.value]),
  )
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return asUtc - Math.floor(at / 1000) * 1000
}

/** Local wall time ('YYYY-MM-DD', 'HH:MM') in `tz` → UTC ISO string. */
export function zonedToUtcIso(day: string, hhmm: string, tz: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const [y, mo, d] = day.split('-').map(Number)
  const guess = Date.UTC(y, mo - 1, d, +m[1], +m[2])
  try {
    let t = guess - tzOffsetMs(tz, guess)
    t = guess - tzOffsetMs(tz, t) // second pass settles DST edges
    return new Date(t).toISOString()
  } catch {
    return new Date(guess).toISOString()
  }
}
