import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Trash, Clock, CurrencyCircleDollar, Bank, VideoCamera, Buildings, MapPin, CheckCircle, Warning, LinkSimple } from '@phosphor-icons/react'
import MercadoPagoMark from '../../components/icons/MercadoPagoMark'
import { professionalService } from '../../services/professionalService'
import { consultationTypesService } from '../../services/consultationTypesService'
import { availabilityService } from '../../services/availabilityService'
import { zonesService } from '../../services/zonesService'
import { mpService } from '../../services/mpService'
import { paymentsService } from '../../services/paymentsService'
import { formatSettlementPlazo } from '../../lib/format'
import {
  PRECIO_MINIMO,
  PRECIO_MINIMO_TEXTO,
  SUGGESTED_PRICE_RANGE,
  estaPorDebajoDelMinimo,
} from '../../lib/tarifas'
import { toast } from '../../components/Toast'

const MODALITIES = [
  { id: 'virtual',    label: 'Solo virtual',        icon: VideoCamera },
  { id: 'presencial', label: 'Solo presencial',      icon: Buildings   },
  { id: 'ambas',      label: 'Virtual y presencial', icon: MapPin      },
]

// El rango sugerido y el piso obligatorio viven en `lib/tarifas.js` — el mismo
// piso lo aplican el checklist del dashboard y la base (migración 142).

const DAYS = [
  { key: 1, label: 'Lunes' },
  { key: 2, label: 'Martes' },
  { key: 3, label: 'Miércoles' },
  { key: 4, label: 'Jueves' },
  { key: 5, label: 'Viernes' },
  { key: 6, label: 'Sábado' },
  { key: 0, label: 'Domingo' },
]

const TABS = [
  { id: 'horarios', label: 'Horarios', icon: Clock },
  { id: 'tarifas',  label: 'Tarifas',  icon: CurrencyCircleDollar },
  { id: 'cuenta',   label: 'Cuenta',   icon: Bank },
]

// Returns something like "Lunes a Viernes: 09:00 – 13:00 y 15:00 – 19:00 · Sábado: 09:00 – 13:00"
function buildScheduleSummary(schedules) {
  if (!schedules.length) return null

  const fmt = t => t.slice(0, 5)

  // Build a map: dayKey → "HH:MM–HH:MM,HH:MM–HH:MM" (sorted slot fingerprint)
  const dayFingerprint = {}
  for (const s of schedules) {
    const fp = `${fmt(s.startTime)}-${fmt(s.endTime)}`
    dayFingerprint[s.dayOfWeek] = dayFingerprint[s.dayOfWeek]
      ? dayFingerprint[s.dayOfWeek] + ',' + fp
      : fp
  }

  // Group days with identical fingerprints, preserving DAYS order
  const groups = {}
  for (const { key } of DAYS) {
    const fp = dayFingerprint[key]
    if (!fp) continue
    if (!groups[fp]) groups[fp] = []
    groups[fp].push(key)
  }

  // For each group, collapse consecutive days into ranges
  const lines = []
  for (const [fp, dayKeys] of Object.entries(groups)) {
    // dayKeys are already in DAYS order — find consecutive runs
    const ranges = []
    let rangeStart = dayKeys[0]
    let prev = dayKeys[0]

    for (let i = 1; i < dayKeys.length; i++) {
      const cur = dayKeys[i]
      const prevIdx = DAYS.findIndex(d => d.key === prev)
      const curIdx  = DAYS.findIndex(d => d.key === cur)
      if (curIdx === prevIdx + 1) {
        prev = cur
      } else {
        ranges.push([rangeStart, prev])
        rangeStart = cur
        prev = cur
      }
    }
    ranges.push([rangeStart, prev])

    const dayLabel = ([start, end]) => {
      const s = DAYS.find(d => d.key === start).label
      const e = DAYS.find(d => d.key === end).label
      return start === end ? s : `${s} a ${e}`
    }

    const slotsLabel = fp.split(',').map(slot => {
      const [from, to] = slot.split('-')
      return `${from} – ${to}`
    }).join(' y ')

    lines.push(`${ranges.map(dayLabel).join(', ')}: ${slotsLabel}`)
  }

  return lines.join(' · ')
}

const VALID_TABS = TABS.map(t => t.id)

export default function Configuracion({ profile }) {
  const [searchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const [tab, setTab] = useState(VALID_TABS.includes(tabParam) ? tabParam : 'horarios')
  const [loading, setLoading] = useState(true)

  // ── Horarios state ──────────────────────────────────────────
  const [schedules, setSchedules] = useState([])
  const [addingDay, setAddingDay] = useState(null)
  const [newSlot, setNewSlot] = useState({ startTime: '09:00', endTime: '13:00' })
  const [savingSchedule, setSavingSchedule] = useState(false)

  // ── Tarifas state ───────────────────────────────────────────
  const [profData, setProfData] = useState(null)
  const [tarifas, setTarifas] = useState({ pricePresencial: '', priceVideo: '' })
  const [modalityPreference, setModalityPreference] = useState('ambas')
  const [zoneId, setZoneId] = useState('')
  const [zones, setZones] = useState([])
  const [consultationTypes, setConsultationTypes] = useState([])
  const [savingTarifas, setSavingTarifas] = useState(false)

  // ── Cuenta state ────────────────────────────────────────────
  const [cuenta, setCuenta] = useState({ cbu: '', cbuAlias: '' })
  const [savingCuenta, setSavingCuenta] = useState(false)

  // ── Mercado Pago state ──────────────────────────────────────
  const [mpStatus, setMpStatus] = useState(null) // { connected, email }
  const [mpDisconnecting, setMpDisconnecting] = useState(false)
  // Cuántos días tarda MP en liberar la plata (B3) — null mientras carga o
  // sin cobros todavía; { count: 0, ... } es el estado vacío real.
  const [settlementPlazo, setSettlementPlazo] = useState(null)

  const loadMpStatus = () => {
    if (!profile?.id) return
    mpService.getConnectionStatus(profile.id).then(({ data }) => setMpStatus(data))
    paymentsService.getSettlementPlazo(profile.id).then(({ data }) => setSettlementPlazo(data))
  }

  useEffect(() => { loadMpStatus() }, [profile?.id])

  const handleMpDisconnect = async () => {
    if (!confirm('¿Desconectar Mercado Pago? No vas a poder recibir nuevos turnos hasta que vuelvas a conectarte.')) return
    setMpDisconnecting(true)
    try {
      const { error } = await mpService.disconnectMp(profile.id)
      if (error) throw new Error(error)
      toast.success('Mercado Pago desconectado')
      loadMpStatus()
    } catch (err) {
      toast.error(err?.message || 'No pudimos desconectar la cuenta')
    } finally {
      setMpDisconnecting(false)
    }
  }

  useEffect(() => {
    if (!profile?.id) return
    Promise.all([
      availabilityService.getSchedule(profile.id),
      professionalService.getByUserId(profile.id),
      consultationTypesService.getByProfessional(profile.id),
      zonesService.getActive(),
    ]).then(([sched, prof, types, zonesList]) => {
      setSchedules(sched || [])
      setProfData(prof)
      if (prof) {
        setTarifas({
          pricePresencial: prof.pricePresencial ?? prof.sessionPrice ?? '',
          priceVideo:      prof.priceVideo      ?? prof.sessionPrice ?? '',
        })
        setModalityPreference(prof.modalityPreference || 'ambas')
        setZoneId(prof.zoneId || '')
        setCuenta({
          cbu:      prof.cbu      || '',
          cbuAlias: prof.cbuAlias || '',
        })
      }
      setConsultationTypes(types || [])
      setZones(zonesList || [])
    }).finally(() => setLoading(false))
  }, [profile?.id])

  // ── Horarios handlers ───────────────────────────────────────
  const schedulesByDay = DAYS.map(d => ({
    ...d,
    slots: schedules.filter(s => s.dayOfWeek === d.key).sort((a, b) => a.startTime.localeCompare(b.startTime)),
  }))

  const handleAddSlot = async (dayOfWeek) => {
    setSavingSchedule(true)
    try {
      const added = await availabilityService.addScheduleEntry({
        professionalId: profile.id,
        dayOfWeek,
        startTime: newSlot.startTime,
        endTime:   newSlot.endTime,
      })
      setSchedules(prev => [...prev, added])
      setAddingDay(null)
      toast.success('Horario agregado')
    } catch {
      toast.error('Error al agregar horario')
    } finally {
      setSavingSchedule(false)
    }
  }

  const handleDeleteSlot = async (id) => {
    try {
      await availabilityService.deleteScheduleEntry(id)
      setSchedules(prev => prev.filter(s => s.id !== id))
    } catch {
      toast.error('Error al eliminar horario')
    }
  }

  // ── Tarifas handlers ────────────────────────────────────────
  const addType    = () => setConsultationTypes(prev => [...prev, { name: '', price: '', modality: '' }])
  const removeType = i  => setConsultationTypes(prev => prev.filter((_, idx) => idx !== i))
  const updateType = (i, key, val) =>
    setConsultationTypes(prev => prev.map((t, idx) => idx === i ? { ...t, [key]: val } : t))

  const saveTarifas = async (e) => {
    e.preventDefault()

    // El piso se chequea acá antes de mandar nada, para poder decir cuál de los
    // campos está mal. La base lo vuelve a chequear igual (migración 142): esto
    // es para explicarlo, no para hacerlo cumplir.
    const fueraDeRango = [
      ['Presencial', tarifas.pricePresencial],
      ['Videollamada', tarifas.priceVideo],
      ...consultationTypes.map(t => [t.name?.trim() || 'Tipo de consulta sin nombre', t.price]),
    ].filter(([, valor]) => estaPorDebajoDelMinimo(valor))

    if (fueraDeRango.length) {
      toast.error(
        `El mínimo por consulta es ${PRECIO_MINIMO_TEXTO}. Revisá: ${fueraDeRango.map(([n]) => n).join(', ')}.`
      )
      return
    }

    setSavingTarifas(true)
    try {
      const pres = tarifas.pricePresencial ? Number(tarifas.pricePresencial) : null
      const vid  = tarifas.priceVideo      ? Number(tarifas.priceVideo)      : null
      await Promise.all([
        professionalService.upsert(profile.id, {
          ...profData,
          pricePresencial:     pres,
          priceVideo:          vid,
          sessionPrice:        pres ?? vid ?? null,
          modalityPreference,
          zoneId:              modalityPreference !== 'virtual' ? (zoneId || null) : null,
        }),
        consultationTypesService.saveTypes(profile.id, consultationTypes),
      ])
      toast.success('Tarifas guardadas')
    } catch {
      toast.error('Error al guardar tarifas')
    } finally {
      setSavingTarifas(false)
    }
  }

  // ── Cuenta handlers ─────────────────────────────────────────
  const saveCuenta = async (e) => {
    e.preventDefault()
    setSavingCuenta(true)
    try {
      await professionalService.upsert(profile.id, {
        ...profData,
        cbu:      cuenta.cbu.trim()      || null,
        cbuAlias: cuenta.cbuAlias.trim() || null,
      })
      toast.success('Datos de pago guardados')
    } catch {
      toast.error('Error al guardar')
    } finally {
      setSavingCuenta(false)
    }
  }

  if (loading) return <div className="h-64 bg-bg-surface rounded-xl animate-pulse" />

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Configuración</h1>
        <p className="text-text-secondary mt-1">Horarios de atención, tarifas y datos de cobro</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-bg-surface rounded-xl p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              tab === id
                ? 'bg-white text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {/* ── HORARIOS TAB ── */}
      {tab === 'horarios' && (
        <div className="card space-y-4">
          <div>
            <h2 className="font-semibold text-text-primary">Horarios de atención</h2>
            <p className="text-sm text-text-secondary mt-0.5">Los pacientes solo pueden agendar dentro de estos bloques.</p>
          </div>

          {/* Summary pill */}
          {schedules.length > 0 && (
            <div className="flex items-start gap-2 bg-brand-muted rounded-xl px-4 py-3">
              <Clock className="h-4 w-4 text-brand mt-0.5 shrink-0" />
              <p className="text-sm text-brand leading-snug">{buildScheduleSummary(schedules)}</p>
            </div>
          )}

          <div className="space-y-3">
            {schedulesByDay.map(({ key: dayKey, label: dayLabel, slots }) => (
              <div key={dayKey} className="border border-border-default rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-bg-surface">
                  <span className="text-sm font-medium text-text-primary">{dayLabel}</span>
                  <button
                    onClick={() => { setAddingDay(addingDay === dayKey ? null : dayKey); setNewSlot({ startTime: '09:00', endTime: '13:00' }) }}
                    className="text-xs text-brand hover:text-brand-hover font-medium flex items-center gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Agregar
                  </button>
                </div>

                {slots.length > 0 && (
                  <div className="px-4 py-2 space-y-1.5">
                    {slots.map(slot => (
                      <div key={slot.id} className="flex items-center justify-between text-sm">
                        <span className="text-text-primary font-mono">
                          {slot.startTime.slice(0, 5)} – {slot.endTime.slice(0, 5)}
                        </span>
                        <button
                          onClick={() => handleDeleteSlot(slot.id)}
                          className="p-1 text-text-muted hover:text-danger transition-colors"
                        >
                          <Trash className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {slots.length === 0 && addingDay !== dayKey && (
                  <div className="px-4 py-2">
                    <span className="text-xs text-text-muted">Sin horarios</span>
                  </div>
                )}

                {addingDay === dayKey && (
                  <div className="px-4 py-3 border-t border-border-default bg-white flex items-end gap-3">
                    <div>
                      <label className="text-xs text-text-secondary mb-1 block">Desde</label>
                      <input
                        type="time"
                        value={newSlot.startTime}
                        onChange={e => setNewSlot(p => ({ ...p, startTime: e.target.value }))}
                        className="form-input text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-text-secondary mb-1 block">Hasta</label>
                      <input
                        type="time"
                        value={newSlot.endTime}
                        onChange={e => setNewSlot(p => ({ ...p, endTime: e.target.value }))}
                        className="form-input text-sm"
                      />
                    </div>
                    <button
                      onClick={() => handleAddSlot(dayKey)}
                      disabled={savingSchedule}
                      className="btn-primary py-2 px-4 text-sm"
                    >
                      {savingSchedule ? '...' : 'Guardar'}
                    </button>
                    <button
                      onClick={() => setAddingDay(null)}
                      className="text-sm text-text-secondary hover:text-text-primary"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TARIFAS TAB ── */}
      {tab === 'tarifas' && (
        <form onSubmit={saveTarifas} className="space-y-6">
          <div className="card space-y-5">
            <div>
              <h2 className="font-semibold text-text-primary">Modalidad y zona</h2>
              <p className="text-xs text-text-secondary mt-0.5">
                Controla si aparecés en búsquedas presenciales de tu barrio.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {MODALITIES.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModalityPreference(m.id)}
                  className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-center transition-colors ${
                    modalityPreference === m.id
                      ? 'bg-brand text-white border-brand'
                      : 'bg-white border-border-default text-text-secondary'
                  }`}
                >
                  <m.icon className="h-5 w-5" />
                  <span className="text-[11px] font-medium leading-tight">{m.label}</span>
                </button>
              ))}
            </div>

            {modalityPreference !== 'virtual' && (
              <div>
                <label className="text-xs text-text-secondary mb-1 block">Zona de atención presencial</label>
                <select
                  value={zoneId}
                  onChange={e => setZoneId(e.target.value)}
                  className="form-select"
                >
                  <option value="">Seleccioná tu barrio</option>
                  {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="card space-y-5">
            <div>
              <h2 className="font-semibold text-text-primary">Precio base por modalidad</h2>
              <p className="text-xs text-text-secondary mt-0.5">
                Usado cuando no se selecciona un tipo de consulta específico.
              </p>
              <p className="text-xs text-text-primary mt-2 rounded-lg bg-brand/10 px-3 py-2">
                <span className="font-semibold">Mínimo {PRECIO_MINIMO_TEXTO} por consulta</span> — presencial o por
                videollamada, y también para cada tipo de consulta. Es el piso de la plataforma para todos los
                profesionales: por debajo de ese valor el precio no se guarda y tu perfil queda incompleto.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-text-secondary mb-1 block">Presencial (ARS)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm">$</span>
                  <input
                    type="number"
                    min={PRECIO_MINIMO}
                    step="500"
                    placeholder={String(PRECIO_MINIMO)}
                    value={tarifas.pricePresencial}
                    onChange={e => setTarifas(p => ({ ...p, pricePresencial: e.target.value }))}
                    className="form-input pl-7"
                  />
                </div>
                {estaPorDebajoDelMinimo(tarifas.pricePresencial) ? (
                  <p className="text-[11px] text-danger mt-1.5 font-medium">
                    El mínimo es {PRECIO_MINIMO_TEXTO}
                  </p>
                ) : (
                  <p className="text-[11px] text-blue-700 mt-1.5">
                    Mínimo {PRECIO_MINIMO_TEXTO} · sugerido ${SUGGESTED_PRICE_RANGE.min.toLocaleString('es-AR')}–${SUGGESTED_PRICE_RANGE.max.toLocaleString('es-AR')} · <span className="font-semibold">recomendado ${SUGGESTED_PRICE_RANGE.recommended.toLocaleString('es-AR')}</span>
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">Videollamada (ARS)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm">$</span>
                  <input
                    type="number"
                    min={PRECIO_MINIMO}
                    step="500"
                    placeholder={String(PRECIO_MINIMO)}
                    value={tarifas.priceVideo}
                    onChange={e => setTarifas(p => ({ ...p, priceVideo: e.target.value }))}
                    className="form-input pl-7"
                  />
                </div>
                {estaPorDebajoDelMinimo(tarifas.priceVideo) ? (
                  <p className="text-[11px] text-danger mt-1.5 font-medium">
                    El mínimo es {PRECIO_MINIMO_TEXTO}
                  </p>
                ) : (
                  <p className="text-[11px] text-blue-700 mt-1.5">
                    Mínimo {PRECIO_MINIMO_TEXTO}
                  </p>
                )}
              </div>
            </div>

            {/* Consultation types repeater */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <label className="form-label mb-0">Tipos de consulta</label>
                  <p className="text-xs text-text-secondary mt-0.5">
                    Nombrados y con precio propio. El paciente los elige al agendar.
                    Mismo mínimo de {PRECIO_MINIMO_TEXTO}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addType}
                  className="flex items-center gap-1.5 text-sm text-brand hover:text-brand-hover font-medium shrink-0"
                >
                  <Plus className="h-4 w-4" />
                  Agregar tipo
                </button>
              </div>

              {consultationTypes.length === 0 ? (
                <div className="border border-dashed border-border-default rounded-xl py-5 text-center">
                  <p className="text-sm text-text-muted">Sin tipos definidos — se usarán los precios base.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Column headers only make sense once the row is an actual grid (sm:+) */}
                  <div className="hidden sm:grid grid-cols-[1fr_110px_130px_32px] gap-2 px-1">
                    <span className="text-xs text-text-muted">Nombre</span>
                    <span className="text-xs text-text-muted">Precio (ARS)</span>
                    <span className="text-xs text-text-muted">Modalidad</span>
                    <span />
                  </div>
                  {consultationTypes.map((t, i) => (
                    // Mobile: stacked card (name on its own row, price/modalidad/borrar share a row).
                    // sm:+: sm:contents on the inner wrapper flattens it back into the 4-col grid.
                    <div
                      key={t.id || i}
                      className="rounded-xl border border-border-default p-3 space-y-2 sm:border-0 sm:p-0 sm:space-y-0 sm:grid sm:grid-cols-[1fr_110px_130px_32px] sm:gap-2 sm:items-center"
                    >
                      <input
                        type="text"
                        value={t.name}
                        onChange={e => updateType(i, 'name', e.target.value)}
                        placeholder="Ej: Consulta inicial"
                        className="form-input"
                      />
                      <div className="flex gap-2 sm:contents">
                        <div className="relative flex-1 sm:flex-none">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm">$</span>
                          <input
                            type="number"
                            min={PRECIO_MINIMO}
                            step="500"
                            value={t.price || ''}
                            onChange={e => updateType(i, 'price', e.target.value)}
                            placeholder={String(PRECIO_MINIMO)}
                            className={`form-input pl-7 ${estaPorDebajoDelMinimo(t.price) ? 'border-danger' : ''}`}
                          />
                        </div>
                        <select
                          value={t.modality || ''}
                          onChange={e => updateType(i, 'modality', e.target.value)}
                          className="form-select flex-1 sm:flex-none"
                        >
                          <option value="">Ambas</option>
                          <option value="presencial">Presencial</option>
                          <option value="video">Videollamada</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => removeType(i)}
                          className="p-1.5 text-text-muted hover:text-danger transition-colors shrink-0"
                        >
                          <Trash className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <button type="submit" disabled={savingTarifas} className="btn-primary w-full">
            {savingTarifas ? 'Guardando...' : 'Guardar tarifas'}
          </button>
        </form>
      )}

      {/* ── CUENTA TAB ── */}
      {tab === 'cuenta' && (
        <div className="space-y-6">
          {/* Mercado Pago — required to receive paid bookings (spec D4) */}
          <div className="card space-y-4">
            <div>
              <h2 className="font-semibold text-text-primary">Mercado Pago</h2>
              <p className="text-sm text-text-secondary mt-0.5">
                Los pagos de tus consultas se acreditan a través de Mercado Pago. Sin esto conectado no podés recibir turnos.
              </p>
            </div>

            {mpStatus?.connected ? (
              <>
              <div className="flex items-center gap-4 p-4 rounded-xl border border-emerald-200 bg-emerald-50">
                <div className="w-11 h-11 rounded-xl bg-white border border-emerald-200 flex items-center justify-center shrink-0">
                  <MercadoPagoMark className="w-7 h-7" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">
                    {profData?.mpAccountLabel ? `Conectado como ${profData.mpAccountLabel}` : 'Mercado Pago conectado'}
                  </p>
                  <p className="text-xs text-text-secondary mt-0.5">Ya podés recibir turnos y cobrar tus consultas.</p>
                </div>
                <button
                  type="button"
                  onClick={handleMpDisconnect}
                  disabled={mpDisconnecting}
                  className="text-xs font-semibold text-red-600 hover:underline shrink-0 disabled:opacity-50"
                >
                  {mpDisconnecting ? 'Desconectando...' : 'Desconectar'}
                </button>
              </div>

              {/* Plazo de acreditación (B3) — lo que MP tarda en liberar la
                  plata después de cobrar, calculado con `mp_money_release_date`
                  real de tus propios cobros. Sin datos todavía = estado vacío,
                  nunca "0 días". */}
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border-default bg-bg-secondary">
                <Clock className="h-4 w-4 text-text-secondary shrink-0" />
                {settlementPlazo?.count ? (
                  <p className="text-xs text-text-secondary">
                    Mercado Pago te libera la plata a los{' '}
                    <span className="font-semibold text-text-primary">{formatSettlementPlazo(settlementPlazo)}</span>
                    {' '}de cada cobro, por su comisión.
                  </p>
                ) : (
                  <p className="text-xs text-text-secondary">
                    El plazo de acreditación se muestra después de tu primer cobro confirmado.
                  </p>
                )}
              </div>
              </>
            ) : (
              <div className="flex items-center gap-4 p-4 rounded-xl border border-red-200 bg-red-50">
                <div className="w-11 h-11 rounded-xl bg-white border border-red-200 flex items-center justify-center shrink-0">
                  <MercadoPagoMark className="w-7 h-7" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary">No conectado</p>
                  <p className="text-xs text-text-secondary mt-0.5">No podés recibir turnos hasta conectar tu cuenta.</p>
                </div>
                <a
                  href={mpService.getMpConnectUrl(profile.id)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-white bg-brand px-3 py-2 rounded-full hover:bg-brand-hover transition-colors shrink-0"
                >
                  <LinkSimple className="h-3.5 w-3.5" /> Conectar
                </a>
              </div>
            )}
          </div>

          <form onSubmit={saveCuenta} className="space-y-6">
          <div className="card space-y-5">
            <div>
              <h2 className="font-semibold text-text-primary">Cuenta de transferencia (respaldo)</h2>
              <p className="text-sm text-text-secondary mt-0.5">
                Este CBU/alias ya no se usa para acreditar pagos — Mercado Pago los reemplazó. Lo dejamos como dato de contacto/respaldo.
              </p>
            </div>

            <div>
              <label className="form-label">CBU</label>
              <input
                type="text"
                value={cuenta.cbu}
                onChange={e => setCuenta(p => ({ ...p, cbu: e.target.value }))}
                placeholder="22 dígitos"
                maxLength={22}
                className="form-input font-mono tracking-widest"
              />
            </div>

            <div>
              <label className="form-label">Alias</label>
              <input
                type="text"
                value={cuenta.cbuAlias}
                onChange={e => setCuenta(p => ({ ...p, cbuAlias: e.target.value }))}
                placeholder="nombre.apellido.banco"
                className="form-input"
              />
              <p className="text-xs text-text-muted mt-1">
                Podés completar solo el CBU, solo el alias, o ambos.
              </p>
            </div>
          </div>

          <button type="submit" disabled={savingCuenta} className="btn-primary w-full">
            {savingCuenta ? 'Guardando...' : 'Guardar datos de cobro'}
          </button>
          </form>
        </div>
      )}
    </div>
  )
}
