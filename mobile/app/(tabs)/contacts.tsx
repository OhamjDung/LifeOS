import { useState, useCallback } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { supabase } from '../../lib/supabase'
import { Contact, CONTACT_TIER_DAYS, ContactTier } from '../../lib/types'
import { SkCard, SkKicker, SkChip } from '../../components/Sk'
import { T, MONO, raisedShadowSm } from '../../lib/theme'

const TIER_LABEL: Record<ContactTier, string> = {
  daily: 'Daily', weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly',
}

function countdown(c: Contact) {
  const tierDays = CONTACT_TIER_DAYS[(c.contact_tier || 'weekly') as ContactTier]
  const since = c.last_contacted_at
    ? Math.floor((Date.now() - new Date(c.last_contacted_at).getTime()) / 86400000)
    : tierDays + 1
  const daysLeft = tierDays - since
  return { daysLeft, overdue: daysLeft < 0, urgent: since >= tierDays * 1.5 }
}

export default function ContactsScreen() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const router = useRouter()

  const fetchContacts = useCallback(async () => {
    const { data } = await supabase.from('contacts').select('*')
    if (data) setContacts((data as Contact[]).sort((a, b) => {
      const ca = countdown(a), cb = countdown(b)
      return ca.daysLeft - cb.daysLeft
    }))
  }, [])

  useFocusEffect(useCallback(() => { fetchContacts() }, [fetchContacts]))

  async function logContact(id: string) {
    await supabase.from('contacts').update({ last_contacted_at: new Date().toISOString() }).eq('id', id)
    fetchContacts()
  }

  const overdueCount = contacts.filter(c => countdown(c).overdue).length

  return (
    <LinearGradient colors={[T.bg, T.bg2]} start={{ x: 0.32, y: 0 }} end={{ x: 0.68, y: 1 }} style={{ flex: 1 }}>
    <SafeAreaView style={cs.safe}>
      <ScrollView contentContainerStyle={cs.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View>
            <SkKicker>Personal CRM</SkKicker>
            <Text style={cs.heading}>People</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, alignItems: 'center' }}>
            <SkChip>{String(overdueCount).padStart(2, '0')} OVERDUE</SkChip>
            <TouchableOpacity style={[cs.newBtn, raisedShadowSm]}
              onPress={() => router.push('/contact-new' as any)}>
              <Text style={cs.newBtnText}>+ NEW</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Contact cards */}
        <View style={{ gap: 18 }}>
          {contacts.length === 0 && (
            <Text style={cs.empty}>No contacts yet. Tap + NEW to add one.</Text>
          )}
          {contacts.map(c => {
            const { daysLeft, overdue, urgent } = countdown(c)
            const initials = c.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
            return (
              <SkCard key={c.id}
                borderLeft={overdue ? T.clay : undefined}
                style={{ paddingHorizontal: 14, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 13 }}
              >
                {/* LCD avatar */}
                <TouchableOpacity onPress={() => router.push(`/contact/${c.id}` as any)} activeOpacity={0.8}
                  style={[
                    cs.avatar,
                    overdue ? { ...raisedShadowSm, shadowColor: T.clay } : raisedShadowSm,
                    overdue && { borderWidth: 2, borderColor: T.clay },
                  ]}>
                  <Text style={[cs.avatarText, overdue && { color: '#ECA06A' }]}>{initials}</Text>
                </TouchableOpacity>

                {/* Info */}
                <TouchableOpacity style={{ flex: 1, minWidth: 0 }}
                  onPress={() => router.push(`/contact/${c.id}` as any)}>
                  <Text style={cs.name}>{c.name}</Text>
                  <Text style={cs.tier}>{TIER_LABEL[c.contact_tier || 'weekly']} · {c.how_we_met || 'Contact'}</Text>
                </TouchableOpacity>

                {/* Countdown + log */}
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Text style={[cs.countdown, overdue ? { color: T.clay } : daysLeft === 0 ? { color: T.sage } : undefined]}>
                    {overdue ? `${Math.abs(daysLeft)}d over` : daysLeft === 0 ? 'today' : `${daysLeft}d left`}
                  </Text>
                  <TouchableOpacity onPress={() => logContact(c.id)} style={[cs.logBtn, raisedShadowSm]}>
                    <Text style={cs.logText}>LOG ✓</Text>
                  </TouchableOpacity>
                </View>
              </SkCard>
            )
          })}
        </View>

      </ScrollView>
    </SafeAreaView>
    </LinearGradient>
  )
}

const cs = StyleSheet.create({
  safe:    { flex: 1 },
  scroll:  { padding: T.padX, paddingTop: T.topPad - 30, gap: T.gap, paddingBottom: 32 },
  heading: { fontFamily: MONO, fontSize: 26, fontWeight: '600', color: T.ink, marginTop: 4 },
  newBtn:  { backgroundColor: T.display, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 7 },
  newBtnText: { fontFamily: MONO, fontSize: 10, color: T.displayInk, letterSpacing: 1 },
  avatar:  { width: 44, height: 44, borderRadius: 22, backgroundColor: T.display, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { fontFamily: MONO, fontWeight: '700', fontSize: 14, color: T.displayInk },
  name:    { fontFamily: MONO, fontSize: 14, fontWeight: '600', color: T.ink },
  tier:    { fontFamily: MONO, fontSize: 10, color: T.faint, marginTop: 2 },
  countdown: { fontFamily: MONO, fontSize: 11, fontWeight: '600', color: T.mute },
  logBtn:  { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: T.surface },
  logText: { fontFamily: MONO, fontSize: 9, color: T.sage, letterSpacing: 0.5 },
  empty:   { fontFamily: MONO, fontSize: 12, color: T.faint, textAlign: 'center', paddingVertical: 24 },
})
