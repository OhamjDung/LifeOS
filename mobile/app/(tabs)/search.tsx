import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../lib/supabase'

interface SearchResult {
  note_id: string
  title: string | null
  chunk_text: string
  similarity: number
}

export default function SearchScreen() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  async function handleSearch() {
    if (!query.trim()) return
    setLoading(true)
    setSearched(true)
    const { data: { session } } = await supabase.auth.getSession()
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
    const res = await fetch(`${supabaseUrl}/functions/v1/fn-search-notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ query: query.trim(), limit: 8 }),
    })
    const { results: data } = await res.json()
    setResults(data ?? [])
    setLoading(false)
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <Text style={s.heading}>Search</Text>
        <Text style={s.sub}>Semantic search across your notes.</Text>

        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            placeholder="What do you know about…"
            placeholderTextColor="#6b7280"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          <TouchableOpacity
            style={[s.searchBtn, (!query.trim() || loading) && s.btnDisabled]}
            onPress={handleSearch}
            disabled={!query.trim() || loading}
          >
            <Text style={s.searchBtnText}>{loading ? '…' : '🔍'}</Text>
          </TouchableOpacity>
        </View>

        {searched && !loading && results.length === 0 && (
          <Text style={s.empty}>No relevant notes found. Try different words.</Text>
        )}

        <FlatList
          data={results}
          keyExtractor={(r, i) => `${r.note_id}-${i}`}
          renderItem={({ item }) => (
            <View style={s.card}>
              <View style={s.cardHeader}>
                <Text style={s.cardTitle} numberOfLines={1}>{item.title || 'Untitled'}</Text>
                <Text style={s.cardSim}>{Math.round(item.similarity * 100)}%</Text>
              </View>
              <Text style={s.cardBody} numberOfLines={3}>{item.chunk_text}</Text>
            </View>
          )}
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111827' },
  container: { flex: 1, padding: 20 },
  heading: { fontSize: 28, fontWeight: '700', color: '#fff', marginTop: 8, marginBottom: 4 },
  sub: { fontSize: 13, color: '#6b7280', marginBottom: 24 },
  inputRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  input: {
    flex: 1, backgroundColor: '#1f2937', borderWidth: 1, borderColor: '#374151',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    color: '#fff', fontSize: 15,
  },
  searchBtn: {
    backgroundColor: '#4f46e5', borderRadius: 12,
    width: 48, alignItems: 'center', justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.4 },
  searchBtnText: { fontSize: 18 },
  card: {
    backgroundColor: '#1f2937', borderRadius: 12,
    padding: 16, marginBottom: 8,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  cardTitle: { color: '#e5e7eb', fontSize: 15, fontWeight: '500', flex: 1 },
  cardSim: { color: '#6b7280', fontSize: 12, marginLeft: 8 },
  cardBody: { color: '#9ca3af', fontSize: 13, lineHeight: 20 },
  empty: { color: '#6b7280', textAlign: 'center', marginTop: 40, fontSize: 14 },
})
