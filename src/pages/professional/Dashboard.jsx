import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Calendar, Star, Users, Clock, Warning, XCircle, Siren, TrendUp, ArrowRight, CurrencyDollar, LinkSimple, CheckCircle, X, CircleNotch, WhatsappLogo, FileText, Lightning, ArrowsClockwise } from '@phosphor-icons/react';
import { consultationsService } from '../../services/consultationsService'
import { consultationEventsService, CONSULTATION_EVENTS } from '../../services/consultationEventsService'
import { professionalService } from '../../services/professionalService'
import { emergencyService } from '../../services/emergencyService'
import { mpService } from '../../services/mpService'
import { walkInQueueService } from '../../services/walkInQueueService'
import { availabilityService } from '../../services/availabilityService'
import { supabase } from '../../lib/supabase'
import { supportWhatsAppLink } from '../../lib/support'
import StatusBadge from '../../components/StatusBadge'
import ProfileCompletenessCard from '../../components/professional/ProfileCompletenessCard'
import PatientWaitingBadge from '../../components/professional/PatientWaitingBadge'
import IncomingRequests from '../../components/professional/IncomingRequests'
import OnDemandSwitch from '../../components/professional/OnDemandSwitch'
import MercadoPagoMark from '../../components/icons/MercadoPagoMark'
import Modal from '../../components/Modal'
import { useWaitingPresence } from '../../hooks/useWaitingPresence'
import { toast } from '../../components/Toast'
import { useNavigate } from 'react-router-dom'

const CODE_COLORS = { ROJO: 'bg-red-600', AMARILLO: 'bg-amber-500', VERDE: 'bg-emerald-600' }

// Temporarily disabled 2026-07-23 — claiming a walk-in entry throws "Error al
// atender la consulta" for at least one freshly-created professional account.
// Root cause not yet confirmed (handleClaimEntry swallows the real Postgres/
// Supabase error into a generic toast). Hidden as a precaution rather than
// fixed blind — see nextsteps.md before flipping this back to true.
const FASTPASS_ENABLED = false

function formatARS(amount) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount || 0)
}

function getThisMonthEarnings(earningsData) {
  const now = new Date()
  return earningsData
    .filter(c => {
      const d = new Date(c.completedAt || c.scheduledAt)
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    })
    .reduce((sum, c) => sum + (c.priceAtBooking || 0), 0)
}

const MP_ERROR_MESSAGES = {
  token_exchange: 'No pudimos completar la conexión con Mercado Pago. Probá de nuevo en unos minutos.',
  db_save: 'La autorización salió bien pero no pudimos guardarla. Probá conectar de nuevo.',
  invalid_state: 'No pudimos validar la conexión por seguridad. Iniciá el proceso de nuevo desde este botón.',
}

const ASK_ONDEMAND_KEY = 'prof-ask-ondemand'

export default function ProfessionalDashboard({ profile }) {
  // Se pregunta una vez por sesión, no en cada visita al dashboard.
  const [askOnDemand, setAskOnDemand] = useState(false)
  const [onDemandOn, setOnDemandOn] = useState(null)

  useEffect(() => {
    if (!profile?.id || onDemandOn !== false) return
    if (sessionStorage.getItem(ASK_ONDEMAND_KEY)) return
    setAskOnDemand(true)
  }, [profile?.id, onDemandOn])

  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [showMpConnectedModal, setShowMpConnectedModal] = useState(false)
  const [consultations, setConsultations] = useState([])
  const [earningsData, setEarningsData] = useState([])
  const [profProfile, setProfProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeEmergency, setActiveEmergency] = useState(null)
  const [mpStatus, setMpStatus] = useState(null)
  const [confirmingId, setConfirmingId] = useState(null)
  const [walkInQueue, setWalkInQueue] = useState([])
  const [claimingId, setClaimingId] = useState(null)

  // Feedback del retorno del OAuth de Mercado Pago (?mp_connected=1 / ?mp_error=...)
  useEffect(() => {
    const connected = searchParams.get('mp_connected')
    const mpError = searchParams.get('mp_error')
    if (!connected && !mpError) return
    if (connected === '1') setShowMpConnectedModal(true)
    if (mpError) toast.error(MP_ERROR_MESSAGES[mpError] ?? 'No pudimos conectar Mercado Pago. Probá de nuevo.')
    navigate('/profesional/dashboard', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [availableWalkIn, setAvailableWalkIn] = useState(false)
  const [togglingAvail, setTogglingAvail] = useState(false)
  const [schedules, setSchedules] = useState([])

  useEffect(() => {
    if (!profile?.id) return
    Promise.all([
      consultationsService.getByProfessional(profile.id),
      professionalService.getByUserId(profile.id),
      emergencyService.getActiveForProfessional(profile.id),
      consultationsService.getEarningsData(profile.id),
      mpService.getConnectionStatus(profile.id),
      availabilityService.getSchedule(profile.id),
    ]).then(([cons, prof, emg, earnings, mp, sched]) => {
      setConsultations(cons)
      setProfProfile(prof)
      setActiveEmergency(emg)
      setEarningsData(earnings)
      setMpStatus(mp.data)
      setSchedules(sched)
    }).catch(() => toast.error('Error al cargar datos'))
    .finally(() => setLoading(false))

    const unsubEmergency = emergencyService.subscribe(profile.id, (updated) => {
      const terminal = ['cancelled', 'completed']
      setActiveEmergency(terminal.includes(updated.status) ? null : updated)
    })

    // Live state update — AppLayout handles the toast; this just refreshes the list
    const bookingChannel = supabase
      .channel(`dashboard-bookings-${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'consultations', filter: `professional_id=eq.${profile.id}` },
        async () => {
          const updated = await consultationsService.getByProfessional(profile.id)
          setConsultations(updated)
        }
      )
      .subscribe()

    walkInQueueService.getWaitingQueue().then(setWalkInQueue).catch(() => {})
    walkInQueueService.getMyAvailability(profile.id).then(setAvailableWalkIn).catch(() => {})

    const queueChannel = walkInQueueService.subscribeToQueue(async () => {
      const updated = await walkInQueueService.getWaitingQueue()
      setWalkInQueue(updated)
    })

    return () => {
      unsubEmergency()
      supabase.removeChannel(bookingChannel)
      queueChannel.unsubscribe()
    }
  }, [profile?.id])

  const today = consultations.filter(c => {
    if (!c.scheduledAt) return false
    return new Date(c.scheduledAt).toDateString() === new Date().toDateString()
  })

  const waitingInfo = useWaitingPresence(consultations, profile?.id)
  const [admittingId, setAdmittingId] = useState(null)

  // Habilitar al paciente y entrar: son la misma intención del profesional
  // ("lo atiendo ahora"), y separarlas es lo que dejaba al paciente colgado.
  const handleAdmit = async (consultationId) => {
    if (admittingId) return
    setAdmittingId(consultationId)
    try {
      await consultationsService.admitPatient(consultationId)
      consultationEventsService.log(consultationId, CONSULTATION_EVENTS.PRO_ADMITTED_PATIENT, null,
        { id: profile?.id, role: 'professional' })
      navigate(`/profesional/videollamada/${consultationId}`)
    } catch {
      toast.error('No pudimos habilitar al paciente. Probá de nuevo.')
    } finally {
      setAdmittingId(null)
    }
  }

  const thisMonthEarnings = getThisMonthEarnings(earningsData)

  // Upcoming pending bookings that need confirmation (not today — those are in the today section)
  const pendingBookings = consultations.filter(c => {
    if (c.status !== 'pending') return false
    if (!c.scheduledAt) return false
    const d = new Date(c.scheduledAt)
    return d > new Date()
  }).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))

  async function handleConfirm(id) {
    setConfirmingId(id)
    try {
      await consultationsService.updateStatus(id, 'confirmed')
      setConsultations(prev => prev.map(c => c.id === id ? { ...c, status: 'confirmed' } : c))
      toast.success('Turno confirmado')
    } catch {
      toast.error('Error al confirmar')
    } finally {
      setConfirmingId(null)
    }
  }

  async function handleReject(id) {
    setConfirmingId(id)
    try {
      await consultationsService.cancel(id, profile.id, 'Rechazado por el profesional')
      setConsultations(prev => prev.map(c => c.id === id ? { ...c, status: 'cancelled' } : c))
      toast.success('Turno rechazado')
    } catch {
      toast.error('Error al rechazar')
    } finally {
      setConfirmingId(null)
    }
  }

  async function handleToggleAvailability() {
    setTogglingAvail(true)
    try {
      const next = !availableWalkIn
      await walkInQueueService.setAvailability(profile.id, next)
      setAvailableWalkIn(next)
      toast.success(next ? 'Disponible para Fastpass' : 'No disponible para Fastpass')
    } catch {
      toast.error('Error al cambiar disponibilidad')
    } finally {
      setTogglingAvail(false)
    }
  }

  async function handleClaimEntry(entry) {
    setClaimingId(entry.id)
    try {
      const consultation = await consultationsService.create({
        patientId: entry.patientId,
        professionalId: profile.id,
        modality: 'video',
        status: 'in_progress',
        notes: entry.chiefComplaint,
      }, { bookedBy: 'professional' })
      await walkInQueueService.claim(entry.id, profile.id, consultation.id)
      setWalkInQueue(prev => prev.filter(e => e.id !== entry.id))
      navigate(`/profesional/videollamada/${consultation.id}`)
    } catch {
      toast.error('Error al atender la consulta')
    } finally {
      setClaimingId(null)
    }
  }

  const stats = [
    { label: 'Consultas hoy',   value: today.length,                                   icon: Calendar,     color: 'text-brand bg-brand-muted' },
    { label: 'Total consultas', value: consultations.length,                           icon: Users,        color: 'text-blue-600 bg-blue-50' },
    { label: 'Calificación',    value: profProfile?.averageRating?.toFixed(1) || '—', icon: Star,         color: 'text-yellow-500 bg-yellow-50' },
    { label: 'Reseñas',         value: profProfile?.totalReviews || 0,                icon: Users,        color: 'text-purple-500 bg-purple-50' },
  ]

  if (!profProfile?.isVerified && !loading) {
    const isRejected = !!profProfile?.rejectedAt
    // Submitted via "Subo los documentos después" (onboarding step Documentación) —
    // nothing for an admin to review yet, so this is a distinct state that
    // precedes "Perfil en revisión", not the same thing.
    const isMissingDocs = !isRejected && !!profProfile
      && !profProfile.titleDocumentUrl && !profProfile.licenseDocumentUrl && !profProfile.dniDocumentUrl

    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="page-title">Hola, {profile?.fullName?.split(' ')[0]}</h1>
        </div>

        {isRejected ? (
          <div className="card border-red-200 bg-red-50">
            <div className="flex items-start gap-3">
              <XCircle className="h-6 w-6 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-text-primary">Perfil rechazado</p>
                {profProfile.rejectionReason && (
                  <p className="text-sm text-text-secondary mt-1 bg-white rounded-lg p-3 border border-red-100">
                    {profProfile.rejectionReason}
                  </p>
                )}
                <p className="text-sm text-text-secondary mt-2">
                  Revisá la información y volvé a enviar tu perfil con las correcciones necesarias.
                </p>
                <Link to="/profesional/onboarding?resubmit=1" className="btn-primary text-sm mt-3 inline-flex">
                  Corregir y reenviar
                </Link>
              </div>
            </div>
          </div>
        ) : !profProfile ? (
          <div className="card border-brand/20 bg-brand-muted/30">
            <div className="flex items-start gap-3">
              <Warning className="h-6 w-6 text-brand shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-text-primary">Completá tu perfil</p>
                <p className="text-sm text-text-secondary mt-1">
                  Para empezar a recibir consultas necesitás completar tu perfil profesional y enviar tu documentación.
                </p>
                <Link to="/profesional/onboarding" className="btn-primary text-sm mt-3 inline-flex">
                  Completar perfil
                </Link>
              </div>
            </div>
          </div>
        ) : isMissingDocs ? (
          <div className="card border-blue-200 bg-blue-50">
            <div className="flex items-start gap-3">
              <FileText className="h-6 w-6 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-text-primary">Te faltan subir documentos</p>
                <p className="text-sm text-text-secondary mt-1">
                  Enviaste tu perfil sin título, matrícula o DNI — la verificación todavía no arrancó porque necesitamos esos documentos para revisarte. Subilos cuando puedas, no hace falta hacerlo todo de una vez.
                </p>
                <Link to="/profesional/onboarding?resubmit=1&step=3" className="btn-primary text-sm mt-3 inline-flex">
                  Subir documentos
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <div className="card border-warning/30 bg-yellow-50">
            <div className="flex items-start gap-3">
              <Warning className="h-6 w-6 text-warning shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-text-primary">Perfil en revisión</p>
                <p className="text-sm text-text-secondary mt-1">
                  Tu documentación está siendo verificada por nuestro equipo. Te notificaremos cuando esté aprobado (24-48 hs).
                </p>
                <a
                  href={supportWhatsAppLink('Hola, tengo una consulta sobre la verificación de mi perfil profesional en Healthier:')}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-brand mt-3"
                >
                  <WhatsappLogo weight="fill" className="h-4 w-4" /> ¿Alguna duda? Escribinos por WhatsApp
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Get Started — let a not-yet-verified professional set price/horarios/zona/avatar
            while they wait, instead of losing that time. Shown regardless of isRejected/
            isMissingDocs/pending state as long as a profile row exists to derive it from;
            excludes the "documentos" step (includeVerification=false) since it's not
            actionable here and the card above already explains that state. */}
        {!!profProfile && (
          <ProfileCompletenessCard
            profProfile={profProfile}
            schedules={schedules}
            includeVerification={false}
            title="Adelantá tu perfil mientras esperás"
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">

      {/* El switch de disponibilidad, arriba de todo: estaba enterrado en Agenda y
          detrás de un "Guardar configuración", así que existir en el pool on-demand
          dependía de acordarse de entrar a otra pantalla (Mateo, 2026-07-31). */}
      <OnDemandSwitch profileId={profile?.id} onChange={v => setOnDemandOn(v)} />

      {/* Al entrar, si está apagado, se pregunta una vez por sesión. Es la decisión
          que define si la plataforma tiene o no oferta ese día. */}
      <Modal
        open={askOnDemand}
        onClose={() => { sessionStorage.setItem(ASK_ONDEMAND_KEY, '1'); setAskOnDemand(false) }}
        title="¿Estás disponible para consultas inmediatas?"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Si lo activás, los pacientes que necesiten atención ahora te pueden llegar
            directo. Dura una hora y podés apagarlo cuando quieras desde el panel.
          </p>
          <div className="flex flex-col-reverse sm:flex-row gap-3">
            <button
              onClick={() => { sessionStorage.setItem(ASK_ONDEMAND_KEY, '1'); setAskOnDemand(false) }}
              className="btn-secondary flex-1"
            >
              Ahora no
            </button>
            <button
              onClick={async () => {
                sessionStorage.setItem(ASK_ONDEMAND_KEY, '1')
                setAskOnDemand(false)
                try {
                  await professionalService.upsert(profile.id, { isOnDemand: true })
                  setOnDemandOn(true)
                  toast.success('Estás disponible para consultas inmediatas')
                } catch {
                  toast.error('No pudimos activarlo')
                }
              }}
              className="btn-primary flex-1"
            >
              Activar
            </button>
          </div>
        </div>
      </Modal>

      {/* Pedidos de consulta inmediata esperando a que alguien los tome.
          Va primero a propósito: es lo único de esta pantalla que caduca. */}
      <IncomingRequests profile={profile} />

      {/* Emergency banner */}
      {activeEmergency && (
        <Link
          to="/profesional/emergencias"
          className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-white ${CODE_COLORS[activeEmergency.triage_code] ?? 'bg-red-600'} shadow-lg`}
        >
          <Siren className="w-5 h-5 shrink-0 animate-pulse" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-tight">Emergencia activa</p>
            <p className="text-xs opacity-80 truncate">
              {activeEmergency.dispatch_code} · {activeEmergency.triage_code} · {
                activeEmergency.status === 'dispatched' ? 'Esperando confirmación'
                : activeEmergency.status === 'in_transit' ? 'En camino'
                : 'Llegaste'
              }
            </p>
          </div>
          <span className="text-sm font-semibold shrink-0">Ver →</span>
        </Link>
      )}

      <div>
        <h1 className="page-title">Hola, {profile?.fullName?.split(' ')[0]} 👋</h1>
        <p className="text-text-secondary mt-1">Tu agenda de hoy</p>
      </div>

      {!loading && <ProfileCompletenessCard profProfile={profProfile} schedules={schedules} />}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className="card bg-gradient-to-br from-bg-primary to-brand/10">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${s.color}`}>
              <s.icon className="h-5 w-5" />
            </div>
            <p className="text-2xl font-semibold text-text-primary">{loading ? '—' : s.value}</p>
            <p className="text-xs text-text-secondary mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Earnings banner */}
      <Link to="/profesional/ganancias" className="card flex items-center gap-4 hover:border-brand/40 transition-colors group">
        <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center shrink-0">
          <TrendUp className="h-6 w-6 text-emerald-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-text-secondary font-medium uppercase tracking-wide">Ganancias este mes</p>
          <p className="text-2xl font-semibold text-text-primary mt-0.5">
            {loading ? <span className="text-text-muted">—</span> : formatARS(thisMonthEarnings)}
          </p>
          {!loading && earningsData.length > 0 && (
            <p className="text-xs text-text-secondary mt-0.5">
              {earningsData.filter(c => {
                const d = new Date(c.completedAt || c.scheduledAt)
                const now = new Date()
                return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
              }).length} consultas completadas
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 text-brand text-sm font-medium shrink-0 group-hover:gap-2 transition-all">
          Ver desglose <ArrowRight className="h-4 w-4" />
        </div>
      </Link>

      {/* MercadoPago connection banner — red/urgent: bookings are blocked without it (spec D4) */}
      {!loading && mpStatus && !mpStatus.connected && (
        <a
          href={mpService.getMpConnectUrl(profile.id)}
          className="card flex items-center gap-4 border-red-300 bg-red-50 hover:border-red-400 transition-colors group"
        >
          <div className="w-12 h-12 rounded-2xl bg-white border border-red-200 flex items-center justify-center shrink-0">
            <MercadoPagoMark className="w-8 h-8" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-red-700 font-bold uppercase tracking-wide">Acción requerida</p>
            <p className="text-base font-semibold text-text-primary mt-0.5">No podés recibir turnos hasta conectar Mercado Pago</p>
            <p className="text-xs text-text-secondary mt-0.5">Los pacientes no pueden reservarte hasta que conectes tu cuenta</p>
          </div>
          <div className="flex items-center gap-1 text-red-600 text-sm font-semibold shrink-0 group-hover:gap-2 transition-all">
            Conectar <ArrowRight className="h-4 w-4" />
          </div>
        </a>
      )}
      {!loading && mpStatus?.connected && (
        <div className="card flex items-center gap-4 border-emerald-200 bg-emerald-50">
          <div className="w-12 h-12 rounded-2xl bg-white border border-emerald-200 flex items-center justify-center shrink-0">
            <MercadoPagoMark className="w-8 h-8" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-emerald-700 font-medium uppercase tracking-wide">MercadoPago conectado</p>
            <p className="text-sm text-text-secondary mt-0.5">Cobrás el 80% de cada consulta directo en tu cuenta de MP</p>
          </div>
          <Link to="/profesional/configuracion" className="text-sm font-medium text-emerald-700 hover:text-emerald-800 shrink-0">
            Administrar
          </Link>
        </div>
      )}

      {/* Modal post-conexión de Mercado Pago */}
      {showMpConnectedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setShowMpConnectedModal(false)}>
          <div className="bg-white rounded-3xl shadow-xl max-w-lg w-full p-8 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-16 h-16 rounded-full bg-white border border-emerald-200 flex items-center justify-center mb-4">
                <MercadoPagoMark className="w-10 h-10" />
              </div>
              <h2 className="font-serif text-2xl text-text-primary">¡Mercado Pago conectado!</h2>
              <p className="text-sm text-text-secondary mt-1">Ya podés recibir turnos. Así funciona el cobro:</p>
            </div>

            <ul className="space-y-4 mb-8">
              <li className="flex gap-3">
                <CurrencyDollar className="h-5 w-5 text-brand shrink-0 mt-0.5" />
                <p className="text-sm text-text-primary">
                  <span className="font-semibold">Cobrás el 80% del valor de cada consulta.</span>{' '}
                  Mercado Pago cobra su comisión sobre ese mismo pago, como en cualquier
                  venta tuya — en Ganancias ves el desglose y lo que te acredita.
                </p>
              </li>
              <li className="flex gap-3">
                <Lightning className="h-5 w-5 text-brand shrink-0 mt-0.5" />
                <p className="text-sm text-text-primary">
                  <span className="font-semibold">La plata entra directo en tu cuenta de Mercado Pago</span>{' '}
                  en el momento en que el paciente paga. Nunca pasa por Healthier.
                </p>
              </li>
              <li className="flex gap-3">
                <Clock className="h-5 w-5 text-brand shrink-0 mt-0.5" />
                <p className="text-sm text-text-primary">
                  <span className="font-semibold">¿Cuándo podés retirarla?</span>{' '}
                  Según el plazo de liberación configurado en tu cuenta de MP (al instante o a 10, 18 o 35 días — lo elegís vos en Mercado Pago; a más plazo, menor costo para la plataforma).
                </p>
              </li>
              <li className="flex gap-3">
                <ArrowsClockwise className="h-5 w-5 text-brand shrink-0 mt-0.5" />
                <p className="text-sm text-text-primary">
                  <span className="font-semibold">La autorización se renueva sola.</span>{' '}
                  Si alguna vez se desconecta, te lo avisamos acá en el dashboard.
                </p>
              </li>
              <li className="flex gap-3">
                <LinkSimple className="h-5 w-5 text-brand shrink-0 mt-0.5" />
                <p className="text-sm text-text-primary">
                  <span className="font-semibold">Podés desconectarte cuando quieras</span>{' '}
                  desde Configuración → Mercado Pago. Mientras estés desconectado no vas a recibir turnos nuevos.
                </p>
              </li>
            </ul>

            <div className="flex flex-col sm:flex-row gap-3">
              <button onClick={() => setShowMpConnectedModal(false)} className="btn-primary flex-1 py-3 rounded-full">
                Entendido
              </button>
              <Link to="/profesional/configuracion" className="btn-secondary flex-1 py-3 rounded-full text-center">
                Ir a Configuración
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Pending bookings — only shown when there are pending ones */}
      {pendingBookings.length > 0 && (
        <div className="card border-amber-200 bg-amber-50/60">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-amber-800">
              Turnos pendientes
              <span className="ml-2 inline-flex items-center justify-center h-5 w-5 rounded-full bg-amber-600 text-white text-xs font-semibold">
                {pendingBookings.length}
              </span>
            </h2>
          </div>
          <div className="space-y-2">
            {pendingBookings.map(c => {
              const busy = confirmingId === c.id
              const patientName = c.profiles?.fullName || c.profiles?.full_name || 'Paciente'
              const date = c.scheduledAt
                ? new Date(c.scheduledAt).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
                : '—'
              const time = c.scheduledAt
                ? new Date(c.scheduledAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
                : '—'
              return (
                <div key={c.id} className="flex items-center gap-3 bg-white rounded-xl p-3 border border-amber-100">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-text-primary text-sm truncate">{patientName}</p>
                    <p className="text-xs text-text-secondary mt-0.5 capitalize">{date} · {time}</p>
                    <p className="text-xs text-text-tertiary mt-0.5">{c.modality === 'video' ? 'Videoconsulta' : 'Presencial'}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleReject(c.id)}
                      disabled={busy}
                      className="h-8 w-8 rounded-full border border-red-200 bg-red-50 hover:bg-red-100 flex items-center justify-center transition-colors disabled:opacity-40"
                      title="Rechazar"
                    >
                      {busy ? <CircleNotch className="h-4 w-4 text-red-500 animate-spin" /> : <X className="h-4 w-4 text-red-500" />}
                    </button>
                    <button
                      onClick={() => handleConfirm(c.id)}
                      disabled={busy}
                      className="h-8 w-8 rounded-full border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 flex items-center justify-center transition-colors disabled:opacity-40"
                      title="Confirmar"
                    >
                      {busy ? <CircleNotch className="h-4 w-4 text-emerald-600 animate-spin" /> : <CheckCircle className="h-4 w-4 text-emerald-600" />}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Walk-in availability toggle + queue */}
      {FASTPASS_ENABLED && (
      <div className="card border-brand/30 bg-brand/5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-brand" />
            <h2 className="font-semibold text-brand">
              Fastpass
              {walkInQueue.length > 0 && (
                <span className="ml-2 inline-flex items-center justify-center h-5 w-5 rounded-full bg-brand text-white text-xs font-semibold">
                  {walkInQueue.length}
                </span>
              )}
            </h2>
          </div>
          <button
            onClick={handleToggleAvailability}
            disabled={togglingAvail}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${availableWalkIn ? 'bg-brand' : 'bg-gray-300'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${availableWalkIn ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        <p className="text-xs text-text-secondary mb-3">
          {availableWalkIn ? '✅ Disponible para atender Fastpass sin turno' : 'Activá para recibir Fastpass sin turno previo'}
        </p>

      {walkInQueue.length > 0 && (
        <div>
          <div className="space-y-2">
            {walkInQueue.map(entry => {
              const busy = claimingId === entry.id
              const patientName = entry.patient?.fullName || entry.patient?.full_name || 'Paciente'
              const wait = Math.floor((Date.now() - new Date(entry.createdAt).getTime()) / 60000)
              const priorityColor = { high: 'text-red-600 bg-red-50', medium: 'text-amber-600 bg-amber-50', low: 'text-green-600 bg-green-50' }[entry.priority]
              const priorityLabel = { high: 'Alta', medium: 'Media', low: 'Baja' }[entry.priority]
              return (
                <div key={entry.id} className="flex items-start gap-3 bg-white rounded-xl p-3 border border-brand/10">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-text-primary text-sm truncate">{patientName}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 ${priorityColor}`}>{priorityLabel}</span>
                    </div>
                    <p className="text-xs text-text-secondary mt-1 line-clamp-2">{entry.chiefComplaint}</p>
                    <p className="text-xs text-text-tertiary mt-0.5">{wait < 1 ? 'Ahora mismo' : `${wait} min esperando`}</p>
                  </div>
                  <button
                    onClick={() => handleClaimEntry(entry)}
                    disabled={busy}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-semibold hover:bg-brand/90 disabled:opacity-50 transition-colors"
                  >
                    {busy ? <CircleNotch size={12} className="animate-spin" /> : null}
                    {busy ? 'Iniciando…' : 'Atender'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
      </div>
      )}

      {/* Today's consultations */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-text-primary">Consultas de hoy</h2>
          <Link to="/profesional/agenda" className="text-sm text-brand hover:underline">Ver agenda completa</Link>
        </div>
        {loading ? (
          <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-16 bg-bg-surface rounded-lg animate-pulse" />)}</div>
        ) : today.length === 0 ? (
          <div className="text-center py-8">
            <Clock className="h-10 w-10 text-text-muted mx-auto mb-2" />
            <p className="text-text-secondary text-sm">No tenés consultas para hoy</p>
          </div>
        ) : (
          <div className="space-y-3">
            {today.map(c => {
              const canJoin = c.modality === 'video' && ['confirmed', 'in_progress', 'pending'].includes(c.status)
              const { waiting, since, admitted } = waitingInfo(c.id)
              return (
                <div
                  key={c.id}
                  className={`flex items-center gap-3 p-3 rounded-lg ${
                    waiting ? 'bg-brand-muted ring-2 ring-brand/50' : 'bg-bg-surface'
                  }`}
                >
                  <Link to={`/profesional/consulta/${c.id}`} className="flex items-center gap-3 flex-1 min-w-0 group">
                    <div className="w-10 h-10 rounded-full bg-brand-muted flex items-center justify-center shrink-0">
                      <Users className="h-5 w-5 text-brand" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-text-primary text-sm truncate group-hover:text-brand transition-colors">
                        {c.profiles?.fullName || c.profiles?.full_name || 'Paciente'}
                      </p>
                      <p className="text-xs text-text-secondary">
                        {c.scheduledAt ? new Date(c.scheduledAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </p>
                    </div>
                  </Link>
                  {waiting ? <PatientWaitingBadge since={since} /> : <StatusBadge status={c.status} />}
                  {/* Con el paciente esperando, la acción es habilitarlo — no
                      entrar y que él se entere de rebote. Antes la habilitación
                      era un efecto secundario de abrir la videollamada, así que
                      el paciente quedaba esperando sin señal. */}
                  {waiting && !admitted ? (
                    <button
                      onClick={() => handleAdmit(c.id)}
                      disabled={admittingId === c.id}
                      className="btn-primary text-xs px-3 py-1.5 shrink-0 font-bold disabled:opacity-60"
                    >
                      {admittingId === c.id ? 'Habilitando…' : 'Ingresar paciente'}
                    </button>
                  ) : canJoin && (
                    <Link
                      to={`/profesional/videollamada/${c.id}`}
                      className={`text-xs px-3 py-1.5 shrink-0 ${waiting ? 'btn-primary font-bold' : 'btn-primary'}`}
                    >
                      {waiting ? 'Entrar' : 'Sala'}
                    </Link>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
