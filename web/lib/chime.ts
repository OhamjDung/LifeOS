// Timer-done chime synthesized with Web Audio (no asset to load). Browsers only
// allow audio after a user gesture, so unlockAudio() is called on the first
// pointerdown on the session page; the context then stays usable for the tab.

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  return ctx
}

export function unlockAudio() {
  const a = audio()
  if (a && a.state === 'suspended') a.resume().catch(() => {})
}

const SOUND_KEY = 'timerSound'
export function soundEnabled(): boolean {
  try { return localStorage.getItem(SOUND_KEY) !== 'off' } catch { return true }
}
export function setSoundEnabled(on: boolean) {
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off') } catch {}
}

/** Soft bell arpeggio. Work done → rising (time to rest); break done → falling-then-up (back to it). */
export function playChime(kind: 'work-done' | 'break-done') {
  const a = audio()
  if (!a) return
  if (a.state === 'suspended') a.resume().catch(() => {})
  const notes = kind === 'work-done' ? [659.25, 783.99, 1046.5] : [783.99, 659.25, 987.77]
  const start = a.currentTime + 0.02
  // Play the phrase twice so it's noticeable from across the room.
  for (let rep = 0; rep < 2; rep++) {
    notes.forEach((freq, i) => {
      const t = start + rep * 0.9 + i * 0.16
      for (const [mult, level] of [[1, 0.28], [2, 0.08]] as const) { // fundamental + soft overtone = bell-ish
        const osc = a.createOscillator()
        const gain = a.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq * mult
        gain.gain.setValueAtTime(0.0001, t)
        gain.gain.exponentialRampToValueAtTime(level, t + 0.015)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)
        osc.connect(gain).connect(a.destination)
        osc.start(t)
        osc.stop(t + 0.95)
      }
    })
  }
}
