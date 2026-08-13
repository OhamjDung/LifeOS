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

  let tasks: { id: string; title: string }[]
  try {
    const body = await req.json()
    tasks = body.tasks ?? []
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
  })

  try {
    const completion = await openai.chat.completions.create({
      model: 'deepseek-v4-flash',
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

    let result: { groups: unknown[]; ungrouped_ids: unknown[] }
    try {
      result = JSON.parse(completion.choices[0].message.content!)
    } catch {
      result = { groups: [], ungrouped_ids: tasks.map(t => t.id) }
    }

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
