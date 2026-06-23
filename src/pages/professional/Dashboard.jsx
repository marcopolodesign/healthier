import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, Star, Users, Clock, Warning, XCircle, Siren, TrendUp, ArrowRight, CurrencyDollar, LinkSimple, CheckCircle, X, CircleNotch } from '@phosphor-icons/react';
import { consultationsService } from '../../services/consultationsService'
import { professionalService } from '../../services/professionalService'
import { emergencyService } from '../../services/emergencyService'
import { mpService } from '../../services/mpService'
import { walkInQueueService } from '../../services/walkInQueueService'
import { supabase } from '../../lib/supabase'
import StatusBadge from '../../components/StatusBadge'
import { toast } from '../../components/Toast'
import { useNavigate } from 'react-router-dom'

const CODE_COLORS = { ROJO: 'bg-red-600', AMARILLO: 'bg-amber-500', VERDE: 'bg-emerald-600' }

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

export default function ProfessionalDashboard({ profile }) {
  const navigate = useNavigate()
  const [consultations, setConsultations] = useState([])
  const [earningsData, setEarningsData] = useState([])
  const [profProfile, setProfProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeEmergency, setActiveEmergency] = useState(null)
  const [mpStatus, setMpStatus] = useState(null)
  const [confirmingId, setConfirmingId] = useState(null)
  const [walkInQueue, setWalkInQueue] = useState([])
  const [claimingId, setClaimingId] = useState(null)
  const [availableWalkIn, setAvailableWalkIn] = useState(false)
  const [togglingAvail, setTogglingAvail] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    Promise.all([
      consultationsService.getByProfessional(profile.id),
      professionalService.getByUserId(profile.id),
      emergencyService.getActiveForProfessional(profile.id),
      consultationsService.getEarningsData(profile.id),
      mpService.getConnectionStatus(profile.id),
    ]).then(([cons, prof, emg, earnings, mp]) => {
      setConsultations(cons)
      setProfProfile(prof)
      setActiveEmergency(emg)
      setEarningsData(earnings)
      setMpStatus(mp.data)
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
      toast.success(next ? 'Disponible para consultas urgentes' : 'No disponible para consultas urgentes')
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
      })
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

    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Hola, {profile?.fullName?.split(' ')[0]}</h1>
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
        ) : (
          <div className="card border-warning/30 bg-yellow-50">
            <div className="flex items-start gap-3">
              <Warning className="h-6 w-6 text-warning shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-text-primary">Perfil en revisión</p>
                <p className="text-sm text-text-secondary mt-1">
                  Tu documentación está siendo verificada por nuestro equipo. Te notificaremos cuando esté aprobado (24-48 hs).
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Emergency banner */}
      {activeEmergency && (
        <Link
          to="/profesional/emergencias"
          className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-white ${CODE_COLORS[activeEmergency.triage_code] ?? 'bg-red-600'} shadow-lg`}
        >
          <Siren className="w-5 h-5 shrink-0 animate-pulse" />
          <div className="flex-1 min-w-0">
            <p className="font-black text-sm leading-tight">Emergencia activa</p>
            <p className="text-xs opacity-80 truncate">
              {activeEmergency.dispatch_code} · {activeEmergency.triage_code} · {
                activeEmergency.status === 'dispatched' ? 'Esperando confirmación'
                : activeEmergency.status === 'in_transit' ? 'En camino'
                : 'Llegaste'
              }
            </p>
          </div>
          <span className="text-sm font-bold shrink-0">Ver →</span>
        </Link>
      )}

      <div>
        <h1 className="text-2xl font-bold text-text-primary">Hola, {profile?.fullName?.split(' ')[0]} 👋</h1>
        <p className="text-text-secondary mt-1">Tu agenda de hoy</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className="card">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${s.color}`}>
              <s.icon className="h-5 w-5" />
            </div>
            <p className="text-2xl font-bold text-text-primary">{loading ? '—' : s.value}</p>
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
          <p className="text-2xl font-bold text-text-primary mt-0.5">
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

      {/* MercadoPago connection banner */}
      {!loading && mpStatus && !mpStatus.connected && (
        <a
          href={mpService.getMpConnectUrl(profile.id)}
          className="card flex items-center gap-4 border-amber-200 bg-amber-50 hover:border-amber-300 transition-colors group"
        >
          <div className="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0">
            <LinkSimple className="h-6 w-6 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-amber-700 font-medium uppercase tracking-wide">Pagos no configurados</p>
            <p className="text-base font-semibold text-text-primary mt-0.5">Conectar MercadoPago</p>
            <p className="text-xs text-text-secondary mt-0.5">Necesario para recibir pagos de tus consultas</p>
          </div>
          <div className="flex items-center gap-1 text-amber-600 text-sm font-medium shrink-0 group-hover:gap-2 transition-all">
            Conectar <ArrowRight className="h-4 w-4" />
          </div>
        </a>
      )}
      {!loading && mpStatus?.connected && (
        <div className="card flex items-center gap-4 border-emerald-200 bg-emerald-50">
          <div className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center shrink-0">
            <CheckCircle className="h-6 w-6 text-emerald-600" weight="fill" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-emerald-700 font-medium uppercase tracking-wide">MercadoPago conectado</p>
            <p className="text-sm text-text-secondary mt-0.5">{mpStatus.email ?? 'Cuenta vinculada'}</p>
          </div>
        </div>
      )}

      {/* Pending bookings — only shown when there are pending ones */}
      {pendingBookings.length > 0 && (
        <div className="card border-amber-200 bg-amber-50/60">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-amber-800">
              Turnos pendientes
              <span className="ml-2 inline-flex items-center justify-center h-5 w-5 rounded-full bg-amber-600 text-white text-xs font-bold">
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
      <div className="card border-brand/30 bg-brand/5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-brand" />
            <h2 className="font-semibold text-brand">
              Consultas urgentes
              {walkInQueue.length > 0 && (
                <span className="ml-2 inline-flex items-center justify-center h-5 w-5 rounded-full bg-brand text-white text-xs font-bold">
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
          {availableWalkIn ? '✅ Disponible para atender consultas urgentes sin turno' : 'Activá para recibir consultas urgentes sin turno previo'}
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
              return (
                <div key={c.id} className="flex items-center gap-3 p-3 bg-bg-surface rounded-lg">
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
                  <StatusBadge status={c.status} />
                  {canJoin && (
                    <Link to={`/profesional/videollamada/${c.id}`} className="btn-primary text-xs px-3 py-1.5 shrink-0">
                      Sala
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
