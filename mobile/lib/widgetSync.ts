import { Platform } from 'react-native'
import { supabase } from './supabase'
import { log, warn, error as logError } from './logger'

const APP_GROUP = 'group.com.lifeos.app'
const WIDGET_KEY = 'lifeos_widget_data'

let _prefs: any = null
function getPrefs() {
  if (Platform.OS !== 'ios') return null
  if (!_prefs) {
    try {
      _prefs = require('react-native-shared-group-preferences').default
      log('widgetSync: SharedGroupPreferences loaded ok')
    } catch (e: any) {
      logError(`widgetSync: SharedGroupPreferences require failed: ${e?.message}`)
      return null
    }
  }
  return _prefs
}

interface WidgetPayload {
  tasks: { id: string; title: string; taskType: string; dueDate: string; rolloverCount: number }[]
  token: string | null
  tokenExpiry: number | null
  supabaseUrl: string
  anonKey: string
  writtenAt: number
}

async function write(payload: WidgetPayload) {
  const prefs = getPrefs()
  if (!prefs) {
    warn('widgetSync: no prefs module — skipping write')
    return
  }
  log(`widgetSync: writing tasks=${payload.tasks.length} hasToken=${!!payload.token} group=${APP_GROUP}`)
  try {
    await prefs.setItem(WIDGET_KEY, JSON.stringify(payload), APP_GROUP)
    log('widgetSync: write ok')
    // Readback: if App Group is broken by AltStore re-signing, this returns null
    const raw = await prefs.getItem(WIDGET_KEY, APP_GROUP)
    if (raw) {
      const back = JSON.parse(raw)
      log(`widgetSync: readback ok tasks=${back?.tasks?.length ?? '?'}`)
    } else {
      logError('widgetSync: readback EMPTY — App Group not shared (AltStore group ID mismatch)')
    }
  } catch (e: any) {
    logError(`widgetSync: write failed: ${e?.message ?? e}`)
  }
}

async function readExisting(): Promise<WidgetPayload | null> {
  const prefs = getPrefs()
  if (!prefs) return null
  try {
    const raw = await prefs.getItem(WIDGET_KEY, APP_GROUP)
    if (!raw) { log('widgetSync: readExisting — nothing in group yet'); return null }
    return JSON.parse(raw)
  } catch (e: any) {
    logError(`widgetSync: readExisting failed: ${e?.message}`)
    return null
  }
}

export async function syncWidgetTasks(tasks: any[]) {
  if (Platform.OS !== 'ios') return
  log(`widgetSync: syncWidgetTasks called tasks=${tasks.length}`)
  const { data: { session } } = await supabase.auth.getSession()
  log(`widgetSync: session=${session ? 'ok' : 'null'} expires=${session?.expires_at ?? 'n/a'}`)
  await write({
    tasks: tasks.map(t => ({
      id: t.id,
      title: t.title,
      taskType: t.task_type ?? 'task',
      dueDate: t.due_date ?? '',
      rolloverCount: t.rollover_count ?? 0,
    })),
    token: session?.access_token ?? null,
    tokenExpiry: session?.expires_at ?? null,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    writtenAt: Date.now() / 1000,
  })
}

export async function syncWidgetToken(token: string | null, tokenExpiry: number | null) {
  if (Platform.OS !== 'ios') return
  log(`widgetSync: syncWidgetToken token=${token ? 'present' : 'null'}`)
  const existing = await readExisting()
  if (!existing) { warn('widgetSync: no existing data — token not synced'); return }
  await write({ ...existing, token, tokenExpiry, writtenAt: Date.now() / 1000 })
}
