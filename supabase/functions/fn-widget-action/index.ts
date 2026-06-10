import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const json = await req.json().catch(() => null)
  const { widget_id, task_id, action } = json ?? {}

  if (!widget_id || !task_id || !action) {
    return new Response(JSON.stringify({ error: 'missing fields' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // widget_id is the auth credential — validate it
  const { data: reg } = await supabase
    .from('widget_registrations')
    .select('user_id')
    .eq('widget_id', widget_id)
    .single()

  if (!reg) {
    return new Response(JSON.stringify({ error: 'not registered' }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // Verify task belongs to this user before mutating
  const { data: task } = await supabase
    .from('tasks')
    .select('id, due_date, status')
    .eq('id', task_id)
    .eq('user_id', reg.user_id)
    .single()

  if (!task) {
    return new Response(JSON.stringify({ error: 'task not found' }), {
      status: 404, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const now = new Date().toISOString()

  if (action === 'complete') {
    const next = task.status === 'done' ? 'pending' : 'done'
    await supabase.from('tasks').update({ status: next, updated_at: now }).eq('id', task_id)
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  if (action === 'rollover') {
    const from = task.due_date
    const d = new Date(from); d.setDate(d.getDate() + 1)
    const to = d.toISOString().split('T')[0]
    await supabase.from('tasks').update({ due_date: to, status: 'rolled_over', updated_at: now }).eq('id', task_id)
    await supabase.from('task_rollovers').insert({ task_id, from_date: from, to_date: to })
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ error: 'unknown action' }), {
    status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
