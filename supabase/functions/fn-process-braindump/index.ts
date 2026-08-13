import { createClient } from 'jsr:@supabase/supabase-js@2'
import OpenAI from 'npm:openai'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: Deno.env.get('DEEPSEEK_TOKEN')!,
})

async function jinaEmbed(inputs: string[]): Promise<number[][]> {
  const res = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('JINA_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'jina-embeddings-v3', input: inputs, task: 'retrieval.passage', dimensions: 1024 }),
  })
  const json = await res.json()
  return json.data.map((d: { embedding: number[] }) => d.embedding)
}

const extractionTool = {
  type: 'function' as const,
  function: {
    name: 'submit_tasks',
    description: 'Submit extracted and deduplicated tasks',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['create', 'merge', 'possible_duplicate'] },
              title: { type: 'string' },
              existing_id: { type: 'string', description: 'UUID of task to merge into' },
            },
            required: ['action', 'title'],
          },
        },
      },
      required: ['tasks'],
    },
  },
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0)
  const magA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0))
  const magB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0))
  return dot / (magA * magB)
}

async function processJob(job: { id: string; user_id: string; raw_transcript: string }): Promise<{
  created: string[]; merged: string[]; duplicates: string[]
}> {
  console.log('[process-braindump] job:', job.id, 'transcript:', job.raw_transcript.slice(0, 100))
  const outcome = { created: [] as string[], merged: [] as string[], duplicates: [] as string[] }

  try {
    await supabase
      .from('braindump_jobs')
      .update({ processing_status: 'processing' })
      .eq('id', job.id)

    const today = new Date().toISOString().split('T')[0]

    const { data: existingTasks } = await supabase
      .from('tasks')
      .select('id, title')
      .eq('user_id', job.user_id)
      .eq('due_date', today)
      .eq('status', 'pending')

    const existingList = existingTasks ?? []
    console.log('[process-braindump] existing tasks:', existingList.length)

    const completion = await openai.chat.completions.create({
      model: 'deepseek-v4-flash',
      messages: [
        {
          role: 'system',
          content: `Extract actionable tasks from the user's braindump transcript.

Rules:
- If the user lists programs, companies, resources, or things to look into — generate a "Research [X]" or "Look into [X]" task for EACH item. Never skip items in a list.
- If the user writes explicit todos ("call X", "email Y") — extract those directly.
- If the user dumps reference info (links, names, notes) — turn each into a concrete follow-up task.
- Be generous: when in doubt, create the task.

Existing tasks today: ${JSON.stringify(existingList.map(t => ({ id: t.id, title: t.title })))}.
Cosine similarity thresholds: >0.85 merge, 0.65–0.85 flag as possible_duplicate, <0.65 create new.
Merge only if near-identical.`,
        },
        { role: 'user', content: job.raw_transcript },
      ],
      tools: [extractionTool],
      tool_choice: { type: 'function', function: { name: 'submit_tasks' } },
    })

    const toolCall = completion.choices[0].message.tool_calls?.[0]
    if (!toolCall) throw new Error('No tool call returned')

    const { tasks } = JSON.parse(toolCall.function.arguments) as {
      tasks: Array<{ action: string; title: string; existing_id?: string }>
    }
    console.log('[process-braindump] extracted tasks:', JSON.stringify(tasks))

    for (const task of tasks) {
      if (task.action === 'create' && existingList.length > 0) {
        const allTitles = [task.title, ...existingList.map(t => t.title)]
        const allEmbeddings = await jinaEmbed(allTitles)
        const taskEmb = allEmbeddings[0]
        const existingEmbs = allEmbeddings.slice(1)
        const sims = existingList.map((t, i) => ({ ...t, sim: cosineSimilarity(taskEmb, existingEmbs[i]) }))
        const best = sims.reduce((a, b) => (a.sim > b.sim ? a : b))
        console.log('[process-braindump] dedup:', task.title, '→ best match:', best.title, 'sim:', best.sim.toFixed(3))

        if (best.sim > 0.85) {
          task.action = 'merge'
          task.existing_id = best.id
        } else if (best.sim > 0.65) {
          task.action = 'possible_duplicate'
          task.existing_id = best.id
        }
      }

      if (task.action === 'create') {
        console.log('[process-braindump] inserting task:', task.title)
        const { error: insertErr } = await supabase.from('tasks').insert({
          user_id: job.user_id,
          title: task.title,
          due_date: today,
          raw_source: job.raw_transcript.slice(0, 200),
        })
        if (insertErr) console.error('[process-braindump] insert error:', insertErr.message)
        else outcome.created.push(task.title)
      } else if (task.action === 'merge' && task.existing_id) {
        console.log('[process-braindump] merged into existing:', task.existing_id)
        outcome.merged.push(task.title)
      } else if (task.action === 'possible_duplicate') {
        console.log('[process-braindump] possible_duplicate — creating anyway:', task.title)
        const { error: insertErr } = await supabase.from('tasks').insert({
          user_id: job.user_id,
          title: task.title,
          due_date: today,
          raw_source: job.raw_transcript.slice(0, 200),
        })
        if (insertErr) {
          console.error('[process-braindump] insert error:', insertErr.message)
          outcome.duplicates.push(task.title)
        } else {
          outcome.created.push(task.title)
        }
      }
    }

    await supabase
      .from('braindump_jobs')
      .update({ processing_status: 'done' })
      .eq('id', job.id)

    console.log('[process-braindump] done. created:', outcome.created.length, 'merged:', outcome.merged.length)
  } catch (e: any) {
    const msg = e?.message ?? String(e)
    console.error('[process-braindump] job failed:', job.id, msg)
    await supabase
      .from('braindump_jobs')
      .update({ processing_status: 'failed', last_error: msg })
      .eq('id', job.id)
    throw e
  }

  return outcome
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  const { data: jobs } = await supabase
    .from('braindump_jobs')
    .select('id, user_id, raw_transcript')
    .eq('processing_status', 'pending')
    .lt('retry_count', 3)
    .limit(10)

  if (!jobs?.length) return new Response(JSON.stringify({ processed: 0 }), {
    status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
  })

  const results = await Promise.allSettled(jobs.map(processJob))

  const created: string[] = []
  const merged: string[] = []
  for (let i = 0; i < jobs.length; i++) {
    if (results[i].status === 'rejected') {
      await supabase.rpc('increment_retry', { job_id: jobs[i].id })
    } else if (results[i].status === 'fulfilled') {
      const v = (results[i] as PromiseFulfilledResult<any>).value
      created.push(...(v?.created ?? []))
      merged.push(...(v?.merged ?? []))
    }
  }

  return new Response(JSON.stringify({ processed: jobs.length, created, merged }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
