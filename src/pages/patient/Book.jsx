import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Calendar, Clock, CurrencyDollar, Tag, ShieldCheck } from '@phosphor-icons/react'
import { professionalService } from '../../services/professionalService'
import { availabilityService } from '../../services/availabilityService'
import { consultationsService } from '../../services/consultationsService'
import { consultationTypesService } from '../../services/consultationTypesService'
import { toast } from '../../components/Toast'

const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function formatARS(amount) {
  if (!amount) return null
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount)
}

function fmtTime(t) {
  return t ? t.slice(0, 5) : ''
}

export default function Book({ profile }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [professional, setProfessional] = useState(null)
  const [schedule, setSchedule] = useState([])
  const [consultationTypes, setConsultationTypes] = useState([])
  const [loading, setLoading] = useState(true)

  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [modality, setModality] = useState('video')
  const [selectedType, setSelectedType] = useState(null)

  const [obraSocialName, setObraSocialName] = useState(profile?.insuranceName || '')
  const [affiliateNumber, setAffiliateNumber] = useState(profile?.insuranceNum || '')

  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    Promise.all([
      professionalService.getPublicProfile(id),
      availabilityService.getSchedule(id),
    ])
      .then(async ([pro, sched]) => {
        setProfessional(pro)
        setSchedule(sched)
        if (pro?.userId) {
          const types = await consultationTypesService.getByProfessional(pro.userId).catch(() => [])
          setConsultationTypes(types.filter(t => t.isActive !== false))
        }
      })
      .catch(() => toast.error('Error al cargar el profesional'))
      .finally(() => setLoading(false))
  }, [id])

  const scheduleByDay = schedule.reduce((acc, s) => {
    if (!acc[s.dayOfWeek]) acc[s.dayOfWeek] = []
    acc[s.dayOfWeek].push(s)
    return acc
  }, {})
  const activeDays = Object.keys(scheduleByDay).map(Number)

  // When a type with a specific modality is selected, lock the modality picker
  const handleSelectType = (type) => {
    if (selectedType?.id === type.id) {
      setSelectedType(null)
    } else {
      setSelectedType(type)
      if (type.modality) setModality(type.modality)
    }
  }

  // Visible modality options — exclude those incompatible with the selected type
  const modalityOptions = [
    { value: 'video',      label: 'Videoconsulta' },
    { value: 'presencial', label: 'Presencial' },
  ]
  const modalityLocked = !!selectedType?.modality

  // Price resolution
  const consultationPrice = selectedType?.price != null
    ? selectedType.price
    : modality === 'video'
      ? (professional?.priceVideo      ?? professional?.sessionPrice ?? null)
      : (professional?.pricePresencial ?? professional?.sessionPrice ?? null)

  const confirm = async () => {
    if (!selectedDate || !selectedTime) {
      toast.warning('Seleccioná fecha y hora')
      return
    }
    setSubmitting(true)
    try {
      await consultationsService.create({
        patientId:          profile.id,
        professionalId:     id,
        status:             'confirmed',
        modality,
        priceAtBooking:     consultationPrice,
        consultationTypeId: selectedType?.id ?? null,
        obraSocialName:     obraSocialName.trim() || null,
        affiliateNumber:    affiliateNumber.trim() || null,
        scheduledAt:        new Date(`${selectedDate}T${selectedTime}:00`).toISOString(),
      })
      toast.success('¡Turno confirmado!')
      navigate('/paciente/consultas')
    } catch {
      toast.error('No se pudo confirmar el turno')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="h-96 bg-bg-surface rounded-xl animate-pulse" />

  const name = professional?.profiles?.fullName || professional?.profiles?.full_name

  if (professional && professional.mpConnected === false) {
    return (
      <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-text-secondary hover:text-brand">
          <ArrowLeft className="h-4 w-4" /> Volver
        </button>
        <div className="card border-amber-200 bg-amber-50">
          <p className="font-semibold text-text-primary">No disponible para reservas online</p>
          <p className="text-sm text-text-secondary mt-1">
            {name || 'Este profesional'} todavía no conectó Mercado Pago y no puede recibir turnos por el momento.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-text-secondary hover:text-brand">
        <ArrowLeft className="h-4 w-4" /> Volver
      </button>

      <div>
        <h1 className="text-2xl font-bold text-text-primary">Agendar consulta</h1>
        {name && <p className="text-text-secondary mt-1">con {name}</p>}
      </div>

      {/* Availability summary */}
      {activeDays.length > 0 && (
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-brand" />
            <p className="text-sm font-semibold text-text-primary">Disponibilidad semanal</p>
          </div>
          <div className="overflow-x-auto -mx-1 px-1">
            <div className="flex gap-2" style={{ minWidth: 'max-content' }}>
              {activeDays.sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b)).map(day => (
                <div key={day} className="w-28 shrink-0 border border-border-default rounded-xl overflow-hidden">
                  <div className="bg-brand-muted/40 px-2 py-1.5 text-center">
                    <p className="text-xs font-bold text-brand">{DAY_LABELS[day]}</p>
                  </div>
                  <div className="flex flex-col gap-1 p-2 bg-white">
                    {scheduleByDay[day].sort((a, b) => a.startTime.localeCompare(b.startTime)).map(s => (
                      <p key={s.id} className="text-xs text-text-primary tabular-nums text-center">
                        {fmtTime(s.startTime)} – {fmtTime(s.endTime)}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Consultation type selector */}
      {consultationTypes.length > 0 && (
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-brand" />
            <p className="text-sm font-semibold text-text-primary">Tipo de consulta</p>
          </div>
          <div className="space-y-2">
            {consultationTypes.map(type => {
              const isSelected = selectedType?.id === type.id
              const mLabel = type.modality === 'video' ? 'Videollamada' : type.modality === 'presencial' ? 'Presencial' : 'Ambas'
              return (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => handleSelectType(type)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-colors ${
                    isSelected
                      ? 'border-brand bg-brand-muted text-brand'
                      : 'border-border-default hover:border-brand/40 text-text-primary'
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium">{type.name}</p>
                    <p className={`text-xs mt-0.5 ${isSelected ? 'text-brand/70' : 'text-text-secondary'}`}>{mLabel}</p>
                  </div>
                  {type.price != null && (
                    <span className={`text-sm font-bold shrink-0 ${isSelected ? 'text-brand' : 'text-text-primary'}`}>
                      {formatARS(type.price)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {selectedType && (
            <button
              type="button"
              onClick={() => setSelectedType(null)}
              className="text-xs text-text-secondary hover:text-brand underline"
            >
              Limpiar selección
            </button>
          )}
        </div>
      )}

      {/* Booking form */}
      <div className="card space-y-5">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-brand" />
          <p className="text-sm font-semibold text-text-primary">Elegí fecha y hora</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Fecha</label>
            <input
              type="date"
              value={selectedDate}
              min={new Date().toISOString().split('T')[0]}
              onChange={e => setSelectedDate(e.target.value)}
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label">Hora</label>
            <input
              type="time"
              value={selectedTime}
              onChange={e => setSelectedTime(e.target.value)}
              className="form-input"
            />
          </div>
        </div>

        <div>
          <label className="form-label">
            Modalidad
            {modalityLocked && (
              <span className="ml-2 text-xs font-normal text-text-secondary">(definida por el tipo de consulta)</span>
            )}
          </label>
          <div className="flex gap-3">
            {modalityOptions.map(opt => (
              <button
                key={opt.value}
                type="button"
                disabled={modalityLocked && modality !== opt.value}
                onClick={() => !modalityLocked && setModality(opt.value)}
                className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                  modality === opt.value
                    ? 'border-brand bg-brand-muted text-brand'
                    : modalityLocked
                    ? 'border-border-default text-text-muted opacity-40 cursor-not-allowed'
                    : 'border-border-default text-text-secondary hover:border-brand/40'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Price preview */}
        {consultationPrice != null && (
          <div className="flex items-center justify-between px-4 py-3 bg-brand-muted/40 rounded-xl">
            <span className="flex items-center gap-2 text-sm text-text-secondary">
              <CurrencyDollar className="h-4 w-4 text-brand" />
              Costo de la consulta
            </span>
            <span className="text-base font-bold text-brand">{formatARS(consultationPrice)}</span>
          </div>
        )}

        <button
          onClick={confirm}
          disabled={submitting || !selectedDate || !selectedTime}
          className="btn-primary w-full"
        >
          {submitting ? 'Confirmando...' : 'Confirmar turno'}
        </button>
      </div>

      {/* Obra social */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-brand" />
          <p className="text-sm font-semibold text-text-primary">Cobertura médica</p>
          <span className="text-xs text-text-muted">(opcional)</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Obra social</label>
            <input
              type="text"
              value={obraSocialName}
              onChange={e => setObraSocialName(e.target.value)}
              placeholder="Ej: OSDE, Swiss Medical"
              className="form-input"
            />
          </div>
          <div>
            <label className="form-label">N° de afiliado</label>
            <input
              type="text"
              value={affiliateNumber}
              onChange={e => setAffiliateNumber(e.target.value)}
              placeholder="Ej: 123456789"
              className="form-input"
            />
          </div>
        </div>
        {!profile?.insuranceName && (obraSocialName || affiliateNumber) && (
          <p className="text-xs text-text-secondary">
            Podés guardar esta info en tu{' '}
            <button className="text-brand underline" onClick={() => navigate('/paciente/perfil')}>
              perfil
            </button>{' '}
            para que se complete automáticamente.
          </p>
        )}
      </div>
    </div>
  )
}
