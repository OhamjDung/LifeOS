export type TaskStatus = 'pending' | 'done' | 'rolled_over'
export type TaskType = 'task' | 'event'
export type ProcessingStatus = 'pending' | 'processing' | 'done' | 'failed'
export type RelationshipTier = 'family' | 'close_friend' | 'friend' | 'acquaintance'
export type ContactTier = 'daily' | 'weekly' | 'biweekly' | 'monthly'

export const CONTACT_TIER_DAYS: Record<ContactTier, number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
}

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
  status: TaskStatus
  task_type: TaskType
  due_date: string
  contact_id: string | null
  rollover_count: number
  created_at: string
  updated_at: string
  tags?: { id: string; name: string }[]
}

export interface Contact {
  id: string
  user_id: string
  name: string
  how_we_met: string | null
  relationship_tier: RelationshipTier
  contact_tier: ContactTier
  last_contacted_at: string | null
  created_at: string
}

export interface ContactEvent {
  id: string
  contact_id: string
  event_type: string
  body: string | null
  created_at: string
}
