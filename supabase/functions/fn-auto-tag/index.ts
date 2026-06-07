import { createClient } from 'jsr:@supabase/supabase-js@2'
import OpenAI from 'npm:openai'

const openai = new OpenAI({
  baseURL: 'https://models.inference.ai.azure.com',
  apiKey: Deno.env.get('GITHUB_TOKEN'),
})

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401 })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { task_id, title } = await req.json()
  if (!task_id || !title) return new Response('Bad request', { status: 400 })

  const { data: tags } = await supabase
    .from('tags').select('id, name').eq('user_id', user.id)

  if (!tags || tags.length === 0) {
    return new Response(JSON.stringify({ tag: null }), { status: 200 })
  }

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a task tagger. Given a task title, pick the single most relevant tag from the list. Return ONLY the tag name, nothing else, no punctuation.',
      },
      {
        role: 'user',
        content: `Tags: ${tags.map(t => t.name).join(', ')}\n\nTask: "${title}"`,
      },
    ],
    max_tokens: 20,
    temperature: 0,
  })

  const picked = completion.choices[0].message.content?.trim().toLowerCase()
  const matched = tags.find(t => t.name.toLowerCase() === picked)

  if (matched) {
    await supabase.from('task_tags').upsert({ task_id, tag_id: matched.id })
  }

  return new Response(JSON.stringify({ tag: matched?.name ?? null }), { status: 200 })
})
