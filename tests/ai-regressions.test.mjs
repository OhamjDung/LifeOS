import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from '../web/node_modules/typescript/lib/typescript.js'

async function load(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}
const { chunkText } = await load('../supabase/functions/_shared/noteText.ts')
const { normalizeGroups } = await load('../supabase/functions/_shared/taskGrouping.ts')

test('long unbroken notes retain every character with bounded embedding inputs', () => {
  const text = 'x'.repeat(5000) + 'An unfinished sentence without punctuation'
  const chunks = chunkText(text)
  assert.ok(chunks.every(chunk => chunk.length <= 1200))
  assert.equal(chunks[0] + chunks.slice(1).map(chunk => chunk.slice(200)).join(''), text)
  assert.equal(chunkText('short note')[0], 'short note')
})
test('invalid, duplicate and fabricated assignments cannot corrupt grouping', () => {
  const tasks = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, title: id }))
  const result = normalizeGroups({ groups: [null, { name: 'Valid', color: 'unknown', task_ids: ['a', 'a', 'b', 'fake'] },
    { name: 'Second', color: 'rose', task_ids: ['b', 'c', 'd'] }, { name: 'Singleton', task_ids: ['e'] }] }, tasks)
  assert.deepEqual(result, { groups: [
    { name: 'Valid', color: 'indigo', task_ids: ['a', 'b'] },
    { name: 'Second', color: 'rose', task_ids: ['c', 'd'] },
  ], ungrouped_ids: ['e'] })
  assert.deepEqual(normalizeGroups(null, tasks).ungrouped_ids, tasks.map(t => t.id))
})
test('group count is bounded without losing tasks', () => {
  const tasks = Array.from({ length: 20 }, (_, i) => ({ id: String(i), title: String(i) }))
  const groups = Array.from({ length: 10 }, (_, i) => ({ name: 'Group', task_ids: [String(i * 2), String(i * 2 + 1)] }))
  const result = normalizeGroups({ groups }, tasks)
  assert.equal(result.groups.length, 6)
  assert.equal(result.ungrouped_ids.length, 8)
})
const { remainingSeconds, resumedStartedAt } = await load('../web/lib/sessionTimer.ts')
test('resuming a paused timer preserves elapsed time across reloads', () => {
  const session = { phase: 'work', work_minutes: 25, break_minutes: 5, phase_started_at: null, phase_remaining_seconds: 600 }
  const now = new Date('2026-09-17T12:00:00Z')
  const resumed = { ...session, phase_started_at: resumedStartedAt(session, now), phase_remaining_seconds: null }
  assert.equal(remainingSeconds(resumed, now), 600)
  assert.equal(remainingSeconds(resumed, new Date(now.getTime() + 60000)), 540)
})
