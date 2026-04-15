import { useEffect, useState } from 'react'

/**
 * Responsive full-page overlay for browsable sub-screens (category detail, add-familiar, etc.)
 *
 * Mobile (<640 px)  → fills the page: `absolute inset-0 flex flex-col`
 * Desktop (≥640 px) → centered card over a dimmed backdrop
 *
 * Props
 *   open      – whether to render
 *   onClose   – called on backdrop click or Escape key
 *   children  – overlay body; use `flex-shrink-0` headers + `flex-1 overflow-y-auto` sections
 *   className – extra classes applied to the mobile wrapper (e.g. "bg-[#F8FAFC]")
 */
export default function PatientPageOverlay({ open, onClose, children, className = 'bg-bg-secondary' }) {
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 640)

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

  if (!open) return null

  if (isDesktop) {
    return (
      <div
        className="fixed inset-0 z-[80] flex items-start justify-center p-8 bg-gray-900/40 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      >
        <div
          className="w-full max-w-2xl max-h-[calc(100dvh-64px)] bg-bg-secondary rounded-[28px] shadow-2xl flex flex-col overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className={`absolute inset-0 flex flex-col animate-fade-in ${className}`}>
      {children}
    </div>
  )
}
