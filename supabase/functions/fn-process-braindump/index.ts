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

async function embedText(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })
  return res.data[0].embedding
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0)
  const magA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0))
  const magB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0))
  return dot / (magA * magB)
}

async function processJob(job: { id: string; user_id: string; raw_transcript: string }) {
  await supabase
    .from('braindump_jobs')
    .update({ processing_status: 'processing' })
    .eq('id', job.id)

  const today = new Date().toISOString().split('T')[0]

  // Fetch today's existing tasks for dedup
  const { data: existingTasks } = await supabase
    .from('tasks')
    .select('id, title')
    .eq('user_id', job.user_id)
    .eq('due_date', today)
    .eq('status', 'pending')

  const existingList = existingTasks ?? []

  // Extract tasks via GPT-4o
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Extract actionable tasks from the user's braindump transcript.
Compare against existing tasks.
Existing tasks today: ${JSON.stringify(existingList.map(t => ({ id: t.id, title: t.title })))}.
Use cosine similarity thresholds: >0.85 merge, 0.65-0.85 flag as possible_duplicate, <0.65 create new.
Be conservative with merges — only merge if near-identical.`,
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

  // Embed extracted tasks and run cosine dedup
  for (const task of tasks) {
    if (task.action === 'create' && existingList.length > 0) {
      const taskEmb = await embedText(task.title)
      const existingEmbs = await Promise.all(existingList.map(t => embedText(t.title)))
      const sims = existingList.map((t, i) => ({ ...t, sim: cosineSimilarity(taskEmb, existingEmbs[i]) }))
      const best = sims.reduce((a, b) => (a.sim > b.sim ? a : b))

      if (best.sim > 0.85) {
        task.action = 'merge'
        task.existing_id = best.id
      } else if (best.sim > 0.65) {
        task.action = 'possible_duplicate'
        task.existing_id = best.id
      }
    }

    if (task.action === 'create') {
      await supabase.from('tasks').insert({
        user_id: job.user_id,
        title: task.title,
        due_date: today,
        raw_source: job.raw_transcript.slice(0, 200),
      })
    } else if (task.action === 'merge' && task.existing_id) {
      await supabase
        .from('tasks')
        .update({ ai_merged_from: task.existing_id })
        .eq('id', task.existing_id)
    }
    // possible_duplicate: leave for user to resolve (future Layer 2 nudge)
  }

  await supabase
    .from('braindump_jobs')
    .update({ processing_status: 'done' })
    .eq('id', job.id)
}

Deno.serve(async () => {
  const { data: jobs } = await supabase
    .from('braindump_jobs')
    .select('id, user_id, raw_transcript')
    .eq('processing_status', 'pending')
    .lt('retry_count', 3)
    .limit(10)

  if (!jobs?.length) return new Response('no jobs', { status: 200 })

  const results = await Promise.allSettled(jobs.map(processJob))

  for (let i = 0; i < jobs.length; i++) {
    if (results[i].status === 'rejected') {
      await supabase
        .from('braindump_jobs')
        .update({
          processing_status: 'failed',
          last_error: String((results[i] as PromiseRejectedResult).reason),
          retry_count: supabase.rpc('increment', { row_id: jobs[i].id }),
        })
        .eq('id', jobs[i].id)

      // Increment retry_count separately
      await supabase.rpc('increment_retry', { job_id: jobs[i].id })
    }
  }

  return new Response(JSON.stringify({ processed: jobs.length }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
