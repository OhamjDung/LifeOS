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
  if (!res.ok || !json.data) {
    throw new Error(`Jina embeddings failed (${res.status}): ${JSON.stringify(json)}`)
  }
  return json.data.map((d: { embedding: number[] }) => d.embedding)
}

const tasksTool = {
  type: 'function' as const,
  function: {
    name: 'submit_tasks',
    description: 'Submit extracted and deduplicated tasks. Always call this — with an empty tasks array if none were found.',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['create', 'merge', 'possible_duplicate', 'delete'] },
              title: { type: 'string' },
              existing_id: { type: 'string', description: 'UUID of task to merge into or delete' },
              due_date: {
                type: 'string',
                description: 'ISO date YYYY-MM-DD this task is due. Infer from phrases like "tomorrow", "by Friday", "next week", "April 15th". If no date is implied, use today.',
              },
            },
            required: ['action', 'title'],
          },
        },
      },
      required: ['tasks'],
    },
  },
}

const contactsTool = {
  type: 'function' as const,
  function: {
    name: 'submit_contacts',
    description: 'Submit people described in the transcript — new contacts, updates to existing contacts, and interactions (met / messaged) that already happened. Only call this when the transcript describes a specific person — not for tasks or notes.',
    parameters: {
      type: 'object',
      properties: {
        contacts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Full name' },
              existing_id: { type: 'string', description: 'UUID from the existing contacts list if this person is already a contact. Omit for a new person.' },
              interaction: {
                type: 'object',
                description: 'Only if the transcript says an interaction ALREADY HAPPENED (not planned). "met", "had coffee", "caught up in person" → met; "texted", "emailed", "called", "messaged" → message_sent.',
                properties: {
                  type: { type: 'string', enum: ['met', 'message_sent'] },
                  date: { type: 'string', description: 'ISO date YYYY-MM-DD the interaction happened. Infer from "yesterday", "last Tuesday", etc. Default today.' },
                  summary: { type: 'string', description: 'One-line summary of what happened / was discussed' },
                },
                required: ['type'],
              },
              title: { type: 'string', description: 'Role/title and company, e.g. "Director of Operations, Acme Co (previously X at Y, 2020-2025)"' },
              education: { type: 'string' },
              location: { type: 'string' },
              email: { type: 'string' },
              phone: { type: 'string' },
              linkedin: { type: 'string', description: 'LinkedIn URL, or status like "connected"' },
              how_we_met: { type: 'string' },
              why_good_contact: { type: 'string', description: 'Bullet-style reasons this is a valuable contact, one per line' },
              less_useful_for: { type: 'string' },
              rating: { type: 'string', description: 'Freeform debrief/rating of the interaction, if mentioned' },
              next_step: { type: 'string' },
              contact_tier: { type: 'string', enum: ['daily', 'weekly', 'biweekly', 'monthly'], description: 'How often to stay in touch. Default weekly.' },
              relationship_tier: { type: 'string', enum: ['family', 'close_friend', 'friend', 'acquaintance'], description: 'Default friend.' },
            },
            required: ['name'],
          },
        },
      },
      required: ['contacts'],
    },
  },
}

// "Mark" ⊂ "Mark Sampelo" counts as a match; so does exact (case/punct-insensitive) equality.
function nameTokens(name: string): string[] {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
}
function namesCollide(a: string, b: string): boolean {
  const ta = nameTokens(a), tb = nameTokens(b)
  if (ta.length === 0 || tb.length === 0) return false
  const subset = (x: string[], y: string[]) => x.every(t => y.includes(t))
  return subset(ta, tb) || subset(tb, ta)
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0)
  const magA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0))
  const magB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0))
  return dot / (magA * magB)
}

interface Outcome {
  created: string[]
  merged: string[]
  duplicates: string[]
  pendingDeletions: { id: string; title: string }[]
  contactsCreated: string[]
  contactsUpdated: string[]
  interactionsLogged: { name: string; type: string; date: string }[]
  pendingContacts: PendingContact[]
  log: string[]
}

interface PendingContact {
  name: string
  fields: Record<string, string>
  interaction: { type: string; date: string; summary: string | null } | null
  matches: { id: string; name: string; title: string | null; location: string | null }[]
}

async function processJob(job: { id: string; user_id: string; raw_transcript: string; categories: string[] | null }): Promise<Outcome> {
  const log: string[] = []
  const trace = (msg: string) => { log.push(msg); console.log('[process-braindump]', msg) }

  const categories = job.categories?.length ? job.categories : ['Tasks']
  trace(`job ${job.id} — categories: ${categories.join(', ')} — transcript: "${job.raw_transcript.slice(0, 100)}${job.raw_transcript.length > 100 ? '…' : ''}"`)
  const outcome: Outcome = { created: [], merged: [], duplicates: [], pendingDeletions: [], contactsCreated: [], contactsUpdated: [], interactionsLogged: [], pendingContacts: [], log }

  try {
    await supabase
      .from('braindump_jobs')
      .update({ processing_status: 'processing' })
      .eq('id', job.id)

    const today = new Date().toISOString().split('T')[0]
    const wantsContacts = categories.includes('Contacts')

    const { data: existingTasks } = await supabase
      .from('tasks')
      .select('id, title')
      .eq('user_id', job.user_id)
      .eq('status', 'pending')

    const existingList = existingTasks ?? []
    trace(`existing pending tasks in DB: ${existingList.length}`)

    const tools = wantsContacts ? [tasksTool, contactsTool] : [tasksTool]

    let existingContacts: { id: string; name: string; title: string | null; location: string | null }[] = []
    if (wantsContacts) {
      const { data } = await supabase
        .from('contacts')
        .select('id, name, title, location')
        .eq('user_id', job.user_id)
      existingContacts = data ?? []
      trace(`existing contacts in DB: ${existingContacts.length}`)
    }

    const completion = await openai.chat.completions.create({
      model: 'deepseek-v4-flash',
      messages: [
        {
          role: 'system',
          content: `Today's date is ${today}. Extract structured data from the user's braindump transcript.

Tasks (always call submit_tasks, even with an empty array):
- If the user lists programs, companies, resources, or things to look into — generate a "Research [X]" or "Look into [X]" task for EACH item. Never skip items in a list.
- If the user writes explicit todos ("call X", "email Y") — extract those directly.
- If the user dumps reference info (links, names, notes) — turn each into a concrete follow-up task.
- Be generous: when in doubt, create the task.
- Infer due_date from relative language ("tomorrow", "by Friday", "next week", "April 15th") relative to today (${today}). Default to today if no date is implied.
- If the user explicitly asks to cancel, remove, or delete an existing task ("never mind the dentist thing", "cancel research X"), emit action "delete" with existing_id set to the matching task's id from the list below. Only do this when confident about the match.
- A transcript that is purely descriptive info about a person (contact debrief) should NOT also generate tasks about that person unless it contains an explicit follow-up action.

Existing pending tasks: ${JSON.stringify(existingList.map(t => ({ id: t.id, title: t.title })))}.
Cosine similarity thresholds: >0.85 merge, 0.65–0.85 flag as possible_duplicate, <0.65 create new.
Merge only if near-identical.
${wantsContacts ? `
Contacts (call submit_contacts): if the transcript describes a specific person the user met, contacted, or wants to remember (name + any context), extract them as a contact with whatever structured fields are present in the text (title, education, location, email, phone, linkedin, how they met, why they're a good contact, what they're less useful for, rating/debrief notes, next step). Do not fabricate fields that aren't in the transcript — leave them out.
- If the person matches one in the existing contacts list below (same person, allowing for nicknames / first-name-only), set existing_id to that contact's id and include ONLY the fields the transcript adds or changes. Do not re-send fields you can't see in the transcript.
- If the transcript says the user already met, saw, called, texted, or emailed the person (past tense — it happened), include an interaction with type, the inferred date, and a one-line summary. Planned/future contact ("should call", "will meet next week") is NOT an interaction — that belongs in next_step or a task.

Existing contacts: ${JSON.stringify(existingContacts.map(c => ({ id: c.id, name: c.name, title: c.title })))}` : ''}`,
        },
        { role: 'user', content: job.raw_transcript },
      ],
      tools,
      tool_choice: 'required',
      // deepseek-v4-flash defaults to thinking mode, which rejects forced tool_choice.
      // JS SDK forwards unknown top-level keys as-is in the request body.
      // @ts-expect-error DeepSeek-specific param not in openai SDK types
      thinking: { type: 'disabled' },
    })

    trace(`DeepSeek call finished — finish_reason: ${completion.choices[0].finish_reason}`)
    const toolCalls = completion.choices[0].message.tool_calls ?? []
    if (toolCalls.length === 0) {
      trace(`no tool call in response — model said: "${completion.choices[0].message.content ?? '(empty)'}"`)
      throw new Error('No tool call returned')
    }

    let tasks: Array<{ action: string; title: string; existing_id?: string; due_date?: string }> = []
    type Interaction = { type?: string; date?: string; summary?: string }
    let contacts: Array<Record<string, string | undefined> & { interaction?: Interaction }> = []

    for (const call of toolCalls) {
      if (call.function.name === 'submit_tasks') {
        tasks = (JSON.parse(call.function.arguments).tasks) ?? []
      } else if (call.function.name === 'submit_contacts') {
        contacts = (JSON.parse(call.function.arguments).contacts) ?? []
      }
    }

    trace(`model extracted ${tasks.length} task(s): ${JSON.stringify(tasks)}`)
    if (tasks.length === 0 && contacts.length === 0) trace('WARNING: model returned zero tasks and zero contacts — nothing will be created for this transcript')

    for (const task of tasks) {
      const dueDate = task.due_date && /^\d{4}-\d{2}-\d{2}$/.test(task.due_date) ? task.due_date : today

      if (task.action === 'create' && existingList.length > 0) {
        const allTitles = [task.title, ...existingList.map(t => t.title)]
        const allEmbeddings = await jinaEmbed(allTitles)
        const taskEmb = allEmbeddings[0]
        const existingEmbs = allEmbeddings.slice(1)
        const sims = existingList.map((t, i) => ({ ...t, sim: cosineSimilarity(taskEmb, existingEmbs[i]) }))
        const best = sims.reduce((a, b) => (a.sim > b.sim ? a : b))
        trace(`dedup check "${task.title}" → closest existing "${best.title}" sim=${best.sim.toFixed(3)}`)

        if (best.sim > 0.85) {
          task.action = 'merge'
          task.existing_id = best.id
        } else if (best.sim > 0.65) {
          task.action = 'possible_duplicate'
          task.existing_id = best.id
        }
      }

      if (task.action === 'create') {
        trace(`inserting task: "${task.title}" (due ${dueDate})`)
        const { error: insertErr } = await supabase.from('tasks').insert({
          user_id: job.user_id,
          title: task.title,
          due_date: dueDate,
          raw_source: job.raw_transcript.slice(0, 200),
        })
        if (insertErr) trace(`INSERT ERROR for "${task.title}": ${insertErr.message}`)
        else outcome.created.push(task.title)
      } else if (task.action === 'merge' && task.existing_id) {
        trace(`merged "${task.title}" into existing task ${task.existing_id}`)
        outcome.merged.push(task.title)
      } else if (task.action === 'delete' && task.existing_id) {
        const match = existingList.find(t => t.id === task.existing_id)
        if (match) {
          trace(`flagged for deletion: "${match.title}"`)
          outcome.pendingDeletions.push({ id: match.id, title: match.title })
        }
      } else if (task.action === 'possible_duplicate') {
        trace(`possible_duplicate — creating anyway: "${task.title}"`)
        const { error: insertErr } = await supabase.from('tasks').insert({
          user_id: job.user_id,
          title: task.title,
          due_date: dueDate,
          raw_source: job.raw_transcript.slice(0, 200),
        })
        if (insertErr) {
          trace(`INSERT ERROR for "${task.title}": ${insertErr.message}`)
          outcome.duplicates.push(task.title)
        } else {
          outcome.created.push(task.title)
        }
      }
    }

    if (contacts.length > 0) trace(`model extracted ${contacts.length} contact(s): ${JSON.stringify(contacts)}`)
    const existingIds = new Set(existingContacts.map(c => c.id))
    // Free-text debrief fields accumulate across dumps; everything else is overwritten by newer info.
    const APPEND_FIELDS = ['why_good_contact', 'less_useful_for', 'rating'] as const
    const OVERWRITE_FIELDS = ['title', 'education', 'location', 'email', 'phone', 'linkedin', 'next_step', 'contact_tier', 'relationship_tier'] as const

    for (const c of contacts) {
      if (!c.name) continue
      const { interaction, existing_id, ...fields } = c
      let contactId: string | null = null

      // Server-side name collision check, independent of what the model chose.
      // Only an unambiguous case (exactly one same-name row, and the model pointed at it)
      // is written automatically; anything else is handed back to the user to resolve.
      const nameMatches = existingContacts.filter(e => namesCollide(e.name, c.name!))
      const unambiguous = nameMatches.length === 0 || (nameMatches.length === 1 && existing_id === nameMatches[0].id)
      if (!unambiguous) {
        const cleanFields: Record<string, string> = {}
        for (const [k, v] of Object.entries(fields)) if (k !== 'name' && typeof v === 'string' && v) cleanFields[k] = v
        const pend: PendingContact = {
          name: c.name,
          fields: cleanFields,
          interaction: interaction?.type
            ? {
                type: interaction.type === 'message_sent' ? 'message_sent' : 'met',
                date: interaction.date && /^\d{4}-\d{2}-\d{2}$/.test(interaction.date) ? interaction.date : today,
                summary: interaction.summary ?? null,
              }
            : null,
          matches: nameMatches.map(m => ({ id: m.id, name: m.name, title: m.title, location: m.location })),
        }
        trace(`name collision for "${c.name}" — ${nameMatches.length} existing row(s) (${nameMatches.map(m => m.name).join(', ')}); model existing_id=${existing_id ?? 'none'} → pending user review`)
        outcome.pendingContacts.push(pend)
        continue
      }

      if (existing_id && existingIds.has(existing_id)) {
        const { data: current, error: fetchErr } = await supabase
          .from('contacts')
          .select('*')
          .eq('id', existing_id)
          .single()
        if (fetchErr || !current) {
          trace(`FETCH ERROR for existing contact ${existing_id}: ${fetchErr?.message}`)
          continue
        }
        const patch: Record<string, string> = {}
        for (const k of OVERWRITE_FIELDS) {
          if (fields[k]) patch[k] = fields[k]!
        }
        for (const k of APPEND_FIELDS) {
          if (fields[k]) patch[k] = current[k] ? `${current[k]}\n${fields[k]}` : fields[k]!
        }
        if (fields.how_we_met && !current.how_we_met) patch.how_we_met = fields.how_we_met
        trace(`updating contact "${current.name}" (${existing_id}) fields: ${Object.keys(patch).join(', ') || '(none)'}`)
        if (Object.keys(patch).length > 0) {
          const { error: updErr } = await supabase
            .from('contacts')
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq('id', existing_id)
          if (updErr) { trace(`UPDATE ERROR for contact "${c.name}": ${updErr.message}`); continue }
          outcome.contactsUpdated.push(current.name)
        }
        contactId = existing_id
      } else {
        if (existing_id) trace(`existing_id ${existing_id} not in user's contacts — treating "${c.name}" as new`)
        trace(`inserting contact: "${c.name}"`)
        const { data: inserted, error: insertErr } = await supabase.from('contacts').insert({
          user_id: job.user_id,
          name: c.name,
          title: c.title ?? null,
          education: c.education ?? null,
          location: c.location ?? null,
          email: c.email ?? null,
          phone: c.phone ?? null,
          linkedin: c.linkedin ?? null,
          how_we_met: c.how_we_met ?? null,
          why_good_contact: c.why_good_contact ?? null,
          less_useful_for: c.less_useful_for ?? null,
          rating: c.rating ?? null,
          next_step: c.next_step ?? null,
          contact_tier: c.contact_tier ?? 'weekly',
          relationship_tier: c.relationship_tier ?? 'friend',
        }).select('id').single()
        if (insertErr || !inserted) { trace(`INSERT ERROR for contact "${c.name}": ${insertErr?.message}`); continue }
        outcome.contactsCreated.push(c.name)
        contactId = inserted.id
      }

      if (interaction?.type && contactId) {
        const type = interaction.type === 'message_sent' ? 'message_sent' : 'met'
        const date = interaction.date && /^\d{4}-\d{2}-\d{2}$/.test(interaction.date) ? interaction.date : today
        trace(`logging interaction for "${c.name}": ${type} on ${date}`)
        // Explicit created_at so trg_last_contacted backdates last_contacted_at to the real day.
        const { error: evErr } = await supabase.from('contact_events').insert({
          user_id: job.user_id,
          contact_id: contactId,
          event_type: type,
          body: interaction.summary ?? null,
          created_at: `${date}T12:00:00Z`,
        })
        if (evErr) trace(`EVENT INSERT ERROR for "${c.name}": ${evErr.message}`)
        else outcome.interactionsLogged.push({ name: c.name, type, date })
      }
    }

    await supabase
      .from('braindump_jobs')
      .update({ processing_status: 'done', result: outcome })
      .eq('id', job.id)

    trace(`done — created ${outcome.created.length}, merged ${outcome.merged.length}, contacts +${outcome.contactsCreated.length} ~${outcome.contactsUpdated.length} ?${outcome.pendingContacts.length}, interactions ${outcome.interactionsLogged.length}`)
  } catch (e: any) {
    const msg = e?.message ?? String(e)
    trace(`JOB FAILED: ${msg}`)
    await supabase
      .from('braindump_jobs')
      .update({ processing_status: 'failed', last_error: msg, result: outcome })
      .eq('id', job.id)
    const err = new Error(msg) as Error & { log?: string[] }
    err.log = log
    throw err
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
    .select('id, user_id, raw_transcript, categories')
    .eq('processing_status', 'pending')
    .lt('retry_count', 3)
    .limit(10)

  if (!jobs?.length) return new Response(JSON.stringify({ processed: 0 }), {
    status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
  })

  const results = await Promise.allSettled(jobs.map(processJob))

  const created: string[] = []
  const merged: string[] = []
  const pendingDeletions: { id: string; title: string }[] = []
  const contactsCreated: string[] = []
  const contactsUpdated: string[] = []
  const interactionsLogged: Outcome['interactionsLogged'] = []
  const pendingContacts: (PendingContact & { jobId: string })[] = []
  const logs: string[] = []
  const errors: string[] = []
  for (let i = 0; i < jobs.length; i++) {
    const r = results[i]
    if (r.status === 'rejected') {
      const reason = r.reason as Error & { log?: string[] }
      errors.push(reason?.message ?? String(reason))
      logs.push(...(reason?.log ?? []))
      await supabase.rpc('increment_retry', { job_id: jobs[i].id })
    } else {
      const v = r.value
      created.push(...(v?.created ?? []))
      merged.push(...(v?.merged ?? []))
      pendingDeletions.push(...(v?.pendingDeletions ?? []))
      contactsCreated.push(...(v?.contactsCreated ?? []))
      contactsUpdated.push(...(v?.contactsUpdated ?? []))
      interactionsLogged.push(...(v?.interactionsLogged ?? []))
      pendingContacts.push(...(v?.pendingContacts ?? []).map(pc => ({ ...pc, jobId: jobs[i].id })))
      logs.push(...(v?.log ?? []))
    }
  }

  return new Response(JSON.stringify({ processed: jobs.length, created, merged, pendingDeletions, contactsCreated, contactsUpdated, interactionsLogged, pendingContacts, logs, errors }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
