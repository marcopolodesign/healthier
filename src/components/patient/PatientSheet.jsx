import { useEffect, useState } from 'react'

/**
 * Responsive sheet / modal primitive.
 *
 * Mobile (<640 px)  → bottom-up sheet with drag-handle pill
 * Desktop (≥640 px) → centered modal
 *
 * Both branches are `fixed inset-0` — viewport-anchored, never
 * container-anchored. The mobile branch used to be `absolute inset-0`, which
 * broke on any page whose own root is the scroll container (Perfil): the sheet
 * pinned itself to the top of the *scrolled content* and disappeared as soon as
 * the user scrolled. Keep this `fixed`.
 *
 * Props
 *   open         – whether to render
 *   onClose      – called on backdrop click or Escape key
 *   children     – sheet body; use `flex-shrink-0` for headers, `flex-1 overflow-y-auto` for scrollable sections
 *   maxWidth     – Tailwind max-w-* class applied on desktop (default "max-w-lg")
 *   backdropClose – whether a backdrop click closes the sheet (default true)
 */
export default function PatientSheet({ open, onClose, children, maxWidth = 'max-w-lg', backdropClose = true }) {
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 640)
  /**
   * La animación de entrada se saca del elemento apenas termina.
   *
   * `animate-slide-up-spring` corre con `forwards`, así que el
   * `transform: translateY(0)` del último keyframe **queda aplicado para
   * siempre**. Un ancestro con `transform` distinto de `none` crea un bloque
   * contenedor propio, y iOS es conocido por perder los toques dentro de un
   * iframe cross-origin ahí adentro. Los campos sensibles del Brick de Mercado
   * Pago (número, vencimiento, CVV) son exactamente eso, y esta hoja es la que
   * los aloja en el Perfil: se veía el formulario y no se podía tipear.
   *
   * Sacar la clase al terminar deja la hoja en la misma posición (ya está
   * anclada abajo por el layout) pero sin transform residual.
   */
  const [animando, setAnimando] = useState(true)

  useEffect(() => {
    const handler = () => setIsDesktop(window.innerWidth >= 640)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Cada apertura vuelve a animar.
  useEffect(() => { if (open) setAnimando(true) }, [open])

  if (!open) return null

  return (
    <div
      className={`fixed inset-0 z-[80] animate-fade-in bg-gray-900/50 backdrop-blur-sm ${isDesktop
        ? 'flex items-center justify-center'
        : 'flex flex-col justify-end'}`}
      onClick={backdropClose ? onClose : undefined}
    >
      <div
        className={`bg-bg-secondary flex flex-col ${isDesktop
          ? `w-full ${maxWidth} rounded-[28px] shadow-2xl max-h-[90dvh]`
          : `w-full rounded-t-[40px] shadow-[0_-20px_50px_rgba(0,0,0,0.2)] max-h-[90dvh] ${animando ? 'animate-slide-up-spring' : ''}`}`}
        onAnimationEnd={() => setAnimando(false)}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag-handle pill — mobile only */}
        {!isDesktop && (
          <div className="w-12 h-1.5 bg-border-default rounded-full mx-auto mt-4 mb-2 flex-shrink-0 pointer-events-none" />
        )}
        {children}
      </div>
    </div>
  )
}
