import type React from 'react'

// Drag a divider (pane gutter, row handle). Two things make a plain window mousemove listener fail on
// pages with an embedded editor (ONLYOFFICE is an iframe): once the cursor is over the iframe the page
// stops getting mouse events, so the drag stalls or sticks to the cursor after release; and resizing on
// every event re-renders the page and the editor many times a frame. So: the handle captures the
// pointer, iframes ignore the mouse while dragging (body.pp-dragging, redtape.css), and onMove runs at
// most once per animation frame. onEnd gets the final offset, to save the size once.
export function startDividerDrag(
  e: React.PointerEvent<HTMLElement>,
  axis: 'x' | 'y',
  onMove: (delta: number) => void,
  onEnd?: (delta: number) => void,
) {
  if (e.button !== 0) return
  e.preventDefault()
  const handle = e.currentTarget
  const pointerId = e.pointerId
  const start = axis === 'x' ? e.clientX : e.clientY
  let delta = 0
  let frame = 0
  try { handle.setPointerCapture(pointerId) } catch { /* pointer already gone */ }
  document.body.classList.add('pp-dragging', axis === 'x' ? 'pp-dragging-x' : 'pp-dragging-y')

  const move = (ev: PointerEvent) => {
    delta = (axis === 'x' ? ev.clientX : ev.clientY) - start
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; onMove(delta) })
  }
  const end = () => {
    if (frame) { cancelAnimationFrame(frame); frame = 0 }
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    handle.removeEventListener('lostpointercapture', end)
    try { handle.releasePointerCapture(pointerId) } catch { /* already released */ }
    document.body.classList.remove('pp-dragging', 'pp-dragging-x', 'pp-dragging-y')
    onMove(delta)
    onEnd?.(delta)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
  handle.addEventListener('lostpointercapture', end)
}
