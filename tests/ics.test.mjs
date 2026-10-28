import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from '../web/node_modules/typescript/lib/typescript.js'
import ICAL from '../web/node_modules/ical.js/dist/ical.js'

const source = readFileSync(new URL('../supabase/functions/_shared/ics.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const { expandIcs, mergeFeeds, feedLabel } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const text = readFileSync(new URL('./fixtures/calendar.ics', import.meta.url), 'utf8')
const events = expandIcs(ICAL, text, new Date('2026-10-19T00:00:00Z'), new Date('2026-11-30T00:00:00Z'))
const standups = events.filter(e => e.uid === 'weekly-standup')

test('recurring event honours EXDATE, overrides and cancellations', () => {
  assert.deepEqual(standups.map(e => e.start), [
    '2026-10-21T14:00:00.000Z',          // CDT 09:00
    // Oct 28 EXDATE'd
    '2026-11-04T15:00:00.000Z',          // CST 09:00 — DST ended Nov 1
    '2026-11-11T20:00:00.000Z',          // override moved to 14:00 CST
    // Nov 18 cancelled
    '2026-11-25T15:00:00.000Z',
  ])
  assert.equal(standups[2].title, 'Standup (moved)')
})
test('all-day events keep plain dates with exclusive end', () => {
  const h = events.find(e => e.uid === 'holiday')
  assert.deepEqual([h.allDay, h.start, h.end], [true, '2026-11-23', '2026-11-25'])
})
test('old daily series still reaches the window; cancelled singles are dropped', () => {
  const j = events.filter(e => e.uid === 'old-daily')
  assert.equal(j[0].start, '2026-10-19T03:00:00.000Z')
  assert.equal(j.length, 42)
  assert.ok(!events.some(e => e.uid === 'gone'))
})
test('mergeFeeds tags src, drops the same invite seen in two calendars, sorts', () => {
  const ev = (uid, start) => ({ uid, title: uid, start, end: start, allDay: false, location: null })
  const merged = mergeFeeds([
    { src: 'a', events: [ev('x', '2026-10-21T15:00:00.000Z'), ev('shared', '2026-10-20T15:00:00.000Z')] },
    { src: 'b', events: [ev('shared', '2026-10-20T15:00:00.000Z'), ev('shared', '2026-10-27T15:00:00.000Z')] },
  ])
  assert.deepEqual(merged.map(e => `${e.uid}@${e.start.slice(5, 10)}:${e.src}`), ['shared@10-20:a', 'x@10-21:a', 'shared@10-27:b'])
})
test('feedLabel shows the calendar id, never the secret token', () => {
  assert.equal(feedLabel('https://calendar.google.com/calendar/ical/tom.pham.data%40gmail.com/private-abc123/basic.ics'), 'tom.pham.data@gmail.com')
  assert.equal(feedLabel('webcal://example.com/feed.ics'), 'example.com')
})
