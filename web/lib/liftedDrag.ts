import type { DragEvent } from 'react'

/**
 * HTML5 drag ghosts are drawn by the OS at partial opacity and can't be styled, so a dragged
 * card looks see-through and "all on your end". Keep native drag-and-drop for the events (drop
 * targets in other components still work) but swap the ghost for our own opaque clone that
 * lifts (shadow, slight tilt) and follows the cursor.
 */

const OFF = { current: null as null | (() => void) }

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function startLiftedDrag(e: DragEvent, el: HTMLElement) {
  OFF.current?.()

  // Hide the native ghost (a 1×1 canvas is "drawn" instantly, unlike an <img> that must load).
  const pixel = document.createElement('canvas')
  pixel.width = pixel.height = 1
  e.dataTransfer.setDragImage(pixel, 0, 0)

  const rect = el.getBoundingClientRect()
  const offX = e.clientX - rect.left
  const offY = e.clientY - rect.top
  const lift = reduced() ? '' : ' rotate(1.2deg) scale(1.025)'

  const clone = el.cloneNode(true) as HTMLElement
  clone.removeAttribute('draggable')
  clone.setAttribute('aria-hidden', 'true')
  Object.assign(clone.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${rect.width}px`,
    margin: '0',
    zIndex: '9999',
    pointerEvents: 'none',
    opacity: '1',
    transformOrigin: `${offX}px ${offY}px`,
    transform: `translate3d(${e.clientX - offX}px, ${e.clientY - offY}px, 0)${lift}`,
    boxShadow: '0 14px 30px rgba(28,26,20,0.30), 0 3px 8px rgba(28,26,20,0.18)',
    borderRadius: '12px',
    cursor: 'grabbing',
    willChange: 'transform',
  })
  document.body.appendChild(clone)

  let lastMove = Date.now()
  const move = (ev: globalThis.DragEvent) => {
    // Some browsers report 0,0 for the last event of a drag — ignore those.
    if (ev.clientX === 0 && ev.clientY === 0) return
    lastMove = Date.now()
    clone.style.transform = `translate3d(${ev.clientX - offX}px, ${ev.clientY - offY}px, 0)${lift}`
  }
  const finish = () => {
    if (OFF.current !== finish) return
    OFF.current = null
    document.removeEventListener('dragover', move, true)
    document.removeEventListener('drop', finish, true)
    window.removeEventListener('dragend', finish, true)
    clearInterval(watchdog)
    // Settle: fade + shrink slightly instead of vanishing.
    clone.style.transition = 'opacity 140ms var(--ease-out), box-shadow 140ms var(--ease-out)'
    clone.style.opacity = '0'
    clone.style.boxShadow = 'none'
    setTimeout(() => clone.remove(), 160)
  }
  // dragend isn't delivered if the source node was unmounted by the drop (e.g. moved to another
  // group), so also end on `drop` and when dragover events stop arriving.
  const watchdog = setInterval(() => { if (Date.now() - lastMove > 1500) finish() }, 500)
  OFF.current = finish
  document.addEventListener('dragover', move, true)
  document.addEventListener('drop', finish, true)
  window.addEventListener('dragend', finish, true)
}
