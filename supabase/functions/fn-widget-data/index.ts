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

  const url = new URL(req.url)
  const widgetId = url.searchParams.get('widget_id')
  if (!widgetId) {
    return new Response(JSON.stringify({ error: 'missing widget_id' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const { data: reg } = await supabase
    .from('widget_registrations')
    .select('user_id')
    .eq('widget_id', widgetId)
    .single()

  if (!reg) {
    return new Response(JSON.stringify({ registered: false, tasks: [] }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const today = new Date().toISOString().split('T')[0]
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, task_type, due_date, rollover_count, status')
    .eq('user_id', reg.user_id)
    .eq('due_date', today)
    .neq('status', 'rolled_over')
    .order('rollover_count', { ascending: false })

  return new Response(JSON.stringify({ registered: true, tasks: tasks ?? [] }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
