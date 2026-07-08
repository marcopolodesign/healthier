import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, UserCircle, Heartbeat, ShieldPlus } from '@phosphor-icons/react';
import { profilesService } from '../../services/profilesService'
import { toast } from '../../components/Toast'

const STEPS = [
  { label: 'Datos de cuenta',   short: 'Cuenta',   icon: UserCircle  },
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
  const [step, setStep] = useState(1) // starts at step 1 (account done)
  const [saving, setSaving] = useState(false)

  const [health, setHealth] = useState({
    birthDate: profile?.birthDate || '',
    gender:    profile?.gender    || '',
    heightCm:  profile?.heightCm  || '',
    weightKg:  profile?.weightKg  || '',
    allergies: profile?.allergies || '',
  })

  const [medical, setMedical] = useState({
    bloodType:       profile?.bloodType       || '',
    insuranceName:   profile?.insuranceName   || '',
    insuranceNum:    profile?.insuranceNum    || '',
    emergencyName:   profile?.emergencyName   || '',
    emergencyPhone:  profile?.emergencyPhone  || '',
    emergencyRel:    profile?.emergencyRel    || '',
  })

  const saveStep1 = async () => {
    setSaving(true)
    try {
      await profilesService.update(profile.id, {
        birth_date: health.birthDate || null,
        gender:     health.gender    || null,
        height_cm:  health.heightCm  ? Number(health.heightCm)  : null,
        weight_kg:  health.weightKg  ? Number(health.weightKg)  : null,
        allergies:  health.allergies || null,
      })
      setStep(2)
    } catch {
      toast.error('Error al guardar. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  const saveStep2 = async () => {
    setSaving(true)
    try {
      await profilesService.update(profile.id, {
        blood_type:      medical.bloodType      || null,
        insurance_name:  medical.insuranceName  || null,
        insurance_num:   medical.insuranceNum   || null,
        emergency_name:  medical.emergencyName  || null,
        emergency_phone: medical.emergencyPhone || null,
        emergency_rel:   medical.emergencyRel   || null,
      })
      toast.success('¡Perfil completo!')
      navigate('/paciente/dashboard')
    } catch {
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
            {step === 1 ? 'Paso 2 de 3 — Salud general' : 'Paso 3 de 3 — Información médica'}
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

          {/* ── Step 1: Salud general ─────────────────────────────── */}
          {step === 1 && (
            <>
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

          {/* ── Step 2: Información médica ────────────────────────── */}
          {step === 2 && (
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
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Nombre</label>
                    <input
                      type="text"
                      value={medical.insuranceName}
                      onChange={e => setMedical(p => ({ ...p, insuranceName: e.target.value }))}
                      className="form-input"
                      placeholder="Ej: OSDE, Swiss Medical"
                    />
                  </div>
                  <div>
                    <label className="form-label">Nro. de socio</label>
                    <input
                      type="text"
                      value={medical.insuranceNum}
                      onChange={e => setMedical(p => ({ ...p, insuranceNum: e.target.value }))}
                      className="form-input"
                      placeholder="Ej: 12345678"
                    />
                  </div>
                </div>
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
          <div className="flex gap-3 pt-2 border-t border-border-default">
            {step === 2 && (
              <button onClick={() => setStep(1)} className="btn-secondary flex-1">
                ← Anterior
              </button>
            )}
            {step === 1 && (
              <button onClick={saveStep1} disabled={saving} className="btn-primary flex-1">
                {saving ? 'Guardando…' : 'Siguiente →'}
              </button>
            )}
            {step === 2 && (
              <button onClick={saveStep2} disabled={saving} className="btn-primary flex-1">
                {saving ? 'Guardando…' : '¡Listo! Ir al inicio'}
              </button>
            )}
          </div>
        </div>

        {/* Skip */}
        <button
          onClick={() => navigate('/paciente/dashboard')}
          className="mt-3 w-full text-center text-sm text-text-tertiary hover:text-text-secondary transition-colors"
        >
          Completar más tarde →
        </button>
      </div>
    </div>
  )
}
