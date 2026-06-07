import { createClient } from 'jsr:@supabase/supabase-js@2'
import OpenAI from 'npm:openai'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const openai = new OpenAI({
  baseURL: 'https://models.inference.ai.azure.com',
  apiKey: Deno.env.get('GITHUB_TOKEN')!,
})

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401 })

  // Verify user via JWT
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return new Response('Unauthorized', { status: 401 })

  const { query, limit = 10 } = await req.json() as { query: string; limit?: number }
  if (!query?.trim()) return new Response('Missing query', { status: 400 })

  const embRes = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query.trim(),
  })
  const embedding = embRes.data[0].embedding

  const { data: results, error } = await supabase.rpc('search_notes', {
    query_embedding: JSON.stringify(embedding),
    match_count: limit,
    p_user_id: user.id,
    similarity_threshold: 0.5,
  })

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
