import { useState, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { supabase } from '../lib/supabase'
import { ContactTier, Tag } from '../lib/types'

const CONTACT_TIERS: { value: ContactTier; label: string; sub: string }[] = [
  { value: 'daily',    label: 'Daily',    sub: 'every day' },
  { value: 'weekly',   label: 'Weekly',   sub: 'every 7 days' },
  { value: 'biweekly', label: 'Biweekly', sub: 'every 14 days' },
  { value: 'monthly',  label: 'Monthly',  sub: 'every 30 days' },
]

export default function ContactNewScreen() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [howWeMet, setHowWeMet] = useState('')
  const [tier, setTier] = useState<ContactTier>('weekly')
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [newTagName, setNewTagName] = useState('')
  const [addingTag, setAddingTag] = useState(false)
  const [saving, setSaving] = useState(false)

  const fetchTags = useCallback(async () => {
    const { data } = await supabase.from('tags').select('*').order('name')
    if (data) setTags(data as Tag[])
  }, [])

  useFocusEffect(useCallback(() => { fetchTags() }, [fetchTags]))

  function toggleTag(id: string) {
    setSelectedTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
  }

  async function addTag() {
    if (!newTagName.trim()) { setAddingTag(false); return }
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase.from('tags')
      .insert({ name: newTagName.trim(), user_id: user?.id })
      .select('*').single()
    if (data) {
      setTags(prev => [...prev, data as Tag].sort((a, b) => a.name.localeCompare(b.name)))
    }
    setNewTagName('')
    setAddingTag(false)
  }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { data: contact } = await supabase.from('contacts').insert({
      name: name.trim(),
      how_we_met: howWeMet.trim() || null,
      relationship_tier: 'friend',
      contact_tier: tier,
      user_id: user?.id,
    }).select('id').single()

    if (contact?.id && selectedTags.length > 0) {
      await supabase.from('contact_tags').insert(
        selectedTags.map(tag_id => ({ contact_id: contact.id, tag_id }))
      )
    }

    setSaving(false)
    router.back()
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={s.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={s.heading}>New contact</Text>
        </View>

        <Text style={s.label}>Name</Text>
        <TextInput
          style={s.input} placeholder="Full name" placeholderTextColor="#6b7280"
          value={name} onChangeText={setName} autoFocus
        />

        <Text style={s.label}>How we met</Text>
        <TextInput
          style={s.input} placeholder="College, work, gym…" placeholderTextColor="#6b7280"
          value={howWeMet} onChangeText={setHowWeMet}
        />

        <Text style={s.label}>Contact frequency</Text>
        <View style={s.tierGrid}>
          {CONTACT_TIERS.map(t => (
            <TouchableOpacity
              key={t.value}
              style={[s.tierBtn, tier === t.value && s.tierBtnActive]}
              onPress={() => setTier(t.value)}
            >
              <Text style={[s.tierLabel, tier === t.value && s.tierLabelActive]}>{t.label}</Text>
              <Text style={s.tierSub}>{t.sub}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.label}>Tags</Text>
        <View style={s.tagWrap}>
          {tags.map(tag => (
            <TouchableOpacity
              key={tag.id}
              style={[s.tagChip, selectedTags.includes(tag.id) && s.tagChipActive]}
              onPress={() => toggleTag(tag.id)}
              onLongPress={() =>
                Alert.alert('Delete tag', `Delete "${tag.name}"?`, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete', style: 'destructive', onPress: async () => {
                      await supabase.from('tags').delete().eq('id', tag.id)
                      setTags(prev => prev.filter(t => t.id !== tag.id))
                      setSelectedTags(prev => prev.filter(t => t !== tag.id))
                    }
                  },
                ])
              }
            >
              <Text style={[s.tagChipText, selectedTags.includes(tag.id) && s.tagChipTextActive]}>{tag.name}</Text>
            </TouchableOpacity>
          ))}
          {addingTag ? (
            <TextInput
              style={s.tagInput} value={newTagName} onChangeText={setNewTagName}
              onSubmitEditing={addTag} onBlur={() => { setNewTagName(''); setAddingTag(false) }} autoFocus
              placeholder="Tag name" placeholderTextColor="#6b7280" returnKeyType="done"
            />
          ) : (
            <TouchableOpacity style={s.tagChipAdd} onPress={() => setAddingTag(true)}>
              <Text style={s.tagChipAddText}>+ tag</Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[s.btn, (!name.trim() || saving) && s.btnDisabled]}
          onPress={handleSave} disabled={!name.trim() || saving}
        >
          <Text style={s.btnText}>{saving ? 'Saving…' : 'Save contact'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111827' },
  container: { padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 28 },
  back: { color: '#6366f1', fontSize: 16 },
  heading: { fontSize: 22, fontWeight: '700', color: '#fff' },
  label: { color: '#9ca3af', fontSize: 13, marginBottom: 6, marginTop: 16 },
  input: {
    backgroundColor: '#1f2937', borderWidth: 1, borderColor: '#374151',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    color: '#fff', fontSize: 15,
  },
  tierGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  tierBtn: {
    flex: 1, minWidth: '45%', paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1, borderColor: '#374151', alignItems: 'center',
  },
  tierBtnActive: { borderColor: '#6366f1', backgroundColor: '#1e1b4b' },
  tierLabel: { color: '#6b7280', fontSize: 14, fontWeight: '600' },
  tierLabelActive: { color: '#a5b4fc' },
  tierSub: { color: '#4b5563', fontSize: 11, marginTop: 2 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
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
  btn: {
    backgroundColor: '#4f46e5', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 32,
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
