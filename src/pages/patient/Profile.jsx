import { useState } from 'react'
import { UserCircleIcon } from '@heroicons/react/24/outline'
import { profilesService } from '../../services/profilesService'
import { toast } from '../../components/Toast'

export default function PatientProfile({ profile, onProfileUpdate }) {
  const [form, setForm] = useState({
    fullName: profile?.fullName || '',
    phone: profile?.phone || '',
    birthDate: profile?.birthDate || '',
  })
  const [loading, setLoading] = useState(false)
  const [avatarLoading, setAvatarLoading] = useState(false)

  const save = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const updated = await profilesService.update(profile.id, form)
      onProfileUpdate?.(updated)
      toast.success('Perfil actualizado correctamente')
    } catch {
      toast.error('Error al actualizar el perfil')
    } finally {
      setLoading(false)
    }
  }

  const handleAvatar = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setAvatarLoading(true)
    try {
      const url = await profilesService.uploadAvatar(profile.id, file)
      onProfileUpdate?.({ ...profile, avatarUrl: url })
      toast.success('Foto actualizada')
    } catch {
      toast.error('Error al subir la foto')
    } finally {
      setAvatarLoading(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Mi perfil</h1>
        <p className="text-text-secondary mt-1">Actualizá tu información personal</p>
      </div>

      {/* Avatar */}
      <div className="card flex items-center gap-6">
        <div className="relative">
          {profile?.avatarUrl ? (
            <img src={profile.avatarUrl} alt={profile.fullName} className="h-20 w-20 rounded-full object-cover" />
          ) : (
            <div className="h-20 w-20 rounded-full bg-brand-muted flex items-center justify-center">
              <UserCircleIcon className="h-12 w-12 text-brand" />
            </div>
          )}
          {avatarLoading && (
            <div className="absolute inset-0 bg-white/70 rounded-full flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
        <div>
          <p className="font-semibold text-text-primary">{profile?.fullName}</p>
          <p className="text-sm text-text-secondary">{profile?.email}</p>
          <label className="mt-2 btn-secondary text-xs cursor-pointer inline-flex">
            Cambiar foto
            <input type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
          </label>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={save} className="card space-y-4">
        <div>
          <label className="form-label">Nombre completo</label>
          <input type="text" value={form.fullName} onChange={e => setForm(p => ({ ...p, fullName: e.target.value }))} className="form-input" />
        </div>
        <div>
          <label className="form-label">Teléfono</label>
          <input type="tel" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="+54 9 11 1234-5678" className="form-input" />
        </div>
        <div>
          <label className="form-label">Fecha de nacimiento</label>
          <input type="date" value={form.birthDate} onChange={e => setForm(p => ({ ...p, birthDate: e.target.value }))} className="form-input" />
        </div>
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </form>
    </div>
  )
}
