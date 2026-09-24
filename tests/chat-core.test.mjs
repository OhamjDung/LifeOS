import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from '../web/node_modules/typescript/lib/typescript.js'

async function load(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}
const c = await load('../supabase/functions/_shared/chatCore.ts')
const k = await load('../supabase/functions/_shared/contacts.ts')

test('cost uses cache hit/miss split and falls back to prompt − hit', () => {
  const u = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, prompt_cache_hit_tokens: 0 }
  assert.equal(c.costUsd('deepseek-v4-flash', u).toFixed(3), '1.500')
  assert.equal(c.costUsd('deepseek-v4-flash', { prompt_tokens: 100, prompt_cache_hit_tokens: 100, prompt_cache_miss_tokens: 0 }), 100 * 0.006 / 1e6)
})
test('short ids resolve by unique prefix only', () => {
  const ids = ['abcd1234-0000', 'abcd9999-0000', 'ffff0000-1111']
  assert.equal(c.resolveId('ffff0000', ids), 'ffff0000-1111')
  assert.equal(c.resolveId('abcd', ids), null) // ambiguous
  assert.equal(c.resolveId('abcd1234-0000', ids), 'abcd1234-0000')
  assert.equal(c.resolveId('zzz', ids), null)
})
test('local dates respect the time zone', () => {
  const at = new Date('2026-09-24T03:30:00Z') // 22:30 on the 23rd in Chicago
  assert.equal(c.localDate('America/Chicago', at), '2026-09-23')
  assert.equal(c.localDate('Not/AZone', at), '2026-09-24')
  assert.equal(c.mondayOfYmd('2026-09-27'), '2026-09-21')
  assert.equal(c.addDaysYmd('2026-12-31', 1), '2027-01-01')
})
test('commands parse, unknown slash text stays a message', () => {
  assert.deepEqual(c.parseCommand('/prioritize today only'), { command: 'prioritize', rest: 'today only' })
  assert.deepEqual(c.parseCommand('/model pro'), { command: 'model', rest: 'pro' })
  assert.equal(c.parseCommand('/usr/bin is a path').command, null)
  assert.equal(c.parseCommand('hello').command, null)
})
test('compaction keeps a recent tail under budget', () => {
  const msgs = Array.from({ length: 20 }, () => ({ content: 'x'.repeat(4000) })) // 1000 tok each
  assert.equal(c.compactionCut(msgs.slice(0, 5)), 0)
  assert.equal(c.compactionCut(msgs), 15)
})
test('contact merge overwrites, appends debrief fields, keeps how_we_met', () => {
  const patch = k.mergePatch({ why_good_contact: 'old', how_we_met: 'gym' }, { title: 'CTO', why_good_contact: 'new', how_we_met: 'x', category: 'work' })
  assert.deepEqual(patch, { title: 'CTO', category: 'work', why_good_contact: 'old\nnew' })
  assert.ok(k.namesCollide('Mark', 'Mark Deniel Sampelo'))
  assert.ok(!k.namesCollide('Mark', 'Marko'))
})
test('local wall time converts to UTC across DST', () => {
  assert.equal(c.zonedToUtcIso('2026-09-24', '15:00', 'America/Chicago'), '2026-09-24T20:00:00.000Z')
  assert.equal(c.zonedToUtcIso('2026-12-01', '09:30', 'America/Chicago'), '2026-12-01T15:30:00.000Z')
  assert.equal(c.zonedToUtcIso('2026-12-01', '9pm', 'America/Chicago'), null)
})
