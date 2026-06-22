import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, Star, Users, Clock, Warning, XCircle, Siren, TrendUp, ArrowRight, CurrencyDollar, LinkSimple, CheckCircle } from '@phosphor-icons/react';
import { consultationsService } from '../../services/consultationsService'
import { professionalService } from '../../services/professionalService'
import { emergencyService } from '../../services/emergencyService'
import { mpService } from '../../services/mpService'
import { supabase } from '../../lib/supabase'
import StatusBadge from '../../components/StatusBadge'
import { toast } from '../../components/Toast'

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
  const [consultations, setConsultations] = useState([])
  const [earningsData, setEarningsData] = useState([])
  const [profProfile, setProfProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeEmergency, setActiveEmergency] = useState(null)
  const [mpStatus, setMpStatus] = useState(null)

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

    // Real-time booking notifications — fire when a patient creates a new consultation
    const bookingChannel = supabase
      .channel(`pro-bookings-${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'consultations', filter: `professional_id=eq.${profile.id}` },
        async (payload) => {
          const updated = await consultationsService.getByProfessional(profile.id)
          setConsultations(updated)
          const newCons = updated.find(c => c.id === payload.new.id)
          const name = newCons?.profiles?.fullName || 'Nuevo paciente'
          const time = newCons?.scheduledAt
            ? new Date(newCons.scheduledAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
            : null
          toast.success(time ? `Nueva reserva de ${name} — ${time}` : `Nueva reserva de ${name}`)
        }
      )
      .subscribe()

    return () => {
      unsubEmergency()
      supabase.removeChannel(bookingChannel)
    }
  }, [profile?.id])

  const today = consultations.filter(c => {
    if (!c.scheduledAt) return false
    return new Date(c.scheduledAt).toDateString() === new Date().toDateString()
  })

  const thisMonthEarnings = getThisMonthEarnings(earningsData)

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
