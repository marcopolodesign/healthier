import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Barbell, Plus, Trash, FloppyDisk, ClockCounterClockwise, CircleNotch, User,
} from '@phosphor-icons/react'
import { professionalService } from '../../services/professionalService'
import { profilesService } from '../../services/profilesService'
import { consultationsService } from '../../services/consultationsService'
import { toast } from '../../components/Toast'
import {
  TIPOS, TIPO_LABELS, tiposParaEspecialidad,
  getPlanForPatient, getHistorialPlanes, savePlan,
} from '../../services/activityPlanService'

// Editor de "Plan de actividad" — genérico para las tres verticales que hoy no
// le muestran al paciente nada de lo que le indicó su profesional. Mismo
// patrón que NutriPlan Pro (professional/NutriPlan.jsx) pero sin cálculo de
// macros: título + indicaciones + una lista de items {nombre, detalle,
// frecuencia}. Ver migración 171 / activityPlanService.js.

function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function emptyItem() { return { nombre: '', detalle: '', frecuencia: '' } }

export default function ActivityPlan({ profile }) {
  const [searchParams] = useSearchParams()
  const linkedPatientId = searchParams.get('patientId')
  const tipoParam = searchParams.get('tipo')

  const [profProfile, setProfProfile] = useState(null)
  const [gateLoading, setGateLoading] = useState(true)

  const [patients, setPatients] = useState([])
  const [patientsLoading, setPatientsLoading] = useState(true)
  const [selectedPatientId, setSelectedPatientId] = useState(linkedPatientId || '')
  const [selectedPatientProfile, setSelectedPatientProfile] = useState(null)

  const [tipo, setTipo] = useState(tipoParam || '')
  const [plan, setPlan] = useState(null)
  const [historial, setHistorial] = useState([])
  const [planLoading, setPlanLoading] = useState(false)

  const [titulo, setTitulo] = useState('')
  const [indicaciones, setIndicaciones] = useState('')
  const [items, setItems] = useState([emptyItem()])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    professionalService.getByUserId(profile.id)
      .then(setProfProfile)
      .catch(() => toast.error('Error al verificar especialidad'))
      .finally(() => setGateLoading(false))
  }, [profile?.id])

  const allowedTipos = useMemo(
    () => tiposParaEspecialidad(profProfile?.specialty),
    [profProfile?.specialty],
  )

  // Tipo por default: el de la URL si es válido para esta especialidad, si no
  // el primero permitido (psicología sólo tiene uno — nunca hay nada que elegir).
  useEffect(() => {
    if (!allowedTipos.length) return
    if (tipoParam && allowedTipos.includes(tipoParam)) { setTipo(tipoParam); return }
    if (!allowedTipos.includes(tipo)) setTipo(allowedTipos[0])
  }, [allowedTipos, tipoParam]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lista de pacientes del profesional — mismo criterio que NutriPlan Pro.
  useEffect(() => {
    if (!profile?.id) return
    setPatientsLoading(true)
    consultationsService.getByProfessional(profile.id)
      .then(consultations => {
        const map = new Map()
        for (const c of consultations) {
          const pid = c.patientId
          if (!pid) continue
          const existing = map.get(pid)
          const fullName = c.profiles?.fullName || 'Paciente'
          if (!existing || new Date(c.scheduledAt) > new Date(existing.lastConsultation)) {
            map.set(pid, { id: pid, fullName, lastConsultation: c.scheduledAt })
          }
        }
        setPatients(Array.from(map.values()).sort((a, b) => new Date(b.lastConsultation) - new Date(a.lastConsultation)))
      })
      .catch(() => toast.error('Error al cargar la lista de pacientes'))
      .finally(() => setPatientsLoading(false))
  }, [profile?.id])

  function resetForm() {
    setTitulo(''); setIndicaciones(''); setItems([emptyItem()]); setPlan(null)
  }

  function hydrateFromPlan(p) {
    setPlan(p)
    setTitulo(p.titulo || '')
    setIndicaciones(p.indicaciones || '')
    setItems(p.items?.length ? p.items : [emptyItem()])
  }

  // Al elegir paciente y/o tipo: cargar el plan vigente de este profesional y
  // el historial de los archivados.
  useEffect(() => {
    if (!selectedPatientId || !tipo || !profile?.id) { resetForm(); setHistorial([]); return }
    let cancelled = false
    setPlanLoading(true)
    Promise.all([
      profilesService.getById(selectedPatientId).catch(() => null),
      getPlanForPatient(selectedPatientId, profile.id, tipo),
      getHistorialPlanes(selectedPatientId, profile.id, tipo),
    ]).then(([patientProfile, activePlan, hist]) => {
      if (cancelled) return
      setSelectedPatientProfile(patientProfile)
      setHistorial(hist)
      if (activePlan) hydrateFromPlan(activePlan)
      else resetForm()
    }).catch(err => {
      if (!cancelled) toast.error(err.message)
    }).finally(() => {
      if (!cancelled) setPlanLoading(false)
    })
    return () => { cancelled = true }
  }, [selectedPatientId, tipo, profile?.id])

  function updateItem(idx, field, value) {
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)))
  }
  function addItem() { setItems(prev => [...prev, emptyItem()]) }
  function removeItem(idx) { setItems(prev => prev.filter((_, i) => i !== idx)) }

  async function handleSave(asNew) {
    if (!selectedPatientId || !tipo) return
    const limpios = items.map(it => ({
      nombre: (it.nombre || '').trim(),
      detalle: (it.detalle || '').trim(),
      frecuencia: (it.frecuencia || '').trim(),
    })).filter(it => it.nombre)
    if (!limpios.length) { toast.error('Agregá al menos un item con nombre'); return }
    setSaving(true)
    try {
      const saved = await savePlan({
        patientId: selectedPatientId,
        professionalId: profile.id,
        tipo,
        titulo: titulo.trim() || TIPO_LABELS[tipo],
        indicaciones: indicaciones.trim(),
        items: limpios,
        asNew,
      })
      hydrateFromPlan(saved)
      if (asNew) {
        const hist = await getHistorialPlanes(selectedPatientId, profile.id, tipo)
        setHistorial(hist)
      }
      toast.success(asNew ? 'Plan nuevo guardado' : 'Plan actualizado')
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar el plan')
    } finally {
      setSaving(false)
    }
  }

  if (gateLoading) {
    return <div className="flex justify-center py-16"><CircleNotch className="h-6 w-6 animate-spin text-brand" /></div>
  }

  if (!allowedTipos.length) {
    return (
      <div className="max-w-lg mx-auto py-16 px-6 text-center">
        <Barbell className="h-10 w-10 text-text-tertiary mx-auto mb-3" />
        <h2 className="font-semibold text-text-primary">Plan de actividad</h2>
        <p className="text-sm text-text-secondary mt-2">
          Esta sección es para profesionales de psicología, kinesiología y entrenamiento físico.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-brand-muted/40 flex items-center justify-center">
          <Barbell className="h-5 w-5 text-brand" weight="fill" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Plan de actividad</h1>
          <p className="text-xs text-text-secondary">Rutina/actividad que ve el paciente en su Bóveda</p>
        </div>
      </div>

      {/* Selector de paciente */}
      <div className="card">
        <label className="text-xs font-semibold text-text-tertiary uppercase tracking-widest mb-2 block">Paciente</label>
        {patientsLoading ? (
          <p className="text-sm text-text-tertiary flex items-center gap-2"><CircleNotch className="h-4 w-4 animate-spin" /> Cargando pacientes…</p>
        ) : (
          <select
            value={selectedPatientId}
            onChange={e => setSelectedPatientId(e.target.value)}
            className="form-select w-full"
          >
            <option value="">Elegí un paciente…</option>
            {patients.map(p => (
              <option key={p.id} value={p.id}>{p.fullName}</option>
            ))}
          </select>
        )}
        {selectedPatientProfile && (
          <p className="text-xs text-text-tertiary mt-2 flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" /> {selectedPatientProfile.fullName}
          </p>
        )}
      </div>

      {/* Selector de tipo, sólo si la especialidad admite más de uno (entrenamiento) */}
      {allowedTipos.length > 1 && (
        <div className="card">
          <label className="text-xs font-semibold text-text-tertiary uppercase tracking-widest mb-2 block">Tipo de plan</label>
          <div className="flex gap-2">
            {allowedTipos.map(t => (
              <button
                key={t}
                onClick={() => setTipo(t)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                  tipo === t ? 'bg-brand border-brand text-white' : 'bg-white border-border-default text-text-secondary'
                }`}
              >
                {TIPO_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      )}

      {!selectedPatientId ? (
        <p className="text-sm text-text-tertiary text-center py-10">Elegí un paciente para armar o editar su plan.</p>
      ) : planLoading ? (
        <div className="flex justify-center py-10"><CircleNotch className="h-5 w-5 animate-spin text-brand" /></div>
      ) : (
        <>
          <div className="card space-y-4">
            <div>
              <label className="text-xs font-semibold text-text-tertiary uppercase tracking-widest mb-1.5 block">Título</label>
              <input
                type="text"
                value={titulo}
                onChange={e => setTitulo(e.target.value)}
                placeholder={TIPO_LABELS[tipo]}
                className="form-input w-full"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-tertiary uppercase tracking-widest mb-1.5 block">Indicaciones generales</label>
              <textarea
                value={indicaciones}
                onChange={e => setIndicaciones(e.target.value)}
                rows={3}
                placeholder="Ej: Practicá estos ejercicios todos los días, a la misma hora."
                className="form-textarea w-full"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">Items del plan</label>
                <button onClick={addItem} className="text-xs font-medium text-brand flex items-center gap-1">
                  <Plus className="h-3.5 w-3.5" /> Agregar item
                </button>
              </div>
              <div className="space-y-3">
                {items.map((it, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_140px_32px] gap-2 items-start bg-bg-secondary rounded-xl p-3">
                    <input
                      type="text"
                      value={it.nombre}
                      onChange={e => updateItem(idx, 'nombre', e.target.value)}
                      placeholder="Nombre (ej: Respiración 4-7-8)"
                      className="form-input"
                    />
                    <input
                      type="text"
                      value={it.detalle}
                      onChange={e => updateItem(idx, 'detalle', e.target.value)}
                      placeholder="Detalle"
                      className="form-input"
                    />
                    <input
                      type="text"
                      value={it.frecuencia}
                      onChange={e => updateItem(idx, 'frecuencia', e.target.value)}
                      placeholder="Frecuencia"
                      className="form-input"
                    />
                    <button
                      onClick={() => removeItem(idx)}
                      disabled={items.length === 1}
                      className="h-9 w-9 flex items-center justify-center rounded-lg text-text-tertiary hover:text-red-500 disabled:opacity-30"
                    >
                      <Trash className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button
                onClick={() => handleSave(false)}
                disabled={saving}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {saving ? <CircleNotch className="h-4 w-4 animate-spin" /> : <FloppyDisk className="h-4 w-4" />}
                {plan ? 'Guardar cambios' : 'Guardar plan'}
              </button>
              {plan && (
                <button
                  onClick={() => handleSave(true)}
                  disabled={saving}
                  className="btn-secondary flex items-center justify-center gap-2"
                  title="Archiva el plan actual y crea uno nuevo — el paciente sigue viendo el anterior en su historial"
                >
                  Guardar como plan nuevo
                </button>
              )}
            </div>
            {plan && (
              <p className="text-[11px] text-text-tertiary">Última actualización: {fmtDateTime(plan.updatedAt)}</p>
            )}
          </div>

          {historial.length > 0 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <ClockCounterClockwise className="h-4 w-4 text-text-tertiary" />
                <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">Planes anteriores</h3>
              </div>
              <div className="space-y-2">
                {historial.map(h => (
                  <div key={h.id} className="flex justify-between items-center text-sm py-2 border-b border-border-default last:border-0">
                    <span className="text-text-primary">{h.titulo || TIPO_LABELS[h.tipo]}</span>
                    <span className="text-text-tertiary text-xs">{fmtDateTime(h.updatedAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
