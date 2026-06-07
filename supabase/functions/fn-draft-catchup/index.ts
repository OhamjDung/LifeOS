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

const TIER_TONE: Record<string, string> = {
  family: 'warm, loving, casual',
  close_friend: 'casual, funny, genuine',
  friend: 'friendly, light, genuine',
  acquaintance: 'polite, warm, brief',
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401 })

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return new Response('Unauthorized', { status: 401 })

  const { contact_id, life_update_text } = await req.json() as {
    contact_id: string
    life_update_text?: string
  }

  const [{ data: contact }, { data: events }] = await Promise.all([
    supabase.from('contacts').select('name, relationship_tier, how_we_met').eq('id', contact_id).single(),
    supabase
      .from('contact_events')
      .select('event_type, body, created_at')
      .eq('contact_id', contact_id)
      .order('created_at', { ascending: false })
      .limit(3),
  ])

  if (!contact) return new Response('Contact not found', { status: 404 })

  const tone = TIER_TONE[contact.relationship_tier] ?? 'warm, friendly'
  const recentContext = events?.map(e => `${e.event_type}: ${e.body ?? ''}`).join('; ') ?? 'none'

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Draft a ${tone} catch-up message. 1-2 sentences max. No subject line. Just the message body.`,
      },
      {
        role: 'user',
        content: `To: ${contact.name}${life_update_text ? `\nUpdate to mention: ${life_update_text}` : ''}\nRecent context: ${recentContext}`,
      },
    ],
    max_tokens: 100,
  })

  const draft = completion.choices[0].message.content?.trim() ?? ''

  return new Response(JSON.stringify({ draft }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
