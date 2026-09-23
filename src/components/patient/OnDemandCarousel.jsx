import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { lerpColor } from '../../lib/color'
import { track } from '../../utils/analytics'

/**
 * Colores del degradé de "Atención inmediata" — spec 2026-09-23. A propósito
 * SEPARADOS de la identidad visual de `lib/verticals.js` (que sigue pintando
 * el mapa, las etiquetas de Consultas, etc.): éste es el lenguaje de color
 * nuevo del carrusel on demand, no un reskin de la app entera.
 */
const GRADIENT_COLOR = {
  clinica:   '#7CB38B',
  pediatria: '#D9699C',
  mente:     '#9B8EC4', // Psicología
  nutricion: '#E8927C',
}
const FALLBACK_COLOR = '#7CB38B'

// Clases literales (Tailwind las detecta por string, no por valor calculado)
// para el fondo de una tarjeta sin foto (hoy sólo Psicología no tiene una).
const VERTICAL_BG_CLASS = {
  clinica:   'bg-[#7CB38B]',
  pediatria: 'bg-[#D9699C]',
  mente:     'bg-[#9B8EC4]',
  nutricion: 'bg-[#E8927C]',
}

const CARD_W = 290
const GAP = 6

/**
 * Carrusel horizontal de "Atención inmediata" del Inicio del paciente.
 *
 * Scroll nativo con snap (no drag manual con pointer events — un handler de
 * pointer casero pisa el scroll nativo y rompe el tap sobre la tarjeta). Un
 * listener de `scroll` con rAF calcula, en cada tick, cuán cerca está cada
 * tarjeta del centro y lo escribe en `--progress` (interpola escala/opacidad,
 * ver `od-card` en index.css) y el color de fondo interpolado en
 * `--gradient-color` — todo vía refs, nunca con `setState` por tarjeta (eso
 * re-renderizaría React en cada frame del scroll).
 *
 * `verticals` ya viene filtrado a las que tienen ≥1 profesional on demand
 * disponible ahora, en el orden fijo del spec (Clínica, Pediatría,
 * Psicología, Nutrición). Con la lista vacía se muestra la tarjeta única de
 * "no hay nadie en línea".
 *
 * `header` (opcional) se pinta arriba de todo, DENTRO del área del degradé —
 * es donde Dashboard.jsx cuelga `<PatientHeader>` para que "Hola, {nombre}" y
 * la campanita queden sobre el mismo verde, no en una franja aparte.
 */
export default function OnDemandCarousel({ verticals, header }) {
  const navigate = useNavigate()
  const scrollRef = useRef(null)
  const bgRef = useRef(null)
  const cardRefs = useRef({})
  const rafRef = useRef(null)
  const [activeIndex, setActiveIndex] = useState(0)

  // El color inicial del degradé (antes de que corra el primer scroll) va acá
  // y no en `style={{}}` de JSX — CLAUDE.md: nunca `style=` en el markup,
  // sólo `el.style.setProperty(...)` sobre un ref.
  useEffect(() => {
    const color = GRADIENT_COLOR[verticals[0]?.id] || FALLBACK_COLOR
    bgRef.current?.style.setProperty('--gradient-color', color)
  }, [verticals])

  const updateFromScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || verticals.length === 0) return
    const raw = el.scrollLeft / (CARD_W + GAP)
    const clamped = Math.max(0, Math.min(verticals.length - 1, raw))

    verticals.forEach((v, i) => {
      const cardEl = cardRefs.current[v.id]
      if (!cardEl) return
      const progress = Math.max(0, 1 - Math.abs(clamped - i))
      cardEl.style.setProperty('--progress', String(progress))
    })

    const lower = Math.floor(clamped)
    const upper = Math.min(verticals.length - 1, lower + 1)
    const t = clamped - lower
    const colorA = GRADIENT_COLOR[verticals[lower]?.id] || FALLBACK_COLOR
    const colorB = GRADIENT_COLOR[verticals[upper]?.id] || colorA
    bgRef.current?.style.setProperty('--gradient-color', lerpColor(colorA, colorB, t))

    setActiveIndex(Math.round(clamped))
  }, [verticals])

  useEffect(() => { updateFromScroll() }, [updateFromScroll])

  const onScroll = () => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      updateFromScroll()
    })
  }

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  const empezar = (v) => {
    if (v.disponible === false) {
      // Sin nadie en línea: a sacar turno de esa misma especialidad.
      track('ondemand_offline_book', { vertical: v.id, flow: 'paciente' })
      navigate(`/paciente/consultas?vertical=${v.id}`)
      return
    }
    track('ondemand_start', { vertical: v.id, flow: 'paciente' })
    navigate(`/paciente/ondemand/${v.id}`)
  }

  // El fondo (degradé) es hijo directo de la raíz, SIN el padding del resto
  // del contenido — así queda de borde a borde. El texto y el carrusel van
  // adentro de un wrapper con `px-6 patient-column`, salvo la fila de
  // tarjetas, que se sale del padding para poder centrarlas con
  // `calc(50% - 145px)` contra el ancho real de la pantalla.
  if (verticals.length === 0) {
    return (
      <div data-tour="pac-ondemand" className="relative">
        <div ref={bgRef} className="absolute inset-x-0 top-0 h-[520px] od-gradient-bg" />
        <div className="relative flex flex-col gap-5 px-6 patient-column pt-safe sm:pt-10 pb-8">
          {header}
          <div>
            <span className="text-[11px] font-semibold tracking-widest uppercase text-white/75">Atención inmediata</span>
            <h2 className="text-[26px] tracking-tight font-light leading-tight mt-1.5 text-white">Tu atención virtual inmediata</h2>
            <p className="text-[13px] text-white/90 mt-2">Sin turno · Te atiende el primero disponible, en minutos</p>
          </div>
          <div className="w-full max-w-[290px] mx-auto bg-white/10 border border-white/20 rounded-[28px] p-7 flex flex-col items-center text-center gap-4">
            <p className="text-white font-medium text-[16px] leading-snug">Ahora no hay profesionales en línea</p>
            <button
              onClick={() => { track('ondemand_none_available_book', { flow: 'paciente' }); navigate('/paciente/consultas') }}
              className="px-5 py-2.5 rounded-full bg-white text-text-primary text-[13px] font-semibold"
            >
              Sacá un turno
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-tour="pac-ondemand" className="relative">
      <div ref={bgRef} className="absolute inset-x-0 top-0 h-[520px] od-gradient-bg" />
      <div className="relative flex flex-col gap-2 pb-8">
        <div className="flex flex-col gap-5 px-6 patient-column pt-safe sm:pt-10">
          {header}
          <div>
            <span className="text-[11px] font-semibold tracking-widest uppercase text-white/75">Atención inmediata</span>
            <h2 className="text-[26px] tracking-tight font-light leading-tight mt-1.5 text-white">Tu atención virtual inmediata</h2>
            <p className="text-[13px] text-white/90 mt-2">Sin turno · Te atiende el primero disponible, en minutos</p>
          </div>
        </div>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="overflow-x-auto scrollbar-hide snap-x snap-mandatory flex gap-1.5 px-[calc(50%-145px)] mt-1"
        >
          {verticals.map(v => (
            <button
              key={v.id}
              ref={el => { if (el) cardRefs.current[v.id] = el }}
              onClick={() => empezar(v)}
              className={`od-card snap-center shrink-0 relative w-[290px] h-[340px] rounded-[28px] overflow-hidden shadow-[0_18px_40px_rgba(0,0,0,0.18)] ${v.disponible === false ? 'od-card-offline' : ''}`}
            >
              {v.img ? (
                <img src={v.img} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <span className={`absolute inset-0 ${VERTICAL_BG_CLASS[v.id] || 'bg-brand'}`} />
              )}
              <span className="absolute inset-0 bg-gradient-to-b from-transparent via-black/25 to-black/75" />
              {v.onDemandPrice != null && (
                <span className="absolute top-3.5 right-3.5 px-2.5 py-1.5 rounded-full bg-black/45 text-white text-[13px] font-medium">
                  ${Number(v.onDemandPrice).toLocaleString('es-AR')}
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 p-[18px] flex flex-col items-start gap-2.5">
                <span className="text-[22px] font-medium text-white">{v.nombre}</span>
                {v.disponible === false && <span className="-mt-1.5 text-[12px] text-white/90">Sin profesionales en línea ahora</span>}
                <span className="px-[18px] py-2 rounded-full bg-white text-text-primary text-[14px] font-medium">{v.disponible === false ? 'Sacá un turno' : 'Empezar'}</span>
              </span>
            </button>
          ))}
        </div>

        {verticals.length > 1 && (
          <div className="flex justify-center gap-1.5 mt-1">
            {verticals.map((v, i) => (
              <span
                key={v.id}
                className={`h-1.5 rounded-full transition-all ${i === activeIndex ? 'w-[18px] bg-[#2D2A26]' : 'w-1.5 bg-[#2D2A26]/25'}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
