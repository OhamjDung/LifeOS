'use client'

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { unlockAudio } from '@/lib/chime'
import { useFocusSession } from '@/lib/useFocusSession'
import { MiniTimer } from './MiniTimer'

// Pop-out window, hosted in (app)/layout so it survives navigating around the
// app. Chrome/Edge: Document Picture-in-Picture — an always-on-top window you can
// drag anywhere on screen and resize; rendered via a portal, so it's live React.
// Other browsers: a regular popup window on /timer/[id] (/timer/none = no session).
// It can be opened for a focus session (from /session/[id]) or without one
// (from /tasks) — then it shows TASKS / TODAY and can start a session.

type DocPiP = { requestWindow: (o: { width: number; height: number }) => Promise<Window>; window: Window | null }
const docPiP = (): DocPiP | null =>
  typeof window !== 'undefined' ? ((window as unknown as { documentPictureInPicture?: DocPiP }).documentPictureInPicture ?? null) : null

interface Ctx {
  /** null = closed; { sessionId: null } = open without a session */
  popped: { sessionId: string | null } | null
  popOut: (sessionId: string | null) => Promise<void>
  closePopOut: () => void
}
const FloatingTimerContext = createContext<Ctx>({ popped: null, popOut: async () => {}, closePopOut: () => {} })
export const useFloatingTimer = () => useContext(FloatingTimerContext)

/** Copy the page's stylesheets + font classes so Tailwind works inside the PiP window. */
function cloneStyles(target: Window) {
  for (const node of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
    target.document.head.appendChild(node.cloneNode(true))
  }
  target.document.documentElement.className = document.documentElement.className
  target.document.body.className = document.body.className
  target.document.body.style.margin = '0'
}

export function FloatingTimerProvider({ children }: { children: ReactNode }) {
  const [popped, setPopped] = useState<{ sessionId: string | null } | null>(null)
  const [pipWindow, setPipWindow] = useState<Window | null>(null)
  const [popup, setPopup] = useState<Window | null>(null)

  // Browsers only allow audio after a gesture: unlock on the first click anywhere.
  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  const closePopOut = useCallback(() => {
    pipWindow?.close()
    popup?.close()
    setPipWindow(null)
    setPopup(null)
    setPopped(null)
  }, [pipWindow, popup])

  const popOut = useCallback(async (sessionId: string | null) => {
    unlockAudio()
    // Already open as PiP: just switch what it shows.
    if (pipWindow) { setPopped({ sessionId }); pipWindow.focus(); return }
    popup?.close()
    const pip = docPiP()
    if (pip) {
      try {
        const win = await pip.requestWindow({ width: 380, height: 320 })
        cloneStyles(win)
        win.document.title = 'LifeOS'
        win.addEventListener('pointerdown', () => unlockAudio())
        win.addEventListener('pagehide', () => { setPipWindow(null); setPopped(null) }, { once: true })
        setPipWindow(win)
        setPopped({ sessionId })
        return
      } catch { /* dismissed / blocked — fall back to a popup */ }
    }
    const w = window.open(`/timer/${sessionId ?? 'none'}`, 'lifeos-popout', 'popup,width=400,height=360')
    if (w) {
      w.focus()
      setPopup(w)
      setPopped({ sessionId })
    }
  }, [pipWindow, popup])

  // Fallback popup: notice when the user closes it.
  useEffect(() => {
    if (!popup) return
    const t = setInterval(() => { if (popup.closed) { setPopup(null); setPopped(null) } }, 1000)
    return () => clearInterval(t)
  }, [popup])

  return (
    <FloatingTimerContext.Provider value={{ popped, popOut, closePopOut }}>
      {children}
      {pipWindow && popped && (
        <PipContent
          key={popped.sessionId ?? 'none'}
          sessionId={popped.sessionId}
          target={pipWindow.document.body}
          onClose={closePopOut}
          onSessionStarted={id => setPopped({ sessionId: id })}
        />
      )}
    </FloatingTimerContext.Provider>
  )
}

function PipContent({ sessionId, target, onClose, onSessionStarted }: {
  sessionId: string | null
  target: HTMLElement
  onClose: () => void
  onSessionStarted: (id: string) => void
}) {
  const timer = useFocusSession(sessionId)
  return createPortal(<MiniTimer timer={timer} onClose={onClose} onSessionStarted={onSessionStarted} />, target)
}
