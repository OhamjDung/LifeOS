import { useState, useCallback } from 'react'
import { useFocusEffect } from 'expo-router'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { Contact, CONTACT_TIER_DAYS, ContactTier } from '../../lib/types'

const TIER_LABELS: Record<ContactTier, string> = {
  daily: 'Daily', weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly',
}

function daysSince(date: string | null): number {
  if (!date) return 9999
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
}

function countdown(contact: Contact): { daysLeft: number; urgent: boolean; overdue: boolean } {
  const tierDays = CONTACT_TIER_DAYS[(contact.contact_tier || 'weekly') as ContactTier]
  const since = daysSince(contact.last_contacted_at)
  const daysLeft = tierDays - since
  return {
    daysLeft,
    overdue: daysLeft < 0,
    urgent: since >= tierDays * 1.5,
  }
}

export default function ContactsScreen() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const router = useRouter()

  const fetchContacts = useCallback(async () => {
    const { data } = await supabase
      .from('contacts')
      .select('*')
      .order('last_contacted_at', { ascending: true, nullsFirst: true })
    if (data) setContacts(data as Contact[])
  }, [])

  useFocusEffect(useCallback(() => { fetchContacts() }, [fetchContacts]))

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <View style={s.header}>
          <Text style={s.heading}>Contacts</Text>
          <TouchableOpacity style={s.newBtn} onPress={() => router.push('/contact-new' as any)}>
            <Text style={s.newBtnText}>+ New</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={contacts}
          keyExtractor={c => c.id}
          renderItem={({ item }) => {
            const { daysLeft, overdue, urgent } = countdown(item)
            return (
              <TouchableOpacity
                style={[s.row, urgent && s.rowUrgent]}
                onPress={() => router.push(`/contact/${item.id}` as any)}
              >
                <View style={[s.avatar, overdue && s.avatarOverdue, urgent && s.avatarUrgent]}>
                  <Text style={s.avatarText}>{item.name[0].toUpperCase()}</Text>
                </View>
                <View style={s.info}>
                  <Text style={s.name}>{item.name}</Text>
                  <Text style={s.tier}>{TIER_LABELS[item.contact_tier || 'weekly']}</Text>
                </View>
                <View style={s.countdownBox}>
                  {overdue ? (
                    <Text style={[s.countdownText, s.countdownOverdue]}>
                      {Math.abs(daysLeft)}d overdue
                    </Text>
                  ) : (
                    <Text style={[s.countdownText, urgent && s.countdownUrgent]}>
                      {daysLeft}d left
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            )
          }}
          ListEmptyComponent={<Text style={s.empty}>No contacts yet.</Text>}
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111827' },
  container: { flex: 1, padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  heading: { fontSize: 28, fontWeight: '700', color: '#fff', marginTop: 8 },
  newBtn: { backgroundColor: '#4f46e5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  newBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#1f2937', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 14, marginBottom: 8,
    borderLeftWidth: 3, borderLeftColor: 'transparent',
  },
  rowUrgent: { borderLeftColor: '#f97316' },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#312e81', alignItems: 'center', justifyContent: 'center',
  },
  avatarOverdue: { backgroundColor: '#7c3aed' },
  avatarUrgent: { backgroundColor: '#b45309' },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  info: { flex: 1 },
  name: { color: '#e5e7eb', fontSize: 15, fontWeight: '500' },
  tier: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  countdownBox: { alignItems: 'flex-end' },
  countdownText: { color: '#6b7280', fontSize: 12 },
  countdownOverdue: { color: '#ef4444', fontWeight: '600' },
  countdownUrgent: { color: '#f97316' },
  empty: { color: '#6b7280', textAlign: 'center', marginTop: 40, fontSize: 14 },
})
