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

function chunkText(text: string): string[] {
  const MAX_CHARS = 1200 // ~300 tokens
  const OVERLAP_CHARS = 200 // ~50 tokens

  const paragraphs = text.split(/\n\n+/).filter(p => p.trim())

  if (text.length <= MAX_CHARS) return [text]

  const chunks: string[] = []
  let current = ''

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length <= MAX_CHARS) {
      current = current ? current + '\n\n' + para : para
    } else {
      if (current) chunks.push(current)
      // If paragraph itself is too long, split by sentence
      if (para.length > MAX_CHARS) {
        const sentences = para.match(/[^.!?]+[.!?]+/g) ?? [para]
        let sub = ''
        for (const s of sentences) {
          if ((sub + ' ' + s).length <= MAX_CHARS) {
            sub = sub ? sub + ' ' + s : s
          } else {
            if (sub) chunks.push(sub)
            sub = s
          }
        }
        if (sub) current = sub
      } else {
        current = para
      }
    }
  }
  if (current) chunks.push(current)

  // Add overlap between chunks
  return chunks.map((chunk, i) => {
    if (i === 0) return chunk
    const prev = chunks[i - 1]
    const overlap = prev.slice(-OVERLAP_CHARS)
    return overlap + ' ' + chunk
  })
}

async function processNote(note: { id: string; content: string; title: string | null; user_id: string; created_at: string }) {
  console.log('[embed-note] processing note:', note.id, 'title:', note.title?.slice(0, 50) ?? 'Untitled')
  await supabase
    .from('notes')
    .update({ processing_status: 'processing' })
    .eq('id', note.id)

  const chunks = chunkText(note.content)

  // Fetch nearby notes (±2 hours) and existing tags in parallel for context
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
      .order('name'),
    Promise.all(
      chunks.map(chunk =>
        openai.embeddings.create({ model: 'text-embedding-3-small', input: chunk })
          .then(r => r.data[0].embedding)
      )
    ),
  ])

  // Semantic search: find top-5 similar notes using first chunk embedding
  const { data: similarRaw } = await supabase.rpc('search_notes', {
    query_embedding: JSON.stringify(embeddings[0]),
    match_count: 8,
    p_user_id: note.user_id,
    similarity_threshold: 0.6,
  })
  const similarNotes = ((similarRaw ?? []) as Array<{ note_id: string; title: string; chunk_text: string; similarity: number }>)
    .filter(r => r.note_id !== note.id)
    .slice(0, 5)

  // Delete old chunks (handles re-edits)
  await supabase.from('note_chunks').delete().eq('note_id', note.id)

  // Insert new chunks
  await supabase.from('note_chunks').insert(
    chunks.map((chunk, i) => ({
      note_id: note.id,
      chunk_index: i,
      chunk_text: chunk,
      embedding: JSON.stringify(embeddings[i]),
    }))
  )

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

  // Categorize with GPT-4o-mini
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Title: ${note.title ?? 'Untitled'}\n\n${note.content.slice(0, 2000)}${contextBlock ? '\n\n' + contextBlock : ''}`,
      },
    ],
    response_format: { type: 'json_object' },
  })

  const { category, tags } = JSON.parse(completion.choices[0].message.content ?? '{}')
  console.log('[embed-note] note:', note.id, '→ category:', category, 'tags:', tags, 'nearby:', nearbyNotes.length, 'similar:', similarNotes.length)

  await supabase
    .from('notes')
    .update({
      category: category ?? null,
      tags: tags ?? [],
      processing_status: 'done',
    })
    .eq('id', note.id)
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  const { data: notes } = await supabase
    .from('notes')
    .select('id, content, title, user_id, created_at')
    .eq('processing_status', 'pending')
    .lt('retry_count', 3)
    .limit(10)

  if (!notes?.length) return new Response(JSON.stringify({ processed: 0 }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })

  const results = await Promise.allSettled(notes.map(processNote))

  for (let i = 0; i < notes.length; i++) {
    if (results[i].status === 'rejected') {
      await supabase.rpc('increment_note_retry', { note_id: notes[i].id })
      await supabase
        .from('notes')
        .update({
          processing_status: 'failed',
          last_error: String((results[i] as PromiseRejectedResult).reason),
        })
        .eq('id', notes[i].id)
    }
  }

  return new Response(JSON.stringify({ processed: notes.length }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
