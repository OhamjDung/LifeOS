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

async function processNote(note: { id: string; content: string; title: string | null }) {
  await supabase
    .from('notes')
    .update({ processing_status: 'processing' })
    .eq('id', note.id)

  const chunks = chunkText(note.content)

  // Embed all chunks in parallel
  const embeddings = await Promise.all(
    chunks.map(chunk =>
      openai.embeddings.create({ model: 'text-embedding-3-small', input: chunk })
        .then(r => r.data[0].embedding)
    )
  )

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

  // Categorize with GPT-4o-mini
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'Categorize this note and return JSON: { "category": string, "tags": string[] }. Category: one of [Work, Personal, Learning, Health, Finance, Ideas, Reference, Other]. Tags: 3-5 lowercase keywords.',
      },
      {
        role: 'user',
        content: `Title: ${note.title ?? 'Untitled'}\n\n${note.content.slice(0, 2000)}`,
      },
    ],
    response_format: { type: 'json_object' },
  })

  const { category, tags } = JSON.parse(completion.choices[0].message.content ?? '{}')

  await supabase
    .from('notes')
    .update({
      category: category ?? null,
      tags: tags ?? [],
      processing_status: 'done',
    })
    .eq('id', note.id)
}

Deno.serve(async () => {
  const { data: notes } = await supabase
    .from('notes')
    .select('id, content, title')
    .eq('processing_status', 'pending')
    .lt('retry_count', 3)
    .limit(10)

  if (!notes?.length) return new Response('no notes', { status: 200 })

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
    headers: { 'Content-Type': 'application/json' },
  })
})
