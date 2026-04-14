import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDaysIcon, StarIcon, UserGroupIcon, ClockIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { consultationsService } from '../../services/consultationsService'
import { professionalService } from '../../services/professionalService'
import StatusBadge from '../../components/StatusBadge'
import { toast } from '../../components/Toast'

export default function ProfessionalDashboard({ profile }) {
  const [consultations, setConsultations] = useState([])
  const [profProfile, setProfProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.id) return
    Promise.all([
      consultationsService.getByProfessional(profile.id),
      professionalService.getByUserId(profile.id),
    ]).then(([cons, prof]) => {
      setConsultations(cons)
      setProfProfile(prof)
    }).catch(() => toast.error('Error al cargar datos'))
    .finally(() => setLoading(false))
  }, [profile?.id])

  const today = consultations.filter(c => {
    if (!c.scheduledAt) return false
    const d = new Date(c.scheduledAt)
    const now = new Date()
    return d.toDateString() === now.toDateString()
  })

  const stats = [
    { label: 'Consultas hoy',    value: today.length,                          icon: CalendarDaysIcon, color: 'text-brand bg-brand-muted' },
    { label: 'Total consultas',  value: consultations.length,                  icon: UserGroupIcon,    color: 'text-blue-500 bg-blue-50' },
    { label: 'Calificación',     value: profProfile?.averageRating?.toFixed(1) || '—', icon: StarIcon, color: 'text-yellow-500 bg-yellow-50' },
    { label: 'Reseñas',          value: profProfile?.totalReviews || 0,        icon: UserGroupIcon,    color: 'text-purple-500 bg-purple-50' },
  ]

  if (!profProfile?.isVerified && !loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Hola, {profile?.fullName?.split(' ')[0]}</h1>
        </div>
        <div className="card border-warning/30 bg-yellow-50">
          <div className="flex items-start gap-3">
            <ExclamationTriangleIcon className="h-6 w-6 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-text-primary">Perfil en revisión</p>
              <p className="text-sm text-text-secondary mt-1">
                Tu documentación está siendo verificada por nuestro equipo. Te notificaremos cuando esté aprobado (24-48 hs).
              </p>
              {!profProfile && (
                <Link to="/profesional/onboarding" className="btn-primary text-sm mt-3 inline-flex">
                  Completar perfil
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Hola, {profile?.fullName?.split(' ')[0]} 👋</h1>
        <p className="text-text-secondary mt-1">Tu agenda de hoy</p>
      </div>

      {/* Stats */}
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
            <ClockIcon className="h-10 w-10 text-text-muted mx-auto mb-2" />
            <p className="text-text-secondary text-sm">No tenés consultas para hoy</p>
          </div>
        ) : (
          <div className="space-y-3">
            {today.map(c => (
              <Link key={c.id} to={`/profesional/consulta/${c.id}`} className="flex items-center gap-4 p-3 bg-bg-surface rounded-lg hover:bg-bg-surface-hover transition-colors">
                <div className="w-10 h-10 rounded-full bg-brand-muted flex items-center justify-center shrink-0">
                  <UserGroupIcon className="h-5 w-5 text-brand" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-text-primary text-sm truncate">
                    {c.profiles?.fullName || c.profiles?.full_name || 'Paciente'}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {c.scheduledAt ? new Date(c.scheduledAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </p>
                </div>
                <StatusBadge status={c.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
