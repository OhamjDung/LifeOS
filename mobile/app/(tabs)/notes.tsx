import { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Animated, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import Constants from 'expo-constants'
import { supabase, supabaseUrl } from '../../lib/supabase'

const IS_EXPO_GO = Constants.appOwnership === 'expo'

interface Note {
  id: string
  title: string | null
  content: string
  category: string | null
  processing_status: string
  created_at: string
}

export default function NotesScreen() {
  const [notes, setNotes] = useState<Note[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Note[]>([])
  const [searching, setSearching] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [composing, setComposing] = useState(false)
  const [voiceAvailable, setVoiceAvailable] = useState(false)
  const [listening, setListening] = useState(false)
  const pulse = useRef(new Animated.Value(1)).current
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (IS_EXPO_GO) return
    let Voice: any = null
    try {
      Voice = require('@react-native-voice/voice').default
      Voice.isAvailable().then((a: boolean) => setVoiceAvailable(!!a))
      Voice.onSpeechResults = (e: any) => {
        if (e.value?.[0]) setContent(prev => prev ? prev + ' ' + e.value[0] : e.value[0])
      }
      Voice.onSpeechEnd = () => setListening(false)
      Voice.onSpeechError = () => setListening(false)
      return () => Voice?.destroy().then(Voice?.removeAllListeners)
    } catch {
      setVoiceAvailable(false)
    }
  }, [])

  useEffect(() => {
    if (listening) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.2, duration: 600, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start()
    } else {
      pulse.stopAnimation()
      pulse.setValue(1)
    }
  }, [listening])

  const fetchNotes = useCallback(async () => {
    const { data } = await supabase
      .from('notes')
      .select('id, title, content, category, processing_status, created_at')
      .order('created_at', { ascending: false })
      .limit(50)
    if (data) setNotes(data as Note[])
  }, [])

  useFocusEffect(useCallback(() => { fetchNotes() }, [fetchNotes]))

  function onSearchChange(q: string) {
    setSearchQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) {
      setSearchResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(() => { runSearch(q.trim()) }, 400)
  }

  async function runSearch(q: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setSearching(false); return }
      const resp = await fetch(`${supabaseUrl}/functions/v1/fn-search-notes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      })
      const json = await resp.json()
      if (json.results) setSearchResults(json.results as Note[])
    } catch {}
    setSearching(false)
  }

  async function toggleVoice() {
    if (IS_EXPO_GO) return
    let Voice: any = null
    try { Voice = require('@react-native-voice/voice').default } catch { return }
    if (listening) {
      await Voice.stop()
      setListening(false)
    } else {
      try { await Voice.start('en-US'); setListening(true) } catch { setListening(false) }
    }
  }

  async function saveNote() {
    if (!content.trim()) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('notes').insert({
      title: title.trim() || null,
      content: content.trim(),
      user_id: user?.id,
      source_platform: 'ios',
    })
    setTitle('')
    setContent('')
    setComposing(false)
    setSaving(false)
    fetchNotes()
  }

  async function uploadRecording() {
    setUploading(true)
    try {
      let DocumentPicker: any
      try {
        DocumentPicker = require('expo-document-picker')
      } catch {
        Alert.alert('Not available', 'Install expo-document-picker to enable uploads.')
        setUploading(false)
        return
      }

      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true })
      if (result.canceled || !result.assets?.[0]) { setUploading(false); return }

      const asset = result.assets[0]
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setUploading(false); return }

      const ext = asset.name?.split('.').pop() || 'audio'
      const path = `${user.id}/${Date.now()}.${ext}`
      const fileResponse = await fetch(asset.uri)
      const blob = await fileResponse.blob()

      const { error: uploadError } = await supabase.storage
        .from('recordings').upload(path, blob, { contentType: asset.mimeType || 'audio/*' })
      if (uploadError) { Alert.alert('Upload failed', uploadError.message); setUploading(false); return }

      const { data: { publicUrl } } = supabase.storage.from('recordings').getPublicUrl(path)
      await supabase.from('braindump_jobs').insert({
        raw_transcript: `[Audio recording: ${asset.name}]`,
        audio_url: publicUrl,
        user_id: user.id,
      })
      Alert.alert('Uploaded', 'Recording submitted — AI will transcribe and extract tasks in ~2 min.')
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Upload failed')
    }
    setUploading(false)
  }

  const inSearchMode = searchQuery.trim().length > 0
  const displayList = inSearchMode ? searchResults : notes

  if (composing) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.composer}>
          <View style={s.composeHeader}>
            <TouchableOpacity onPress={() => { setComposing(false); setTitle(''); setContent('') }}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.composeTitle}>New note</Text>
            <TouchableOpacity onPress={saveNote} disabled={!content.trim() || saving}>
              <Text style={[s.saveText, (!content.trim() || saving) && s.saveTextDisabled]}>
                {saving ? 'Saving…' : 'Save'}
              </Text>
            </TouchableOpacity>
          </View>

          <TextInput style={s.titleInput} placeholder="Title (optional)"
            placeholderTextColor="#6b7280" value={title} onChangeText={setTitle} />

          {voiceAvailable && (
            <View style={s.voiceRow}>
              <Animated.View style={{ transform: [{ scale: pulse }] }}>
                <TouchableOpacity style={[s.micBtn, listening && s.micBtnActive]} onPress={toggleVoice}>
                  <Text style={s.micIcon}>{listening ? '⏹' : '🎙'}</Text>
                </TouchableOpacity>
              </Animated.View>
              <Text style={s.voiceHint}>{listening ? 'Listening…' : 'Speak to add content'}</Text>
            </View>
          )}

          <TextInput style={s.contentInput} placeholder="Start writing…"
            placeholderTextColor="#6b7280" value={content} onChangeText={setContent}
            multiline autoFocus={!voiceAvailable} textAlignVertical="top" />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.heading}>Notes</Text>
          <View style={s.headerBtns}>
            <TouchableOpacity style={[s.uploadBtn, uploading && s.uploadBtnDisabled]}
              onPress={uploadRecording} disabled={uploading}>
              <Text style={s.uploadBtnText}>{uploading ? '⏳' : '🎙 Upload'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.newBtn} onPress={() => setComposing(true)}>
              <Text style={s.newBtnText}>+ New</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Search bar — always visible */}
        <View style={s.searchBar}>
          <Text style={s.searchIcon}>🔍</Text>
          <TextInput style={s.searchInput} placeholder="Search notes…"
            placeholderTextColor="#6b7280" value={searchQuery}
            onChangeText={onSearchChange} returnKeyType="search" clearButtonMode="while-editing" />
          {searching && <Text style={s.searchingText}>…</Text>}
        </View>

        {inSearchMode && (
          <Text style={s.searchLabel}>
            {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for "{searchQuery}"
          </Text>
        )}

        <FlatList
          data={displayList}
          keyExtractor={n => n.id}
          renderItem={({ item }) => (
            <View style={s.noteCard}>
              <View style={s.noteCardHeader}>
                <Text style={s.noteTitle} numberOfLines={1}>{item.title || 'Untitled'}</Text>
                {item.category && <Text style={s.noteCategory}>{item.category}</Text>}
              </View>
              <Text style={s.noteContent} numberOfLines={2}>{item.content}</Text>
              <Text style={s.noteDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={s.empty}>
              {inSearchMode ? 'No results found.' : 'No notes yet. Tap + New to start.'}
            </Text>
          }
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#111827' },
  container: { flex: 1, padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  heading: { fontSize: 28, fontWeight: '700', color: '#fff', marginTop: 8 },
  headerBtns: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  uploadBtn: { backgroundColor: '#1f2937', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#374151' },
  uploadBtnDisabled: { opacity: 0.5 },
  uploadBtnText: { color: '#9ca3af', fontSize: 13 },
  newBtn: { backgroundColor: '#4f46e5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  newBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1f2937', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, borderWidth: 1, borderColor: '#374151' },
  searchIcon: { fontSize: 14, marginRight: 8 },
  searchInput: { flex: 1, color: '#fff', fontSize: 15 },
  searchingText: { color: '#6b7280', fontSize: 13 },
  searchLabel: { color: '#6b7280', fontSize: 12, marginBottom: 10 },
  noteCard: { backgroundColor: '#1f2937', borderRadius: 12, padding: 14, marginBottom: 10 },
  noteCardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  noteTitle: { color: '#e5e7eb', fontSize: 15, fontWeight: '500', flex: 1 },
  noteCategory: { color: '#6366f1', fontSize: 11, marginLeft: 8 },
  noteContent: { color: '#9ca3af', fontSize: 13, lineHeight: 18 },
  noteDate: { color: '#4b5563', fontSize: 11, marginTop: 6 },
  empty: { color: '#6b7280', textAlign: 'center', marginTop: 40, fontSize: 14 },
  composer: { flex: 1, padding: 20 },
  composeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  composeTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelText: { color: '#6b7280', fontSize: 15 },
  saveText: { color: '#6366f1', fontSize: 15, fontWeight: '600' },
  saveTextDisabled: { opacity: 0.4 },
  titleInput: { color: '#fff', fontSize: 20, fontWeight: '600', borderBottomWidth: 1, borderBottomColor: '#374151', paddingBottom: 12, marginBottom: 16 },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  micBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1f2937', borderWidth: 2, borderColor: '#374151', alignItems: 'center', justifyContent: 'center' },
  micBtnActive: { borderColor: '#ef4444', backgroundColor: '#450a0a' },
  micIcon: { fontSize: 20 },
  voiceHint: { color: '#6b7280', fontSize: 13 },
  contentInput: { flex: 1, color: '#e5e7eb', fontSize: 16, lineHeight: 24 },
})
