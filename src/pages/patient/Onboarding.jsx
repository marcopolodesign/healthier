import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Check, UserCircle, ShieldCheck, Heartbeat, ShieldPlus } from '@phosphor-icons/react';
import { profilesService } from '../../services/profilesService'
import { toast } from '../../components/Toast'
import { PATIENT_CONSENT_ITEMS } from '../../lib/consentItems'
import FinanciadorPicker from '../../components/professional/FinanciadorPicker'
import { track } from '../../utils/analytics'

// Internal step (1=consentimiento, 2=salud_general, 3=informacion_medica) mapped
// to Henry's spec numbering, which also counts the account-creation step (step 1,
// handled in Register.jsx) — so event step = internal step + 1.
const STEP_NAME_BY_INTERNAL_STEP = { 1: 'consentimiento', 2: 'salud_general', 3: 'informacion_medica' }

const STEPS = [
  { label: 'Datos de cuenta',   short: 'Cuenta',   icon: UserCircle  },
  { label: 'Consentimiento',    short: 'Consent.', icon: ShieldCheck },
  { label: 'Salud general',     short: 'Salud',    icon: Heartbeat },
  { label: 'Información médica', short: 'Médico',  icon: ShieldPlus },
]

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const GENDERS = [
  { value: 'masculino',        label: 'Masculino' },
  { value: 'femenino',         label: 'Femenino' },
  { value: 'no_binario',       label: 'No binario / otro' },
  { value: 'prefiero_no_decir', label: 'Prefiero no decir' },
]

export default function PatientOnboarding({ profile }) {
  const navigate = useNavigate()
  const [step, setStep] = useState(1) // starts at step 1 (account done, consent is next)
  const [saving, setSaving] = useState(false)

  const [consents, setConsents] = useState(
    Object.fromEntries(PATIENT_CONSENT_ITEMS.map(item => [item.key, false]))
  )
  const allConsented = PATIENT_CONSENT_ITEMS.every(item => consents[item.key])

  const [health, setHealth] = useState({
    dni:       profile?.dni       || '',
    birthDate: profile?.birthDate || '',
    gender:    profile?.gender    || '',
    heightCm:  profile?.heightCm  || '',
    weightKg:  profile?.weightKg  || '',
    allergies: profile?.allergies || '',
  })

  const [medical, setMedical] = useState({
    bloodType:       profile?.bloodType       || '',
    // La obra social sale del catálogo de Innovamed, no de texto libre: RCTA no
    // acepta el nombre, exige el idFinanciador. Ver migración 083.
    coverageType:    profile?.coverageType    ?? null,
    financiadorId:   profile?.financiadorId   ?? null,
    insuranceName:   profile?.insuranceName   || '',
    insuranceNum:    profile?.insuranceNum    || '',
    emergencyName:   profile?.emergencyName   || '',
    emergencyPhone:  profile?.emergencyPhone  || '',
    emergencyRel:    profile?.emergencyRel    || '',
  })

  const saveStep1 = async () => {
    // DNI obligatorio: sin él el paciente no puede recibir una receta
    // electrónica, y descubrirlo recién en la consulta es peor.
    if (!health.dni || health.dni.trim().length < 7) {
      toast.error('Ingresá tu DNI sin puntos (mínimo 7 dígitos).')
      return
    }
    if (health.heightCm && !Number.isInteger(Number(health.heightCm))) {
      toast.error('La altura debe ser un número entero en centímetros (ej: 165).')
      return
    }
    if (health.heightCm && (Number(health.heightCm) <= 0 || Number(health.heightCm) >= 300)) {
      toast.error('La altura debe estar entre 1 y 299 cm.')
      return
    }
    if (health.weightKg && (Number(health.weightKg) <= 0 || Number(health.weightKg) >= 700)) {
      toast.error('El peso debe estar entre 1 y 699 kg.')
      return
    }

    setSaving(true)
    try {
      await profilesService.update(profile.id, {
        dni:        health.dni.trim(),
        birth_date: health.birthDate || null,
        gender:     health.gender    || null,
        height_cm:  health.heightCm  ? Number(health.heightCm)  : null,
        weight_kg:  health.weightKg  ? Number(health.weightKg)  : null,
        allergies:  health.allergies || null,
      })
      track('sign_up_step_complete', { step: step + 1, step_name: STEP_NAME_BY_INTERNAL_STEP[step], flow: 'paciente', has_allergies: !!health.allergies.trim() })
      setStep(3)
    } catch {
      track('sign_up_error', { step: step + 1, step_name: STEP_NAME_BY_INTERNAL_STEP[step], error_type: 'server_error', flow: 'paciente' })
      toast.error('Error al guardar. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  const saveStep2 = async () => {
    setSaving(true)
    try {
      const esParticular = medical.coverageType === 'particular'
      await profilesService.update(profile.id, {
        blood_type:      medical.bloodType      || null,
        coverage_type:   medical.coverageType   || null,
        // Particular limpia los dos: lo exige la constraint y dejarlos sería un
        // dato contradictorio.
        financiador_id:  esParticular ? null : (medical.financiadorId ?? null),
        insurance_name:  esParticular ? null : (medical.insuranceName || null),
        insurance_num:   esParticular ? null : (medical.insuranceNum  || null),
        emergency_name:  medical.emergencyName  || null,
        emergency_phone: medical.emergencyPhone || null,
        emergency_rel:   medical.emergencyRel   || null,
      })
      track('sign_up_step_complete', { step: step + 1, step_name: STEP_NAME_BY_INTERNAL_STEP[step], flow: 'paciente' })
      track('sign_up_complete', { flow: 'paciente', profile_completed: true })
      toast.success('¡Perfil completo!')
      navigate('/paciente/dashboard')
    } catch {
      track('sign_up_error', { step: step + 1, step_name: STEP_NAME_BY_INTERNAL_STEP[step], error_type: 'server_error', flow: 'paciente' })
      toast.error('Error al guardar. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg-primary py-10 px-4">
      <div className="max-w-lg mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl sm:text-5xl font-light leading-tight text-text-primary tracking-tight">Completá tu perfil</h1>
          <p className="text-text-secondary mt-3 text-sm">
            {step === 1 ? 'Paso 2 de 4 — Consentimiento'
              : step === 2 ? 'Paso 3 de 4 — Salud general'
              : 'Paso 4 de 4 — Información médica'}
          </p>
        </div>

        {/* Step tracker */}
        <div className="flex items-center mb-8">
          {STEPS.map((s, i) => {
            const Icon  = s.icon
            const done  = i < step
            const current = i === step
            return (
              <div key={i} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center gap-1">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-colors ${
                    done    ? 'bg-brand border-brand text-white'
                    : current ? 'bg-bg-surface border-brand text-brand'
                    : 'bg-bg-surface border-border-default text-text-tertiary'
                  }`}>
                    {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </div>
                  <span className={`text-[10px] font-medium hidden sm:block ${current ? 'text-brand' : done ? 'text-text-secondary' : 'text-text-tertiary'}`}>
                    {s.short}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 mb-4 ${i < step ? 'bg-brand' : 'bg-border-default'}`} />
                )}
              </div>
            )
          })}
        </div>

        <div className="card space-y-5">
          <h2 className="font-semibold text-text-primary text-lg border-b border-border-default pb-3">
            {STEPS[step].label}
          </h2>

          {/* ── Step 1: Consentimiento ────────────────────────────── */}
          {step === 1 && (
            <>
              <p className="text-sm text-text-secondary -mt-1">
                Necesitamos tu consentimiento para poder atenderte en Healthier. Podés leer el detalle completo en nuestros{' '}
                <Link to="/terminos" target="_blank" className="text-brand font-medium hover:underline">Términos y Condiciones</Link>.
              </p>
              <div className="border border-border-default rounded-xl p-4 space-y-3 bg-bg-primary">
                {PATIENT_CONSENT_ITEMS.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setConsents(p => ({ ...p, [item.key]: !p[item.key] }))}
                    className="flex items-start gap-3 w-full text-left"
                  >
                    <span className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors ${
                      consents[item.key] ? 'bg-brand border-brand' : 'border-border-default'
                    }`}>
                      {consents[item.key] && <Check className="h-3 w-3 text-white" weight="bold" />}
                    </span>
                    <span>
                      <span className="text-sm font-semibold text-text-primary block">{item.title}</span>
                      <span className="text-xs text-text-secondary leading-relaxed">{item.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── Step 2: Salud general ─────────────────────────────── */}
          {step === 2 && (
            <>
              <div>
                <label className="form-label">DNI</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={health.dni}
                  onChange={e => setHealth(p => ({ ...p, dni: e.target.value.replace(/\D/g, '') }))}
                  placeholder="Sin puntos, ej: 30111222"
                  className="form-input"
                />
                {/* Obligatorio porque sin DNI no se puede emitir una receta
                    electrónica (Innovamed responde QBI156). Pedirlo acá evita
                    tener que interrumpir al paciente después, en la consulta. */}
                <p className="text-xs text-text-tertiary mt-1">
                  Necesario para emitir recetas electrónicas.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Fecha de nacimiento</label>
                  <input
                    type="date"
                    value={health.birthDate}
                    onChange={e => setHealth(p => ({ ...p, birthDate: e.target.value }))}
                    className="form-input"
                    max={new Date().toISOString().split('T')[0]}
                  />
                </div>
                <div>
                  <label className="form-label">Sexo biológico</label>
                  <select
                    value={health.gender}
                    onChange={e => setHealth(p => ({ ...p, gender: e.target.value }))}
                    className="form-select"
                  >
                    <option value="">Seleccioná</option>
                    {GENDERS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Altura <span className="text-text-tertiary text-xs font-normal">cm</span></label>
                  <input
                    type="number"
                    min="50" max="250"
                    value={health.heightCm}
                    onChange={e => setHealth(p => ({ ...p, heightCm: e.target.value }))}
                    className="form-input"
                    placeholder="Ej: 170"
                  />
                </div>
                <div>
                  <label className="form-label">Peso <span className="text-text-tertiary text-xs font-normal">kg</span></label>
                  <input
                    type="number"
                    min="1" max="500" step="0.1"
                    value={health.weightKg}
                    onChange={e => setHealth(p => ({ ...p, weightKg: e.target.value }))}
                    className="form-input"
                    placeholder="Ej: 70"
                  />
                </div>
              </div>

              <div>
                <label className="form-label">
                  Alergias conocidas <span className="text-text-tertiary text-xs font-normal">(opcional)</span>
                </label>
                <textarea
                  value={health.allergies}
                  onChange={e => setHealth(p => ({ ...p, allergies: e.target.value }))}
                  rows={3}
                  className="form-textarea"
                  placeholder="Ej: Penicilina, mariscos, látex…"
                />
              </div>
            </>
          )}

          {/* ── Step 3: Información médica ────────────────────────── */}
          {step === 3 && (
            <>
              <div>
                <label className="form-label">Grupo sanguíneo</label>
                <select
                  value={medical.bloodType}
                  onChange={e => setMedical(p => ({ ...p, bloodType: e.target.value }))}
                  className="form-select"
                >
                  <option value="">Seleccioná</option>
                  {BLOOD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  <option value="desconocido">No sé</option>
                </select>
              </div>

              <div className="pt-1">
                <p className="text-xs font-semibold text-text-tertiary uppercase tracking-widest mb-3">Obra social / prepaga</p>
                {/* Del catálogo de Innovamed, no a mano: es el mismo dato que va
                    a necesitar una receta electrónica, y el nombre escrito no
                    sirve para emitirla. Cargándolo acá el médico ya lo tiene. */}
                <FinanciadorPicker
                  coverageType={medical.coverageType}
                  financiadorId={medical.financiadorId}
                  financiadorName={medical.insuranceName}
                  affiliateNumber={medical.insuranceNum}
                  hintAfiliado="No pasa nada si no lo tenés a mano: podés completarlo más tarde desde tu perfil."
                  hintSinDefinir="Opcional. Si la cargás, tu médico ya la tiene lista para recetarte con cobertura."
                  onChange={v => setMedical(p => ({
                    ...p,
                    coverageType:  v.coverageType,
                    financiadorId: v.financiadorId,
                    insuranceName: v.financiadorName,
                    insuranceNum:  v.affiliateNumber,
                  }))}
                />
              </div>

              <div className="pt-1">
                <p className="text-xs font-semibold text-text-tertiary uppercase tracking-widest mb-3">Contacto de emergencia</p>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={medical.emergencyName}
                    onChange={e => setMedical(p => ({ ...p, emergencyName: e.target.value }))}
                    className="form-input"
                    placeholder="Nombre completo"
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <input
                      type="tel"
                      value={medical.emergencyPhone}
                      onChange={e => setMedical(p => ({ ...p, emergencyPhone: e.target.value }))}
                      className="form-input"
                      placeholder="Teléfono"
                    />
                    <input
                      type="text"
                      value={medical.emergencyRel}
                      onChange={e => setMedical(p => ({ ...p, emergencyRel: e.target.value }))}
                      className="form-input"
                      placeholder="Vínculo (mamá, pareja…)"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Navigation */}
          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2 border-t border-border-default">
            {(step === 2 || step === 3) && (
              <button onClick={() => setStep(step - 1)} className="btn-secondary flex-1">
                ← Anterior
              </button>
            )}
            {step === 1 && (
              <button
                onClick={() => {
                  track('sign_up_step_complete', {
                    step: step + 1,
                    step_name: STEP_NAME_BY_INTERNAL_STEP[step],
                    flow: 'paciente',
                    consent_datos_salud: consents.hipaa,
                    consent_ley_25326: consents.ley25326,
                    consent_acceso_medico: consents.equipo_tratante,
                  })
                  setStep(2)
                }}
                disabled={!allConsented}
                className="btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Siguiente →
              </button>
            )}
            {step === 2 && (
              <button onClick={saveStep1} disabled={saving} className="btn-primary flex-1">
                {saving ? 'Guardando…' : 'Siguiente →'}
              </button>
            )}
            {step === 3 && (
              <button onClick={saveStep2} disabled={saving} className="btn-primary flex-1">
                {saving ? 'Guardando…' : '¡Listo! Ir al inicio'}
              </button>
            )}
          </div>
        </div>

        {/* Skip — no se ofrece en el paso 1 (Consentimiento) ni en el 2 (Salud
            general): los dos son obligatorios. El 2 pasó a serlo cuando el DNI
            se volvió requerido — sin DNI no se puede emitir una receta
            electrónica (Innovamed responde QBI156), y dejar el atajo acá haría
            que la validación no sirviera de nada. */}
        {step !== 1 && step !== 2 && (
          <button
            onClick={() => {
              track('sign_up_skip_step', { step: step + 1, step_name: STEP_NAME_BY_INTERNAL_STEP[step], flow: 'paciente' })
              navigate('/paciente/dashboard')
            }}
            className="mt-3 w-full text-center text-sm text-text-tertiary hover:text-text-secondary transition-colors"
          >
            Completar más tarde →
          </button>
        )}
      </div>
    </div>
  )
}
