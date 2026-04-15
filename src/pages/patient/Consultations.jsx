import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Calendar, Clock, Video, MapPin, Star, ChevronRight, ArrowLeft, Loader2, Check,
  Stethoscope, Apple, BrainCircuit, Dumbbell, PawPrint,
} from 'lucide-react'
import { consultationsService } from '../../services/consultationsService'
import { professionalService } from '../../services/professionalService'
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
  clinica:     ['Médico Generalista', 'Cardiología', 'Dermatología', 'Pediatría', 'Traumatología', 'Ginecología'],
  mente:       ['Terapia Cognitivo Conductual', 'Psicoanálisis', 'Psiquiatría', 'Terapia de Pareja', 'Psicología Infantil'],
  nutricion:   ['Nutrición Deportiva', 'Nutrición Clínica', 'Pérdida de Peso', 'Trastornos Alimentarios'],
  fisico:      ['Kinesiología y Rehabilitación', 'Preparación Física', 'Yoga y Pilates', 'Entrenamiento Funcional'],
  veterinaria: ['Clínica General Veterinaria', 'Vacunación', 'Urgencias 24h', 'Peluquería Canina/Felina'],
}

const AGENDA_DATES = ['12 Mar', '13 Mar', '14 Mar', '15 Mar', '16 Mar', '17 Mar']
const AGENDA_TIMES = ['09:00 AM', '10:30 AM', '14:00 PM', '16:00 PM', '18:30 PM']

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

export default function PatientConsultations({ profile }) {
  const navigate = useNavigate()
  const [view, setView] = useState('upcoming')
  const [turnos, setTurnos] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [selVertical, setSelVertical] = useState(null)
  const [step, setStep] = useState('modality')
  const [modality, setModality] = useState(null)
  const [specialty, setSpecialty] = useState(null)
  const [professional, setProfessional] = useState(null)
  const [agendaDate, setAgendaDate] = useState('12 Mar')
  const [agendaTime, setAgendaTime] = useState(null)
  const [paying, setPaying] = useState(false)
  const [paid, setPaid] = useState(false)
  const [pros, setPros] = useState([])
  const [prosLoading, setProsLoading] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    consultationsService.getByPatient(profile.id)
      .then(data => setTurnos(data))
      .catch(() => toast.error('Error al cargar consultas'))
      .finally(() => setLoading(false))
  }, [profile?.id])

  const openModal = vertical => {
    setSelVertical(vertical)
    setStep('modality'); setModality(null); setSpecialty(null); setProfessional(null)
    setAgendaDate('12 Mar'); setAgendaTime(null); setPaying(false); setPaid(false)
    setPros([]); setProsLoading(false)
    setModalOpen(true)
  }

  const loadPros = verticalId => {
    const slugs = VERTICAL_SPECIALTIES[verticalId] || []
    if (!slugs.length) { setPros([]); return }
    setProsLoading(true)
    professionalService.search({ specialty: slugs[0] })
      .then(data => setPros(data))
      .catch(() => setPros([]))
      .finally(() => setProsLoading(false))
  }

  const advanceToProfessional = verticalId => {
    loadPros(verticalId)
    setStep('professional')
  }

  const goBack = () => {
    if (step === 'payment') setStep('datetime')
    else if (step === 'datetime') setStep('professional')
    else if (step === 'professional') setStep(ESPECIALIDADES[selVertical?.id] ? 'specialty' : 'modality')
    else if (step === 'specialty') setStep('modality')
    else setModalOpen(false)
  }

  const confirmPay = () => {
    setPaying(true)
    setTimeout(async () => {
      try {
        await consultationsService.create({
          patientId:      profile.id,
          professionalId: professional.id,
          scheduledAt:    `2026-03-${agendaDate.split(' ')[0]}T${agendaTime?.split(' ')[0]}:00`,
          status:         'confirmed',
        })
        setPaid(true)
        setTimeout(() => {
          setModalOpen(false)
          toast.success('¡Turno confirmado!')
          consultationsService.getByPatient(profile.id).then(setTurnos)
        }, 1000)
      } catch {
        toast.error('Error al confirmar el turno')
        setPaying(false)
      }
    }, 1500)
  }

  const STEP_TITLES = {
    modality: 'Elegir Modalidad', specialty: 'Elegir Especialidad',
    professional: 'Elegir Profesional', datetime: 'Elegir Horario', payment: 'Confirmar Pago',
  }

  const upcoming = turnos.filter(t => !['completed', 'cancelled'].includes(t.status))
  const past     = turnos.filter(t =>  ['completed', 'cancelled'].includes(t.status))
  const shown    = view === 'upcoming' ? upcoming : past

  return (
    <div className="absolute inset-0 bg-bg-primary pt-6 sm:pt-8 pb-32 px-6 overflow-y-auto animate-fade-in scrollbar-hide">
      <div className="max-w-2xl mx-auto">
      <div className="mb-8 mt-4">
        <h1 className="text-[32px] font-black text-gray-900 tracking-tight leading-none">Mi Agenda</h1>
        <p className="text-gray-500 font-medium text-[15px] mt-2 flex items-center gap-1.5">
          <Calendar className="w-4 h-4 text-gray-400" /> Reservá tu turno
        </p>
      </div>

      {/* Specialty list — scrollable on mobile, wrapped grid on desktop */}
      <div className="flex gap-3 overflow-x-auto scrollbar-hide sm:overflow-visible sm:flex-wrap mb-8 -mx-6 px-6 sm:mx-0 sm:px-0">
        {VERTICALS.map(v => (
          <div
            key={v.id}
            onClick={() => openModal(v)}
            className="bg-white rounded-[20px] p-3 shadow-sm border border-gray-100 flex items-center gap-3 cursor-pointer hover:border-blue-200 transition-all flex-shrink-0 min-w-[140px]"
          >
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
          <button
            key={tab}
            onClick={() => setView(tab)}
            className={`flex-1 py-2.5 text-[14px] font-bold rounded-lg transition-all ${view === tab ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
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
          return (
            <div key={t.id} className="bg-white rounded-[24px] p-5 shadow-sm border border-gray-100 flex flex-col gap-4 hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start border-b border-gray-50 pb-4">
                <div className="flex gap-3">
                  <div className="w-12 h-12 rounded-[14px] flex items-center justify-center flex-shrink-0" style={{ backgroundColor: vert.bg }}>
                    <vert.icon className="w-6 h-6" style={{ color: vert.color }} />
                  </div>
                  <div>
                    <h4 className="font-bold text-[16px] text-gray-900 leading-tight">{t.professionalName || 'Profesional'}</h4>
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
              {view === 'upcoming' && t.status === 'confirmed' && t.modality === 'video' && (
                <button onClick={() => navigate('/paciente/videollamada/1')} className="w-full bg-brand text-white py-2.5 rounded-xl font-bold text-[13px] hover:bg-brand-hover transition-colors flex items-center justify-center gap-2">
                  <Video className="w-4 h-4" /> Entrar a Sala
                </button>
              )}
            </div>
          )
        })}
      </div>

      </div>{/* end max-w-2xl */}

      {/* Booking modal — responsive sheet/modal */}
      <PatientSheet open={modalOpen && !!selVertical} onClose={() => setModalOpen(false)}>
        <div className="px-6 pt-4 pb-2 flex justify-between items-center flex-shrink-0">
          <div>
            <h2 className="text-[24px] font-black text-gray-900 leading-none tracking-tight">{STEP_TITLES[step]}</h2>
            <p className="text-[13px] font-bold text-gray-500 tracking-widest uppercase mt-1">
              {selVertical?.nombre}{modality ? ` • ${modality}` : ''}{specialty && step !== 'specialty' && step !== 'modality' ? ` • ${specialty}` : ''}
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
                    <div key={opt.mod} onClick={() => { setModality(opt.mod); if (ESPECIALIDADES[selVertical.id]) { setStep('specialty') } else { advanceToProfessional(selVertical.id) } }} className="bg-bg-primary p-5 rounded-[24px] shadow-sm border border-gray-100 flex items-center gap-4 cursor-pointer hover:border-brand transition-all group">
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
                    const proName   = p.profiles?.fullName || 'Profesional'
                    const proAvatar = p.profiles?.avatarUrl || null
                    const proObj    = { id: p.userId, name: proName, img: proAvatar, rating: String(p.averageRating ?? '—'), reviews: p.totalReviews ?? 0 }
                    return (
                      <div key={p.id} onClick={() => { setProfessional(proObj); setStep('datetime') }} className="bg-bg-primary p-4 rounded-[24px] shadow-sm border border-gray-100 flex gap-4 cursor-pointer hover:border-brand transition-all group">
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
                  <div className="bg-bg-primary rounded-[24px] p-5 shadow-sm border border-gray-100 mb-6">
                    <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">Día</h4>
                    <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide -mx-2 px-2">
                      {AGENDA_DATES.map(d => (
                        <div key={d} onClick={() => setAgendaDate(d)} className={`flex-shrink-0 px-4 py-2 rounded-xl cursor-pointer font-bold text-[14px] transition-colors border ${agendaDate === d ? 'bg-brand text-white border-brand' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>{d}</div>
                      ))}
                    </div>
                    <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3 mt-2">Hora</h4>
                    <div className="grid grid-cols-3 gap-2">
                      {AGENDA_TIMES.map(t => (
                        <div key={t} onClick={() => setAgendaTime(t)} className={`px-2 py-3 rounded-xl cursor-pointer font-bold text-[13px] text-center transition-colors border ${agendaTime === t ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>{t}</div>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => setStep('payment')} disabled={!agendaTime} className={`w-full py-5 rounded-[20px] font-bold text-[17px] shadow-sm transition-all flex justify-center items-center gap-2 ${agendaTime ? 'bg-brand text-white hover:bg-brand-hover active:scale-95' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                    Continuar al Pago
                  </button>
                </div>
              )}

              {step === 'payment' && (
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
                        <p className="text-[14px] text-gray-500 font-medium mt-0.5">{specialty}</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="bg-white rounded-xl p-3 flex justify-center items-center border border-gray-100">
                        <span className="font-bold text-[14px] text-gray-800 flex items-center gap-2">
                          {modality === 'Videollamada' ? <Video className="w-4 h-4 text-brand" /> : <MapPin className="w-4 h-4 text-emerald-600" />} Cita {modality}
                        </span>
                      </div>
                      <div className="bg-white rounded-xl p-3 flex justify-between items-center border border-gray-100">
                        <span className="font-bold text-[14px] text-gray-800 flex items-center gap-2"><Calendar className="w-4 h-4 text-gray-400" /> {agendaDate}</span>
                        <span className="font-black text-[14px] text-gray-900 flex items-center gap-2"><Clock className="w-4 h-4 text-gray-400" /> {agendaTime}</span>
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
                     : paid  ? <><Check className="w-6 h-6 text-white animate-bounce" strokeWidth={3} /> ¡Pago Exitoso!</>
                     : <>Confirmar y Pagar</>}
                  </button>
                </div>
              )}
        </div>
        <div className="h-6 flex-shrink-0" />{/* bottom padding */}
      </PatientSheet>
    </div>
  )
}
