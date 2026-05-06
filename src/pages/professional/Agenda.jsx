import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Zap, Plus, X, Calendar, Video, ExternalLink } from 'lucide-react'
import { professionalService } from '../../services/professionalService'
import { availabilityService } from '../../services/availabilityService'
import { consultationsService } from '../../services/consultationsService'
import CalendlyEmbed from '../../components/CalendlyEmbed'
import { toast } from '../../components/Toast'

const DAYS = [
  { value: 1, label: 'Lunes',     short: 'Lun' },
  { value: 2, label: 'Martes',    short: 'Mar' },
  { value: 3, label: 'Miércoles', short: 'Mié' },
  { value: 4, label: 'Jueves',    short: 'Jue' },
  { value: 5, label: 'Viernes',   short: 'Vie' },
  { value: 6, label: 'Sábado',    short: 'Sáb' },
  { value: 0, label: 'Domingo',   short: 'Dom' },
]

function fmtTime(t) {
  return t ? t.slice(0, 5) : ''
}

export default function Agenda({ profile }) {
  const [form, setForm] = useState({ calendlyUrl: '', isOnDemand: false })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const [schedule, setSchedule] = useState([])
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [addingForDay, setAddingForDay] = useState(null)
  const [newFranja, setNewFranja] = useState({ start: '', end: '' })
  const [addingFranja, setAddingFranja] = useState(false)

  const [todayConsultations, setTodayConsultations] = useState([])

  useEffect(() => {
    professionalService.getByUserId(profile?.id)
      .then(p => {
        if (p) setForm({ calendlyUrl: p.calendlyUrl || '', isOnDemand: p.isOnDemand || false })
      })
      .finally(() => setLoading(false))
  }, [profile?.id])

  useEffect(() => {
    if (!profile?.id) return
    setScheduleLoading(true)
    availabilityService.getSchedule(profile.id)
      .then(setSchedule)
      .catch(() => toast.error('Error al cargar horarios'))
      .finally(() => setScheduleLoading(false))
  }, [profile?.id])

  useEffect(() => {
    if (!profile?.id) return
    consultationsService.getByProfessional(profile.id).then(all => {
      const now = new Date()
      const today = all.filter(c => {
        if (!['pending', 'confirmed', 'in_progress'].includes(c.status)) return false
        if (!c.scheduledAt) return false
        const d = new Date(c.scheduledAt)
        return d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth() &&
          d.getDate() === now.getDate()
      })
      setTodayConsultations(today)
    }).catch(() => {})
  }, [profile?.id])

  const save = async () => {
    setSaving(true)
    try {
      await professionalService.upsert(profile.id, form)
      toast.success('Agenda actualizada')
    } catch {
      toast.error('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const openAddFranja = (dayValue) => {
    setAddingForDay(addingForDay === dayValue ? null : dayValue)
    setNewFranja({ start: '', end: '' })
  }

  const addFranja = async (dayOfWeek) => {
    if (!newFranja.start || !newFranja.end) {
      toast.warning('Completá inicio y fin de la franja')
      return
    }
    if (newFranja.start >= newFranja.end) {
      toast.warning('El horario de fin debe ser posterior al de inicio')
      return
    }
    setAddingFranja(true)
    try {
      const entry = await availabilityService.addScheduleEntry({
        professionalId: profile.id,
        dayOfWeek,
        startTime: newFranja.start,
        endTime: newFranja.end,
      })
      setSchedule(prev => [...prev, entry])
      setNewFranja({ start: '', end: '' })
      setAddingForDay(null)
      toast.success('Franja agregada')
    } catch (err) {
      if (err?.code === '23505') {
        toast.error('Ya existe una franja con ese horario de inicio para ese día')
      } else {
        toast.error('Error al agregar franja')
      }
    } finally {
      setAddingFranja(false)
    }
  }

  const deleteFranja = async (id) => {
    try {
      await availabilityService.deleteScheduleEntry(id)
      setSchedule(prev => prev.filter(s => s.id !== id))
      toast.info('Franja eliminada')
    } catch {
      toast.error('Error al eliminar franja')
    }
  }

  const scheduleByDay = useMemo(() =>
    DAYS.reduce((acc, d) => {
      acc[d.value] = schedule
        .filter(s => s.dayOfWeek === d.value)
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
      return acc
    }, {})
  , [schedule])

  if (loading) return <div className="h-64 bg-bg-surface rounded-xl animate-pulse" />

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Mi agenda</h1>
        <p className="text-text-secondary mt-1">Configurá tus franjas horarias por día de la semana</p>
      </div>

      {/* ── Consultas de Hoy ── */}
      {todayConsultations.length > 0 && (
        <div className="card space-y-3">
          <p className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">Hoy</p>
          {todayConsultations.map(c => {
            const patientName = c.patient?.fullName || c.profiles?.fullName || c.profiles?.full_name || 'Paciente'
            const time = c.scheduledAt
              ? new Date(c.scheduledAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
              : '—'
            const isVideo = c.modality === 'video'
            return (
              <div key={c.id} className="flex items-center gap-4 p-3 bg-bg-surface rounded-xl">
                <div className={`w-2 h-2 rounded-full shrink-0 ${isVideo ? 'bg-brand' : 'bg-green-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-text-primary text-sm truncate">{patientName}</p>
                  <p className="text-xs text-text-secondary">{isVideo ? 'Videoconsulta' : 'Presencial'} · {time}</p>
                </div>
                {isVideo && (
                  <Link
                    to={`/profesional/videollamada/${c.id}`}
                    className="btn-primary flex items-center gap-1.5 text-sm px-4 py-2 shrink-0"
                  >
                    <Video className="h-4 w-4" />
                    Acceder a la consulta
                  </Link>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Horario Semanal ── */}
      <div className="card space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-muted flex items-center justify-center">
            <Calendar className="h-5 w-5 text-brand" />
          </div>
          <div>
            <p className="font-semibold text-text-primary">Horario semanal</p>
            <p className="text-sm text-text-secondary">Los pacientes verán estas franjas al reservar un turno</p>
          </div>
        </div>

        {scheduleLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-14 bg-bg-surface rounded-lg animate-pulse" />)}
          </div>
        ) : (
          <div className="space-y-2">
            {DAYS.map(day => {
              const entries = scheduleByDay[day.value] || []
              const isAdding = addingForDay === day.value
              const hasEntries = entries.length > 0

              return (
                <div key={day.value} className="border border-border-default rounded-xl overflow-hidden">
                  {/* Day header */}
                  <div className={`flex items-center justify-between px-4 py-3 ${hasEntries ? 'bg-brand-muted/40' : 'bg-bg-surface'}`}>
                    <div className="flex items-center gap-3">
                      <span className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold ${hasEntries ? 'bg-brand text-white' : 'bg-gray-200 text-text-tertiary'}`}>
                        {day.short}
                      </span>
                      <span className="font-medium text-text-primary text-sm">{day.label}</span>
                      {hasEntries && (
                        <span className="text-xs text-brand font-medium">
                          {entries.length} franja{entries.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => openAddFranja(day.value)}
                      className="p-1.5 rounded-lg hover:bg-brand-muted text-brand transition-colors"
                      title={isAdding ? 'Cancelar' : 'Agregar franja'}
                    >
                      {isAdding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    </button>
                  </div>

                  {/* Existing franjas */}
                  {hasEntries && (
                    <div className="px-4 py-2 flex flex-wrap gap-2 border-t border-border-default bg-white">
                      {entries.map(e => (
                        <div key={e.id} className="flex items-center gap-1.5 border border-border-default rounded-full px-3 py-1.5 bg-bg-surface">
                          <span className="text-sm font-medium text-text-primary">
                            {fmtTime(e.startTime)} – {fmtTime(e.endTime)}
                          </span>
                          <button
                            onClick={() => deleteFranja(e.id)}
                            className="text-text-tertiary hover:text-red-500 transition-colors ml-0.5"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add franja inline form */}
                  {isAdding && (
                    <div className="px-4 pb-3 pt-2 bg-bg-surface border-t border-border-default">
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          value={newFranja.start}
                          onChange={e => setNewFranja(p => ({ ...p, start: e.target.value }))}
                          className="form-input text-sm flex-1"
                        />
                        <span className="text-text-tertiary text-sm shrink-0">—</span>
                        <input
                          type="time"
                          value={newFranja.end}
                          onChange={e => setNewFranja(p => ({ ...p, end: e.target.value }))}
                          className="form-input text-sm flex-1"
                        />
                        <button
                          onClick={() => addFranja(day.value)}
                          disabled={addingFranja}
                          className="btn-primary text-sm px-4 py-2 shrink-0"
                        >
                          {addingFranja ? '...' : 'Agregar'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Configuración ── */}
      <div className="card space-y-5">
        {/* On-demand toggle */}
        <div className="flex items-center justify-between p-4 bg-bg-surface rounded-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center">
              <Zap className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="font-semibold text-text-primary">Consulta inmediata</p>
              <p className="text-sm text-text-secondary">Aparecés como disponible para consultas al instante</p>
            </div>
          </div>
          <button
            onClick={() => setForm(p => ({ ...p, isOnDemand: !p.isOnDemand }))}
            className={`w-12 h-7 rounded-full transition-colors relative ${form.isOnDemand ? 'bg-accent' : 'bg-gray-300'}`}
          >
            <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-transform ${form.isOnDemand ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        {/* Calendly URL */}
        <div>
          <label className="form-label flex items-center gap-1.5">
            <ExternalLink className="h-4 w-4" />
            Link de Calendly (alternativo)
          </label>
          <input
            type="url"
            value={form.calendlyUrl}
            onChange={e => setForm(p => ({ ...p, calendlyUrl: e.target.value }))}
            placeholder="https://calendly.com/tu-usuario"
            className="form-input"
          />
          <p className="text-xs text-text-tertiary mt-1">
            Opcional — se muestra junto con tus franjas nativas.{' '}
            <a href="https://calendly.com" target="_blank" rel="noreferrer" className="text-brand hover:underline">
              Crear cuenta en Calendly
            </a>
          </p>
        </div>

        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? 'Guardando...' : 'Guardar configuración'}
        </button>
      </div>

      {form.calendlyUrl && (
        <div className="card">
          <h2 className="font-semibold text-text-primary mb-4">Vista previa de Calendly</h2>
          <CalendlyEmbed url={form.calendlyUrl} height={500} />
        </div>
      )}
    </div>
  )
}
