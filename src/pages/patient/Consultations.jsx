import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Calendar, Clock, Video, MapPin, Star, ChevronRight, ArrowLeft, Loader2, Check,
  Stethoscope, Apple, BrainCircuit, Dumbbell, PawPrint, X, FileText,
} from 'lucide-react'
import { consultationsService } from '../../services/consultationsService'
import { professionalService } from '../../services/professionalService'
import { availabilityService } from '../../services/availabilityService'
import { reviewsService } from '../../services/reviewsService'
import { VERTICAL_SPECIALTIES } from '../../lib/verticals'
import { toast } from '../../components/Toast'
import PatientSheet from '../../components/patient/PatientSheet'

const VERTICALS = [
  { id: 'clinica',     nombre: 'Clínica',      icon: Stethoscope, color: '#b05a36', bg: '#fef9ef' },
  { id: 'nutricion',   nombre: 'Nutrición',    icon: Apple,       color: '#059669', bg: '#ECFDF5' },
  { id: 'mente',       nombre: 'Psicología',   icon: BrainCircuit,color: '#7C3AED', bg: '#F5F3FF' },
  { id: 'fisico',      nombre: 'Kinesiología', icon: Dumbbell,    color: '#EA580C', bg: '#FFF7ED' },
  { id: 'veterinaria', nombre: 'Veterinaria',  icon: PawPrint,    color: '#0284C7', bg: '#F0F9FF' },
]

const ESPECIALIDADES = {
  clinica:     ['Médico Generalista', 'Cardiología', 'Dermatología', 'Pediatría', 'Traumatología'],
  mente:       ['Terapia Cognitivo Conductual', 'Psicoanálisis', 'Psiquiatría', 'Terapia de Pareja'],
  nutricion:   ['Nutrición Deportiva', 'Nutrición Clínica', 'Pérdida de Peso'],
  fisico:      ['Kinesiología y Rehabilitación', 'Preparación Física', 'Entrenamiento Funcional'],
  veterinaria: ['Clínica General Veterinaria', 'Vacunación', 'Urgencias 24h'],
}

const STATUS_STYLE = {
  confirmed:   'bg-emerald-50 text-emerald-600',
  pending:     'bg-amber-50 text-amber-600',
  cancelled:   'bg-gray-100 text-gray-500',
  completed:   'bg-gray-100 text-gray-500',
  in_progress: 'bg-blue-50 text-brand',
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

export default function PatientConsultations({ profile }) {
  const navigate = useNavigate()
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

  // Cancel modal state
  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  // Review modal state
  const [reviewTarget, setReviewTarget] = useState(null)
  const [reviewRating, setReviewRating] = useState(0)
  const [reviewComment, setReviewComment] = useState('')
  const [submittingReview, setSubmittingReview] = useState(false)

  const loadTurnos = () =>
    consultationsService.getByPatient(profile.id).then(setTurnos)

  useEffect(() => {
    if (!profile?.id) return
    setLoading(true)
    loadTurnos()
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

  const openModal = vertical => {
    setSelVertical(vertical)
    setStep('modality'); setModality(null); setSpecialty(null); setProfessional(null)
    setAvailableSlots([]); setSelectedDate(null); setSelectedSlot(null)
    setPaying(false); setPaid(false); setPros([]); setProsLoading(false)
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
    const proObj = { id: pro.userId, name: pro.profiles?.fullName || 'Profesional', img: pro.profiles?.avatarUrl || null, rating: String(pro.averageRating ?? '—'), reviews: pro.totalReviews ?? 0 }
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

  const confirmPay = () => {
    if (!selectedSlot) return
    setPaying(true)
    setTimeout(async () => {
      try {
        await consultationsService.create({
          patientId:      profile.id,
          professionalId: professional.id,
          scheduledAt:    selectedSlot.startTime,
          modality:       modality === 'Videollamada' ? 'video' : 'presencial',
          status:         'confirmed',
        })
        await availabilityService.bookSlot(selectedSlot.id)
        setPaid(true)
        setTimeout(() => {
          setModalOpen(false)
          toast.success('¡Turno confirmado!')
          loadTurnos()
        }, 1000)
      } catch {
        toast.error('Error al confirmar el turno')
        setPaying(false)
      }
    }, 1500)
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

  const slotsByDate = groupSlotsByDate(availableSlots)
  const availableDates = Object.keys(slotsByDate)
  const timeSlotsForDate = selectedDate ? (slotsByDate[selectedDate] || []) : []

  return (
    <div className="absolute inset-0 bg-bg-primary pt-6 sm:pt-8 pb-32 px-6 overflow-y-auto animate-fade-in scrollbar-hide">
      <div className="max-w-2xl mx-auto">
      <div className="mb-8 mt-4">
        <h1 className="text-[32px] font-black text-gray-900 tracking-tight leading-none">Mi Agenda</h1>
        <p className="text-gray-500 font-medium text-[15px] mt-2 flex items-center gap-1.5">
          <Calendar className="w-4 h-4 text-gray-400" /> Reservá tu turno
        </p>
      </div>

      {/* Specialty list */}
      <div className="flex gap-3 overflow-x-auto scrollbar-hide sm:overflow-visible sm:flex-wrap mb-8 -mx-6 px-6 sm:mx-0 sm:px-0">
        {VERTICALS.map(v => (
          <div key={v.id} onClick={() => openModal(v)} className="bg-white rounded-[20px] p-3 shadow-sm border border-gray-100 flex items-center gap-3 cursor-pointer hover:border-blue-200 transition-all flex-shrink-0 min-w-[140px]">
            <div className="w-10 h-10 rounded-[12px] flex items-center justify-center" style={{ backgroundColor: v.bg }}>
              <v.icon className="w-5 h-5" style={{ color: v.color }} />
            </div>
            <h3 className="font-bold text-[14px] text-gray-900">{v.nombre}</h3>
          </div>
        ))}
      </div>

      {/* View toggle */}
      <div className="flex bg-gray-200/60 p-1 rounded-xl mb-6">
        {['upcoming', 'past'].map(tab => (
          <button key={tab} onClick={() => setView(tab)} className={`flex-1 py-2.5 text-[14px] font-bold rounded-lg transition-all ${view === tab ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {tab === 'upcoming' ? 'Próximos' : 'Historial'}
          </button>
        ))}
      </div>

      {/* Consultation list */}
      <div className="space-y-4">
        {loading ? (
          [1, 2].map(i => <div key={i} className="h-40 bg-white rounded-[24px] animate-pulse border border-gray-100" />)
        ) : shown.length === 0 ? (
          <div className="bg-white p-8 rounded-[24px] border border-gray-100 text-center shadow-sm flex flex-col items-center justify-center">
            <Calendar className="w-10 h-10 text-gray-200 mb-3" />
            <p className="font-bold text-[14px] text-gray-500">No hay turnos en esta sección</p>
          </div>
        ) : shown.map(t => {
          const vert = VERTICALS.find(v => v.id === t.specialty) || VERTICALS[0]
          const date = t.scheduledAt ? new Date(t.scheduledAt) : null
          const hasReview = !!patientReviewMap[t.id]
          return (
            <div key={t.id} className="bg-white rounded-[24px] p-5 shadow-sm border border-gray-100 flex flex-col gap-4 hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start border-b border-gray-50 pb-4">
                <div className="flex gap-3">
                  <div className="w-12 h-12 rounded-[14px] flex items-center justify-center flex-shrink-0" style={{ backgroundColor: vert.bg }}>
                    <vert.icon className="w-6 h-6" style={{ color: vert.color }} />
                  </div>
                  <div>
                    <h4 className="font-bold text-[16px] text-gray-900 leading-tight">{t.professional?.fullName || 'Profesional'}</h4>
                    <p className="text-[13px] text-gray-500 font-medium mt-0.5">{vert.nombre}</p>
                  </div>
                </div>
                <div className={`px-2.5 py-1 rounded-md text-[10px] font-black tracking-widest uppercase ${STATUS_STYLE[t.status] || STATUS_STYLE.pending}`}>
                  {STATUS_LABEL[t.status] || t.status}
                </div>
              </div>

              {date && (
                <div className="bg-bg-primary rounded-xl p-3 flex justify-between items-center border border-gray-100">
                  <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-gray-400" /><span className="font-bold text-[13px] text-gray-800">{date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}</span></div>
                  <div className="w-px h-4 bg-gray-200" />
                  <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-gray-400" /><span className="font-black text-[13px] text-gray-900">{date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span></div>
                  <div className="w-px h-4 bg-gray-200" />
                  <span className={`text-[13px] font-bold flex items-center gap-1 ${t.modality === 'video' ? 'text-brand' : 'text-emerald-600'}`}>
                    {t.modality === 'video' ? <Video className="w-3.5 h-3.5" /> : <MapPin className="w-3.5 h-3.5" />}
                    {t.modality === 'video' ? 'Video' : 'Presencial'}
                  </span>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 flex-wrap">
                {view === 'upcoming' && t.status === 'confirmed' && t.modality === 'video' && (
                  <button onClick={() => navigate('/paciente/videollamada/1')} className="flex-1 bg-brand text-white py-2.5 rounded-xl font-bold text-[13px] hover:bg-brand-hover transition-colors flex items-center justify-center gap-2">
                    <Video className="w-4 h-4" /> Entrar a Sala
                  </button>
                )}
                {view === 'upcoming' && ['confirmed', 'pending'].includes(t.status) && (
                  <button onClick={() => { setCancelTarget(t); setCancelReason('') }} className="px-4 py-2.5 rounded-xl font-bold text-[13px] text-red-500 border border-red-100 hover:bg-red-50 transition-colors">
                    Cancelar
                  </button>
                )}
                {view === 'past' && t.status === 'completed' && t.prescriptionUrl && (
                  <a href={t.prescriptionUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[13px] font-bold text-brand hover:underline">
                    <FileText className="w-4 h-4" /> Ver receta
                  </a>
                )}
                {view === 'past' && t.status === 'completed' && !hasReview && (
                  <button onClick={() => { setReviewTarget(t); setReviewRating(0); setReviewComment('') }} className="px-4 py-2.5 rounded-xl font-bold text-[13px] text-yellow-600 border border-yellow-100 hover:bg-yellow-50 transition-colors flex items-center gap-1.5">
                    <Star className="w-4 h-4" /> Dejar reseña
                  </button>
                )}
                {view === 'past' && t.status === 'completed' && hasReview && (
                  <div className="flex items-center gap-1 text-[13px] text-yellow-500 font-bold">
                    <Star className="w-4 h-4 fill-yellow-400" /> {patientReviewMap[t.id]?.rating}/5
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      </div>{/* end max-w-2xl */}

      {/* ─── Booking modal ─── */}
      <PatientSheet open={modalOpen && !!selVertical} onClose={() => setModalOpen(false)}>
        <div className="px-6 pt-4 pb-2 flex justify-between items-center flex-shrink-0">
          <div>
            <h2 className="text-[24px] font-black text-gray-900 leading-none tracking-tight">{STEP_TITLES[step]}</h2>
            <p className="text-[13px] font-bold text-gray-500 tracking-widest uppercase mt-1">
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
                { label: 'Virtual', sub: 'Videollamada segura en la app', mod: 'Videollamada', icon: Video, bg: 'bg-blue-50', color: 'text-brand' },
                { label: 'Presencial', sub: 'En el consultorio del profesional', mod: 'Presencial', icon: MapPin, bg: 'bg-emerald-50', color: 'text-emerald-600' },
              ].map(opt => (
                <div key={opt.mod} onClick={() => { setModality(opt.mod); ESPECIALIDADES[selVertical.id] ? setStep('specialty') : advanceToProfessional(selVertical.id) }} className="bg-bg-primary p-5 rounded-[24px] shadow-sm border border-gray-100 flex items-center gap-4 cursor-pointer hover:border-brand transition-all group">
                  <div className={`w-14 h-14 ${opt.bg} rounded-full flex items-center justify-center group-hover:scale-110 transition-transform`}>
                    <opt.icon className={`w-7 h-7 ${opt.color}`} />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-black text-[18px] text-gray-900">{opt.label}</h3>
                    <p className="text-[13px] text-gray-500 font-medium mt-0.5">{opt.sub}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-brand transition-colors" />
                </div>
              ))}
            </div>
          )}

          {step === 'specialty' && (
            <div className="space-y-3 pb-6">
              {(ESPECIALIDADES[selVertical.id] || []).map(esp => (
                <div key={esp} onClick={() => { setSpecialty(esp); advanceToProfessional(selVertical.id) }} className="bg-white p-4 rounded-[20px] shadow-sm border border-gray-100 flex justify-between items-center cursor-pointer hover:border-brand hover:bg-bg-primary transition-all group">
                  <span className="font-bold text-[16px] text-gray-800">{esp}</span>
                  <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-brand transition-colors" />
                </div>
              ))}
            </div>
          )}

          {step === 'professional' && (
            <div className="space-y-4 pb-6">
              {prosLoading ? (
                [1, 2].map(i => <div key={i} className="h-24 bg-white rounded-[24px] animate-pulse border border-gray-100" />)
              ) : pros.length === 0 ? (
                <p className="text-center text-gray-400 font-medium py-8">No hay profesionales disponibles para esta especialidad.</p>
              ) : pros.map(p => {
                const proName = p.profiles?.fullName || 'Profesional'
                const proAvatar = p.profiles?.avatarUrl || null
                return (
                  <div key={p.id} onClick={() => selectProfessional(p)} className="bg-bg-primary p-4 rounded-[24px] shadow-sm border border-gray-100 flex gap-4 cursor-pointer hover:border-brand transition-all group">
                    {proAvatar
                      ? <img src={proAvatar} alt={proName} className="w-16 h-16 rounded-full object-cover border-2 border-white shadow-sm flex-shrink-0" />
                      : <div className="w-16 h-16 rounded-full border-2 border-white shadow-sm flex-shrink-0 flex items-center justify-center text-2xl font-black bg-gray-100 text-gray-400">{proName[0]}</div>
                    }
                    <div className="flex-1 flex flex-col justify-center">
                      <h4 className="font-black text-[17px] text-gray-900 leading-tight">{proName}</h4>
                      <div className="flex items-center gap-1.5 mt-1">
                        <div className="flex items-center gap-1 bg-yellow-50 text-yellow-700 px-1.5 py-0.5 rounded text-[12px]">
                          <Star className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                          <span className="font-bold">{String(p.averageRating ?? '—')}</span>
                        </div>
                        <span className="text-[12px] font-medium text-gray-400">({p.totalReviews ?? 0} reseñas)</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-center pr-2">
                      <div className="bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded-full text-[11px] font-bold group-hover:bg-brand group-hover:text-white transition-colors">ELEGIR</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {step === 'datetime' && (
            <div className="pb-6">
              {slotsLoading ? (
                <div className="h-32 bg-white rounded-[24px] animate-pulse border border-gray-100" />
              ) : availableDates.length === 0 ? (
                <div className="bg-bg-primary rounded-[24px] p-5 shadow-sm border border-gray-100 text-center">
                  <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                  <p className="font-bold text-[15px] text-gray-500 mb-1">Sin franjas disponibles</p>
                  <p className="text-[13px] text-gray-400">Este profesional no tiene horarios libres por el momento.</p>
                </div>
              ) : (
                <div className="bg-bg-primary rounded-[24px] p-5 shadow-sm border border-gray-100 mb-6">
                  <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">Día</h4>
                  <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide -mx-2 px-2">
                    {availableDates.map(d => (
                      <div key={d} onClick={() => { setSelectedDate(d); setSelectedSlot(null) }} className={`flex-shrink-0 px-4 py-2 rounded-xl cursor-pointer font-bold text-[14px] transition-colors border ${selectedDate === d ? 'bg-brand text-white border-brand' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>{d}</div>
                    ))}
                  </div>
                  <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3 mt-2">Hora</h4>
                  <div className="grid grid-cols-3 gap-2">
                    {timeSlotsForDate.map(slot => {
                      const t = new Date(slot.startTime).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
                      const isSelected = selectedSlot?.id === slot.id
                      return (
                        <div key={slot.id} onClick={() => setSelectedSlot(slot)} className={`px-2 py-3 rounded-xl cursor-pointer font-bold text-[13px] text-center transition-colors border ${isSelected ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>{t}</div>
                      )
                    })}
                  </div>
                </div>
              )}
              <button onClick={() => setStep('payment')} disabled={!selectedSlot} className={`w-full py-5 rounded-[20px] font-bold text-[17px] shadow-sm transition-all flex justify-center items-center gap-2 ${selectedSlot ? 'bg-brand text-white hover:bg-brand-hover active:scale-95' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                Continuar al Pago
              </button>
            </div>
          )}

          {step === 'payment' && selectedSlot && (
            <div className="pb-6 animate-fade-in">
              <div className="bg-bg-primary rounded-[24px] p-5 shadow-sm border border-gray-100 mb-4">
                <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-4">Resumen</h4>
                <div className="flex gap-4 items-center mb-5">
                  {professional?.img
                    ? <img src={professional.img} alt={professional.name} className="w-14 h-14 rounded-full object-cover border-2 border-white shadow-sm" />
                    : <div className="w-14 h-14 rounded-full border-2 border-white shadow-sm bg-gray-100 flex items-center justify-center font-black text-gray-400 text-xl">{professional?.name?.[0] || '?'}</div>
                  }
                  <div>
                    <h4 className="font-black text-[17px] text-gray-900 leading-tight">{professional?.name}</h4>
                    {specialty && <p className="text-[14px] text-gray-500 font-medium mt-0.5">{specialty}</p>}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="bg-white rounded-xl p-3 flex justify-center items-center border border-gray-100">
                    <span className="font-bold text-[14px] text-gray-800 flex items-center gap-2">
                      {modality === 'Videollamada' ? <Video className="w-4 h-4 text-brand" /> : <MapPin className="w-4 h-4 text-emerald-600" />}
                      Cita {modality}
                    </span>
                  </div>
                  <div className="bg-white rounded-xl p-3 flex justify-between items-center border border-gray-100">
                    <span className="font-bold text-[14px] text-gray-800 flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      {new Date(selectedSlot.startTime).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short' })}
                    </span>
                    <span className="font-black text-[14px] text-gray-900 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-gray-400" />
                      {new Date(selectedSlot.startTime).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-[24px] p-5 shadow-sm border border-gray-100 mb-6">
                <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">Método de Pago</h4>
                <div className="flex items-center justify-between p-3.5 border-2 border-brand bg-brand-muted/40 rounded-[16px]">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-7 rounded bg-[#1A1F71] flex items-center justify-center text-[9px] text-white font-black">VISA</div>
                    <span className="font-bold text-gray-900 text-[15px]">•••• 4242</span>
                  </div>
                  <div className="w-6 h-6 bg-brand rounded-full flex items-center justify-center"><Check className="w-3 h-3 text-white" strokeWidth={3} /></div>
                </div>
                <div className="flex justify-between items-center mt-5 pt-5 border-t border-gray-100">
                  <span className="font-bold text-gray-500">A pagar hoy</span>
                  <span className="font-black text-[24px] text-gray-900">$10.00</span>
                </div>
              </div>
              <button onClick={confirmPay} disabled={paying || paid} className={`w-full py-5 rounded-[20px] font-bold text-[17px] shadow-sm transition-all flex justify-center items-center gap-3 ${paid ? 'bg-emerald-500 text-white scale-[1.02]' : paying ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-brand text-white hover:bg-brand-hover active:scale-95'}`}>
                {paying ? <><Loader2 className="w-5 h-5 animate-spin" /> Procesando...</>
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
          <h2 className="text-[20px] font-black text-gray-900">Cancelar turno</h2>
        </div>
        <div className="px-6 flex-1 overflow-y-auto pb-8">
          <p className="text-gray-500 text-[14px] mb-5 mt-2">¿Estás seguro/a que querés cancelar este turno?</p>
          <div className="mb-5">
            <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Motivo (opcional)</label>
            <textarea
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              rows={3}
              placeholder="Contanos brevemente por qué..."
              className="w-full bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3 outline-none text-[15px] font-medium text-gray-900 focus:border-red-300"
            />
          </div>
          <div className="flex gap-3">
            <button onClick={() => setCancelTarget(null)} className="flex-1 py-3.5 rounded-[20px] font-bold text-[15px] border border-gray-200 text-gray-700 hover:bg-gray-50">No, volver</button>
            <button onClick={handleCancel} disabled={cancelling} className="flex-1 py-3.5 rounded-[20px] font-bold text-[15px] bg-red-500 text-white hover:bg-red-600 transition-colors">
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
          <h2 className="text-[20px] font-black text-gray-900">Dejá tu reseña</h2>
        </div>
        <div className="px-6 flex-1 overflow-y-auto pb-8">
          <p className="text-gray-500 text-[14px] mb-5 mt-2">
            ¿Cómo fue tu experiencia con <span className="font-bold text-gray-800">{reviewTarget?.professional?.fullName || 'el profesional'}</span>?
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
            <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Comentario (opcional)</label>
            <textarea
              value={reviewComment}
              onChange={e => setReviewComment(e.target.value)}
              rows={3}
              placeholder="Contanos tu experiencia..."
              className="w-full bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3 outline-none text-[15px] font-medium text-gray-900 focus:border-brand"
            />
          </div>
          <button onClick={submitReview} disabled={!reviewRating || submittingReview} className={`w-full py-4 rounded-[20px] font-bold text-[16px] transition-all ${reviewRating ? 'bg-brand text-white hover:bg-brand-hover active:scale-95' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
            {submittingReview ? 'Enviando...' : 'Enviar reseña'}
          </button>
        </div>
      </PatientSheet>
    </div>
  )
}
