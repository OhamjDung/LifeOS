'use client'

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { unlockAudio } from '@/lib/chime'
import { useFocusSession } from '@/lib/useFocusSession'
import { MiniTimer } from './MiniTimer'

// Pop-out focus timer, hosted in (app)/layout so it survives navigating around
// the app. Chrome/Edge: Document Picture-in-Picture — an always-on-top window you
// can drag anywhere on screen and resize; rendered via a portal, so it's live
// React. Other browsers: a regular popup window on /timer/[id].

type DocPiP = { requestWindow: (o: { width: number; height: number }) => Promise<Window>; window: Window | null }
const docPiP = (): DocPiP | null =>
  typeof window !== 'undefined' ? ((window as unknown as { documentPictureInPicture?: DocPiP }).documentPictureInPicture ?? null) : null

interface Ctx {
  poppedId: string | null
  popOut: (sessionId: string) => Promise<void>
  closePopOut: () => void
}
const FloatingTimerContext = createContext<Ctx>({ poppedId: null, popOut: async () => {}, closePopOut: () => {} })
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
  const [poppedId, setPoppedId] = useState<string | null>(null)
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
    setPoppedId(null)
  }, [pipWindow, popup])

  const popOut = useCallback(async (sessionId: string) => {
    unlockAudio()
    pipWindow?.close()
    popup?.close()
    const pip = docPiP()
    if (pip) {
      try {
        const win = await pip.requestWindow({ width: 380, height: 320 })
        cloneStyles(win)
        win.document.title = 'Focus timer'
        win.addEventListener('pointerdown', () => unlockAudio())
        win.addEventListener('pagehide', () => { setPipWindow(null); setPoppedId(null) }, { once: true })
        setPipWindow(win)
        setPoppedId(sessionId)
        return
      } catch { /* dismissed / blocked — fall back to a popup */ }
    }
    const w = window.open(`/timer/${sessionId}`, `lifeos-timer-${sessionId}`, 'popup,width=400,height=360')
    if (w) {
      w.focus()
      setPopup(w)
      setPoppedId(sessionId)
    }
  }, [pipWindow, popup])

  // Fallback popup: notice when the user closes it.
  useEffect(() => {
    if (!popup) return
    const t = setInterval(() => { if (popup.closed) { setPopup(null); setPoppedId(null) } }, 1000)
    return () => clearInterval(t)
  }, [popup])

  return (
    <FloatingTimerContext.Provider value={{ poppedId, popOut, closePopOut }}>
      {children}
      {pipWindow && poppedId && (
        <PipContent key={poppedId} sessionId={poppedId} target={pipWindow.document.body} onClose={closePopOut} />
      )}
    </FloatingTimerContext.Provider>
  )
}

function PipContent({ sessionId, target, onClose }: { sessionId: string; target: HTMLElement; onClose: () => void }) {
  const timer = useFocusSession(sessionId)
  return createPortal(<MiniTimer timer={timer} onClose={onClose} />, target)
}
