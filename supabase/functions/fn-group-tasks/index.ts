import { normalizeGroups } from '../_shared/taskGrouping.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import OpenAI from 'npm:openai'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return new Response('Unauthorized', { status: 401, headers: cors })

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors })
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  })
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) return new Response('Unauthorized', { status: 401, headers: cors })

  let tasks: { id: string; title: string }[]
  try {
    const body = await req.json()
    if (!Array.isArray(body.tasks) || body.tasks.length > 200 || body.tasks.some((t: { id?: unknown; title?: unknown }) =>
      !t || typeof t.id !== 'string' || typeof t.title !== 'string' || t.title.length > 1000)) {
      throw new Error('Invalid task list')
    }
    tasks = [...new Map<string, { id: string; title: string }>(body.tasks.map((t: { id: string; title: string }) => [t.id, t])).values()]
  } catch {
    return new Response('Bad request', { status: 400, headers: cors })
  }

  if (tasks.length < 3) {
    return new Response(
      JSON.stringify({ groups: [], ungrouped_ids: tasks.map(t => t.id) }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  }

  const openai = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: Deno.env.get('DEEPSEEK_TOKEN')!,
    timeout: 45000,
    maxRetries: 1,
  })

  try {
    const completion = await openai.chat.completions.create({
      model: 'deepseek-v4-flash',
      // @ts-expect-error DeepSeek extension forwarded by the OpenAI SDK
      thinking: { type: 'disabled' },
      messages: [
        {
          role: 'system',
          content: `Group the tasks into logical themes. Return valid JSON only — no markdown, no explanation.
Format: {"groups":[{"name":"Group Name","color":"indigo","task_ids":["id1","id2"]}],"ungrouped_ids":["id3"]}
Rules:
- Max 6 groups. Group name: 1-3 words (e.g. "Research", "Career", "Health", "Admin", "Learning")
- Each task belongs to exactly one group OR ungrouped_ids — never both, never neither
- Colors (use distinct colors per group): indigo, orange, green, yellow, rose, cyan, purple
- Minimum 2 tasks per group; if only 1 task would be in a group, move it to ungrouped_ids
- If all tasks are similar, one group is fine`,
        },
        {
          role: 'user',
          content: JSON.stringify(tasks.map(t => ({ id: t.id, title: t.title }))),
        },
      ],
      response_format: { type: 'json_object' },
    })

    const raw = JSON.parse(completion.choices[0]?.message.content ?? '{}')
    const result = normalizeGroups(raw, tasks)

    return new Response(JSON.stringify(result), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    console.error('[fn-group-tasks] error:', e?.message ?? e)
    return new Response(
      JSON.stringify({ error: e?.message ?? 'AI call failed' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  }
})
