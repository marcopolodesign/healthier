import { useState, useEffect } from 'react'
import { professionalService } from '../../services/professionalService'
import { profilesService } from '../../services/profilesService'
import { toast } from '../../components/Toast'

const SPECIALTIES = [
  { value: 'medicina_general', label: 'Medicina General' },
  { value: 'nutricion', label: 'Nutrición' },
  { value: 'psicologia', label: 'Psicología' },
  { value: 'entrenamiento', label: 'Entrenamiento Físico' },
  { value: 'cardiologia', label: 'Cardiología' },
  { value: 'dermatologia', label: 'Dermatología' },
  { value: 'otra', label: 'Otra' },
]

export default function ProfessionalProfile({ profile, onProfileUpdate }) {
  const [profData, setProfData] = useState(null)
  const [form, setForm] = useState({ specialty: '', subSpecialty: '', bio: '', sessionPrice: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    professionalService.getByUserId(profile?.id).then(p => {
      setProfData(p)
      if (p) setForm({ specialty: p.specialty || '', subSpecialty: p.subSpecialty || '', bio: p.bio || '', sessionPrice: p.sessionPrice || '' })
    }).finally(() => setLoading(false))
  }, [profile?.id])

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await professionalService.upsert(profile.id, { ...form, sessionPrice: form.sessionPrice ? Number(form.sessionPrice) : null })
      toast.success('Perfil actualizado')
    } catch {
      toast.error('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="h-64 bg-bg-surface rounded-xl animate-pulse" />

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Mi perfil profesional</h1>
        <p className="text-text-secondary mt-1">Esta información es visible para los pacientes</p>
      </div>

      <form onSubmit={save} className="card space-y-4">
        <div>
          <label className="form-label">Especialidad</label>
          <select value={form.specialty} onChange={e => setForm(p => ({ ...p, specialty: e.target.value }))} className="form-select">
            <option value="">Seleccioná una especialidad</option>
            {SPECIALTIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Sub-especialidad</label>
          <input type="text" value={form.subSpecialty} onChange={e => setForm(p => ({ ...p, subSpecialty: e.target.value }))} className="form-input" />
        </div>
        <div>
          <label className="form-label">Bio / Presentación</label>
          <textarea value={form.bio} onChange={e => setForm(p => ({ ...p, bio: e.target.value }))} rows={5} className="form-textarea" />
        </div>
        <div>
          <label className="form-label">Precio por sesión (ARS)</label>
          <input type="number" value={form.sessionPrice} onChange={e => setForm(p => ({ ...p, sessionPrice: e.target.value }))} className="form-input" />
        </div>
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </form>
    </div>
  )
}
