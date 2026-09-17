import { chunkText } from '../_shared/noteText.ts'
import { resolveCaller } from '../_shared/auth.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import OpenAI from 'npm:openai'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: Deno.env.get('DEEPSEEK_TOKEN')!,
  timeout: 45000,
  maxRetries: 1,
})

async function jinaEmbed(inputs: string[], task: 'retrieval.passage' | 'retrieval.query' = 'retrieval.passage'): Promise<number[][]> {
  const res = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: {
      'Authorization': `Bearer ${Deno.env.get('JINA_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'jina-embeddings-v3', input: inputs, task, dimensions: 1024 }),
  })
  if (!res.ok) throw new Error(`Embedding request failed (${res.status})`)
  const json = await res.json()
  if (!Array.isArray(json.data) || json.data.length !== inputs.length) throw new Error('Invalid embeddings')
  return json.data.map((d: { embedding: number[] }) => d.embedding)
}

async function processNote(note: { id: string; content: string; title: string | null; user_id: string; created_at: string; updated_at: string; retry_count: number; category: string | null; tags: string[]; category_locked: boolean }) {
  console.log('[embed-note] processing note:', note.id, 'title:', note.title?.slice(0, 50) ?? 'Untitled')
  const claimTime = new Date().toISOString()
  const { data: claimed, error: claimError } = await supabase.from('notes')
    .update({ processing_status: 'processing', updated_at: claimTime })
    .eq('id', note.id).eq('updated_at', note.updated_at).select('id').maybeSingle()
  if (claimError) throw claimError
  if (!claimed) return
  // Keep the claimed version for guarded success and failure writes.
  note.updated_at = claimTime

  const chunks = chunkText(note.content)

  const windowStart = new Date(new Date(note.created_at).getTime() - 2 * 60 * 60 * 1000).toISOString()
  const windowEnd = new Date(new Date(note.created_at).getTime() + 2 * 60 * 60 * 1000).toISOString()

  const [nearbyResult, tagsResult, embeddings] = await Promise.all([
    supabase
      .from('notes')
      .select('title, content, created_at')
      .eq('user_id', note.user_id)
      .neq('id', note.id)
      .gte('created_at', windowStart)
      .lte('created_at', windowEnd)
      .order('created_at', { ascending: true })
      .limit(6),
    supabase
      .from('tags')
      .select('name')
      .eq('user_id', note.user_id)
      .order('name').limit(100),
    jinaEmbed(chunks),
  ])

  const { data: similarRaw } = await supabase.rpc('search_notes', {
    query_embedding: JSON.stringify(embeddings[0]),
    match_count: 8,
    p_user_id: note.user_id,
    similarity_threshold: 0.6,
  })
  const similarNotes = ((similarRaw ?? []) as Array<{ note_id: string; title: string; chunk_text: string; similarity: number }>)
    .filter(r => r.note_id !== note.id)
    .slice(0, 5)

  const nearbyNotes = nearbyResult.data ?? []
  const existingTags = (tagsResult.data ?? []).map(t => t.name)

  const contextBlock = [
    nearbyNotes.length > 0
      ? `NOTES WRITTEN AROUND THE SAME TIME (treat as related session context):\n` +
        nearbyNotes.map(n => `- ${n.title ?? 'Untitled'}: ${n.content.slice(0, 200)}`).join('\n')
      : '',
    similarNotes.length > 0
      ? `SEMANTICALLY SIMILAR NOTES FROM YOUR HISTORY (use for consistent tagging/category):\n` +
        similarNotes.map(r => `- ${r.title ?? 'Untitled'} (similarity ${r.similarity.toFixed(2)}): ${r.chunk_text.slice(0, 200)}`).join('\n')
      : '',
  ].filter(Boolean).join('\n\n')

  const tagsBlock = existingTags.length > 0
    ? `\n\nEXISTING TAGS (prefer these over inventing new ones): ${existingTags.join(', ')}`
    : ''

  const systemPrompt = `Categorize this note and return JSON: { "category": string, "tags": string[] }.
Category: one of [Work, Personal, Learning, Health, Finance, Ideas, Reference, Other].
Tags: 2-4 lowercase keywords. STRONGLY prefer tags from the existing tags list. Only add a new tag if none of the existing ones fit.${tagsBlock}`

  let category = note.category
  let tags = note.tags ?? []
  if (!note.category_locked) {
  const completion = await openai.chat.completions.create({
    model: 'deepseek-v4-flash',
    // @ts-expect-error DeepSeek extension forwarded by the OpenAI SDK
    thinking: { type: 'disabled' },
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Title: ${note.title ?? 'Untitled'}\n\n${note.content.slice(0, 2000)}${contextBlock ? '\n\n' + contextBlock : ''}`,
      },
    ],
    response_format: { type: 'json_object' },
  })

  const parsed = JSON.parse(completion.choices[0]?.message.content ?? '{}')
  const categories = ['Work', 'Personal', 'Learning', 'Health', 'Finance', 'Ideas', 'Reference', 'Other']
  if (!parsed || !categories.includes(parsed.category) || !Array.isArray(parsed.tags)) throw new Error('Invalid categorization')
  category = parsed.category
  tags = [...new Set<string>(parsed.tags.filter((tag: unknown) => typeof tag === 'string' && tag.trim()).map((tag: string) => tag.trim().toLowerCase().slice(0, 50)))].slice(0, 4)
  }
  console.log('[embed-note] note:', note.id, '→ category:', category, 'tags:', tags)

  const { error: updateError } = await supabase.rpc('finish_note_processing', {
    p_note_id: note.id, p_claim_time: claimTime, p_category: category, p_tags: tags,
    p_chunks: chunks.map((chunk, i) => ({ chunk_index: i, chunk_text: chunk, embedding: JSON.stringify(embeddings[i]) })),
  })
  if (updateError) throw updateError
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors })
  // pg_cron (service key) drains everyone's queue; a signed-in user only drains their own.
  const caller = await resolveCaller(req, supabase)
  if (!caller) return new Response('Unauthorized', { status: 401, headers: cors })
  const userId = caller.kind === 'user' ? caller.userId : null

  const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  let query = supabase
    .from('notes')
    .select('id, content, title, user_id, created_at, updated_at, retry_count, category, tags, category_locked')
    .or(`processing_status.eq.pending,and(processing_status.eq.processing,updated_at.lt.${staleBefore})`)
    .lt('retry_count', 3)
    .limit(10)
  if (userId) query = query.eq('user_id', userId)
  const { data: notes, error: queryError } = await query
  if (queryError) return new Response('Unable to load queue', { status: 500, headers: cors })

  if (!notes?.length) return new Response(JSON.stringify({ processed: 0 }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })

  // Sequential on purpose: Jina's free tier 429s when ~10 embed calls land at once.
  const results: PromiseSettledResult<void>[] = []
  for (const note of notes) {
    try { results.push({ status: 'fulfilled', value: await processNote(note) }) }
    catch (reason) { results.push({ status: 'rejected', reason }) }
  }

  for (let i = 0; i < notes.length; i++) {
    if (results[i].status === 'rejected') {
      await supabase
        .from('notes')
        .update({
          processing_status: notes[i].retry_count + 1 < 3 ? 'pending' : 'failed',
          retry_count: notes[i].retry_count + 1,
          last_error: String((results[i] as PromiseRejectedResult).reason),
        })
        .eq('id', notes[i].id).eq('updated_at', notes[i].updated_at).eq('processing_status', 'processing')
    }
  }

  return new Response(JSON.stringify({ processed: notes.length }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
