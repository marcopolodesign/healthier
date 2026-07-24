import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, VideoCamera, MapPin, Star, CaretRight, Check,
  CircleNotch, CheckCircle, MagnifyingGlass,
} from '@phosphor-icons/react'
import { professionalService } from '../../services/professionalService'
import { availabilityService } from '../../services/availabilityService'
import { consultationsService } from '../../services/consultationsService'
import { VERTICALS, VERTICAL_SPECIALTIES, SPECIALTY_LABELS } from '../../lib/verticals'
import { toast } from '../../components/Toast'

// Verticals that trigger the clinica auto-match flow
const AUTO_MATCH_VERTICALS = ['clinica']

const SPECIES = ['Perro', 'Gato', 'Conejo', 'Ave', 'Otro']

// 15-min slots instead of a whole schedule block — 4 patients/hour with
// margin for delays, per Nacho Arteaga (2026-07-08).
const SLOT_DURATION_MINUTES = 15
const ACTIVE_CONSULTATION_STATUSES = ['pending', 'confirmed', 'in_progress']

function addMinutes(hhmmss, minutes) {
  const [h, m] = hhmmss.split(':').map(Number)
  const total = h * 60 + m + minutes
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0')
  const mm = String(total % 60).padStart(2, '0')
  return `${hh}:${mm}:00`
}

// Splits each schedule range ("franja") for the selected day into 15-min
// slots, skipping any that already have an active consultation booked.
function buildTimeSlots(franjasForDay, bookedTimes) {
  const slots = []
  franjasForDay.forEach(fr => {
    let cursor = fr.startTime
    while (cursor < fr.endTime) {
      const end = addMinutes(cursor, SLOT_DURATION_MINUTES)
      if (end > fr.endTime) break
      if (!bookedTimes.has(cursor.slice(0, 5))) {
        slots.push({ id: `${fr.id}-${cursor}`, startTime: cursor, endTime: end })
      }
      cursor = end
    }
  })
  return slots
}

// ── Date helpers ─────────────────────────────────────────────
function buildDateOptions(n = 14) {
  const days   = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const today  = new Date()
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const yyyy = d.getFullYear()
    const mm   = String(d.getMonth() + 1).padStart(2, '0')
    const dd   = String(d.getDate()).padStart(2, '0')
    return {
      label:     i === 0 ? 'Hoy' : `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`,
      value:     `${yyyy}-${mm}-${dd}`,
      dayOfWeek: d.getDay(),
    }
  })
}

const ALL_DATES = buildDateOptions(14)

function fmtTime(t) {
  return t ? t.slice(0, 5) : ''
}

// ── Step sequence logic ───────────────────────────────────────
function getSteps(verticalId, skipPro) {
  const base = verticalId === 'veterinaria'
    ? ['vertical', 'modality', 'pet', 'professional', 'datetime', 'confirm']
    : ['vertical', 'modality', 'professional', 'datetime', 'confirm']
  return skipPro ? base.filter(s => s !== 'professional') : base
}

// ── Normalise a raw professionalService row into a lean card object ──────────
function normalizeProCard(raw, modality = null) {
  const priceVideo      = raw.priceVideo      ?? raw.sessionPrice ?? null
  const pricePresencial = raw.pricePresencial ?? raw.sessionPrice ?? null
  const price = modality === 'virtual'
    ? priceVideo
    : modality === 'presencial'
      ? pricePresencial
      : (priceVideo ?? pricePresencial ?? null)
  return {
    id:              raw.userId,
    name:            raw.profiles?.fullName || 'Profesional',
    avatarUrl:       raw.profiles?.avatarUrl || null,
    specialty:       raw.specialty || '',
    rating:          Number(raw.averageRating ?? 0),
    reviews:         Number(raw.totalReviews ?? 0),
    price,
    priceVideo,
    pricePresencial,
    mpConnected:     raw.mpConnected !== false,
  }
}

// ── Component ─────────────────────────────────────────────────
export default function ReservarConsulta({ profile }) {
  const navigate      = useNavigate()
  const [searchParams] = useSearchParams()

  const paramVerticalId = searchParams.get('vertical')
  const paramProId      = searchParams.get('proId')
  const paramModality   = searchParams.get('modality') // 'virtual' | 'presencial'

  // ── State ─────────────────────────────────────────────────
  const [selectedVertical, setSelectedVertical] = useState(
    () => VERTICALS.find(v => v.id === paramVerticalId && !v.comingSoon) || null
  )
  const [step, setStep] = useState(() => {
    const hasVert = paramVerticalId && !VERTICALS.find(v => v.id === paramVerticalId)?.comingSoon
    if (!hasVert) return 'vertical'
    if (paramModality && paramProId) return 'datetime'
    if (paramModality) return 'professional'
    return 'modality'
  })
  const [modality, setModality] = useState(paramModality || null) // 'virtual' | 'presencial'
  const [petName, setPetName]           = useState('')
  const [petSpecies, setPetSpecies]     = useState('')
  const [professionals, setProfessionals] = useState([])
  const [loadingPros, setLoadingPros]   = useState(false)
  const [selectedPro, setSelectedPro]   = useState(null)
  const [schedule, setSchedule]         = useState([])
  const [loadingSchedule, setLoadingSchedule] = useState(false)
  const [existingConsultations, setExistingConsultations] = useState([])
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedFranja, setSelectedFranja] = useState(null)
  const [processing, setProcessing]     = useState(false)
  const [createError, setCreateError]   = useState(null)
  const [matchedPro, setMatchedPro]     = useState(null)

  const steps = getSteps(selectedVertical?.id, !!paramProId)

  // Derived — datetime step
  const scheduledDays  = new Set(schedule.map(e => e.dayOfWeek))
  const availableDates = ALL_DATES.filter(d => scheduledDays.has(d.dayOfWeek))
  const selectedDow    = selectedDate ? new Date(selectedDate + 'T12:00:00').getDay() : -1
  const franjas        = schedule.filter(e => e.dayOfWeek === selectedDow)
  const bookedTimesForDate = new Set(
    existingConsultations
      .filter(c => ACTIVE_CONSULTATION_STATUSES.includes(c.status) && c.scheduledAt)
      .map(c => new Date(c.scheduledAt))
      .filter(d => {
        const yyyy = d.getFullYear(), mm = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0')
        return `${yyyy}-${mm}-${dd}` === selectedDate
      })
      .map(d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
  )
  const timeSlots = selectedDate ? buildTimeSlots(franjas, bookedTimesForDate) : []

  // ── Pre-load pro when coming from a marker / sheet ────────
  useEffect(() => {
    if (!paramProId) return
    professionalService.search({})
      .then(data => {
        const match = data.find(p => p.userId === paramProId)
        if (match) setSelectedPro(normalizeProCard(match, modality))
      })
      .catch(() => {})
  }, [paramProId])

  // ── Load professionals when entering that step ────────────
  useEffect(() => {
    if (step !== 'professional' || !selectedVertical) return
    const slugs = VERTICAL_SPECIALTIES[selectedVertical.id] || []
    if (!slugs.length) { setProfessionals([]); return }
    setLoadingPros(true)
    professionalService.search({})
      .then(data => setProfessionals(data.filter(p => slugs.includes(p.specialty)).map(p => normalizeProCard(p, modality))))
      .catch(() => setProfessionals([]))
      .finally(() => setLoadingPros(false))
  }, [step, selectedVertical])

  // ── Searching step: fetch best pro + auto-advance after 2.5s ────────────
  useEffect(() => {
    if (step !== 'searching' || !selectedVertical) return
    const slugs = VERTICAL_SPECIALTIES[selectedVertical.id] || []
    if (slugs.length) {
      professionalService.search({})
        .then(data => {
          // Only auto-match professionals who can actually receive paid bookings (spec D4)
          const pros = data.filter(p => slugs.includes(p.specialty) && p.mpConnected !== false)
          if (pros.length) setMatchedPro(normalizeProCard(pros[0], 'virtual'))
        })
        .catch(() => {})
    }
    const t = setTimeout(() => setStep('matched'), 2500)
    return () => clearTimeout(t)
  }, [step, selectedVertical])

  // ── Pre-fetch schedule + existing bookings whenever a pro is selected ────
  useEffect(() => {
    if (!selectedPro) return
    setLoadingSchedule(true)
    setSchedule([])
    setExistingConsultations([])
    setSelectedDate('')
    setSelectedFranja(null)
    Promise.all([
      availabilityService.getSchedule(selectedPro.id),
      consultationsService.getByProfessional(selectedPro.id).catch(() => []),
    ])
      .then(([sched, cons]) => { setSchedule(sched); setExistingConsultations(cons) })
      .catch(() => setSchedule([]))
      .finally(() => setLoadingSchedule(false))
  }, [selectedPro?.id])

  const goBack = () => {
    if (step === 'searching' || step === 'matched') { setStep('modality'); setMatchedPro(null); return }
    const i = steps.indexOf(step)
    if (i <= 0) { navigate(-1); return }
    setStep(steps[i - 1])
  }

  const handleAfterModality = () => {
    if (!selectedVertical || !modality) return
    // All virtual consultations go through searching → matched → payment
    if (modality === 'virtual') {
      setStep('searching')
      return
    }
    // Presencial with pre-loaded pro (from map marker)
    if (paramProId && selectedPro) {
      setStep(selectedVertical.id === 'veterinaria' ? 'pet' : 'datetime')
      return
    }
    // Presencial standard: professional list (or pet first for vet)
    setStep(selectedVertical.id === 'veterinaria' ? 'pet' : 'professional')
  }

  const handleConfirm = async () => {
    if (!selectedVertical || !selectedPro) return

    // Virtual — navigate to the real payment step (in Consultations modal or OnDemand)
    if (modality === 'virtual') {
      // Pass all booking params to the consultas page which has the real MP payment
      navigate('/paciente/consultas', {
        state: {
          autoBook: true,
          verticalId:   selectedVertical.id,
          professionalId: selectedPro.id,
          modality,
          scheduledAt: selectedDate && selectedFranja
            ? new Date(`${selectedDate}T${selectedFranja.startTime}`).toISOString()
            : null,
        }
      })
      return
    }

    // Presencial — write directly to DB (no payment gate)
    if (!profile?.id) { toast.error('Debes iniciar sesión'); return }
    setProcessing(true)
    setCreateError(null)
    try {
      const createPayload = {
        patientId:      profile.id,
        professionalId: selectedPro.id,
        vertical:       selectedVertical.id,
        modality:       'presencial',
        status:         'confirmed',
        paymentStatus:  'pending_payment',
        priceAtBooking: modality === 'presencial'
          ? (selectedPro.pricePresencial ?? selectedPro.price ?? null)
          : (selectedPro.priceVideo ?? selectedPro.price ?? null),
        scheduledAt:    selectedDate && selectedFranja
          ? new Date(`${selectedDate}T${selectedFranja.startTime}`).toISOString()
          : new Date().toISOString(),
      }
      if (selectedVertical.id === 'veterinaria') {
        createPayload.petName    = petName    || null
        createPayload.petSpecies = petSpecies || null
      }
      const created = await consultationsService.create(createPayload)
      navigate(`/paciente/turno-confirmado/${created.id}`)
    } catch (err) {
      setCreateError(err?.message || 'Error al guardar el turno. Intentá de nuevo.')
    } finally {
      setProcessing(false)
    }
  }

  const handleConfirmMatched = () => {
    if (!selectedVertical || !matchedPro) return
    navigate('/paciente/pago', {
      state: {
        professionalId: matchedPro.id,
        professionalName: matchedPro.name,
        professionalAvatar: matchedPro.avatarUrl,
        specialty: matchedPro.specialty,
        verticalId: selectedVertical.id,
        modality: 'virtual',
        price: matchedPro.price,
      }
    })
  }

  const modalityCTA = () => {
    if (!modality) return 'Continuar'
    if (selectedPro) {
      return modality === 'virtual'
        ? `Videoconsulta con ${selectedPro.name}`
        : `Buscar turnos con ${selectedPro.name}`
    }
    if (AUTO_MATCH_VERTICALS.includes(selectedVertical?.id ?? '')) return 'Buscar profesional'
    return 'Continuar'
  }

  // Progress dots (skip for clinica auto-match)
  const showProgress = !AUTO_MATCH_VERTICALS.includes(selectedVertical?.id ?? '')
  const currentStepIndex = steps.indexOf(step)

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="absolute inset-0 overflow-y-auto bg-bg-primary">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-bg-primary/95 backdrop-blur-sm border-b border-border-default">
        <div className="flex items-center gap-3 px-4 py-4 max-w-lg mx-auto">
          <button
            onClick={goBack}
            className="w-9 h-9 rounded-full bg-bg-secondary border border-border-default flex items-center justify-center flex-shrink-0 hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-text-primary" />
          </button>
          <h2 className="flex-1 text-center font-serif font-bold text-lg text-text-primary">
            Nueva consulta
          </h2>
          <div className="w-9" /> {/* spacer */}
        </div>

        {/* Progress bar */}
        {showProgress && (
          <div className="flex gap-1.5 px-4 pb-3 max-w-lg mx-auto">
            {steps.map((s, i) => (
              <div
                key={s}
                className={`flex-1 h-1 rounded-full transition-colors ${
                  i < currentStepIndex
                    ? 'bg-brand/50'
                    : i === currentStepIndex
                      ? 'bg-brand'
                      : 'bg-border-default'
                }`}
              />
            ))}
          </div>
        )}
      </div>

      <div className="px-4 py-6 pb-32 max-w-lg mx-auto space-y-4">

        {/* ── STEP: Vertical ── */}
        {step === 'vertical' && (
          <>
            <h1 className="font-serif font-bold text-3xl text-text-primary">
              ¿Qué especialidad buscás?
            </h1>
            <div className="space-y-2">
              {VERTICALS.map(v => {
                const Icon = v.icon
                return (
                  <button
                    key={v.id}
                    disabled={v.comingSoon}
                    onClick={v.comingSoon ? undefined : () => { setSelectedVertical(v); setStep('modality') }}
                    className={`w-full flex items-center gap-3 bg-bg-secondary rounded-2xl border border-border-default px-4 py-4 transition-all text-left ${
                      v.comingSoon
                        ? 'opacity-60 cursor-default'
                        : 'hover:border-brand/40 hover:shadow-sm active:scale-[0.99]'
                    }`}
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: v.bg }}
                    >
                      <Icon className="w-5 h-5" style={{ color: v.color }} />
                    </div>
                    <span
                      className="flex-1 text-[18px] leading-snug font-medium"
                      style={{ color: v.color }}
                    >
                      {v.nombre}
                    </span>
                    {v.comingSoon
                      ? <span className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full" style={{ backgroundColor: v.bg, color: v.color }}>Próximamente</span>
                      : <CaretRight className="w-4 h-4 text-text-tertiary" />
                    }
                  </button>
                )
              })}
            </div>
          </>
        )}

        {/* ── STEP: Modality ── */}
        {step === 'modality' && selectedVertical && (
          <>
            <h1 className="font-serif font-bold text-3xl text-text-primary">
              ¿Cómo querés consultar?
            </h1>
            <div className="space-y-3">
              {[
                { id: 'virtual',    label: 'Videoconsulta', sub: 'Desde donde estés',   Icon: VideoCamera, color: '#7CB38B', bg: 'rgba(124,179,139,0.10)' },
                { id: 'presencial', label: 'Presencial',    sub: 'En el consultorio',   Icon: MapPin,      color: '#059669', bg: 'rgba(5,150,105,0.10)'   },
              ].map(m => (
                <button
                  key={m.id}
                  onClick={() => setModality(m.id)}
                  className={`w-full flex items-center gap-4 rounded-2xl border px-4 py-4 transition-all text-left ${
                    modality === m.id
                      ? 'border-brand bg-brand/5'
                      : 'border-border-default bg-bg-secondary hover:border-brand/30'
                  }`}
                >
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: m.bg }}
                  >
                    <m.Icon className="w-6 h-6" style={{ color: m.color }} />
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-[15px] text-text-primary">{m.label}</div>
                    <div className="text-[13px] text-text-secondary mt-0.5">{m.sub}</div>
                  </div>
                  {modality === m.id && (
                    <Check className="w-5 h-5 flex-shrink-0" style={{ color: '#7CB38B' }} />
                  )}
                </button>
              ))}
            </div>
            <button
              onClick={handleAfterModality}
              disabled={!modality}
              className="w-full py-4 rounded-full font-semibold text-[15px] text-white transition-all mt-2 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#7CB38B' }}
            >
              {modalityCTA()}
            </button>
          </>
        )}

        {/* ── STEP: Searching ── */}
        {step === 'searching' && (
          <div className="flex flex-col items-center justify-center py-20 gap-6 text-center">
            <div className="w-24 h-24 rounded-full bg-brand/10 flex items-center justify-center">
              <CircleNotch className="w-10 h-10 text-brand animate-spin" />
            </div>
            <div>
              <h1 className="font-bold text-2xl text-text-primary">Buscando profesional…</h1>
              <p className="text-text-secondary text-[14px] mt-2">
                Conectándote con el especialista más cercano
              </p>
            </div>
          </div>
        )}

        {/* ── STEP: Matched — sin match real (ningún profesional habilitado) ── */}
        {step === 'matched' && !matchedPro && (
          <div className="flex flex-col items-center gap-5 py-10 text-center">
            <div className="w-24 h-24 rounded-full bg-bg-secondary flex items-center justify-center">
              <MagnifyingGlass className="w-10 h-10 text-text-tertiary" />
            </div>
            <div>
              <h1 className="font-bold text-2xl text-text-primary">
                No hay profesionales disponibles
              </h1>
              <p className="text-text-secondary text-[14px] mt-2 max-w-sm">
                Por el momento no hay profesionales de {selectedVertical?.nombre ?? 'esta especialidad'} habilitados para recibir reservas online. Probá de nuevo más tarde.
              </p>
            </div>
            <div className="w-full space-y-3 mt-4">
              <button
                onClick={() => { setStep('modality'); setMatchedPro(null) }}
                className="w-full py-4 rounded-full font-semibold text-[15px] text-text-secondary border border-border-default hover:bg-bg-secondary transition-colors"
              >
                Volver
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: Matched ── */}
        {step === 'matched' && matchedPro && (
          <div className="flex flex-col items-center gap-5 py-10 text-center">
            {/* Avatar with check badge */}
            <div className="relative">
              <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-white shadow-md">
                {matchedPro?.avatarUrl ? (
                  <img src={matchedPro.avatarUrl} alt={matchedPro.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-brand/10 flex items-center justify-center text-[36px] font-bold text-brand">
                    {(matchedPro?.name ?? 'P').charAt(0)}
                  </div>
                )}
              </div>
              <div className="absolute -bottom-1 -right-1 bg-white rounded-full shadow">
                <CheckCircle className="w-7 h-7 text-success" weight="fill" />
              </div>
            </div>

            {/* Pro info */}
            <div>
              <p className="text-[13px] font-semibold text-success uppercase tracking-wide mb-1">
                ¡Profesional encontrado!
              </p>
              <h1 className="font-bold text-2xl text-text-primary">
                {matchedPro?.name ?? 'Profesional disponible'}
              </h1>
              {(matchedPro?.specialty || selectedVertical?.nombre) && (
                <p className="text-text-secondary text-[14px] mt-0.5">
                  {SPECIALTY_LABELS[matchedPro?.specialty] || matchedPro?.specialty || selectedVertical.nombre}
                </p>
              )}
            </div>

            {/* Rating + price */}
            <div className="flex items-center gap-4">
              {matchedPro?.rating > 0 && (
                <div className="flex items-center gap-1">
                  <Star className="w-4 h-4 text-amber-400" weight="fill" />
                  <span className="text-[13px] font-semibold text-amber-600">
                    {matchedPro.rating.toFixed(1)}
                  </span>
                  {matchedPro.reviews > 0 && (
                    <span className="text-[12px] text-text-tertiary">
                      ({matchedPro.reviews} reseñas)
                    </span>
                  )}
                </div>
              )}
              {matchedPro?.price != null && (
                <span className="text-[15px] font-bold text-brand">
                  ${matchedPro.price}/consulta
                </span>
              )}
            </div>

            {/* CTAs */}
            <div className="w-full space-y-3 mt-4">
              <button
                onClick={handleConfirmMatched}
                className="w-full py-4 rounded-full font-semibold text-[15px] text-white bg-brand hover:bg-brand-hover transition-colors"
              >
                Elegir y pagar
              </button>
              <button
                onClick={() => { setStep('modality'); setMatchedPro(null) }}
                className="w-full py-4 rounded-full font-semibold text-[15px] text-text-secondary border border-border-default hover:bg-bg-secondary transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: Pet (veterinaria only) ── */}
        {step === 'pet' && (
          <>
            <h1 className="font-serif font-bold text-3xl text-text-primary">
              ¿Para qué mascota?
            </h1>
            <div className="flex justify-center py-2">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ backgroundColor: '#F0F9FF' }}
              >
                <PawPrint className="w-8 h-8" style={{ color: '#0284C7' }} />
              </div>
            </div>
            <div>
              <label className="text-[13px] font-semibold text-text-secondary mb-2 block">
                Nombre de la mascota
              </label>
              <input
                type="text"
                placeholder="Ej: Luna, Max, Simba…"
                value={petName}
                onChange={e => setPetName(e.target.value)}
                className="w-full px-4 py-3.5 rounded-xl border border-border-default bg-bg-secondary text-text-primary placeholder-text-tertiary text-[15px] focus:outline-none focus:border-brand transition-colors"
              />
            </div>
            <div>
              <label className="text-[13px] font-semibold text-text-secondary mb-2 block">
                Especie
              </label>
              <div className="flex flex-wrap gap-2">
                {SPECIES.map(sp => (
                  <button
                    key={sp}
                    onClick={() => setPetSpecies(sp)}
                    className={`px-4 py-2 rounded-full border text-[13px] font-medium transition-all ${
                      petSpecies === sp
                        ? 'text-white border-transparent'
                        : 'text-text-secondary border-border-default bg-bg-secondary hover:border-brand/40'
                    }`}
                    style={petSpecies === sp ? { backgroundColor: '#0284C7', borderColor: '#0284C7' } : {}}
                  >
                    {sp}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => setStep(paramProId && selectedPro ? 'datetime' : 'professional')}
              disabled={!petName.trim() || !petSpecies}
              className="w-full py-4 rounded-full font-semibold text-[15px] text-white transition-all mt-2 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#7CB38B' }}
            >
              Continuar
            </button>
          </>
        )}

        {/* ── STEP: Professional ── */}
        {step === 'professional' && (
          <>
            <h1 className="font-serif font-bold text-3xl text-text-primary">
              Elegí tu profesional
            </h1>
            {loadingPros ? (
              <div className="flex justify-center py-12">
                <CircleNotch className="w-8 h-8 animate-spin" style={{ color: '#7CB38B' }} />
              </div>
            ) : professionals.length === 0 ? (
              <p className="text-center text-text-tertiary text-[15px] py-12">
                Sin profesionales disponibles.
              </p>
            ) : (
              <div className="space-y-2">
                {professionals.map(pro => (
                  <button
                    key={pro.id}
                    onClick={() => pro.mpConnected && setSelectedPro(pro)}
                    disabled={!pro.mpConnected}
                    className={`w-full flex items-center gap-3 rounded-2xl border px-4 py-4 transition-all text-left ${
                      !pro.mpConnected
                        ? 'border-border-default bg-bg-secondary opacity-50 cursor-not-allowed'
                        : selectedPro?.id === pro.id
                          ? 'border-brand bg-brand/5'
                          : 'border-border-default bg-bg-secondary hover:border-brand/30'
                    }`}
                  >
                    {/* Avatar */}
                    <div className="w-[52px] h-[52px] rounded-full overflow-hidden flex-shrink-0">
                      {pro.avatarUrl ? (
                        <img src={pro.avatarUrl} alt={pro.name} className="w-full h-full object-cover" />
                      ) : (
                        <div
                          className="w-full h-full flex items-center justify-center text-[20px] font-bold"
                          style={{ backgroundColor: 'rgba(124,179,139,0.15)', color: '#7CB38B' }}
                        >
                          {pro.name.charAt(0)}
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[14px] text-text-primary truncate">{pro.name}</div>
                      <div className="text-[12px] text-text-secondary mt-0.5 truncate">{SPECIALTY_LABELS[pro.specialty] || pro.specialty}</div>
                      {!pro.mpConnected ? (
                        <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full mt-1 inline-block">No disponible para reservas online</span>
                      ) : (
                        <div className="flex items-center gap-1 mt-1">
                          <Star className="w-3 h-3 text-amber-400" weight="fill" />
                          <span className="text-[12px] font-semibold text-amber-600">{pro.rating.toFixed(1)}</span>
                          {pro.reviews > 0 && (
                            <span className="text-[11px] text-text-tertiary">({pro.reviews} reseñas)</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Price + check */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {pro.mpConnected && pro.price != null && (
                        <span className="text-[14px] font-bold" style={{ color: '#7CB38B' }}>
                          ${pro.price}
                        </span>
                      )}
                      {selectedPro?.id === pro.id && (
                        <Check className="w-5 h-5" style={{ color: '#7CB38B' }} />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {selectedPro && (
              <button
                onClick={() => setStep('datetime')}
                className="w-full py-4 rounded-full font-semibold text-[15px] text-white mt-2"
                style={{ backgroundColor: '#7CB38B' }}
              >
                Continuar
              </button>
            )}
          </>
        )}

        {/* ── STEP: Datetime ── */}
        {step === 'datetime' && (
          <>
            <h1 className="font-serif font-bold text-3xl text-text-primary">
              ¿Cuándo?
            </h1>
            {loadingSchedule ? (
              <div className="flex justify-center py-12">
                <CircleNotch className="w-8 h-8 animate-spin" style={{ color: '#7CB38B' }} />
              </div>
            ) : schedule.length === 0 ? (
              <p className="text-center text-text-tertiary text-[15px] py-12">
                Este profesional no tiene franjas configuradas.
              </p>
            ) : (
              <>
                {/* Date pills (horizontal scroll) */}
                <div className="-mx-4 px-4">
                  <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                    {availableDates.length === 0 ? (
                      <p className="text-text-tertiary text-[14px] py-2">
                        No hay fechas disponibles en los próximos 14 días.
                      </p>
                    ) : availableDates.map(d => (
                      <button
                        key={d.value}
                        onClick={() => { setSelectedDate(d.value); setSelectedFranja(null) }}
                        className={`flex-shrink-0 px-4 py-2.5 rounded-full border text-[13px] font-medium transition-all whitespace-nowrap ${
                          selectedDate === d.value
                            ? 'text-white border-transparent'
                            : 'text-text-secondary border-border-default bg-bg-secondary hover:border-brand/40'
                        }`}
                        style={selectedDate === d.value ? { backgroundColor: '#7CB38B', borderColor: '#7CB38B' } : {}}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Time slots */}
                {selectedDate && (
                  <>
                    <p className="text-[13px] font-semibold text-text-secondary mt-2">
                      Horarios disponibles
                    </p>
                    {timeSlots.length === 0 ? (
                      <p className="text-text-tertiary text-[14px]">Sin horarios disponibles para este día.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {timeSlots.map(slot => {
                          const isActive = selectedFranja?.id === slot.id
                          return (
                            <button
                              key={slot.id}
                              onClick={() => setSelectedFranja(slot)}
                              className={`px-4 py-2 rounded-full border text-[13px] font-medium transition-all ${
                                isActive
                                  ? 'text-white border-transparent'
                                  : 'text-text-secondary border-border-default bg-bg-secondary hover:border-brand/40'
                              }`}
                              style={isActive ? { backgroundColor: '#7CB38B', borderColor: '#7CB38B' } : {}}
                            >
                              {fmtTime(slot.startTime)}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            {selectedDate && selectedFranja && (
              <button
                onClick={() => setStep('confirm')}
                className="w-full py-4 rounded-full font-semibold text-[15px] text-white mt-2"
                style={{ backgroundColor: '#7CB38B' }}
              >
                Ver resumen
              </button>
            )}
          </>
        )}

        {/* ── STEP: Confirm ── */}
        {step === 'confirm' && selectedVertical && selectedPro && (
          <>
            <h1 className="font-serif font-bold text-3xl text-text-primary">
              Resumen del turno
            </h1>
            <div className="bg-bg-secondary rounded-2xl border border-border-default divide-y divide-border-default overflow-hidden">
              {[
                { label: 'Especialidad', value: selectedVertical.nombre },
                ...(selectedVertical.id === 'veterinaria' && petName
                  ? [{ label: 'Mascota', value: `${petName}${petSpecies ? ` (${petSpecies})` : ''}` }]
                  : []),
                { label: 'Profesional', value: selectedPro.name },
                { label: 'Modalidad',   value: modality === 'virtual' ? 'Videoconsulta' : 'Presencial' },
                { label: 'Fecha',       value: selectedDate || '—' },
                {
                  label: 'Horario',
                  value: selectedFranja
                    ? `${fmtTime(selectedFranja.startTime)} – ${fmtTime(selectedFranja.endTime)}`
                    : '—',
                },
                { label: 'Precio',      value: selectedPro.price != null ? `$${selectedPro.price}` : '—' },
              ].map((row, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-3">
                  <span className="text-[13px] text-text-tertiary">{row.label}</span>
                  <span className="text-[13px] font-semibold text-text-primary text-right">{row.value}</span>
                </div>
              ))}
            </div>

            {createError && (
              <p className="text-[13px] text-center" style={{ color: '#D9534F' }}>
                {createError}
              </p>
            )}

            <button
              onClick={handleConfirm}
              disabled={processing}
              className="w-full py-4 rounded-full font-semibold text-[15px] text-white flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ backgroundColor: '#7CB38B' }}
            >
              {processing && <CircleNotch className="w-4 h-4 animate-spin" />}
              {modality === 'virtual' ? 'Ir al pago' : 'Confirmar y reservar'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
