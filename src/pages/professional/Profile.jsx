import { useState, useEffect } from 'react'
import { Plus, Trash } from '@phosphor-icons/react'
import { professionalService } from '../../services/professionalService'
import { profilesService } from '../../services/profilesService'
import { consultationTypesService } from '../../services/consultationTypesService'
import FileUpload from '../../components/FileUpload'
import AddressAutocomplete from '../../components/common/AddressAutocomplete'
import { SPECIALTIES } from '../../lib/verticals'
import { toast } from '../../components/Toast'

export default function ProfessionalProfile({ profile }) {
  const [profData, setProfData] = useState(null)
  const [form, setForm] = useState({
    specialty: '', subSpecialty: '', bio: '',
    pricePresencial: '', priceVideo: '',
    address: '', latitude: null, longitude: null,
  })
  const [consultationTypes, setConsultationTypes] = useState([])
  const [avatarFile, setAvatarFile] = useState(null)
  const [avatarPreview, setAvatarPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    Promise.all([
      professionalService.getByUserId(profile.id),
      consultationTypesService.getByProfessional(profile.id),
    ]).then(([p, types]) => {
      setProfData(p)
      if (p) setForm({
        specialty:       p.specialty       || '',
        subSpecialty:    p.subSpecialty    || '',
        bio:             p.bio             || '',
        pricePresencial: p.pricePresencial ?? p.sessionPrice ?? '',
        priceVideo:      p.priceVideo      ?? p.sessionPrice ?? '',
        address:         p.address         || '',
        latitude:        p.latitude        || null,
        longitude:       p.longitude       || null,
      })
      setConsultationTypes(types)
    }).finally(() => setLoading(false))
  }, [profile?.id])

  const handleAvatarFile = file => {
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  const addType    = () => setConsultationTypes(prev => [...prev, { name: '', price: '', modality: '' }])
  const removeType = i  => setConsultationTypes(prev => prev.filter((_, idx) => idx !== i))
  const updateType = (i, key, val) =>
    setConsultationTypes(prev => prev.map((t, idx) => idx === i ? { ...t, [key]: val } : t))

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (avatarFile) {
        await profilesService.uploadAvatar(profile.id, avatarFile)
        setAvatarFile(null)
      }
      const pres = form.pricePresencial ? Number(form.pricePresencial) : null
      const vid  = form.priceVideo      ? Number(form.priceVideo)      : null
      const payload = {
        ...form,
        pricePresencial: pres,
        priceVideo:      vid,
        sessionPrice:    pres ?? vid ?? null,
      }
      if (payload.latitude == null) { delete payload.latitude; delete payload.longitude }

      await Promise.all([
        professionalService.upsert(profile.id, payload),
        consultationTypesService.saveTypes(profile.id, consultationTypes),
      ])
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
        </div>

        {/* ── Pricing card ── */}
        <div className="card space-y-5">
          <h2 className="font-semibold text-text-primary">Tarifas</h2>

          <div>
            <label className="form-label">Precio base por modalidad (ARS)</label>
            <p className="text-xs text-text-secondary mb-2">
              Usado cuando no se selecciona un tipo de consulta específico.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-text-secondary mb-1 block">Presencial</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={form.pricePresencial}
                    onChange={e => setForm(p => ({ ...p, pricePresencial: e.target.value }))}
                    className="form-input pl-7"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">Videollamada</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={form.priceVideo}
                    onChange={e => setForm(p => ({ ...p, priceVideo: e.target.value }))}
                    className="form-input pl-7"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Consultation types repeater ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <label className="form-label mb-0">Tipos de consulta</label>
                <p className="text-xs text-text-secondary mt-0.5">
                  Nombrados y con precio propio. El paciente los elige al agendar.
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
                {/* Header */}
                <div className="grid grid-cols-[1fr_110px_130px_32px] gap-2 px-1">
                  <span className="text-xs text-text-muted">Nombre</span>
                  <span className="text-xs text-text-muted">Precio (ARS)</span>
                  <span className="text-xs text-text-muted">Modalidad</span>
                  <span />
                </div>
                {consultationTypes.map((t, i) => (
                  <div key={t.id || i} className="grid grid-cols-[1fr_110px_130px_32px] gap-2 items-center">
                    <input
                      type="text"
                      value={t.name}
                      onChange={e => updateType(i, 'name', e.target.value)}
                      placeholder="Ej: Consulta inicial"
                      className="form-input"
                    />
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm">$</span>
                      <input
                        type="number"
                        min="0"
                        value={t.price || ''}
                        onChange={e => updateType(i, 'price', e.target.value)}
                        placeholder="0"
                        className="form-input pl-7"
                      />
                    </div>
                    <select
                      value={t.modality || ''}
                      onChange={e => updateType(i, 'modality', e.target.value)}
                      className="form-select"
                    >
                      <option value="">Ambas</option>
                      <option value="presencial">Presencial</option>
                      <option value="video">Videollamada</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => removeType(i)}
                      className="p-1.5 text-text-muted hover:text-danger transition-colors"
                    >
                      <Trash className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </form>
    </div>
  )
}
