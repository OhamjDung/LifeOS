type LogEntry = { ts: string; msg: string; level: 'info' | 'warn' | 'error' }
type Listener = (logs: LogEntry[]) => void

const logs: LogEntry[] = []
const listeners = new Set<Listener>()

function notify() {
  const snapshot = [...logs]
  listeners.forEach(l => l(snapshot))
}

export function log(msg: string, level: LogEntry['level'] = 'info') {
  const ts = new Date().toISOString().slice(11, 23)
  logs.push({ ts, msg, level })
  if (logs.length > 200) logs.splice(0, logs.length - 200)
  notify()
  // also forward to console
  level === 'error' ? console.error(`[LOG] ${msg}`) : console.log(`[LOG] ${msg}`)
}

export function warn(msg: string) { log(msg, 'warn') }
export function error(msg: string) { log(msg, 'error') }

export function subscribe(fn: Listener) {
  listeners.add(fn)
  fn([...logs])
  return () => listeners.delete(fn)
}

export function clearLogs() {
  logs.splice(0, logs.length)
  notify()
}
