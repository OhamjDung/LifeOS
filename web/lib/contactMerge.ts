import { SupabaseClient } from '@supabase/supabase-js'
import { PendingContact } from './types'

// Mirrors the merge policy in supabase/functions/fn-process-braindump/index.ts.
// Free-text debrief fields accumulate; everything else is overwritten by newer info.
const APPEND_FIELDS = ['why_good_contact', 'less_useful_for', 'rating'] as const
const OVERWRITE_FIELDS = ['title', 'education', 'location', 'email', 'phone', 'linkedin', 'next_step', 'contact_tier', 'relationship_tier'] as const

export async function applyPendingContact(
  supabase: SupabaseClient,
  userId: string,
  pc: PendingContact,
  target: string | 'new',
): Promise<{ contactId: string; created: boolean }> {
  let contactId: string
  let created = false

  if (target === 'new') {
    const f = pc.fields
    const { data, error } = await supabase.from('contacts').insert({
      user_id: userId,
      name: pc.name,
      title: f.title ?? null,
      education: f.education ?? null,
      location: f.location ?? null,
      email: f.email ?? null,
      phone: f.phone ?? null,
      linkedin: f.linkedin ?? null,
      how_we_met: f.how_we_met ?? null,
      why_good_contact: f.why_good_contact ?? null,
      less_useful_for: f.less_useful_for ?? null,
      rating: f.rating ?? null,
      next_step: f.next_step ?? null,
      contact_tier: f.contact_tier ?? 'weekly',
      relationship_tier: f.relationship_tier ?? 'friend',
    }).select('id').single()
    if (error || !data) throw new Error(error?.message ?? 'insert failed')
    contactId = data.id
    created = true
  } else {
    const { data: current, error: fetchErr } = await supabase
      .from('contacts').select('*').eq('id', target).single()
    if (fetchErr || !current) throw new Error(fetchErr?.message ?? 'contact not found')
    const patch: Record<string, string> = {}
    for (const k of OVERWRITE_FIELDS) if (pc.fields[k]) patch[k] = pc.fields[k]
    for (const k of APPEND_FIELDS) if (pc.fields[k]) patch[k] = current[k] ? `${current[k]}\n${pc.fields[k]}` : pc.fields[k]
    if (pc.fields.how_we_met && !current.how_we_met) patch.how_we_met = pc.fields.how_we_met
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase
        .from('contacts')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', target)
      if (error) throw new Error(error.message)
    }
    contactId = target
  }

  if (pc.interaction) {
    // Explicit created_at so trg_last_contacted backdates last_contacted_at to the real day.
    const { error } = await supabase.from('contact_events').insert({
      user_id: userId,
      contact_id: contactId,
      event_type: pc.interaction.type,
      body: pc.interaction.summary,
      created_at: `${pc.interaction.date}T12:00:00Z`,
    })
    if (error) throw new Error(error.message)
  }

  return { contactId, created }
}
