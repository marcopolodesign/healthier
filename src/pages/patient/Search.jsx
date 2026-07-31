import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MagnifyingGlass, ArrowLeft, CircleNotch, SmileyMeh, X,
} from '@phosphor-icons/react'
import { professionalService } from '../../services/professionalService'
import { SPECIALTY_LABELS } from '../../lib/verticals'
import ProfessionalCard from '../../components/ProfessionalCard'
import { toast } from '../../components/Toast'

/**
 * Buscar profesionales por nombre — `/paciente/buscar`
 *
 * Barra de búsqueda arriba y la lista abajo: se entra a buscar a alguien, no a
 * configurar filtros. Antes esta pantalla abría con tres selects (especialidad,
 * calificación, "disponible ahora") y ningún campo de nombre, que es lo único
 * que el paciente sabe cuando le recomendaron un profesional.
 *
 * **Sólo aparecen los que tienen Mercado Pago conectado** (Mateo, 2026-07-31):
 * si no puede cobrar, no puede atender, y mostrarlo sólo lleva a un callejón sin
 * salida al intentar reservar. El filtro es del lado del servidor — ver
 * `professionalService.buscarCobrables`.
 *
 * La especialidad quedó como un chip opcional y no como un select obligatorio:
 * acota, no gatea. La lista de chips sale de `SPECIALTY_LABELS`, que es la fuente
 * única; la lista que había acá era una copia a mano y ya se le habían quedado
 * afuera pediatría y veterinaria.
 */

// Un espejo escrito a mano se desactualiza: se derivan de la fuente única, sin
// 'otra', que como filtro no le dice nada al paciente.
const CHIPS_ESPECIALIDAD = Object.entries(SPECIALTY_LABELS)
  .filter(([value]) => value !== 'otra')
  .map(([value, label]) => ({ value, label }))

const DEBOUNCE_MS = 300

export default function PatientSearch() {
  const navigate = useNavigate()
  const [texto, setTexto] = useState('')
  const [especialidad, setEspecialidad] = useState('')
  const [resultados, setResultados] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(false)
  const inputRef = useRef(null)

  const buscar = useCallback(async (q, esp) => {
    setCargando(true)
    setError(false)
    try {
      const data = await professionalService.buscarCobrables({
        texto: q,
        especialidades: esp ? [esp] : null,
      })
      setResultados(data)
    } catch {
      setError(true)
      setResultados([])
      toast.error('No pudimos buscar profesionales')
    } finally {
      setCargando(false)
    }
  }, [])

  // Debounce: cada tecla contra la base es innecesario y hace parpadear la lista
  // mientras se escribe.
  useEffect(() => {
    const t = setTimeout(() => buscar(texto, especialidad), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [texto, especialidad, buscar])

  const limpiar = () => {
    setTexto('')
    inputRef.current?.focus()
  }

  const hayFiltros = Boolean(texto.trim() || especialidad)

  return (
    <div className="absolute inset-0 bg-bg-primary overflow-y-auto scrollbar-hide animate-fade-in">
      <div className="max-w-2xl mx-auto px-6 pt-6 sm:pt-8 pb-32">

        {/* Encabezado */}
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={() => navigate(-1)}
            aria-label="Volver"
            className="w-10 h-10 rounded-full bg-bg-secondary border border-border-default flex items-center justify-center hover:bg-gray-100 transition-colors shrink-0"
          >
            <ArrowLeft className="w-5 h-5 text-text-primary" />
          </button>
          <div className="min-w-0">
            <h1 className="text-[28px] font-bold text-text-primary tracking-tight leading-none">
              Buscar profesional
            </h1>
            <p className="text-[13px] text-text-tertiary font-medium mt-1">
              Por nombre o especialidad
            </p>
          </div>
        </div>

        {/* Barra de búsqueda — arriba de todo, con el foco puesto al entrar */}
        <div className="relative mb-4">
          <MagnifyingGlass className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
          <input
            ref={inputRef}
            type="search"
            autoFocus
            value={texto}
            onChange={e => setTexto(e.target.value)}
            placeholder="Buscá por nombre…"
            aria-label="Buscar profesional por nombre"
            className="w-full bg-bg-secondary border border-border-default rounded-[20px] pl-10 pr-10 py-3 text-[15px] text-text-primary placeholder:text-text-muted outline-none focus:border-brand/60 transition-colors"
          />
          {texto && (
            <button
              onClick={limpiar}
              aria-label="Limpiar búsqueda"
              className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-border-default/60 flex items-center justify-center hover:bg-border-default transition-colors"
            >
              <X className="w-3.5 h-3.5 text-text-secondary" />
            </button>
          )}
        </div>

        {/* Especialidad — acota, no gatea */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-6 px-6 pb-1 mb-5">
          <button
            onClick={() => setEspecialidad('')}
            className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-medium border transition-colors ${
              especialidad === ''
                ? 'bg-brand text-white border-brand'
                : 'bg-bg-secondary text-text-secondary border-border-default hover:border-brand/40'
            }`}
          >
            Todas
          </button>
          {CHIPS_ESPECIALIDAD.map(e => (
            <button
              key={e.value}
              onClick={() => setEspecialidad(especialidad === e.value ? '' : e.value)}
              className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-medium border transition-colors ${
                especialidad === e.value
                  ? 'bg-brand text-white border-brand'
                  : 'bg-bg-secondary text-text-secondary border-border-default hover:border-brand/40'
              }`}
            >
              {e.label}
            </button>
          ))}
        </div>

        {/* Resultados */}
        {cargando ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-[168px] bg-bg-secondary rounded-2xl border border-border-default animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 bg-bg-secondary rounded-full flex items-center justify-center mb-4 border border-border-default">
              <CircleNotch className="w-7 h-7 text-text-muted" />
            </div>
            <p className="font-bold text-[16px] text-text-primary mb-1">No pudimos buscar</p>
            <p className="text-[13px] text-text-tertiary max-w-xs">Revisá tu conexión y probá de nuevo.</p>
            <button
              onClick={() => buscar(texto, especialidad)}
              className="mt-4 text-brand text-[13px] font-semibold underline underline-offset-2"
            >
              Reintentar
            </button>
          </div>
        ) : resultados.length === 0 ? (
          /* Vacío explicado: una lista vacía sin motivo hace pensar que la app
             falló. Se distingue "no coincide tu búsqueda" de "todavía no hay
             nadie disponible", que son problemas distintos. */
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 bg-bg-secondary rounded-full flex items-center justify-center mb-4 border border-border-default">
              <SmileyMeh className="w-8 h-8 text-text-muted" />
            </div>
            <p className="font-bold text-[16px] text-text-primary mb-1">
              {hayFiltros ? 'Sin resultados' : 'Todavía no hay profesionales disponibles'}
            </p>
            <p className="text-[13px] text-text-tertiary max-w-xs">
              {hayFiltros
                ? 'No encontramos profesionales disponibles que coincidan con tu búsqueda.'
                : 'Estamos sumando profesionales. Probá de nuevo en un rato.'}
            </p>
            {hayFiltros && (
              <button
                onClick={() => { setTexto(''); setEspecialidad('') }}
                className="mt-4 text-brand text-[13px] font-semibold underline underline-offset-2"
              >
                Limpiar búsqueda
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="text-[12px] text-text-muted font-medium mb-3">
              {resultados.length} {resultados.length === 1 ? 'profesional disponible' : 'profesionales disponibles'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* La prop es `professional`, no `pro`: con `pro` este componente
                  destructura undefined y la página queda en blanco. Hay DOS
                  ProfessionalCard con APIs distintas — el de
                  `components/patient/` sí usa `pro`. */}
              {resultados.map(p => (
                <ProfessionalCard key={p.id} professional={p} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
