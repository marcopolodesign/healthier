import { useState } from 'react'

// Drag-to-expand bottom sheet hook used by the patient Dashboard
export function useBottomSheet(initial = 'half') {
  const [state, setState] = useState(initial)
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [startY, setStartY] = useState(0)

  const onPointerDown = e => {
    setDragging(true)
    setStartY(e.clientY)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = e => {
    if (!dragging) return
    const delta = e.clientY - startY
    if (state === 'expanded' && delta < -30) return
    setOffset(delta)
  }

  const onPointerUp = e => {
    if (!dragging) return
    setDragging(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
    const delta = e.clientY - startY
    const threshold = 50
    if (delta < -threshold) {
      setState(s => s === 'collapsed' ? 'half' : s === 'half' ? 'expanded' : s)
    } else if (delta > threshold) {
      setState(s => s === 'expanded' ? 'half' : s === 'half' ? 'collapsed' : s)
    } else if (Math.abs(delta) < 10) {
      setState(s => s === 'half' ? 'expanded' : s === 'expanded' ? 'collapsed' : 'half')
    }
    setOffset(0)
  }

  const getTransform = () => {
    const base = state === 'expanded' ? 0 : state === 'half' ? 35 : 70
    if (dragging) return `translateY(calc(${base}% + ${offset}px))`
    return `translateY(${base}%)`
  }

  return { state, setState, dragging, offset, getTransform, onPointerDown, onPointerMove, onPointerUp }
}
