// Contact matching + merge policy, shared by fn-process-braindump and fn-chat.
// web/lib/contactMerge.ts mirrors mergePatch() for client-side resolution.

// "Mark" ⊂ "Mark Sampelo" counts as a match; so does exact (case/punct-insensitive) equality.
export function nameTokens(name: string): string[] {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
}
export function namesCollide(a: string, b: string): boolean {
  const ta = nameTokens(a), tb = nameTokens(b)
  if (ta.length === 0 || tb.length === 0) return false
  const subset = (x: string[], y: string[]) => x.every(t => y.includes(t))
  return subset(ta, tb) || subset(tb, ta)
}

// Free-text debrief fields accumulate across updates; everything else is overwritten by newer info.
export const APPEND_FIELDS = ['why_good_contact', 'less_useful_for', 'rating'] as const
export const OVERWRITE_FIELDS = ['title', 'education', 'location', 'email', 'phone', 'linkedin', 'next_step', 'contact_tier', 'relationship_tier', 'category'] as const
export const INSERT_FIELDS = ['title', 'education', 'location', 'email', 'phone', 'linkedin', 'how_we_met', 'why_good_contact', 'less_useful_for', 'rating', 'next_step', 'category'] as const

/** Patch to apply to an existing contact row given newly-learned fields. */
export function mergePatch(current: Record<string, unknown>, fields: Record<string, string | undefined>): Record<string, string> {
  const patch: Record<string, string> = {}
  for (const k of OVERWRITE_FIELDS) if (fields[k]) patch[k] = fields[k]!
  for (const k of APPEND_FIELDS) if (fields[k]) patch[k] = current[k] ? `${current[k]}\n${fields[k]}` : fields[k]!
  if (fields.how_we_met && !current.how_we_met) patch.how_we_met = fields.how_we_met
  return patch
}
