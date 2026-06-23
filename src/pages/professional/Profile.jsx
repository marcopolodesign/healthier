import { useState, useEffect } from 'react'
import { professionalService } from '../../services/professionalService'
import { profilesService } from '../../services/profilesService'
import FileUpload from '../../components/FileUpload'
import AddressAutocomplete from '../../components/common/AddressAutocomplete'
import { SPECIALTIES } from '../../lib/verticals'
import { geocodeAddress } from '../../lib/geo'
import { toast } from '../../components/Toast'

export default function ProfessionalProfile({ profile }) {
  const [profData, setProfData] = useState(null)
  const [form, setForm] = useState({
    specialty: '', subSpecialty: '', bio: '',
    address: '', latitude: null, longitude: null,
    calendlyUrl: '',
  })
  const [avatarFile, setAvatarFile] = useState(null)
  const [avatarPreview, setAvatarPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    professionalService.getByUserId(profile.id).then(p => {
      setProfData(p)
      if (p) setForm({
        specialty:    p.specialty    || '',
        subSpecialty: p.subSpecialty || '',
        bio:          p.bio          || '',
        address:      p.address      || '',
        latitude:     p.latitude     || null,
        longitude:    p.longitude    || null,
        calendlyUrl:  p.calendlyUrl  || '',
      })
    }).finally(() => setLoading(false))
  }, [profile?.id])

  const handleAvatarFile = file => {
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (avatarFile) {
        await profilesService.uploadAvatar(profile.id, avatarFile)
        setAvatarFile(null)
      }
      const payload = { ...profData, ...form }
      if (payload.latitude == null && payload.address) {
        const geo = await geocodeAddress(payload.address)
        if (geo) { payload.latitude = geo.lat; payload.longitude = geo.lng }
      }
      if (payload.latitude == null) { delete payload.latitude; delete payload.longitude }
      await professionalService.upsert(profile.id, payload)
      toast.success('Perfil actualizado')
    } catch {
      toast.error('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="h-64 bg-bg-surface rounded-xl animate-pulse" />

  const currentAvatar = avatarPreview || profData?.profiles?.avatarUrl

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Mi perfil profesional</h1>
        <p className="text-text-secondary mt-1">Esta información es visible para los pacientes</p>
      </div>

      <form onSubmit={save} className="space-y-6">

        {/* ── Personal info card ── */}
        <div className="card space-y-5">
          <h2 className="font-semibold text-text-primary">Datos personales</h2>

          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full overflow-hidden bg-brand-muted flex items-center justify-center shrink-0">
              {currentAvatar
                ? <img src={currentAvatar} alt="Avatar" className="w-full h-full object-cover" />
                : <span className="text-brand font-bold text-2xl">{profile?.fullName?.[0]}</span>
              }
            </div>
            <div className="flex-1">
              <label className="form-label">Foto de perfil</label>
              <FileUpload
                onFile={handleAvatarFile}
                accept="image/*"
                label={avatarFile ? avatarFile.name : 'Cambiar foto'}
              />
            </div>
          </div>

          <div>
            <label className="form-label">Especialidad</label>
            <select
              value={form.specialty}
              onChange={e => setForm(p => ({ ...p, specialty: e.target.value }))}
              className="form-select"
            >
              <option value="">Seleccioná una especialidad</option>
              {SPECIALTIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          <div>
            <label className="form-label">Sub-especialidad</label>
            <input
              type="text"
              value={form.subSpecialty}
              onChange={e => setForm(p => ({ ...p, subSpecialty: e.target.value }))}
              className="form-input"
            />
          </div>

          <div>
            <label className="form-label">Bio / Presentación</label>
            <textarea
              value={form.bio}
              onChange={e => setForm(p => ({ ...p, bio: e.target.value }))}
              rows={4}
              className="form-textarea"
            />
          </div>

          <AddressAutocomplete
            label="Dirección del consultorio"
            value={{ address: form.address, latitude: form.latitude, longitude: form.longitude }}
            onChange={({ address, latitude, longitude }) =>
              setForm(p => ({ ...p, address, latitude, longitude }))
            }
          />

          <div>
            <label className="form-label">Link de Calendly (opcional)</label>
            <input
              type="url"
              value={form.calendlyUrl}
              onChange={e => setForm(p => ({ ...p, calendlyUrl: e.target.value }))}
              placeholder="https://calendly.com/tu-nombre/consulta"
              className="form-input"
            />
            <p className="text-xs text-text-muted mt-1">
              Si completás este campo, los pacientes verán un widget de Calendly en tu perfil público para agendar directamente.
            </p>
          </div>
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </form>
    </div>
  )
}
