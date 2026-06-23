import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Calendar, Pill, Warning, Heartbeat,
  ClipboardText, CaretRight, Stethoscope, VideoCamera, MapPin,
  Pulse,
} from '@phosphor-icons/react'
import { historiaClinicaService } from '../../services/historiaClinicaService'
import { consultationsService } from '../../services/consultationsService'

const CONDITION_STATUS = {
  active:   { label: 'Activo',  bg: '#fef2f2', color: '#b91c1c' },
  chronic:  { label: 'Crónico', bg: '#fffbeb', color: '#b45309' },
  resolved: { label: 'Resuelto', bg: '#f0fdf4', color: '#15803d' },
}

const MED_STATUS = {
  active:    { label: 'Activo',     bg: '#f0fdf4', color: '#15803d' },
  completed: { label: 'Completado', bg: '#f0f9ff', color: '#0284c7' },
  stopped:   { label: 'Suspendido', bg: '#f9fafb', color: '#6b7280' },
}

function StatusBadge({ map, value }) {
  const s = map[value] ?? { label: value, bg: '#f3f4f6', color: '#374151' }
  return (
    <span
      className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full flex-shrink-0"
      style={{ backgroundColor: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  )
}

function SectionHeader({ title, count, onViewAll, viewAllLabel = 'Ver todos' }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-bold text-text-primary">{title}</span>
        {count != null && (
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{count}</span>
        )}
      </div>
      {onViewAll && (
        <button
          onClick={onViewAll}
          className="flex items-center gap-1 text-[12px] font-bold text-brand hover:text-brand-hover transition-colors"
        >
          {viewAllLabel}
          <CaretRight className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}

function EmptyState({ message }) {
  return (
    <p className="text-[13px] text-text-tertiary text-center py-4">{message}</p>
  )
}

function SkeletonCard() {
  return (
    <div className="rounded-[16px] bg-bg-primary border border-border-default p-4 animate-pulse">
      <div className="h-3 w-2/3 bg-gray-200 rounded mb-2" />
      <div className="h-3 w-1/3 bg-gray-100 rounded" />
    </div>
  )
}

export default function HealthSnapshot({ profile }) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [timeline, setTimeline] = useState(null)
  const [consultations, setConsultations] = useState([])

  useEffect(() => {
    if (!profile?.id) return
    Promise.all([
      historiaClinicaService.getPatientTimeline(profile.id),
      consultationsService.getByPatient(profile.id),
    ])
      .then(([tl, cons]) => {
        setTimeline(tl)
        setConsultations(cons)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [profile?.id])

  // Derived data
  const allConditions = timeline?.encounters?.flatMap(e => e.conditions ?? []) ?? []
  const activeConditions = allConditions.filter(c => ['active', 'chronic'].includes(c.clinicalStatus))

  const allMedications = timeline?.encounters?.flatMap(e => e.medications ?? []) ?? []
  const activeMedications = allMedications.filter(m => !m.status || m.status === 'active')

  const allergies = timeline?.allergies ?? []

  const now = new Date()
  const upcomingConsultations = consultations
    .filter(c => ['confirmed', 'pending'].includes(c.status) && c.scheduledAt && new Date(c.scheduledAt) > now)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
  const nextConsultation = upcomingConsultations[0] ?? null

  const completedCount = consultations.filter(c => c.status === 'completed').length
  const thisYear = now.getFullYear()
  const thisYearCount = consultations.filter(c => {
    if (c.status !== 'completed') return false
    const d = new Date(c.scheduledAt || c.completedAt || 0)
    return d.getFullYear() === thisYear
  }).length
  const encounterCount = timeline?.encounters?.filter(e => e.status === 'finished').length ?? 0

  const STATS = [
    { label: 'Consultas totales', value: loading ? '—' : completedCount, icon: Stethoscope, color: '#7CB38B' },
    { label: `En ${thisYear}`,    value: loading ? '—' : thisYearCount,  icon: Calendar,   color: '#9B8EC4' },
    { label: 'Con HC',  value: loading ? '—' : encounterCount, icon: ClipboardText, color: '#E8927C' },
  ]

  return (
    <div className="absolute inset-0 bg-bg-primary overflow-y-auto">

      {/* Header */}
      <div className="sticky top-0 z-10 bg-bg-primary/90 backdrop-blur-md border-b border-border-default px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
          <ArrowLeft className="w-5 h-5 text-text-primary" />
        </button>
        <div>
          <h1 className="text-[18px] font-bold text-text-primary leading-tight">Resumen de salud</h1>
          <p className="text-[12px] text-text-secondary">Condiciones, medicamentos y turnos</p>
        </div>
      </div>

      <div className="px-4 py-5 flex flex-col gap-5 max-w-2xl mx-auto pb-16">

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2.5">
          {STATS.map((s, i) => (
            <div key={i} className="bg-white rounded-[16px] border border-border-default p-3 flex flex-col gap-1">
              <s.icon className="w-4 h-4" style={{ color: s.color }} />
              <span className="text-[22px] font-black text-text-primary leading-none">{s.value}</span>
              <span className="text-[10px] font-semibold text-text-tertiary leading-tight">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Next appointment */}
        <div className="bg-white rounded-[20px] border border-border-default p-4">
          <SectionHeader
            title="Próximo turno"
            onViewAll={() => navigate('/paciente/consultas')}
            viewAllLabel="Ver todos"
          />
          {loading ? (
            <SkeletonCard />
          ) : nextConsultation ? (
            <div
              onClick={() => {
                if (nextConsultation.modality === 'video') {
                  navigate(`/paciente/sala-espera/${nextConsultation.id}`)
                } else {
                  navigate('/paciente/consultas')
                }
              }}
              className="flex items-center gap-3 px-4 py-3 rounded-[14px] border border-brand/20 cursor-pointer hover:border-brand/40 transition-colors"
              style={{ backgroundColor: '#f0f7f3' }}
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#7CB38B' }}>
                {nextConsultation.modality === 'video'
                  ? <VideoCamera className="w-5 h-5 text-white" />
                  : <MapPin className="w-5 h-5 text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-bold text-text-primary leading-tight truncate">
                  {nextConsultation.professional?.fullName ?? 'Profesional'}
                </p>
                <p className="text-[12px] text-text-secondary mt-0.5">
                  {nextConsultation.modality === 'video' ? 'Videoconsulta' : 'Presencial'} ·{' '}
                  {nextConsultation.scheduledAt
                    ? new Date(nextConsultation.scheduledAt).toLocaleString('es-AR', {
                        weekday: 'short', day: '2-digit', month: 'short',
                        hour: '2-digit', minute: '2-digit',
                        timeZone: 'America/Argentina/Buenos_Aires',
                      })
                    : '—'}
                </p>
              </div>
              <CaretRight className="w-4 h-4 text-brand flex-shrink-0" />
            </div>
          ) : (
            <div
              onClick={() => navigate('/paciente/reservar')}
              className="flex items-center gap-3 px-4 py-3 rounded-[14px] border border-dashed border-border-default cursor-pointer hover:border-brand/40 group transition-colors"
            >
              <Calendar className="w-5 h-5 text-text-muted group-hover:text-brand transition-colors flex-shrink-0" />
              <span className="text-[13px] text-text-tertiary font-medium group-hover:text-text-primary transition-colors">
                Sin turnos próximos — reservá ahora
              </span>
              <CaretRight className="w-4 h-4 text-text-muted group-hover:text-brand transition-colors flex-shrink-0 ml-auto" />
            </div>
          )}
        </div>

        {/* Active conditions */}
        <div className="bg-white rounded-[20px] border border-border-default p-4">
          <SectionHeader
            title="Condiciones"
            count={loading ? null : activeConditions.length}
            onViewAll={() => navigate('/paciente/historia-clinica')}
            viewAllLabel="Ver HC"
          />
          {loading ? (
            <>
              <SkeletonCard />
              <div className="mt-2"><SkeletonCard /></div>
            </>
          ) : activeConditions.length === 0 ? (
            <EmptyState message="Sin condiciones registradas por profesionales" />
          ) : (
            <div className="flex flex-col gap-2">
              {activeConditions.slice(0, 5).map((c, i) => (
                <div key={c.id ?? i} className="flex items-start justify-between gap-3 px-3 py-2.5 rounded-[12px] bg-bg-primary border border-border-default">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text-primary leading-tight">
                      {c.icd10Display ?? c.display ?? '—'}
                    </p>
                    {c.icd10Code && (
                      <p className="text-[11px] text-text-tertiary mt-0.5 font-mono">{c.icd10Code}</p>
                    )}
                  </div>
                  <StatusBadge map={CONDITION_STATUS} value={c.clinicalStatus} />
                </div>
              ))}
              {activeConditions.length > 5 && (
                <button
                  onClick={() => navigate('/paciente/historia-clinica')}
                  className="text-[12px] font-bold text-brand hover:text-brand-hover text-center py-1 transition-colors"
                >
                  +{activeConditions.length - 5} más — Ver HC completa
                </button>
              )}
            </div>
          )}
        </div>

        {/* Active medications */}
        <div className="bg-white rounded-[20px] border border-border-default p-4">
          <SectionHeader
            title="Medicamentos"
            count={loading ? null : activeMedications.length}
            onViewAll={() => navigate('/paciente/historia-clinica')}
            viewAllLabel="Ver HC"
          />
          {loading ? (
            <SkeletonCard />
          ) : activeMedications.length === 0 ? (
            <EmptyState message="Sin medicamentos activos registrados" />
          ) : (
            <div className="flex flex-col gap-2">
              {activeMedications.slice(0, 5).map((m, i) => (
                <div key={m.id ?? i} className="flex items-start justify-between gap-3 px-3 py-2.5 rounded-[12px] bg-bg-primary border border-border-default">
                  <div className="flex items-start gap-2.5 flex-1 min-w-0">
                    <Pill className="w-4 h-4 text-brand mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-text-primary leading-tight">
                        {m.medicationName ?? '—'}
                      </p>
                      {(m.dosage || m.frequency) && (
                        <p className="text-[11px] text-text-secondary mt-0.5">
                          {[m.dosage, m.frequency].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                  </div>
                  {m.status && <StatusBadge map={MED_STATUS} value={m.status} />}
                </div>
              ))}
              {activeMedications.length > 5 && (
                <button
                  onClick={() => navigate('/paciente/historia-clinica')}
                  className="text-[12px] font-bold text-brand hover:text-brand-hover text-center py-1 transition-colors"
                >
                  +{activeMedications.length - 5} más — Ver HC completa
                </button>
              )}
            </div>
          )}
        </div>

        {/* Allergies */}
        <div className="bg-white rounded-[20px] border border-border-default p-4">
          <SectionHeader
            title="Alergias conocidas"
            count={loading ? null : allergies.length}
            onViewAll={() => navigate('/paciente/historia-clinica')}
            viewAllLabel="Ver HC"
          />
          {loading ? (
            <SkeletonCard />
          ) : allergies.length === 0 ? (
            <EmptyState message="Sin alergias registradas" />
          ) : (
            <div className="flex flex-wrap gap-2">
              {allergies.map((a, i) => (
                <span
                  key={a.id ?? i}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-50 border border-red-200 text-red-700 text-[12px] font-semibold"
                >
                  <Warning className="w-3.5 h-3.5 flex-shrink-0" />
                  {a.allergen}{a.severity ? ` (${a.severity})` : ''}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Quick links */}
        <div className="bg-white rounded-[20px] border border-border-default p-4">
          <SectionHeader title="Accesos rápidos" />
          <div className="flex flex-col gap-2">
            {[
              { label: 'Historia Clínica completa', icon: ClipboardText, to: '/paciente/historia-clinica', color: '#7CB38B' },
              { label: 'Análisis de laboratorio (BioVisor)', icon: Pulse, to: '/paciente/biovisor', color: '#9B8EC4' },
              { label: 'Plan nutricional', icon: Heartbeat, to: '/paciente/nutriplan', color: '#E8927C' },
              { label: 'Reservar turno', icon: Calendar, to: '/paciente/reservar', color: '#6366f1' },
            ].map((l, i) => (
              <button
                key={i}
                onClick={() => navigate(l.to)}
                className="flex items-center gap-3 px-3 py-3 rounded-[12px] hover:bg-bg-primary transition-colors group text-left"
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: l.color + '18' }}>
                  <l.icon className="w-4 h-4" style={{ color: l.color }} />
                </div>
                <span className="text-[14px] font-medium text-text-primary flex-1">{l.label}</span>
                <CaretRight className="w-4 h-4 text-text-tertiary group-hover:text-text-secondary transition-colors" />
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
