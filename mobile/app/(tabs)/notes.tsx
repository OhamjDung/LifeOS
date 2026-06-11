import { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Animated, Alert, ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { useFocusEffect } from 'expo-router'
import Constants from 'expo-constants'
import { supabase, supabaseUrl } from '../../lib/supabase'
import { log, warn, error as logError } from '../../lib/logger'
import { SkCard, SkKicker, SkChip } from '../../components/Sk'
import { T, MONO, raisedShadowSm } from '../../lib/theme'

const IS_EXPO_GO = Constants.appOwnership === 'expo'

const CAT_COLOR: Record<string, string> = {
  Learning: '#CDDBA6', Reference: '#CCC6B6', Idea: '#ECA06A', Meeting: '#9FE3B0',
}

interface Note {
  id: string; title: string | null; content: string
  category: string | null; processing_status: string; created_at: string
}

export default function NotesScreen() {
  const [notes, setNotes] = useState<Note[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Note[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedNote, setSelectedNote] = useState<Note | null>(null)
  const [composing, setComposing] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [editingNote, setEditingNote] = useState(false)
  const [editNoteTitle, setEditNoteTitle] = useState('')
  const [editNoteContent, setEditNoteContent] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [voiceAvailable, setVoiceAvailable] = useState(false)
  const [listening, setListening] = useState(false)
  const pulse = useRef(new Animated.Value(1)).current
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (IS_EXPO_GO) return
    try {
      const Voice = require('@react-native-voice/voice').default
      Voice.isAvailable().then((a: boolean) => setVoiceAvailable(!!a))
      Voice.onSpeechResults = (e: any) => {
        if (e.value?.[0]) setContent(prev => prev ? prev + ' ' + e.value[0] : e.value[0])
      }
      Voice.onSpeechEnd = () => setListening(false)
      Voice.onSpeechError = () => setListening(false)
      return () => Voice?.destroy().then(Voice?.removeAllListeners)
    } catch { setVoiceAvailable(false) }
  }, [])

  useEffect(() => {
    if (listening) {
      Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1.2, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])).start()
    } else { pulse.stopAnimation(); pulse.setValue(1) }
  }, [listening])

  const fetchNotes = useCallback(async () => {
    const { data } = await supabase.from('notes')
      .select('id,title,content,category,processing_status,created_at')
      .order('created_at', { ascending: false }).limit(50)
    if (data) setNotes(data as Note[])
  }, [])

  useFocusEffect(useCallback(() => { fetchNotes() }, [fetchNotes]))

  function onSearchChange(q: string) {
    setSearchQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) { setSearchResults([]); setSearching(false); return }
    setSearching(true)
    debounceRef.current = setTimeout(() => runSearch(q.trim()), 400)
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
      if (json.results) setSearchResults(json.results.map((r: any) => ({
        id: r.note_id,
        title: r.title ?? null,
        content: r.chunk_text ?? '',
        category: null,
        processing_status: 'done',
        created_at: '',
      })))
    } catch {}
    setSearching(false)
  }

  async function toggleVoice() {
    if (IS_EXPO_GO) return
    let Voice: any
    try { Voice = require('@react-native-voice/voice').default } catch { return }
    if (listening) { await Voice.stop(); setListening(false) }
    else { try { await Voice.start('en-US'); setListening(true) } catch { setListening(false) } }
  }

  async function saveNoteEdit() {
    if (!selectedNote) return
    setSavingEdit(true)
    await supabase.from('notes').update({
      title: editNoteTitle.trim() || null,
      content: editNoteContent.trim(),
    }).eq('id', selectedNote.id)
    setSelectedNote({ ...selectedNote, title: editNoteTitle.trim() || null, content: editNoteContent.trim() })
    setEditingNote(false)
    setSavingEdit(false)
    fetchNotes()
  }

  async function saveNote() {
    if (!content.trim()) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('notes').insert({
      title: title.trim() || null, content: content.trim(),
      user_id: user?.id, source_platform: 'ios',
    })
    setTitle(''); setContent(''); setComposing(false); setSaving(false)
    fetchNotes()
  }

  async function uploadRecording() {
    log('notes: uploadRecording started')
    setUploading(true)
    try {
      let DocumentPicker: any
      try {
        DocumentPicker = require('expo-document-picker')
        log('notes: expo-document-picker loaded ok')
      } catch (e: any) {
        logError(`notes: expo-document-picker require failed: ${e?.message}`)
        Alert.alert('Not available', 'Install expo-document-picker')
        setUploading(false)
        return
      }

      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true })
      log(`notes: picker result canceled=${result.canceled}`)
      if (result.canceled || !result.assets?.[0]) { setUploading(false); return }

      const asset = result.assets[0]
      log(`notes: picked file name=${asset.name} type=${asset.mimeType}`)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { warn('notes: no user — aborting upload'); setUploading(false); return }

      const ext = asset.name?.split('.').pop() || 'audio'
      const path = `${user.id}/${Date.now()}.${ext}`
      const blob = await (await fetch(asset.uri)).blob()
      log(`notes: uploading to storage path=${path}`)

      const { error } = await supabase.storage.from('recordings')
        .upload(path, blob, { contentType: asset.mimeType || 'audio/*' })
      if (error) {
        logError(`notes: storage upload failed: ${error.message}`)
        Alert.alert('Upload failed', error.message)
        setUploading(false)
        return
      }

      log('notes: storage upload ok')
      const { data: { publicUrl } } = supabase.storage.from('recordings').getPublicUrl(path)
      const { error: jobErr } = await supabase.from('braindump_jobs').insert({
        raw_transcript: `[Audio: ${asset.name}]`, audio_url: publicUrl, user_id: user.id,
      })
      if (jobErr) logError(`notes: braindump_jobs insert failed: ${jobErr.message}`)
      else log('notes: braindump_jobs insert ok')
      Alert.alert('Uploaded', 'AI will transcribe and extract tasks in ~2 min.')
    } catch (e: any) {
      logError(`notes: uploadRecording error: ${e?.message}`)
      Alert.alert('Error', e?.message || 'Upload failed')
    }
    setUploading(false)
  }

  const inSearch = searchQuery.trim().length > 0
  const displayList = inSearch ? searchResults : notes

  // ── Note detail ──
  if (selectedNote) {
    const catColor = selectedNote.category ? (CAT_COLOR[selectedNote.category] ?? T.displayInk) : T.displayInk
    return (
      <LinearGradient colors={[T.bg, T.bg2]} start={{ x: 0.32, y: 0 }} end={{ x: 0.68, y: 1 }} style={{ flex: 1 }}>
      <SafeAreaView style={ns.safe}>
        <ScrollView contentContainerStyle={ns.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <TouchableOpacity onPress={() => { setSelectedNote(null); setEditingNote(false) }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={[ns.backBtn, raisedShadowSm]}>
                <Text style={{ color: T.faint, fontSize: 16 }}>‹</Text>
              </View>
              <SkKicker>Notes</SkKicker>
            </TouchableOpacity>
            {editingNote ? (
              <TouchableOpacity onPress={saveNoteEdit} disabled={!editNoteContent.trim() || savingEdit}>
                <Text style={[ns.saveText, (!editNoteContent.trim() || savingEdit) && { opacity: 0.4 }]}>
                  {savingEdit ? 'Saving…' : 'Save'}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => { setEditNoteTitle(selectedNote.title || ''); setEditNoteContent(selectedNote.content); setEditingNote(true) }}>
                <Text style={ns.saveText}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>
          {selectedNote.category && !editingNote && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={[ns.catBadge, { backgroundColor: T.display }]}>
                <Text style={[ns.catBadgeText, { color: catColor }]}>{selectedNote.category.toUpperCase()}</Text>
              </View>
              <Text style={ns.noteDate}>{selectedNote.created_at ? new Date(selectedNote.created_at).toLocaleDateString() : ''}</Text>
            </View>
          )}
          {editingNote ? (
            <>
              <TextInput style={ns.titleInput} placeholder="Title (optional)"
                placeholderTextColor={T.faint} value={editNoteTitle} onChangeText={setEditNoteTitle} />
              <TextInput style={ns.contentInput} value={editNoteContent} onChangeText={setEditNoteContent}
                multiline textAlignVertical="top" autoFocus />
            </>
          ) : (
            <>
              <Text style={ns.detailTitle}>{selectedNote.title || 'Untitled'}</Text>
              <SkCard style={{ padding: 18 }}>
                <Text style={ns.detailBody}>{selectedNote.content}</Text>
              </SkCard>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
      </LinearGradient>
    )
  }

  // ── Compose ──
  if (composing) {
    return (
      <LinearGradient colors={[T.bg, T.bg2]} start={{ x: 0.32, y: 0 }} end={{ x: 0.68, y: 1 }} style={{ flex: 1 }}>
      <SafeAreaView style={ns.safe}>
        <ScrollView contentContainerStyle={ns.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => { setComposing(false); setTitle(''); setContent('') }}>
              <Text style={ns.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <SkKicker>New note</SkKicker>
            <TouchableOpacity onPress={saveNote} disabled={!content.trim() || saving}>
              <Text style={[ns.saveText, (!content.trim() || saving) && { opacity: 0.4 }]}>
                {saving ? 'Saving…' : 'Save'}
              </Text>
            </TouchableOpacity>
          </View>
          <TextInput style={ns.titleInput} placeholder="Title (optional)"
            placeholderTextColor={T.faint} value={title} onChangeText={setTitle} />
          {voiceAvailable && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Animated.View style={{ transform: [{ scale: pulse }] }}>
                <TouchableOpacity style={[ns.micBtn, listening && ns.micBtnActive]} onPress={toggleVoice}>
                  <Text style={{ fontSize: 22, color: listening ? T.clayFg : T.faint }}>
                    {listening ? '■' : '◉'}
                  </Text>
                </TouchableOpacity>
              </Animated.View>
              <Text style={{ fontFamily: MONO, fontSize: 14, color: T.faint }}>{listening ? 'Listening…' : 'Tap to dictate'}</Text>
            </View>
          )}
          <TextInput style={ns.contentInput} placeholder="Start writing…"
            placeholderTextColor={T.faint} value={content} onChangeText={setContent}
            multiline autoFocus={!voiceAvailable} textAlignVertical="top" />
        </ScrollView>
      </SafeAreaView>
      </LinearGradient>
    )
  }

  // ── List ──
  return (
    <LinearGradient colors={[T.bg, T.bg2]} start={{ x: 0.32, y: 0 }} end={{ x: 0.68, y: 1 }} style={{ flex: 1 }}>
    <SafeAreaView style={ns.safe}>
      <ScrollView contentContainerStyle={ns.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View>
            <SkKicker>Second brain</SkKicker>
            <Text style={ns.heading}>Notes</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 }}>
            <TouchableOpacity style={[ns.uploadBtn, uploading && { opacity: 0.5 }, raisedShadowSm]}
              onPress={uploadRecording} disabled={uploading}>
              <Text style={ns.uploadText}>{uploading ? '○ …' : '◉ REC'}</Text>
            </TouchableOpacity>
            <SkChip>{String(notes.length).padStart(2, '0')} NOTES</SkChip>
          </View>
        </View>

        {/* Search bar — always visible, inset style */}
        <SkCard pressed style={{ paddingHorizontal: 16, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontSize: 18, color: T.faint }}>⌕</Text>
          <TextInput style={ns.searchInput} placeholder="Search what you know…"
            placeholderTextColor={T.faint} value={searchQuery} onChangeText={onSearchChange}
            returnKeyType="search" />
          {searching && <Text style={{ fontFamily: MONO, fontSize: 13, color: T.faint }}>…</Text>}
        </SkCard>

        {inSearch && (
          <Text style={ns.searchLabel}>{searchResults.length} result{searchResults.length !== 1 ? 's' : ''} · "{searchQuery}"</Text>
        )}

        {/* Note list */}
        <View style={{ gap: T.listGap }}>
          {displayList.length === 0 ? (
            <Text style={ns.empty}>{inSearch ? 'No results found.' : 'No notes yet. Tap + New to start.'}</Text>
          ) : displayList.map(n => (
            <NoteCard key={n.id} note={n} onPress={() => setSelectedNote(n)} />
          ))}
        </View>

        {/* New note FAB */}
        <TouchableOpacity style={[ns.newBtn, raisedShadowSm]} onPress={() => setComposing(true)}>
          <Text style={ns.newBtnText}>+ New note</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
    </LinearGradient>
  )
}

function NoteCard({ note, onPress }: { note: Note; onPress: () => void }) {
  const catColor = note.category ? (CAT_COLOR[note.category] ?? T.displayInk) : T.displayInk
  return (
    <SkCard onPress={onPress} style={{ padding: 15 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        {note.category ? (
          <View style={[ns.catBadge, { backgroundColor: T.display }]}>
            <Text style={[ns.catBadgeText, { color: catColor }]}>{note.category.toUpperCase()}</Text>
          </View>
        ) : <View />}
        <Text style={ns.noteDate}>{new Date(note.created_at).toLocaleDateString()}</Text>
      </View>
      <Text style={ns.noteTitle} numberOfLines={1}>{note.title || 'Untitled'}</Text>
      <Text style={ns.notePreview} numberOfLines={2}>{note.content}</Text>
    </SkCard>
  )
}

const ns = StyleSheet.create({
  safe:    { flex: 1 },
  scroll:  { flex: 1, padding: T.padX, paddingTop: T.topPad - 30, gap: T.gap },
  scrollContent: { padding: T.padX, paddingTop: T.topPad - 30, gap: T.gap, paddingBottom: 32 },
  heading: { fontFamily: MONO, fontSize: 31, fontWeight: '600', color: T.ink, marginTop: 4 },
  searchInput: { flex: 1, fontFamily: MONO, fontSize: 15, color: T.ink },
  searchLabel: { fontFamily: MONO, fontSize: 12, color: T.faint, letterSpacing: 0.5 },
  catBadge:    { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  catBadgeText: { fontFamily: MONO, fontSize: 10, letterSpacing: 1.5, fontWeight: '600' },
  noteDate:    { fontFamily: MONO, fontSize: 11.5, color: T.faint },
  noteTitle:   { fontFamily: MONO, fontSize: 17, fontWeight: '600', color: T.ink, marginBottom: 5 },
  notePreview: { fontFamily: MONO, fontSize: 13, lineHeight: 20, color: T.mute },
  uploadBtn:   { backgroundColor: T.surface, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6 },
  uploadText:  { fontFamily: MONO, fontSize: 13, color: T.mute },
  newBtn:      { backgroundColor: T.display, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 8, marginBottom: 24 },
  newBtnText:  { fontFamily: MONO, fontSize: 16, fontWeight: '600', color: T.displayInk, letterSpacing: 0.5 },
  empty:       { fontFamily: MONO, fontSize: 14, color: T.faint, textAlign: 'center', paddingVertical: 24 },
  backBtn:     { width: 38, height: 38, borderRadius: 11, backgroundColor: T.surface, alignItems: 'center', justifyContent: 'center' },
  detailTitle: { fontFamily: MONO, fontSize: 26, fontWeight: '600', color: T.ink, letterSpacing: -0.4, lineHeight: 34 },
  detailBody:  { fontFamily: MONO, fontSize: 15, lineHeight: 26, color: T.mute },
  cancelText:  { fontFamily: MONO, fontSize: 17, color: T.faint },
  saveText:    { fontFamily: MONO, fontSize: 17, fontWeight: '600', color: T.sage },
  titleInput:  { fontFamily: MONO, fontSize: 24, fontWeight: '600', color: T.ink, borderBottomWidth: 1, borderBottomColor: T.line, paddingBottom: 12 },
  micBtn:      { width: 48, height: 48, borderRadius: 24, backgroundColor: T.surface, borderWidth: 2, borderColor: T.line, alignItems: 'center', justifyContent: 'center' },
  micBtnActive: { borderColor: T.clay, backgroundColor: '#3A1810' },
  contentInput: { fontFamily: MONO, fontSize: 18, color: T.ink, lineHeight: 28, minHeight: 160 },
})
