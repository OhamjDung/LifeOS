import { Platform } from 'react-native'
import { supabase } from './supabase'

const APP_GROUP = 'group.com.lifeos.app'
const WIDGET_KEY = 'lifeos_widget_data'

let _prefs: any = null
function getPrefs() {
  if (Platform.OS !== 'ios') return null
  if (!_prefs) {
    try { _prefs = require('react-native-shared-group-preferences').default } catch { return null }
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
  if (!prefs) return
  try {
    await prefs.setItem(WIDGET_KEY, JSON.stringify(payload), APP_GROUP)
  } catch (e) {
    console.warn('[widget] write failed:', e)
  }
}

async function readExisting(): Promise<WidgetPayload | null> {
  const prefs = getPrefs()
  if (!prefs) return null
  try {
    const raw = await prefs.getItem(WIDGET_KEY, APP_GROUP)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export async function syncWidgetTasks(tasks: any[]) {
  if (Platform.OS !== 'ios') return
  const { data: { session } } = await supabase.auth.getSession()
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
  const existing = await readExisting()
  if (!existing) return
  await write({ ...existing, token, tokenExpiry, writtenAt: Date.now() / 1000 })
}
