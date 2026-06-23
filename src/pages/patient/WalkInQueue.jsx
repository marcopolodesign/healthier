import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Siren, Clock, CircleNotch, X, CheckCircle, UserCircle } from '@phosphor-icons/react'
import { walkInQueueService } from '../../services/walkInQueueService'

const PRIORITY_OPTIONS = [
  { value: 'high',   label: 'Alta prioridad',   description: 'Dolor severo, fiebre alta, síntomas que empeoran', color: 'border-red-300 bg-red-50' },
  { value: 'medium', label: 'Prioridad media',  description: 'Síntomas moderados, consulta de urgencia', color: 'border-amber-300 bg-amber-50' },
  { value: 'low',    label: 'Prioridad baja',   description: 'Consulta rápida, resultado de laboratorio, duda', color: 'border-green-300 bg-green-50' },
]

const PRIORITY_BADGE = {
  high:   'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low:    'bg-green-100 text-green-700',
}

function formatWait(createdAt) {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
  if (mins < 1) return 'Ahora'
  if (mins === 1) return '1 min'
  return `${mins} min`
}

export default function WalkInQueue({ profile }) {
  const navigate = useNavigate()
  const [phase, setPhase] = useState('check') // check | form | waiting
  const [activeEntry, setActiveEntry] = useState(null)
  const [complaint, setComplaint] = useState('')
  const [priority, setPriority] = useState('medium')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [waitTime, setWaitTime] = useState('')
  const [queuePosition, setQueuePosition] = useState(null)
  const channelRef = useRef(null)
  const queueChannelRef = useRef(null)

  // On mount: check if patient already has an active queue entry
  useEffect(() => {
    if (!profile?.id) return
    walkInQueueService.getActiveEntry(profile.id)
      .then(entry => {
        if (entry) {
          setActiveEntry(entry)
          if (entry.status === 'in_progress' && entry.consultationId) {
            navigate(`/paciente/sala-espera/${entry.consultationId}`, { replace: true })
          } else {
            setPhase('waiting')
          }
        } else {
          setPhase('form')
        }
      })
      .catch(() => setPhase('form'))
  }, [profile?.id])

  // Subscribe to changes on the active entry
  useEffect(() => {
    if (!activeEntry?.id) return
    const updateTimer = () => setWaitTime(formatWait(activeEntry.createdAt))
    updateTimer()
    const interval = setInterval(updateTimer, 30000)

    const refreshPosition = () =>
      walkInQueueService.getQueuePosition(activeEntry.id).then(setQueuePosition)
    refreshPosition()

    channelRef.current = walkInQueueService.subscribeToEntry(activeEntry.id, updated => {
      setActiveEntry(updated)
      if (updated.status === 'in_progress' && updated.consultationId) {
        navigate(`/paciente/sala-espera/${updated.consultationId}`, { replace: true })
      } else if (updated.status === 'cancelled' || updated.status === 'completed') {
        setActiveEntry(null)
        setPhase('form')
      }
    })

    queueChannelRef.current = walkInQueueService.subscribeToQueue(refreshPosition)

    return () => {
      clearInterval(interval)
      if (channelRef.current) channelRef.current.unsubscribe()
      if (queueChannelRef.current) queueChannelRef.current.unsubscribe()
    }
  }, [activeEntry?.id, activeEntry?.createdAt])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!complaint.trim()) return
    setSubmitting(true)
    setError('')
    try {
      const entry = await walkInQueueService.joinQueue({
        patientId: profile.id,
        chiefComplaint: complaint.trim(),
        priority,
      })
      setActiveEntry(entry)
      setPhase('waiting')
    } catch {
      setError('No se pudo unirse a la cola. Intentá de nuevo.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancel() {
    if (!activeEntry) return
    try {
      await walkInQueueService.cancel(activeEntry.id)
      setActiveEntry(null)
      setPhase('form')
    } catch {
      setError('No se pudo cancelar. Intentá de nuevo.')
    }
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-6 pb-4 border-b border-border-default bg-bg-surface">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-lg hover:bg-bg-muted">
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <div>
          <h1 className="font-bold text-text-primary">Consulta urgente</h1>
          <p className="text-xs text-text-secondary">Sin turno previo</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-32">
        {/* Loading */}
        {phase === 'check' && (
          <div className="flex justify-center py-16">
            <CircleNotch size={28} className="animate-spin text-brand" />
          </div>
        )}

        {/* Form */}
        {phase === 'form' && (
          <form onSubmit={handleSubmit} className="p-4 space-y-5 max-w-lg mx-auto">
            <div className="card p-4 flex items-start gap-3">
              <Siren size={20} className="text-brand-secondary mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-text-primary text-sm">¿Qué te trae hoy?</p>
                <p className="text-xs text-text-secondary mt-1">Describí brevemente tu síntoma o consulta. Un profesional de salud te atenderá en orden de llegada.</p>
              </div>
            </div>

            {/* Complaint */}
            <div className="space-y-1.5">
              <label className="form-label">Motivo de consulta *</label>
              <textarea
                required
                rows={3}
                className="form-input resize-none"
                placeholder="Ej: Tengo dolor de cabeza fuerte desde esta mañana con fiebre de 38.5°C..."
                value={complaint}
                onChange={e => setComplaint(e.target.value)}
              />
            </div>

            {/* Priority */}
            <div className="space-y-2">
              <label className="form-label">Urgencia</label>
              <div className="space-y-2">
                {PRIORITY_OPTIONS.map(opt => (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                      priority === opt.value ? opt.color + ' border-current' : 'border-border-default bg-bg-surface hover:bg-bg-muted'
                    }`}
                  >
                    <input
                      type="radio"
                      name="priority"
                      value={opt.value}
                      checked={priority === opt.value}
                      onChange={() => setPriority(opt.value)}
                      className="mt-0.5 accent-brand"
                    />
                    <div>
                      <p className="text-sm font-medium text-text-primary">{opt.label}</p>
                      <p className="text-xs text-text-secondary">{opt.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button type="submit" disabled={submitting || !complaint.trim()} className="btn-accent w-full py-3 flex items-center justify-center gap-2">
              {submitting ? <CircleNotch size={16} className="animate-spin" /> : <Siren size={16} />}
              {submitting ? 'Uniéndose a la cola…' : 'Solicitar atención'}
            </button>

            <p className="text-xs text-text-secondary text-center">
              Si tenés una emergencia médica, llamá al 107 (SAME) o 911.
            </p>
          </form>
        )}

        {/* Waiting */}
        {phase === 'waiting' && activeEntry && (
          <div className="p-4 space-y-4 max-w-lg mx-auto">
            {/* Status card */}
            <div className="card p-5 text-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-brand/10 flex items-center justify-center mx-auto">
                <div className="relative">
                  <Clock size={28} className="text-brand" />
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-400 ring-2 ring-white animate-pulse" />
                </div>
              </div>
              <div>
                <p className="font-bold text-lg text-text-primary">En espera</p>
                <p className="text-sm text-text-secondary mt-1">Un profesional te atenderá en breve</p>
              </div>
              <div className="flex items-center justify-center gap-6 pt-1">
                {queuePosition !== null && (
                  <div className="text-center">
                    <p className="text-2xl font-bold text-brand">
                      {queuePosition === 1 ? '🟢 Próximo' : `#${queuePosition}`}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {queuePosition === 1 ? 'en atención' : 'en la cola'}
                    </p>
                  </div>
                )}
                <div className="text-center">
                  <p className="text-2xl font-bold text-text-primary">{waitTime}</p>
                  <p className="text-xs text-text-secondary">esperando</p>
                </div>
              </div>
            </div>

            {/* Entry details */}
            <div className="card p-4 space-y-3">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Tu solicitud</p>
              <div className="flex items-start gap-2">
                <UserCircle size={16} className="text-text-secondary mt-0.5 shrink-0" />
                <p className="text-sm text-text-primary">{activeEntry.chiefComplaint}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_BADGE[activeEntry.priority]}`}>
                  {PRIORITY_OPTIONS.find(o => o.value === activeEntry.priority)?.label}
                </span>
              </div>
            </div>

            {/* What to expect */}
            <div className="card p-4 space-y-2">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">¿Qué pasa ahora?</p>
              <ul className="text-sm text-text-secondary space-y-1.5">
                <li className="flex items-start gap-2"><CheckCircle size={14} className="text-brand mt-0.5 shrink-0" /><span>Un profesional verá tu solicitud y la tomará</span></li>
                <li className="flex items-start gap-2"><CheckCircle size={14} className="text-brand mt-0.5 shrink-0" /><span>Serás redirigido automáticamente a la videollamada</span></li>
                <li className="flex items-start gap-2"><CheckCircle size={14} className="text-brand mt-0.5 shrink-0" /><span>Mantené esta página abierta</span></li>
              </ul>
            </div>

            {/* Cancel */}
            <button
              onClick={handleCancel}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-200 text-red-500 text-sm hover:bg-red-50 transition-colors"
            >
              <X size={15} />
              Cancelar solicitud
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
