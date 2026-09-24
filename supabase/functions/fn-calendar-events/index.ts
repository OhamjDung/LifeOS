import { createClient } from 'jsr:@supabase/supabase-js@2'
import { getCalendarEvents } from '../_shared/calendar.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// POST {from, to, refresh?} → { configured, events, fetched_at, stale, error }
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Unauthorized' }, 401)
  const { data: { user }, error: authError } = await admin.auth.getUser(token)
  if (authError || !user) return json({ error: 'Unauthorized' }, 401)

  const body = await req.json().catch(() => ({})) as { from?: string; to?: string; refresh?: boolean }
  const from = new Date(body.from ?? '')
  const to = new Date(body.to ?? '')
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to <= from) return json({ error: 'Invalid range' }, 400)
  if (to.getTime() - from.getTime() > 400 * 86400000) return json({ error: 'Range too large' }, 400)

  return json(await getCalendarEvents(admin, user.id, from, to, !!body.refresh))
})
