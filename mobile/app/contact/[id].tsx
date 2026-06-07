import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, Alert, TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { Contact, ContactEvent, Tag, CONTACT_TIER_DAYS, ContactTier } from '../../lib/types'

const EVENT_TYPES = ['met', 'message_sent', 'photo_sent', 'life_update', 'note'] as const
const EVENT_LABELS: Record<string, string> = {
  met: 'Met up', message_sent: 'Message', photo_sent: 'Photo',
  life_update: 'Life update', note: 'Note',
}
const TIER_LABELS: Record<ContactTier, string> = {
  daily: 'Daily', weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly',
}

export default function ContactDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const [contact, setContact] = useState<Contact | null>(null)
  const [events, setEvents] = useState<ContactEvent[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [contactTagIds, setContactTagIds] = useState<string[]>([])
  const [eventType, setEventType] = useState<typeof EVENT_TYPES[number]>('met')
  const [body, setBody] = useState('')
  const [logging, setLogging] = useState(false)
  const [addingTag, setAddingTag] = useState(false)
  const [newTagName, setNewTagName] = useState('')

  async function fetchAll() {
    const [cRes, eRes, tagsRes, ctRes] = await Promise.all([
      supabase.from('contacts').select('*').eq('id', id).single(),
      supabase.from('contact_events').select('*').eq('contact_id', id).order('created_at', { ascending: false }).limit(20),
      supabase.from('tags').select('*').order('name'),
      supabase.from('contact_tags').select('tag_id').eq('contact_id', id),
    ])
    if (cRes.data) setContact(cRes.data as Contact)
    if (eRes.data) setEvents(eRes.data as ContactEvent[])
    if (tagsRes.data) setAllTags(tagsRes.data as Tag[])
    if (ctRes.data) setContactTagIds(ctRes.data.map((r: any) => r.tag_id))
  }

  useFocusEffect(useCallback(() => { fetchAll() }, [id]))

  async function toggleTag(tagId: string) {
    if (contactTagIds.includes(tagId)) {
      await supabase.from('contact_tags').delete().eq('contact_id', id).eq('tag_id', tagId)
      setContactTagIds(prev => prev.filter(t => t !== tagId))
    } else {
      await supabase.from('contact_tags').insert({ contact_id: id, tag_id: tagId })
      setContactTagIds(prev => [...prev, tagId])
    }
  }

  async function addNewTag() {
    if (!newTagName.trim()) { setAddingTag(false); return }
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase.from('tags')
      .insert({ name: newTagName.trim(), user_id: user?.id })
      .select('*').single()
    if (data) {
      const newTag = data as Tag
      setAllTags(prev => [...prev, newTag].sort((a, b) => a.name.localeCompare(b.name)))
      await supabase.from('contact_tags').insert({ contact_id: id, tag_id: newTag.id })
      setContactTagIds(prev => [...prev, newTag.id])
    }
    setNewTagName('')
    setAddingTag(false)
  }

  async function logEvent() {
    if (!body.trim() && eventType === 'note') return
    setLogging(true)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('contact_events').insert({
      contact_id: id, event_type: eventType,
      body: body.trim() || null, user_id: user?.id,
    })
    setBody('')
    setLogging(false)
    fetchAll()
  }

  async function handleDelete() {
    Alert.alert('Delete contact', `Delete ${contact?.name}? Cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('contacts').delete().eq('id', id)
          router.back()
        }
      },
    ])
  }

  if (!contact) return <SafeAreaView style={s.safe}><Text style={s.loading}>Loading…</Text></SafeAreaView>

  const tierDays = CONTACT_TIER_DAYS[(contact.contact_tier || 'weekly') as ContactTier]
  const daysSince = contact.last_contacted_at
    ? Math.floor((Date.now() - new Date(contact.last_contacted_at).getTime()) / 86400000)
    : null
  const daysLeft = daysSince !== null ? tierDays - daysSince : null
  const overdue = daysLeft !== null && daysLeft < 0

  const activeTagIds = contactTagIds
  const activeTags = allTags.filter(t => activeTagIds.includes(t.id))

  return (
    <SafeAreaView style={s.safe}>
      <FlatList
        data={events}
        keyExtractor={e => e.id}
        ListHeaderComponent={
          <View style={s.container}>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={s.back}>← Contacts</Text>
            </TouchableOpacity>

            <Text style={s.name}>{contact.name}</Text>
            <View style={s.metaRow}>
              <View style={s.tierBadge}>
                <Text style={s.tierBadgeText}>{TIER_LABELS[contact.contact_tier || 'weekly']}</Text>
              </View>
              {contact.how_we_met && <Text style={s.metaText}>{contact.how_we_met}</Text>}
              {daysLeft !== null && (
                <Text style={[s.metaText, overdue && s.metaOverdue]}>
                  {overdue ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}
                </Text>
              )}
            </View>

            {/* Tags */}
            <View style={s.tagSection}>
              <View style={s.tagWrap}>
                {allTags.map(tag => (
                  <TouchableOpacity
                    key={tag.id}
                    style={[s.tagChip, activeTagIds.includes(tag.id) && s.tagChipActive]}
                    onPress={() => toggleTag(tag.id)}
                    onLongPress={() =>
                      Alert.alert('Delete tag', `Delete "${tag.name}"?`, [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete', style: 'destructive', onPress: async () => {
                            await supabase.from('tags').delete().eq('id', tag.id)
                            setAllTags(prev => prev.filter(t => t.id !== tag.id))
                            setContactTagIds(prev => prev.filter(t => t !== tag.id))
                          }
                        },
                      ])
                    }
                  >
                    <Text style={[s.tagChipText, activeTagIds.includes(tag.id) && s.tagChipTextActive]}>{tag.name}</Text>
                  </TouchableOpacity>
                ))}
                {addingTag ? (
                  <TextInput
                    style={s.tagInput} value={newTagName} onChangeText={setNewTagName}
                    onSubmitEditing={addNewTag} onBlur={() => { setNewTagName(''); setAddingTag(false) }} autoFocus
                    placeholder="Tag name" placeholderTextColor="#6b7280" returnKeyType="done"
                  />
                ) : (
                  <TouchableOpacity style={s.tagChipAdd} onPress={() => setAddingTag(true)}>
                    <Text style={s.tagChipAddText}>+ tag</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Log interaction */}
            <View style={s.card}>
              <Text style={s.cardTitle}>Log interaction</Text>
              <View style={s.eventTypes}>
                {EVENT_TYPES.map(t => (
                  <TouchableOpacity key={t} style={[s.typeBtn, eventType === t && s.typeBtnActive]} onPress={() => setEventType(t)}>
                    <Text style={[s.typeText, eventType === t && s.typeTextActive]}>{EVENT_LABELS[t]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={s.input} placeholder="Notes (optional)" placeholderTextColor="#6b7280"
                value={body} onChangeText={setBody} multiline
              />
              <TouchableOpacity style={[s.btn, logging && s.btnDisabled]} onPress={logEvent} disabled={logging}>
                <Text style={s.btnText}>{logging ? 'Logging…' : 'Log'}</Text>
              </TouchableOpacity>
            </View>

            <Text style={s.sectionTitle}>Timeline</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.event}>
            <View style={s.dot} />
            <View>
              <Text style={s.eventLabel}>{EVENT_LABELS[item.event_type] || item.event_type}</Text>
              <Text style={s.eventDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
              {item.body && <Text style={s.eventBody}>{item.body}</Text>}
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={s.empty}>No interactions yet.</Text>}
        ListFooterComponent={
          <TouchableOpacity style={s.deleteBtn} onPress={handleDelete}>
            <Text style={s.deleteText}>Delete contact</Text>
          </TouchableOpacity>
        }
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111827' },
  loading: { color: '#6b7280', padding: 20 },
  container: { padding: 20 },
  back: { color: '#6366f1', fontSize: 15, marginBottom: 16 },
  name: { fontSize: 26, fontWeight: '700', color: '#fff', marginBottom: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  tierBadge: { backgroundColor: '#1e1b4b', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  tierBadgeText: { color: '#818cf8', fontSize: 12, fontWeight: '600' },
  metaText: { color: '#6b7280', fontSize: 13 },
  metaOverdue: { color: '#ef4444' },
  tagSection: { marginBottom: 20 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12,
    borderWidth: 1, borderColor: '#374151', backgroundColor: '#111827',
  },
  tagChipActive: { borderColor: '#6366f1', backgroundColor: '#1e1b4b' },
  tagChipText: { color: '#6b7280', fontSize: 13 },
  tagChipTextActive: { color: '#a5b4fc' },
  tagChipAdd: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12,
    borderWidth: 1, borderColor: '#374151', borderStyle: 'dashed',
  },
  tagChipAddText: { color: '#4b5563', fontSize: 13 },
  tagInput: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12,
    borderWidth: 1, borderColor: '#6366f1', color: '#fff',
    fontSize: 13, minWidth: 90, backgroundColor: '#111827',
  },
  card: { backgroundColor: '#1f2937', borderRadius: 14, padding: 16, marginBottom: 24 },
  cardTitle: { color: '#fff', fontWeight: '600', marginBottom: 12 },
  eventTypes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  typeBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#374151' },
  typeBtnActive: { borderColor: '#6366f1', backgroundColor: '#1e1b4b' },
  typeText: { color: '#6b7280', fontSize: 12 },
  typeTextActive: { color: '#a5b4fc' },
  input: {
    backgroundColor: '#111827', borderWidth: 1, borderColor: '#374151',
    borderRadius: 10, padding: 10, color: '#e5e7eb', fontSize: 14, marginBottom: 10,
  },
  btn: { backgroundColor: '#4f46e5', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '600' },
  sectionTitle: { color: '#9ca3af', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  event: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginBottom: 14 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#6366f1', marginTop: 4, flexShrink: 0 },
  eventLabel: { color: '#e5e7eb', fontSize: 14, fontWeight: '500' },
  eventDate: { color: '#6b7280', fontSize: 12 },
  eventBody: { color: '#9ca3af', fontSize: 13, marginTop: 2 },
  empty: { color: '#6b7280', fontSize: 14, paddingHorizontal: 20, paddingBottom: 16 },
  deleteBtn: { marginHorizontal: 20, marginTop: 16 },
  deleteText: { color: '#ef4444', fontSize: 14 },
})
