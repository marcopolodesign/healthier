import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  MagnifyingGlass, ArrowLeft, CircleNotch, SmileyMeh,
} from '@phosphor-icons/react'
import { professionalService } from '../../services/professionalService'
import { VERTICAL_SPECIALTIES, SPECIALTY_LABELS } from '../../lib/verticals'
import { useVerticales } from '../../hooks/useVerticales'
import { toast } from '../../components/Toast'
import ProfessionalCard from '../../components/patient/ProfessionalCard'
import ProfessionalModal from '../../components/patient/ProfessionalModal'

// Modality labels (kept consistent with Consultations.jsx wizard)
const MODALITY_OPTIONS = [
  { value: 'video',      label: 'Virtual', sub: 'Videollamada segura' },
  { value: 'presencial', label: 'Presencial', sub: 'En el consultorio' },
]

/**
 * BuscarProfesional — `/paciente/buscar-profesional`
 *
 * Standalone patient page that lets a patient search for a professional
 * by specialty (vertical) and modality, then open a detail modal to book.
 *
 * URL params (all optional):
 *   ?vertical=clinica|nutricion|mente|fisico|veterinaria
 *   ?modality=video|presencial
 *
 * After clicking "Reservar ahora" in the modal, the user is sent to
 * /paciente/consultas?vertical=<id>&pro=<userId>&modality=<value>
 * so Consultations.jsx can auto-open the booking wizard with the pro pre-selected.
 */
export default function BuscarProfesional({ profile }) {
  // Habilitación de cada vertical: sale de `vertical_settings`, no del código.
  const { verticales: VERTICALS } = useVerticales()

  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // ── Filters ───────────────────────────────────────────────────────────────
  const paramVertical = searchParams.get('vertical') || ''
  const paramModality = searchParams.get('modality') || 'video'

  const [selectedVerticalId, setSelectedVerticalId] = useState(
    VERTICALS.find(v => v.id === paramVertical) ? paramVertical : '',
  )
  const [modality, setModality] = useState(
    MODALITY_OPTIONS.find(m => m.value === paramModality) ? paramModality : 'video',
  )
  const [searchQuery, setSearchQuery] = useState('')

  // ── Results ───────────────────────────────────────────────────────────────
  const [pros, setPros] = useState([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)   // has a search been performed?

  // ── Selected / modal ──────────────────────────────────────────────────────
  const [selectedPro, setSelectedPro] = useState(null)
  const [modalOpen, setModalOpen]     = useState(false)

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchPros = useCallback(async (verticalId) => {
    const slugs = VERTICAL_SPECIALTIES[verticalId] || []
    if (!slugs.length) {
      setPros([])
      setFetched(true)
      return
    }
    setLoading(true)
    setFetched(false)
    try {
      const data = await professionalService.search({})
      // Filter to specialties that belong to the selected vertical
      setPros(data.filter(p => slugs.includes(p.specialty)))
    } catch {
      toast.error('Error al buscar profesionales')
      setPros([])
    } finally {
      setLoading(false)
      setFetched(true)
    }
  }, [])

  // Auto-fetch when vertical is pre-set from URL params
  useEffect(() => {
    if (selectedVerticalId) {
      fetchPros(selectedVerticalId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSelectVertical = (id) => {
    setSelectedVerticalId(id)
    setPros([])
    setFetched(false)
    setSelectedPro(null)
    setSearchParams(prev => {
      prev.set('vertical', id)
      return prev
    })
    fetchPros(id)
  }

  const handleModalityChange = (val) => {
    setModality(val)
    setSearchParams(prev => {
      prev.set('modality', val)
      return prev
    })
  }

  const handleCardSelect = (pro) => {
    setSelectedPro(pro)
    setModalOpen(true)
  }

  /**
   * "Reservar ahora" from the modal:
   * Navigate to /paciente/consultas with params so the booking wizard
   * opens pre-filled with this professional.
   */
  const handleBook = (pro) => {
    setModalOpen(false)
    navigate(
      `/paciente/consultas?vertical=${selectedVerticalId}&pro=${pro.userId}&modality=${modality}`,
    )
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const selectedVertical = VERTICALS.find(v => v.id === selectedVerticalId) || null

  const filteredPros = searchQuery.trim()
    ? pros.filter(p => {
        const name    = (p.profiles?.fullName || '').toLowerCase()
        const spec    = (SPECIALTY_LABELS[p.specialty] || '').toLowerCase()
        const q       = searchQuery.toLowerCase()
        return name.includes(q) || spec.includes(q)
      })
    : pros

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="absolute inset-0 bg-bg-primary overflow-y-auto scrollbar-hide animate-fade-in">
      <div className="max-w-2xl mx-auto px-6 pt-6 sm:pt-8 pb-32">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(-1)}
            className="w-10 h-10 rounded-full bg-bg-secondary border border-border-default flex items-center justify-center hover:bg-gray-100 transition-colors shrink-0"
          >
            <ArrowLeft className="w-5 h-5 text-text-primary" />
          </button>
          <div>
            <h1 className="text-[28px] font-bold text-text-primary tracking-tight leading-none">
              Buscar Profesional
            </h1>
            <p className="text-[13px] text-text-tertiary font-medium mt-1">
              Encontrá al especialista ideal para vos
            </p>
          </div>
        </div>

        {/* ── Vertical chips ─────────────────────────────────────────────── */}
        <section className="mb-5">
          <p className="text-[11px] font-bold text-text-muted uppercase tracking-widest mb-2.5">
            Especialidad
          </p>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-6 px-6 pb-1">
            {VERTICALS.map(v => {
              const isActive = selectedVerticalId === v.id
              return (
                <button
                  key={v.id}
                  disabled={v.comingSoon}
                  onClick={v.comingSoon ? undefined : () => handleSelectVertical(v.id)}
                  className={`flex items-center gap-2 rounded-[28px] px-4 py-2.5 shrink-0 border transition-all font-medium text-[13px]
                    ${v.comingSoon
                      ? 'bg-bg-secondary border-border-default opacity-50 cursor-default'
                      : isActive
                        ? 'border-transparent text-white shadow-md'
                        : 'bg-bg-secondary border-border-default hover:border-brand/40 hover:bg-white'}`}
                  style={!v.comingSoon && isActive ? { backgroundColor: v.color } : { color: v.color }}
                >
                  <v.icon className="w-[16px] h-[16px] shrink-0" style={{ color: (!v.comingSoon && isActive) ? '#fff' : v.color }} />
                  <span style={{ color: (!v.comingSoon && isActive) ? '#fff' : v.color }}>{v.nombre}</span>
                  {v.comingSoon && (
                    <span className="text-[9px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded-full ml-0.5" style={{ backgroundColor: v.bg, color: v.color }}>Pronto</span>
                  )}
                </button>
              )
            })}
          </div>
        </section>

        {/* ── Modality tabs ──────────────────────────────────────────────── */}
        <section className="mb-5">
          <p className="text-[11px] font-bold text-text-muted uppercase tracking-widest mb-2.5">
            Modalidad
          </p>
          <div className="flex bg-bg-secondary border border-border-default p-1 rounded-[32px]">
            {MODALITY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => handleModalityChange(opt.value)}
                className={`flex-1 py-2 text-[13px] rounded-[28px] transition-all
                  ${modality === opt.value
                    ? 'bg-white font-bold text-text-primary shadow-sm'
                    : 'font-medium text-text-tertiary'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        {/* ── Search box (only when results are loaded) ──────────────────── */}
        {fetched && pros.length > 0 && (
          <div className="relative mb-5">
            <MagnifyingGlass className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar por nombre o especialidad…"
              className="w-full bg-bg-secondary border border-border-default rounded-[20px] pl-10 pr-4 py-3 text-[14px] text-text-primary placeholder:text-text-muted outline-none focus:border-brand/60 transition-colors"
            />
          </div>
        )}

        {/* ── Results area ───────────────────────────────────────────────── */}
        {!selectedVerticalId && !loading && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 bg-bg-secondary rounded-full flex items-center justify-center mb-4 border border-border-default">
              <MagnifyingGlass className="w-7 h-7 text-text-muted" />
            </div>
            <p className="font-bold text-[16px] text-text-primary mb-1">
              Elegí una especialidad
            </p>
            <p className="text-[13px] text-text-tertiary max-w-xs">
              Seleccioná la especialidad que necesitás para ver los profesionales disponibles.
            </p>
          </div>
        )}

        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-[88px] bg-bg-secondary rounded-[24px] border border-border-default animate-pulse" />
            ))}
          </div>
        )}

        {!loading && fetched && filteredPros.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 bg-bg-secondary rounded-full flex items-center justify-center mb-4 border border-border-default">
              <SmileyMeh className="w-8 h-8 text-text-muted" />
            </div>
            <p className="font-bold text-[16px] text-text-primary mb-1">
              {searchQuery ? 'Sin resultados' : 'Sin profesionales disponibles'}
            </p>
            <p className="text-[13px] text-text-tertiary max-w-xs">
              {searchQuery
                ? `No encontramos profesionales que coincidan con "${searchQuery}".`
                : `No hay profesionales verificados para esta especialidad por el momento.`}
            </p>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="mt-4 text-brand text-[13px] font-semibold underline underline-offset-2"
              >
                Limpiar búsqueda
              </button>
            )}
          </div>
        )}

        {!loading && filteredPros.length > 0 && (
          <div className="space-y-3">
            {/* Result count */}
            <p className="text-[12px] text-text-muted font-medium">
              {filteredPros.length} {filteredPros.length === 1 ? 'profesional encontrado' : 'profesionales encontrados'}
              {selectedVertical ? ` en ${selectedVertical.nombre}` : ''}
            </p>
            {filteredPros.map(pro => (
              <ProfessionalCard
                key={pro.id || pro.userId}
                pro={pro}
                modality={modality}
                isSelected={selectedPro?.userId === pro.userId}
                onSelect={() => handleCardSelect(pro)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Professional detail modal ─────────────────────────────────── */}
      <ProfessionalModal
        pro={selectedPro}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        modality={modality}
        onBook={handleBook}
        vertical={selectedVertical}
      />
    </div>
  )
}
