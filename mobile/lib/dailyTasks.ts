import * as SecureStore from 'expo-secure-store'
import { supabase } from './supabase'
import { CONTACT_TIER_DAYS, ContactTier } from './types'

const DAILY_KEY = 'lifeos_daily_run'
const todayStr = () => new Date().toISOString().split('T')[0]

async function syncCatchupTasks() {
  const today = todayStr()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name, contact_tier, last_contacted_at')

  if (!contacts) return

  for (const contact of contacts) {
    const tierDays = CONTACT_TIER_DAYS[(contact.contact_tier || 'weekly') as ContactTier]
    const days = contact.last_contacted_at
      ? Math.floor((Date.now() - new Date(contact.last_contacted_at).getTime()) / 86400000)
      : tierDays + 1

    if (days < tierDays) continue

    const urgent = days >= tierDays * 1.5
    const baseName = `Catching up with ${contact.name}`
    const title = urgent ? `[!] ${baseName}` : baseName

    const { data: existing } = await supabase
      .from('tasks')
      .select('id, title')
      .eq('user_id', user.id)
      .eq('due_date', today)
      .ilike('title', `%${baseName}%`)
      .neq('status', 'done')
      .limit(1)

    if (!existing || existing.length === 0) {
      await supabase.from('tasks').insert({
        title, due_date: today, task_type: 'task',
        user_id: user.id, contact_id: contact.id,
      })
    } else if (urgent && existing[0] && !existing[0].title.startsWith('[!]')) {
      await supabase.from('tasks').update({ title }).eq('id', existing[0].id)
    }
  }
}

export async function runDailyTasksIfNeeded() {
  const today = todayStr()
  try {
    const lastRun = await SecureStore.getItemAsync(DAILY_KEY)
    if (lastRun === today) return
    await syncCatchupTasks()
    await SecureStore.setItemAsync(DAILY_KEY, today)
  } catch {}
}
