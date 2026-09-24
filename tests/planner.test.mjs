import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from '../web/node_modules/typescript/lib/typescript.js'

const source = readFileSync(new URL('../web/lib/planDates.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const p = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

test('a week belongs to the month its Monday is in', () => {
  // Sep 2026: Mondays 7,14,21,28. Sep 28 – Oct 4 belongs to September.
  assert.deepEqual(p.weeksOfMonth('2026-09-01'), ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'])
  assert.deepEqual(p.weeksOfMonth('2026-10-01'), ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
  assert.equal(p.monthOfWeek('2026-09-28'), '2026-09-01')
})
test('mondayOf handles Sunday and month edges', () => {
  assert.equal(p.mondayOf(new Date(2026, 9, 4)), '2026-09-28') // Sun Oct 4
  assert.equal(p.mondayOf(new Date(2026, 8, 28)), '2026-09-28') // Mon itself
})
test('month math crosses years and preserves spans', () => {
  assert.equal(p.addMonths('2026-11-01', 3), '2027-02-01')
  assert.equal(p.addMonths('2026-01-01', -1), '2025-12-01')
  assert.equal(p.monthDiff('2026-10-01', '2027-01-01'), 3)
  assert.ok(p.coversMonth({ period_start: '2026-10-01', period_end: '2026-12-01' }, '2026-11-01'))
  assert.ok(!p.coversMonth({ period_start: '2026-10-01', period_end: '2026-12-01' }, '2027-01-01'))
})
