import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import {
  Calendar, Clock, VideoCamera, MapPin, Star, CaretRight, ArrowLeft, CircleNotch, Check,
  X, FileText, Ambulance, ClipboardText, Pill, UserCircle,
} from '@phosphor-icons/react'
import { consultationsService } from '../../services/consultationsService'
import { professionalService } from '../../services/professionalService'
import { availabilityService } from '../../services/availabilityService'
import { reviewsService } from '../../services/reviewsService'
import { emergencyService } from '../../services/emergencyService'
import { mpService } from '../../services/mpService'
import { VERTICALS, VERTICAL_SPECIALTIES } from '../../lib/verticals'
import { toast } from '../../components/Toast'
import PatientSheet from '../../components/patient/PatientSheet'
import SavedCardSelector from '../../components/payment/SavedCardSelector'

const ESPECIALIDADES = {
  clinica:     ['Médico Generalista', 'Cardiología', 'Dermatología', 'Pediatría', 'Traumatología'],
  mente:       ['Terapia Cognitivo Conductual', 'Psicoanálisis', 'Psiquiatría', 'Terapia de Pareja'],
  nutricion:   ['Nutrición Deportiva', 'Nutrición Clínica', 'Pérdida de Peso'],
  fisico:      ['Kinesiología y Rehabilitación', 'Preparación Física', 'Entrenamiento Funcional'],
  veterinaria: ['Clínica General Veterinaria', 'Vacunación', 'Urgencias 24h'],
}

const STATUS_CLASS = {
  confirmed:   'status-confirmed',
  pending:     'status-pending',
  cancelled:   'status-cancelled',
  completed:   'status-completed',
  in_progress: 'status-in-progress',
}
const STATUS_LABEL = {
  confirmed: 'Confirmado', pending: 'Pendiente',
  cancelled: 'Cancelado',  completed: 'Finalizado', in_progress: 'En Curso',
}

// Group slots by date string "dd/mm/yyyy"
function groupSlotsByDate(slots) {
  const now = new Date()
  return slots
    .filter(s => !s.isBooked && new Date(s.startTime) > now)
    .reduce((acc, s) => {
      const d = new Date(s.startTime).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
      ;(acc[d] = acc[d] || []).push(s)
      return acc
    }, {})
}

// Map BuscarProfesional URL modality values to Consultations internal modality state
const MODALITY_PARAM_MAP = { video: 'Videollamada', presencial: 'Presencial' }

export default function PatientConsultations({ profile }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const autoBookConsumed = useRef(false)
  const [view, setView] = useState('upcoming')
  const [turnos, setTurnos] = useState([])
  const [loading, setLoading] = useState(true)

  // Booking modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [selVertical, setSelVertical] = useState(null)
  const [step, setStep] = useState('modality')
  const [modality, setModality] = useState(null)
  const [specialty, setSpecialty] = useState(null)
  const [professional, setProfessional] = useState(null)
  const [pros, setPros] = useState([])
  const [prosLoading, setProsLoading] = useState(false)

  // Availability slots
  const [availableSlots, setAvailableSlots] = useState([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedSlot, setSelectedSlot] = useState(null)

  // Payment
  const [paying, setPaying] = useState(false)
  const [paid, setPaid] = useState(false)
  const [selectedCardId, setSelectedCardId] = useState(null)
  const [mpPublicKey, setMpPublicKey] = useState(null)
  const [mpConfigLoading, setMpConfigLoading] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState(null)

  // Cancel modal state
  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  // Review modal state
  const [reviewTarget, setReviewTarget] = useState(null)
  const [reviewRating, setReviewRating] = useState(0)
  const [reviewComment, setReviewComment] = useState('')
  const [submittingReview, setSubmittingReview] = useState(false)

  const [emergencies, setEmergencies] = useState([])

  const loadTurnos = () =>
    consultationsService.getByPatient(profile.id).then(setTurnos)

  useEffect(() => {
    if (!profile?.id) return
    setLoading(true)
    Promise.all([
      loadTurnos(),
      emergencyService.getByPatient(profile.id).then(setEmergencies).catch(() => {}),
    ])
      .catch(() => toast.error('Error al cargar consultas'))
      .finally(() => setLoading(false))
  }, [profile?.id])

  // Load patient's reviews to know which consultations have been reviewed
  const [patientReviewMap, setPatientReviewMap] = useState({})
  useEffect(() => {
    if (!profile?.id) return
    reviewsService.getByPatient(profile.id)
      .then(setPatientReviewMap)
      .catch(() => {})
  }, [profile?.id])

  // Auto-open booking modal when navigated here from ReservarConsulta with autoBook state
  useEffect(() => {
    if (autoBookConsumed.current) return
    const state = location.state
    if (!state?.autoBook) return
    autoBookConsumed.current = true
    // Clear navigation state so a refresh doesn't re-trigger
    window.history.replaceState({}, '', location.pathname)
    const vertId = state.verticalId
    const vert = VERTICALS.find(v => v.id === vertId)
    if (!vert) return
    // Pre-set modality to 'Videollamada' (virtual path always uses video)
    setModality('Videollamada')
    // If a professional was pre-selected, skip straight to datetime/payment
    if (state.professionalId) {
      setProfessional({
        id:      state.professionalId,
        name:    'Profesional',
        img:     null,
        rating:  '—',
        reviews: 0,
        pricePresencial: null,
        priceVideo: null,
      })
      if (state.scheduledAt) {
        // We have a full booking — go straight to payment
        const slot = { id: 'autobook', startTime: state.scheduledAt }
        setSelectedSlot(slot)
        openModal(vert)
        setStep('payment')
      } else {
        openModal(vert)
        loadSlots(state.professionalId)
        setStep('datetime')
      }
    } else {
      openModal(vert)
    }
  }, [location.state])

  // Handle URL params from BuscarProfesional (?vertical=&pro=&modality=)
  const urlParamConsumed = useRef(false)
  useEffect(() => {
    if (urlParamConsumed.current) return
    const proId      = searchParams.get('pro')
    const vertId     = searchParams.get('vertical')
    const modalParam = searchParams.get('modality')
    if (!proId && !vertId) return
    urlParamConsumed.current = true
    const vert = vertId ? VERTICALS.find(v => v.id === vertId) : null
    if (!vert) return
    const modalityState = MODALITY_PARAM_MAP[modalParam] || 'Videollamada'
    setModality(modalityState)
    if (proId) {
      professionalService.search({})
        .then(data => {
          const match = data.find(p => p.userId === proId)
          if (!match) return
          const proObj = {
            id:              match.userId,
            name:            match.profiles?.fullName || 'Profesional',
            img:             match.profiles?.avatarUrl || null,
            rating:          String(match.averageRating ?? '—'),
            reviews:         match.totalReviews ?? 0,
            pricePresencial: match.pricePresencial ?? null,
            priceVideo:      match.priceVideo ?? null,
          }
          setProfessional(proObj)
          openModal(vert)
          setModality(modalityState)
          loadSlots(proId)
          setStep('datetime')
        })
        .catch(() => {})
    } else {
      openModal(vert)
      setModality(modalityState)
    }
  }, [])

  // Load MP public key and resolve payment amount when entering payment step
  useEffect(() => {
    if (step !== 'payment') return
    // Resolve amount from professional prices based on modality
    const amount = modality === 'Videollamada'
      ? (professional?.priceVideo ?? professional?.pricePresencial ?? null)
      : (professional?.pricePresencial ?? professional?.priceVideo ?? null)
    setPaymentAmount(amount)
    setMpConfigLoading(true)
    mpService.getPaymentPlatformConfig()
      .then(({ data }) => setMpPublicKey(data?.publicKey ?? null))
      .catch(() => setMpPublicKey(null))
      .finally(() => setMpConfigLoading(false))
  }, [step])

  const openModal = vertical => {
    setSelVertical(vertical)
    setStep('modality'); setModality(null); setSpecialty(null); setProfessional(null)
    setAvailableSlots([]); setSelectedDate(null); setSelectedSlot(null)
    setPaying(false); setPaid(false); setSelectedCardId(null); setPaymentAmount(null); setPros([]); setProsLoading(false)
    setModalOpen(true)
  }

  const loadPros = verticalId => {
    const slugs = VERTICAL_SPECIALTIES[verticalId] || []
    if (!slugs.length) { setPros([]); return }
    setProsLoading(true)
    professionalService.search({})
      .then(data => setPros(data.filter(p => slugs.includes(p.specialty))))
      .catch(() => setPros([]))
      .finally(() => setProsLoading(false))
  }

  const loadSlots = async (professionalUserId) => {
    setSlotsLoading(true)
    try {
      const slots = await availabilityService.getByProfessional(professionalUserId, true)
      const future = slots.filter(s => new Date(s.startTime) > new Date())
      setAvailableSlots(future)
      if (future.length > 0) {
        const firstDate = new Date(future[0].startTime).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
        setSelectedDate(firstDate)
      }
    } catch {
      setAvailableSlots([])
    } finally {
      setSlotsLoading(false)
    }
  }

  const advanceToProfessional = verticalId => {
    loadPros(verticalId)
    setStep('professional')
  }

  const selectProfessional = pro => {
    const proObj = {
      id:      pro.userId,
      name:    pro.profiles?.fullName || 'Profesional',
      img:     pro.profiles?.avatarUrl || null,
      rating:  String(pro.averageRating ?? '—'),
      reviews: pro.totalReviews ?? 0,
      // Price resolved later in payment step based on modality
      pricePresencial: pro.pricePresencial ?? null,
      priceVideo:      pro.priceVideo ?? null,
    }
    setProfessional(proObj)
    loadSlots(pro.userId)
    setStep('datetime')
  }

  const goBack = () => {
    if (step === 'payment') setStep('datetime')
    else if (step === 'datetime') setStep('professional')
    else if (step === 'professional') setStep(ESPECIALIDADES[selVertical?.id] ? 'specialty' : 'modality')
    else if (step === 'specialty') setStep('modality')
    else setModalOpen(false)
  }

  const confirmPay = async () => {
    if (!selectedSlot || !selectedCardId) return
    setPaying(true)
    try {
      // 1. Create the consultation record first (DB write before UI confirmation)
      const consultation = await consultationsService.create({
        patientId:      profile.id,
        professionalId: professional.id,
        scheduledAt:    selectedSlot.startTime,
        modality:       modality === 'Videollamada' ? 'video' : 'presencial',
        status:         'pending',
      })

      // 2. Book the slot
      await availabilityService.bookSlot(selectedSlot.id)

      // 3. Charge via Mercado Pago
      const { data: paymentData, error: paymentError } = await mpService.createPayment({
        consultationId: consultation.id,
        amount:         paymentAmount ?? 0,
        cardId:         selectedCardId,
        professionalId: professional.id,
        description:    `Consulta Healthier — ${professional.name}`,
      })

      if (paymentError) {
        // Payment failed — cancel the consultation and surface the error
        await consultationsService.cancel(consultation.id, profile.id, 'Pago rechazado')
        throw new Error(paymentError)
      }

      // 4. Mark consultation confirmed if MP returned approved
      if (paymentData?.status === 'approved') {
        await consultationsService.updateStatus(consultation.id, 'confirmed')
      }

      setPaid(true)
      const confirmedId = consultation.id
      const isVirtual = modality === 'Videollamada'
      setTimeout(() => {
        setModalOpen(false)
        if (isVirtual) {
          navigate(`/paciente/videollamada/${confirmedId}`)
        } else {
          toast.success('¡Turno confirmado y pago acreditado!')
          loadTurnos()
        }
      }, 800)
    } catch (err) {
      toast.error(err?.message ?? 'Error al confirmar el turno')
      setPaying(false)
    }
  }

  const handleCancel = async () => {
    if (!cancelTarget) return
    setCancelling(true)
    try {
      await consultationsService.cancel(cancelTarget.id, profile.id, cancelReason)
      toast.info('Turno cancelado')
      setCancelTarget(null)
      setCancelReason('')
      loadTurnos()
    } catch {
      toast.error('Error al cancelar el turno')
    } finally {
      setCancelling(false)
    }
  }

  const submitReview = async () => {
    if (!reviewRating || !reviewTarget) return
    setSubmittingReview(true)
    try {
      await reviewsService.create({
        consultationId: reviewTarget.id,
        patientId:      profile.id,
        professionalId: reviewTarget.professionalId,
        rating:         reviewRating,
        comment:        reviewComment || null,
      })
      toast.success('¡Gracias por tu reseña!')
      setPatientReviewMap(prev => ({ ...prev, [reviewTarget.id]: { rating: reviewRating } }))
      setReviewTarget(null); setReviewRating(0); setReviewComment('')
    } catch {
      toast.error('Error al enviar la reseña')
    } finally {
      setSubmittingReview(false)
    }
  }

  const STEP_TITLES = {
    modality: 'Elegir Modalidad', specialty: 'Elegir Especialidad',
    professional: 'Elegir Profesional', datetime: 'Elegir Horario', payment: 'Confirmar Pago',
  }

  const upcoming = turnos.filter(t => !['completed', 'cancelled'].includes(t.status))
  const past     = turnos.filter(t =>  ['completed', 'cancelled'].includes(t.status))
  const shown    = view === 'upcoming' ? upcoming : past

  const TRIAGE_CLASSES = {
    ROJO:     { border: 'border-rose-500/25',    bg: 'bg-rose-500/5',    chip: 'bg-rose-500/20',    icon: 'text-rose-500',    solid: 'bg-rose-500' },
    AMARILLO: { border: 'border-amber-500/25',   bg: 'bg-amber-500/5',   chip: 'bg-amber-500/20',   icon: 'text-amber-500',   solid: 'bg-amber-500' },
    VERDE:    { border: 'border-emerald-500/25', bg: 'bg-emerald-500/5', chip: 'bg-emerald-500/20', icon: 'text-emerald-500', solid: 'bg-emerald-500' },
  }
  const DEFAULT_TRIAGE = TRIAGE_CLASSES.ROJO
  const activeEmergencies = emergencies.filter(e => ['pending', 'dispatched', 'in_transit', 'arrived'].includes(e.status))
  const pastEmergencies   = emergencies.filter(e => ['completed', 'cancelled'].includes(e.status))

  const slotsByDate = groupSlotsByDate(availableSlots)
  const availableDates = Object.keys(slotsByDate)
  const timeSlotsForDate = selectedDate ? (slotsByDate[selectedDate] || []) : []

  return (
    <div className="absolute inset-0 bg-bg-primary pt-6 sm:pt-8 pb-32 px-6 overflow-y-auto animate-fade-in scrollbar-hide">
      <div className="max-w-2xl mx-auto">
      <div className="mb-8 mt-4">
        <h1 className="text-2xl sm:text-3xl font-light text-gray-900 tracking-tight leading-none">Mi Agenda</h1>
        <p className="text-gray-500 font-medium text-[15px] mt-2 flex items-center gap-1.5">
          <Calendar className="w-4 h-4 text-gray-400" /> Reservá tu turno
        </p>
      </div>

      {/* Specialty chips — naked icon + vertical-color label (mobile pattern) */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide mb-6 -mx-6 px-6">
        {VERTICALS.map(v => (
          <button
            key={v.id}
            onClick={v.comingSoon ? undefined : () => openModal(v)}
            disabled={v.comingSoon}
            className={`flex items-center gap-2 bg-bg-secondary border border-border-default rounded-[28px] px-4 py-2.5 shrink-0 transition-opacity ${v.comingSoon ? 'opacity-50 cursor-default' : 'active:opacity-80'}`}
          >
            <v.icon className="w-[18px] h-[18px] shrink-0" style={{ color: v.color }} />
            <span className="text-[14px] font-light whitespace-nowrap" style={{ color: v.color }}>{v.nombre}</span>
            {v.comingSoon && (
              <span className="text-[9px] font-semibold tracking-wide uppercase px-1.5 py-0.5 rounded-full ml-0.5" style={{ backgroundColor: v.bg, color: v.color }}>Pronto</span>
            )}
          </button>
        ))}
      </div>

      {/* Segment control — matches mobile style */}
      <div className="flex bg-bg-secondary border border-border-default p-1 rounded-2xl mb-5">
        {['upcoming', 'past'].map(tab => (
          <button key={tab} onClick={() => setView(tab)} className={`flex-1 py-2 text-[14px] rounded-[28px] transition-all ${view === tab ? 'bg-white font-semibold text-text-primary shadow-sm' : 'font-medium text-text-tertiary'}`}>
            {tab === 'upcoming' ? 'Próximos' : 'Historial'}
          </button>
        ))}
      </div>

      {/* Active emergency banners — always at top of Próximos */}
      {view === 'upcoming' && activeEmergencies.map(emg => {
        const triage = TRIAGE_CLASSES[emg.triage_code] ?? DEFAULT_TRIAGE
        const fecha = new Date(emg.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
        return (
          <div key={emg.id} className={`mb-3 rounded-2xl border p-4 flex items-center gap-4 cursor-pointer active:opacity-80 transition-opacity ${triage.border} ${triage.bg}`} onClick={() => navigate('/paciente/sos')}>
            <div className={`w-12 h-12 rounded-[14px] flex items-center justify-center shrink-0 ${triage.chip}`}>
              <Ambulance className={`w-6 h-6 ${triage.icon}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[15px] text-gray-900">Emergencia S.O.S</p>
              <p className="text-[13px] text-gray-500 font-medium">{fecha} · {emg.dispatch_code ?? '—'}</p>
            </div>
            <div className={`px-2.5 py-1 rounded-md text-[10px] font-semibold tracking-widest uppercase text-white ${triage.solid}`}>
              {emg.triage_code ?? 'ACTIVA'}
            </div>
          </div>
        )
      })}

      {/* Past emergencies in Historial */}
      {view === 'past' && pastEmergencies.map(emg => {
        const fecha = new Date(emg.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
        return (
          <div key={emg.id} className="mb-3 bg-bg-secondary rounded-2xl border border-border-default p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-[14px] bg-gray-50 flex items-center justify-center shrink-0">
              <Ambulance className="w-6 h-6 text-gray-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[15px] text-gray-900">Emergencia S.O.S · {emg.triage_code}</p>
              <p className="text-[13px] text-gray-500 font-medium">{fecha} · {emg.dispatch_code ?? '—'}</p>
            </div>
            <div className="px-2.5 py-1 rounded-md text-[10px] font-semibold bg-gray-100 text-gray-500 uppercase tracking-wider">
              Finalizado
            </div>
          </div>
        )
      })}

      {/* Consultation list */}
      <div className="space-y-3">
        {loading ? (
          [1, 2].map(i => <div key={i} className="h-32 bg-bg-secondary rounded-2xl animate-pulse border border-border-default" />)
        ) : shown.length === 0 && (view === 'upcoming' ? activeEmergencies : pastEmergencies).length === 0 ? (
          <div className="bg-bg-secondary p-8 rounded-2xl border border-border-default text-center flex flex-col items-center justify-center">
            <Calendar className="w-10 h-10 text-text-muted mb-3" />
            <p className="font-medium text-[14px] text-text-tertiary">Sin turnos en esta sección</p>
          </div>
        ) : shown.map(t => {
          const vert = VERTICALS.find(v => v.id === t.vertical) || VERTICALS[0]
          const date = t.scheduledAt ? new Date(t.scheduledAt) : null
          const hasReview = !!patientReviewMap[t.id]
          const isUpcomingActive = view === 'upcoming' && ['confirmed', 'pending'].includes(t.status)
          const isInProgressVideo = view === 'upcoming' && t.status === 'in_progress' && t.modality === 'video'
          const orders = t.consultationOrders ?? []
          const hasActions = isUpcomingActive || isInProgressVideo || (view === 'past' && t.status === 'completed')
          return (
            <div key={t.id} className="bg-bg-secondary rounded-2xl border border-border-default overflow-hidden">
              <div className="flex">
                {/* Left: date column */}
                <div className="w-[88px] shrink-0 border-r border-border-default flex flex-col items-center justify-center py-5 gap-0.5">
                  {date ? (
                    <>
                      <span className="text-[28px] font-semibold text-text-primary leading-none">
                        {date.toLocaleDateString('es-AR', { day: '2-digit' })}
                      </span>
                      <span className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">
                        {date.toLocaleDateString('es-AR', { month: 'short' })}
                      </span>
                      <div className="flex items-center gap-1 mt-1.5">
                        <Clock className="w-3 h-3 text-text-tertiary" />
                        <span className="text-[11px] font-medium text-text-tertiary">
                          {date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </>
                  ) : (
                    <span className="text-[12px] text-text-tertiary font-medium">—</span>
                  )}
                </div>

                {/* Right: content */}
                <div className="flex-1 p-4 flex flex-col gap-2 min-w-0">
                  {/* Vertical: naked icon + name in vertical color (mobile pattern) */}
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <vert.icon className="w-4 h-4 shrink-0" style={{ color: vert.color }} />
                      <span className="text-[13px] font-light" style={{ color: vert.color }}>{vert.nombre}</span>
                    </div>
  </div>
                  <p className="text-[17px] font-light text-text-primary leading-snug">
                    {t.professional?.fullName || 'Profesional'}
                  </p>
                  {/* Tags: modality pill + status pill */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${t.modality === 'video' ? 'bg-brand-muted text-brand' : 'bg-emerald-50 text-emerald-600'}`}>
                      {t.modality === 'video' ? <VideoCamera className="w-3 h-3" /> : <MapPin className="w-3 h-3" />}
                      {t.modality === 'video' ? 'Videollamada' : 'Presencial'}
                    </div>
                    <div className={`status-badge uppercase tracking-wide ${STATUS_CLASS[t.status] || STATUS_CLASS.pending}`}>
                      {STATUS_LABEL[t.status] || t.status}
                    </div>
                  </div>

                </div>
              </div>

              {/* Orders / prescriptions / referrals section */}
              {orders.length > 0 && (
                <div className="border-t border-border-default px-4 py-3 space-y-1.5">
                  {orders.map(order => {
                    const orderIcon = order.orderType === 'receta' ? Pill
                      : order.orderType === 'derivacion' ? UserCircle
                      : ClipboardText
                    const orderLabel = order.orderType === 'receta' ? 'Receta'
                      : order.orderType === 'derivacion' ? 'Derivación'
                      : 'Orden'
                    const OrderIcon = orderIcon
                    return (
                      <div key={order.id} className="flex items-center gap-2.5">
                        <OrderIcon className="w-4 h-4 text-brand shrink-0" />
                        <span className="text-[12px] text-text-secondary flex-1 truncate">{order.description}</span>
                        {order.url ? (
                          <a
                            href={order.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-brand font-semibold shrink-0 hover:underline"
                          >
                            {orderLabel} →
                          </a>
                        ) : (
                          <span className="text-[11px] text-text-tertiary shrink-0">{orderLabel}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Actions row */}
              {hasActions && (
                <div className="border-t border-border-default flex">
                  {view === 'upcoming' && ['confirmed', 'in_progress'].includes(t.status) && t.modality === 'video' && (
                    <button onClick={() => navigate(`/paciente/videollamada/${t.id}`)} className="flex-1 py-3 text-[13px] font-semibold text-brand flex items-center justify-center gap-1.5 hover:bg-brand-muted transition-colors">
                      <VideoCamera className="w-4 h-4" /> Entrar a Sala
                    </button>
                  )}
                  {view === 'upcoming' && ['confirmed', 'pending'].includes(t.status) && (
                    <button onClick={() => { setCancelTarget(t); setCancelReason('') }} className={`py-3 text-[13px] font-semibold text-error flex items-center justify-center gap-1.5 hover:bg-red-50 transition-colors ${t.status === 'confirmed' && t.modality === 'video' ? 'w-24 border-l border-border-default' : 'flex-1'}`}>
                      Cancelar
                    </button>
                  )}
                  {view === 'past' && t.status === 'completed' && t.prescriptionUrl && (
                    <a href={t.prescriptionUrl} target="_blank" rel="noreferrer" className="flex-1 py-3 text-[13px] font-semibold text-brand flex items-center justify-center gap-1.5 hover:bg-brand-muted transition-colors">
                      <FileText className="w-4 h-4" /> Ver receta
                    </a>
                  )}
                  {view === 'past' && t.status === 'completed' && !hasReview && (
                    <button onClick={() => { setReviewTarget(t); setReviewRating(0); setReviewComment('') }} className="flex-1 py-3 text-[13px] font-semibold text-amber-600 flex items-center justify-center gap-1.5 hover:bg-amber-50 transition-colors">
                      <Star className="w-4 h-4" /> Dejar reseña
                    </button>
                  )}
                  {view === 'past' && t.status === 'completed' && hasReview && (
                    <div className="flex-1 py-3 flex items-center justify-center gap-1 text-[13px] text-amber-500 font-semibold">
                      <Star className="w-4 h-4 fill-amber-400" /> {patientReviewMap[t.id]?.rating}/5
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      </div>{/* end max-w-2xl */}

      {/* ─── Booking modal ─── */}
      <PatientSheet open={modalOpen && !!selVertical} onClose={() => setModalOpen(false)}>
        <div className="px-6 pt-4 pb-2 flex justify-between items-center flex-shrink-0">
          <div>
            <h2 className="text-[24px] font-semibold text-gray-900 leading-none tracking-tight">{STEP_TITLES[step]}</h2>
            <p className="text-[13px] font-semibold text-gray-500 tracking-widest uppercase mt-1">
              {selVertical?.nombre}{modality ? ` • ${modality}` : ''}
            </p>
          </div>
          <button onClick={goBack} className="w-10 h-10 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50" disabled={paying}>
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </button>
        </div>

        <div className="px-6 overflow-y-auto scrollbar-hide flex-1">
          {step === 'modality' && (
            <div className="space-y-4 pb-6">
              {[
                { label: 'Virtual', sub: 'Videollamada segura en la app', mod: 'Videollamada', icon: VideoCamera, bg: 'bg-blue-50', color: 'text-brand' },
                { label: 'Presencial', sub: 'En el consultorio del profesional', mod: 'Presencial', icon: MapPin, bg: 'bg-emerald-50', color: 'text-emerald-600' },
              ].map(opt => (
                <div key={opt.mod} onClick={() => { setModality(opt.mod); ESPECIALIDADES[selVertical.id] ? setStep('specialty') : advanceToProfessional(selVertical.id) }} className="bg-bg-primary p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4 cursor-pointer hover:border-brand transition-all group">
                  <div className={`w-14 h-14 ${opt.bg} rounded-full flex items-center justify-center group-hover:scale-110 transition-transform`}>
                    <opt.icon className={`w-7 h-7 ${opt.color}`} />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-[18px] text-gray-900">{opt.label}</h3>
                    <p className="text-[13px] text-gray-500 font-medium mt-0.5">{opt.sub}</p>
                  </div>
                  <CaretRight className="w-5 h-5 text-gray-300 group-hover:text-brand transition-colors" />
                </div>
              ))}
            </div>
          )}

          {step === 'specialty' && (
            <div className="space-y-3 pb-6">
              {(ESPECIALIDADES[selVertical.id] || []).map(esp => (
                <div key={esp} onClick={() => { setSpecialty(esp); advanceToProfessional(selVertical.id) }} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex justify-between items-center cursor-pointer hover:border-brand hover:bg-bg-primary transition-all group">
                  <span className="font-semibold text-[16px] text-gray-800">{esp}</span>
                  <CaretRight className="w-5 h-5 text-gray-300 group-hover:text-brand transition-colors" />
                </div>
              ))}
            </div>
          )}

          {step === 'professional' && (
            <div className="space-y-4 pb-6">
              {prosLoading ? (
                [1, 2].map(i => <div key={i} className="h-24 bg-white rounded-2xl animate-pulse border border-gray-100" />)
              ) : pros.length === 0 ? (
                <p className="text-center text-gray-400 font-medium py-8">No hay profesionales disponibles para esta especialidad.</p>
              ) : pros.map(p => {
                const proName = p.profiles?.fullName || 'Profesional'
                const proAvatar = p.profiles?.avatarUrl || null
                return (
                  <div key={p.userId ?? p.id} onClick={() => selectProfessional(p)} className="bg-bg-primary p-4 rounded-2xl shadow-sm border border-gray-100 flex gap-4 cursor-pointer hover:border-brand transition-all group">
                    {proAvatar
                      ? <img src={proAvatar} alt={proName} className="w-16 h-16 rounded-full object-cover border-2 border-white shadow-sm flex-shrink-0" />
                      : <div className="w-16 h-16 rounded-full border-2 border-white shadow-sm flex-shrink-0 flex items-center justify-center text-2xl font-semibold bg-gray-100 text-gray-400">{proName[0]}</div>
                    }
                    <div className="flex-1 flex flex-col justify-center">
                      <h4 className="font-semibold text-[17px] text-gray-900 leading-tight">{proName}</h4>
                      <div className="flex items-center gap-1.5 mt-1">
                        <div className="flex items-center gap-1 bg-yellow-50 text-yellow-700 px-1.5 py-0.5 rounded text-[12px]">
                          <Star className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                          <span className="font-semibold">{String(p.averageRating ?? '—')}</span>
                        </div>
                        <span className="text-[12px] font-medium text-gray-400">({p.totalReviews ?? 0} reseñas)</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-center pr-2">
                      <div className="bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded-full text-[11px] font-semibold group-hover:bg-brand group-hover:text-white transition-colors">ELEGIR</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {step === 'datetime' && (
            <div className="pb-6">
              {slotsLoading ? (
                <div className="h-32 bg-white rounded-2xl animate-pulse border border-gray-100" />
              ) : availableDates.length === 0 ? (
                <div className="bg-bg-primary rounded-2xl p-5 shadow-sm border border-gray-100 text-center">
                  <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                  <p className="font-semibold text-[15px] text-gray-500 mb-1">Sin franjas disponibles</p>
                  <p className="text-[13px] text-gray-400">Este profesional no tiene horarios libres por el momento.</p>
                </div>
              ) : (
                <div className="bg-bg-primary rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
                  <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Día</h4>
                  <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide -mx-2 px-2">
                    {availableDates.map(d => (
                      <div key={d} onClick={() => { setSelectedDate(d); setSelectedSlot(null) }} className={`flex-shrink-0 px-4 py-2 rounded-xl cursor-pointer font-semibold text-[14px] transition-colors border ${selectedDate === d ? 'bg-brand text-white border-brand' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>{d}</div>
                    ))}
                  </div>
                  <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3 mt-2">Hora</h4>
                  <div className="grid grid-cols-3 gap-2">
                    {timeSlotsForDate.map(slot => {
                      const t = new Date(slot.startTime).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
                      const isSelected = selectedSlot?.id === slot.id
                      return (
                        <div key={slot.id} onClick={() => setSelectedSlot(slot)} className={`px-2 py-3 rounded-xl cursor-pointer font-semibold text-[13px] text-center transition-colors border ${isSelected ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>{t}</div>
                      )
                    })}
                  </div>
                </div>
              )}
              <button onClick={() => setStep('payment')} disabled={!selectedSlot} className="btn-primary w-full py-5 text-[17px] flex justify-center items-center gap-2">
                Continuar al Pago
              </button>
            </div>
          )}

          {step === 'payment' && selectedSlot && (
            <div className="pb-6 animate-fade-in">
              <div className="bg-bg-primary rounded-2xl p-5 shadow-sm border border-gray-100 mb-4">
                <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-4">Resumen</h4>
                <div className="flex gap-4 items-center mb-5">
                  {professional?.img
                    ? <img src={professional.img} alt={professional.name} className="w-14 h-14 rounded-full object-cover border-2 border-white shadow-sm" />
                    : <div className="w-14 h-14 rounded-full border-2 border-white shadow-sm bg-gray-100 flex items-center justify-center font-semibold text-gray-400 text-xl">{professional?.name?.[0] || '?'}</div>
                  }
                  <div>
                    <h4 className="font-semibold text-[17px] text-gray-900 leading-tight">{professional?.name}</h4>
                    {specialty && <p className="text-[14px] text-gray-500 font-medium mt-0.5">{specialty}</p>}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="bg-white rounded-xl p-3 flex justify-center items-center border border-gray-100">
                    <span className="font-semibold text-[14px] text-gray-800 flex items-center gap-2">
                      {modality === 'Videollamada' ? <VideoCamera className="w-4 h-4 text-brand" /> : <MapPin className="w-4 h-4 text-emerald-600" />}
                      Cita {modality}
                    </span>
                  </div>
                  <div className="bg-white rounded-xl p-3 flex justify-between items-center border border-gray-100">
                    <span className="font-semibold text-[14px] text-gray-800 flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      {new Date(selectedSlot.startTime).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short' })}
                    </span>
                    <span className="font-semibold text-[14px] text-gray-900 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-gray-400" />
                      {new Date(selectedSlot.startTime).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
                <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Método de Pago</h4>
                {mpConfigLoading ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-gray-400">
                    <CircleNotch className="w-5 h-5 animate-spin" />
                    <span className="text-[13px]">Cargando métodos de pago…</span>
                  </div>
                ) : (
                  <SavedCardSelector
                    selectedCardId={selectedCardId}
                    onCardSelected={setSelectedCardId}
                    publicKey={mpPublicKey}
                    payerEmail={profile?.email ?? ''}
                  />
                )}
                {paymentAmount != null && (
                  <div className="flex justify-between items-center mt-5 pt-5 border-t border-gray-100">
                    <span className="font-semibold text-gray-500">A pagar hoy</span>
                    <span className="font-semibold text-[24px] text-gray-900">
                      ${paymentAmount.toLocaleString('es-AR')}
                    </span>
                  </div>
                )}
              </div>
              <button onClick={confirmPay} disabled={paying || paid || !selectedCardId} className={`btn-primary w-full py-5 text-[17px] flex justify-center items-center gap-3 ${paid ? '!bg-emerald-500 !opacity-100 scale-[1.02]' : ''}`}>
                {paying ? <><CircleNotch className="w-5 h-5 animate-spin" /> Procesando...</>
                 : paid  ? <><Check className="w-6 h-6 text-white animate-bounce" strokeWidth={3} /> ¡Turno Confirmado!</>
                 : <>Confirmar y Pagar</>}
              </button>
            </div>
          )}
        </div>
        <div className="h-6 flex-shrink-0" />
      </PatientSheet>

      {/* ─── Cancel modal ─── */}
      <PatientSheet open={!!cancelTarget} onClose={() => setCancelTarget(null)} maxWidth="max-w-md">
        <div className="px-6 pt-4 pb-2 flex items-center gap-3 flex-shrink-0">
          <button onClick={() => setCancelTarget(null)} className="w-10 h-10 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50">
            <X className="w-5 h-5 text-gray-700" />
          </button>
          <h2 className="text-[20px] font-semibold text-gray-900">Cancelar turno</h2>
        </div>
        <div className="px-6 flex-1 overflow-y-auto pb-8">
          <p className="text-gray-500 text-[14px] mb-5 mt-2">¿Estás seguro/a que querés cancelar este turno?</p>
          <div className="mb-5">
            <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5 block">Motivo (opcional)</label>
            <textarea
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              rows={3}
              placeholder="Contanos brevemente por qué..."
              className="w-full bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3 outline-none text-[15px] font-medium text-gray-900 focus:border-red-300"
            />
          </div>
          <div className="flex gap-3">
            <button onClick={() => setCancelTarget(null)} className="btn-secondary flex-1 py-3.5 text-[15px]">No, volver</button>
            <button onClick={handleCancel} disabled={cancelling} className="btn-danger flex-1 py-3.5 text-[15px]">
              {cancelling ? 'Cancelando...' : 'Sí, cancelar'}
            </button>
          </div>
        </div>
      </PatientSheet>

      {/* ─── Review modal ─── */}
      <PatientSheet open={!!reviewTarget} onClose={() => setReviewTarget(null)} maxWidth="max-w-md">
        <div className="px-6 pt-4 pb-2 flex items-center gap-3 flex-shrink-0">
          <button onClick={() => setReviewTarget(null)} className="w-10 h-10 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50">
            <X className="w-5 h-5 text-gray-700" />
          </button>
          <h2 className="text-[20px] font-semibold text-gray-900">Dejá tu reseña</h2>
        </div>
        <div className="px-6 flex-1 overflow-y-auto pb-8">
          <p className="text-gray-500 text-[14px] mb-5 mt-2">
            ¿Cómo fue tu experiencia con <span className="font-semibold text-gray-800">{reviewTarget?.professional?.fullName || 'el profesional'}</span>?
          </p>
          {/* Star picker */}
          <div className="flex gap-2 justify-center mb-6">
            {[1,2,3,4,5].map(n => (
              <button key={n} onClick={() => setReviewRating(n)} className="transition-transform hover:scale-110">
                <Star className={`w-10 h-10 ${n <= reviewRating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} />
              </button>
            ))}
          </div>
          <div className="mb-5">
            <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5 block">Comentario (opcional)</label>
            <textarea
              value={reviewComment}
              onChange={e => setReviewComment(e.target.value)}
              rows={3}
              placeholder="Contanos tu experiencia..."
              className="w-full bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3 outline-none text-[15px] font-medium text-gray-900 focus:border-brand"
            />
          </div>
          <button onClick={submitReview} disabled={!reviewRating || submittingReview} className="btn-primary w-full py-4 text-[16px]">
            {submittingReview ? 'Enviando...' : 'Enviar reseña'}
          </button>
        </div>
      </PatientSheet>

    </div>
  )
}
