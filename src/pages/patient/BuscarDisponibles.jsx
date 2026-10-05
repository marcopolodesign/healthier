import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, MagnifyingGlass, SmileyMeh } from '@phosphor-icons/react'
import { professionalService } from '../../services/professionalService'
import { consultationsService } from '../../services/consultationsService'
import { useVerticales } from '../../hooks/useVerticales'
import { useEspecialidades } from '../../hooks/useEspecialidades'
import { track } from '../../utils/analytics'

/** Especialidad → vertical, sin acento y en minúscula para el buscador de texto. */
function normalizar(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

const VERTICAL_BG_CLASS = {
  clinica:   'bg-[#7CB38B1F]',
  pediatria: 'bg-[#DB27771F]',
  mente:     'bg-[#9B8EC41F]',
  nutricion: 'bg-[#E8927C1F]',
}

/**
 * "Buscar por nombre — disponibles ahora" (`/paciente/buscar-disponibles`) —
 * pantalla nueva del spec 2026-09-23, acceso desde el Inicio.
 *
 * Distinta de `/paciente/buscar` (Search.jsx): ésa busca entre TODOS los
 * profesionales cobrables para agendar un turno; ésta sólo entre los que
 * están on demand y en línea AHORA MISMO — el que está en atención con otro
 * paciente se ve apagado y no se puede tocar.
 */
export default function BuscarDisponibles() {
  const navigate = useNavigate()
  const { verticalesById } = useVerticales()
  const { porSlug, porVertical } = useEspecialidades()

  const [pros, setPros] = useState([])
  const [ocupados, setOcupados] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [texto, setTexto] = useState('')
  const [chip, setChip] = useState('')

  const cargar = () => {
    setLoading(true)
    setError(false)
    Promise.all([
      professionalService.search({ onDemand: true, onlyLive: true }),
      consultationsService.getProfesionalesEnAtencion(),
    ])
      .then(([prosData, ocupadosSet]) => { setPros(prosData); setOcupados(ocupadosSet) })
      .catch(() => { setError(true); setPros([]) })
      .finally(() => setLoading(false))
  }

  useEffect(cargar, [])

  // slug de especialidad → id de vertical, para el chip de filtro y para
  // armar el link a `/paciente/ondemand/:vertical?pro=`.
  const verticalDeSlug = useMemo(() => {
    const map = {}
    Object.entries(porVertical).forEach(([vid, slugs]) => slugs.forEach(s => { map[s] = vid }))
    return map
  }, [porVertical])

  const chips = useMemo(
    () => ['clinica', 'pediatria', 'mente', 'nutricion']
      .map(id => verticalesById[id])
      .filter(v => v && !v.comingSoon),
    [verticalesById]
  )

  const filtrados = useMemo(() => {
    const q = normalizar(texto.trim())
    return pros
      .map(p => ({ ...p, verticalId: verticalDeSlug[p.specialty] ?? null, ocupado: ocupados.has(p.userId) }))
      .filter(p => {
        if (chip && p.verticalId !== chip) return false
        if (q && !normalizar(p.profiles?.fullName).includes(q)) return false
        return true
      })
      // Libres primero — el ocupado no es lo que el paciente vino a buscar.
      .sort((a, b) => Number(a.ocupado) - Number(b.ocupado))
  }, [pros, chip, texto, ocupados, verticalDeSlug])

  const irAConsultar = (p) => {
    if (p.ocupado || !p.verticalId) return
    track('buscar_disponibles_select', { professional_id: p.userId, vertical: p.verticalId, flow: 'paciente' })
    navigate(`/paciente/ondemand/${p.verticalId}?pro=${p.userId}`)
  }

  return (
    <div className="absolute inset-0 bg-bg-primary overflow-y-auto scrollbar-hide animate-fade-in">
      <div className="max-w-2xl mx-auto px-6 pt-6 sm:pt-8 pb-32">

        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={() => navigate(-1)}
            aria-label="Volver"
            className="w-10 h-10 rounded-full bg-bg-secondary border border-border-default flex items-center justify-center hover:bg-gray-100 transition-colors shrink-0"
          >
            <ArrowLeft className="w-5 h-5 text-text-primary" />
          </button>
          <div className="min-w-0">
            <h1 className="text-[26px] sm:text-[28px] font-light text-text-primary tracking-tight leading-none">Buscar por nombre</h1>
            <p className="text-[13px] text-text-tertiary font-medium mt-1">Profesionales listos para atenderte ahora mismo</p>
          </div>
        </div>

        <div className="relative mb-4">
          <MagnifyingGlass className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
          <input
            type="search"
            autoFocus
            value={texto}
            onChange={e => setTexto(e.target.value)}
            placeholder="Nombre o especialidad…"
            aria-label="Buscar profesional disponible ahora"
            className="w-full bg-bg-secondary border border-border-default rounded-[20px] pl-10 pr-4 py-3 text-[15px] text-text-primary placeholder:text-text-muted outline-none focus:border-brand/60 transition-colors"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-6 px-6 pb-1 mb-5">
          <button
            onClick={() => setChip('')}
            className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-medium border transition-colors ${
              chip === '' ? 'bg-brand text-white border-brand' : 'bg-bg-secondary text-text-secondary border-border-default hover:border-brand/40'
            }`}
          >
            Todas
          </button>
          {chips.map(v => (
            <button
              key={v.id}
              onClick={() => setChip(chip === v.id ? '' : v.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-medium border transition-colors ${
                chip === v.id ? 'bg-brand text-white border-brand' : 'bg-bg-secondary text-text-secondary border-border-default hover:border-brand/40'
              }`}
            >
              {v.nombre}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-[86px] bg-bg-secondary rounded-2xl border border-border-default animate-pulse" />)}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="font-bold text-[16px] text-text-primary mb-1">No pudimos buscar</p>
            <p className="text-[13px] text-text-tertiary max-w-xs mb-4">Revisá tu conexión y probá de nuevo.</p>
            <button onClick={cargar} className="text-brand text-[13px] font-semibold underline underline-offset-2">Reintentar</button>
          </div>
        ) : filtrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 bg-bg-secondary rounded-full flex items-center justify-center mb-4 border border-border-default">
              <SmileyMeh className="w-8 h-8 text-text-muted" />
            </div>
            <p className="font-bold text-[16px] text-text-primary mb-1">
              {pros.length === 0 ? 'Ahora no hay nadie disponible' : 'Sin resultados'}
            </p>
            <p className="text-[13px] text-text-tertiary max-w-xs mb-4">
              {pros.length === 0
                ? 'Ningún profesional está en línea para atención inmediata en este momento.'
                : 'No encontramos a nadie disponible ahora que coincida con tu búsqueda.'}
            </p>
            <button
              onClick={() => { track('buscar_disponibles_empty_book', { flow: 'paciente' }); navigate('/paciente/consultas') }}
              className="btn-primary px-6 py-3 text-[14px]"
            >
              Sacá un turno
            </button>
          </div>
        ) : (
          <>
            <p className="text-[12px] text-text-muted font-medium mb-3">
              {(() => {
                const libres = filtrados.filter(p => !p.ocupado).length
                return libres === 1 ? '1 profesional disponible' : `${libres} profesionales disponibles`
              })()}
            </p>
            <div className="flex flex-col gap-2.5">
            {filtrados.map(p => {
              const nombre = p.profiles?.fullName || 'Profesional'
              const label = porSlug[p.specialty] || verticalesById[p.verticalId]?.nombre || p.specialty
              const precio = p.verticalId ? verticalesById[p.verticalId]?.onDemandPrice : null
              return (
                <button
                  key={p.userId}
                  onClick={() => irAConsultar(p)}
                  disabled={p.ocupado}
                  className={`bg-bg-secondary border border-border-default rounded-[24px] p-3.5 flex items-center gap-3 text-left transition-colors ${
                    p.ocupado ? 'opacity-50 cursor-not-allowed' : 'hover:border-brand/40 active:opacity-90'
                  }`}
                >
                  <span className={`w-[46px] h-[46px] rounded-full flex items-center justify-center shrink-0 overflow-hidden ${VERTICAL_BG_CLASS[p.verticalId] || 'bg-brand-muted'}`}>
                    {p.profiles?.avatarUrl
                      ? <img src={p.profiles.avatarUrl} alt="" className="w-full h-full object-cover" />
                      : <span className="text-[16px] font-semibold text-text-primary">{nombre[0]}</span>}
                  </span>
                  <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="font-medium text-[15px] text-text-primary truncate">{nombre}</span>
                    <span className="text-[12px] text-text-tertiary">
                      {label}{precio != null ? ` · $${Number(precio).toLocaleString('es-AR')}` : ''}
                    </span>
                    {p.ocupado ? (
                      <span className="text-[11px] text-text-muted">En atención</span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <span className="w-[7px] h-[7px] rounded-full bg-brand" />
                        <span className="text-[11px] font-medium text-brand-hover">Disponible ahora</span>
                      </span>
                    )}
                  </span>
                  {p.ocupado ? (
                    <span className="shrink-0 px-4 py-2.5 rounded-full border border-border-default text-[13px] text-text-muted">Ocupado</span>
                  ) : (
                    <span className="shrink-0 px-4 py-2.5 rounded-full bg-brand text-white text-[13px] font-medium">Hablar ahora</span>
                  )}
                </button>
              )
            })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
