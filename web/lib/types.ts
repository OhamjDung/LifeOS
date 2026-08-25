export type TaskStatus = 'pending' | 'done' | 'rolled_over'
export type TaskType = 'task' | 'event'
export type RelationshipTier = 'family' | 'close_friend' | 'friend' | 'acquaintance'
export type ContactTier = 'daily' | 'weekly' | 'biweekly' | 'monthly'
export type ProcessingStatus = 'pending' | 'processing' | 'done' | 'failed'
export type AppMode = 'home' | 'work' | 'car' | 'gym' | 'default'

export interface Tag {
  id: string
  user_id: string
  name: string
  created_at: string
}

export interface Task {
  id: string
  user_id: string
  title: string
  description: string | null
  status: TaskStatus
  task_type: TaskType
  due_date: string
  contact_id: string | null
  rollover_count: number
  raw_source: string | null
  mode_at_creation: string | null
  ai_merged_from: string | null
  created_at: string
  updated_at: string
  tags?: { id: string; name: string }[]
  subtasks?: Subtask[]
}

export type SubtaskStatus = 'pending' | 'done'

export interface Subtask {
  id: string
  task_id: string
  user_id: string
  title: string
  group_name: string | null
  status: SubtaskStatus
  sort_order: number
  created_at: string
  updated_at: string
}

export interface BraindumpJob {
  id: string
  user_id: string
  audio_path: string | null
  raw_transcript: string | null
  categories: string[]
  processing_status: ProcessingStatus
  retry_count: number
  last_error: string | null
  created_at: string
}

export interface Contact {
  id: string
  user_id: string
  name: string
  how_we_met: string | null
  relationship_tier: RelationshipTier
  contact_tier: ContactTier
  last_contacted_at: string | null
  avatar_path: string | null
  created_at: string
  updated_at: string
}

export interface ContactEvent {
  id: string
  user_id: string
  contact_id: string
  event_type: 'photo_sent' | 'message_sent' | 'met' | 'life_update' | 'note'
  body: string | null
  media_path: string | null
  created_at: string
}

export interface Note {
  id: string
  user_id: string
  title: string | null
  content: string
  category: string | null
  tags: string[]
  source_platform: 'web' | 'ios' | 'import'
  processing_status: ProcessingStatus
  retry_count: number
  created_at: string
  updated_at: string
}

export interface LocationAnchor {
  id: string
  user_id: string
  label: string
  mode: AppMode
  latitude: number
  longitude: number
  radius_meters: number
  created_at: string
}

// Relationship tier → reminder interval (days) — used by fn-draft-catchup for AI tone
export const TIER_INTERVALS: Record<RelationshipTier, number> = {
  family: 2,
  close_friend: 7,
  friend: 14,
  acquaintance: 30,
}

// Contact tier → CRM countdown days — used for overdue calculations
export const CONTACT_TIER_DAYS: Record<ContactTier, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
}

export const CONTACT_TIER_LABEL: Record<ContactTier, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
}
