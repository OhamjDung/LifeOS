import { GoalStatus, PlanGoal } from './types'

export const CATEGORY_PRESETS = ['School', 'Career', 'Health', 'Social', 'Personal', 'Finance'] as const

const PRESET_COLORS: Record<string, string> = {
  school: '#5E7AA6',
  career: '#516439',
  health: '#B0643F',
  social: '#A0668F',
  personal: '#8C7A4E',
  finance: '#3F7F7A',
}
const FALLBACK_COLORS = ['#6E6A9E', '#9E6A4E', '#4E8A6A', '#8A4E6A', '#6A7E4E', '#4E6A8A']

/** Stable color per category: presets fixed, custom ones hashed into a small palette. */
export function categoryColor(category: string | null): string {
  if (!category) return '#9E9890'
  const key = category.trim().toLowerCase()
  if (PRESET_COLORS[key]) return PRESET_COLORS[key]
  let h = 0
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length]
}

export const STATUS_META: Record<GoalStatus, { label: string; bg: string; fg: string }> = {
  not_started: { label: 'TODO', bg: 'rgba(28,26,20,0.07)', fg: '#6B6358' },
  in_progress: { label: 'DOING', bg: '#EBD9A8', fg: '#6B4F12' },
  done: { label: 'DONE', bg: '#CDDBA6', fg: '#2A3518' },
}
export const STATUS_ORDER: GoalStatus[] = ['not_started', 'in_progress', 'done']

export function sortGoals(goals: PlanGoal[]): PlanGoal[] {
  return [...goals].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
}

/**
 * Move `draggedId` into a column (whose current members are `column`, excluding
 * or including the dragged goal) before `beforeId` (or at the end), and return
 * the new sort_order for every goal whose order changed.
 */
export function reorderColumn(
  column: PlanGoal[],
  draggedId: string,
  beforeId: string | null,
): { id: string; sort_order: number }[] {
  const ordered = sortGoals(column).filter(g => g.id !== draggedId)
  const idx = beforeId ? ordered.findIndex(g => g.id === beforeId) : -1
  const ids = ordered.map(g => g.id)
  ids.splice(idx === -1 ? ids.length : idx, 0, draggedId)
  const current = new Map(column.map(g => [g.id, g.sort_order]))
  return ids
    .map((id, i) => ({ id, sort_order: i * 10 }))
    .filter(u => current.get(u.id) !== u.sort_order)
}
