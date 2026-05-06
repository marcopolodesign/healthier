import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, Stethoscope, User, MapPin, FileCheck, ClipboardList } from 'lucide-react'
import { professionalService } from '../../services/professionalService'
import { profilesService } from '../../services/profilesService'
import { SPECIALTIES } from '../../lib/verticals'
import AddressAutocomplete from '../../components/common/AddressAutocomplete'
import FileUpload from '../../components/FileUpload'
import { toast } from '../../components/Toast'

const STEPS = [
  { label: 'Especialidad',      short: 'Especialidad',   icon: Stethoscope  },
  { label: 'Tu presentación',   short: 'Perfil',         icon: User         },
  { label: 'Tarifas y lugar',   short: 'Tarifas',        icon: MapPin       },
  { label: 'Documentación',     short: 'Documentos',     icon: FileCheck    },
  { label: 'Revisión y envío',  short: 'Revisión',       icon: ClipboardList},
]

export default function Onboarding({ profile }) {
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isResubmit = searchParams.get('resubmit') === '1'

  const [form, setForm] = useState({
    specialty: '', subSpecialty: '', bio: '', sessionPrice: '',
    address: '', latitude: null, longitude: null,
  })
  const [avatarFile, setAvatarFile]   = useState(null)
  const [avatarPreview, setAvatarPreview] = useState(null)
  const [titleFile, setTitleFile]     = useState(null)
  const [licenseFile, setLicenseFile] = useState(null)
  const [dniFile, setDniFile]         = useState(null)

  useEffect(() => {
    if (!isResubmit || !profile?.id) return
    professionalService.getByUserId(profile.id).then(p => {
      if (!p) return
      setForm({
        specialty:    p.specialty    || '',
        subSpecialty: p.subSpecialty || '',
        bio:          p.bio          || '',
        sessionPrice: p.sessionPrice?.toString() || '',
        address:      p.address      || '',
        latitude:     p.latitude     || null,
        longitude:    p.longitude    || null,
      })
    })
  }, [isResubmit, profile?.id])

  const handleAvatar = file => {
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  // Per-step validation
  const canAdvance = () => {
    if (step === 0) return !!form.specialty
    return true
  }

  const next = () => { if (canAdvance()) setStep(s => s + 1) }
  const prev = () => setStep(s => s - 1)

  const submit = async () => {
    setLoading(true)
    try {
      if (avatarFile) await profilesService.uploadAvatar(profile.id, avatarFile)

      let titleUrl = '', licenseUrl = '', dniUrl = ''
      if (titleFile)   titleUrl   = await professionalService.uploadDocument(profile.id, titleFile,   'professional-docs', 'titulo')
      if (licenseFile) licenseUrl = await professionalService.uploadDocument(profile.id, licenseFile, 'professional-docs', 'matricula')
      if (dniFile)     dniUrl     = await professionalService.uploadDocument(profile.id, dniFile,     'professional-docs', 'dni')

      const payload = {
        ...form,
        sessionPrice:       form.sessionPrice ? Number(form.sessionPrice) : null,
        titleDocumentUrl:   titleUrl   || undefined,
        licenseDocumentUrl: licenseUrl || undefined,
        dniDocumentUrl:     dniUrl     || undefined,
        isVerified:         false,
        isActive:           false,
        submittedAt:        new Date().toISOString(),
        rejectionReason:    null,
        rejectedAt:         null,
      }
      if (payload.latitude == null) { delete payload.latitude; delete payload.longitude }
      await professionalService.upsert(profile.id, payload)

      toast.success('¡Perfil enviado! Un administrador lo revisará pronto.')
      navigate('/profesional/dashboard')
    } catch (err) {
      toast.error(err.message || 'Error al enviar el perfil')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg-primary py-10 px-4">
      <div className="max-w-lg mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-text-primary">
            {isResubmit ? 'Corregir y reenviar' : 'Completá tu perfil clínico'}
          </h1>
          <p className="text-text-secondary mt-1.5 text-sm">
            {isResubmit
              ? 'Actualizá la información solicitada y volvé a enviar.'
              : `Paso ${step + 1} de ${STEPS.length} — ${STEPS[step].label}`}
          </p>
        </div>

        {/* Step tracker */}
        <div className="flex items-center mb-8">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            const done    = i < step
            const current = i === step
            return (
              <div key={i} className="flex items-center flex-1 last:flex-none">
                <button
                  onClick={() => done && setStep(i)}
                  className={`flex flex-col items-center gap-1 group ${done ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors border-2 ${
                    done    ? 'bg-brand border-brand text-white'
                    : current ? 'bg-white border-brand text-brand'
                    : 'bg-white border-border-default text-text-tertiary'
                  }`}>
                    {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </div>
                  <span className={`text-[10px] font-medium hidden sm:block ${current ? 'text-brand' : done ? 'text-text-secondary' : 'text-text-tertiary'}`}>
                    {s.short}
                  </span>
                </button>
                {i < STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 mb-4 transition-colors ${i < step ? 'bg-brand' : 'bg-border-default'}`} />
                )}
              </div>
            )
          })}
        </div>

        {/* Step card */}
        <div className="card space-y-5">
          <h2 className="font-semibold text-text-primary text-lg border-b border-border-default pb-3">
            {STEPS[step].label}
          </h2>

          {/* ── Step 0: Especialidad ─────────────────────────────── */}
          {step === 0 && (
            <>
              <div>
                <label className="form-label">Especialidad <span className="text-danger">*</span></label>
                <select
                  value={form.specialty}
                  onChange={e => setForm(p => ({ ...p, specialty: e.target.value }))}
                  className="form-select"
                  autoFocus
                >
                  <option value="">Seleccioná una especialidad</option>
                  {SPECIALTIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Sub-especialidad <span className="text-text-tertiary text-xs">(opcional)</span></label>
                <input
                  type="text"
                  value={form.subSpecialty}
                  onChange={e => setForm(p => ({ ...p, subSpecialty: e.target.value }))}
                  className="form-input"
                  placeholder="Ej: Cardiología Clínica"
                />
              </div>
            </>
          )}

          {/* ── Step 1: Presentación ─────────────────────────────── */}
          {step === 1 && (
            <>
              <div>
                <label className="form-label">Foto de perfil <span className="text-text-tertiary text-xs">(opcional)</span></label>
                {avatarPreview && (
                  <img src={avatarPreview} alt="preview" className="w-20 h-20 rounded-full object-cover mb-3 border-2 border-brand/30" />
                )}
                <FileUpload
                  onFile={handleAvatar}
                  accept="image/*"
                  label={avatarFile ? avatarFile.name : 'Subir foto (JPG, PNG)'}
                />
              </div>
              <div>
                <label className="form-label">Bio / Presentación <span className="text-text-tertiary text-xs">(opcional)</span></label>
                <textarea
                  value={form.bio}
                  onChange={e => setForm(p => ({ ...p, bio: e.target.value }))}
                  rows={5}
                  className="form-textarea"
                  placeholder="Contale a los pacientes tu experiencia, enfoque y formación..."
                  autoFocus
                />
                <p className="text-xs text-text-tertiary mt-1">{form.bio.length}/500 caracteres</p>
              </div>
            </>
          )}

          {/* ── Step 2: Tarifas y consultorio ────────────────────── */}
          {step === 2 && (
            <>
              <div>
                <label className="form-label">Precio por sesión (ARS) <span className="text-text-tertiary text-xs">(opcional)</span></label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary text-sm font-medium">$</span>
                  <input
                    type="number"
                    min="0"
                    value={form.sessionPrice}
                    onChange={e => setForm(p => ({ ...p, sessionPrice: e.target.value }))}
                    className="form-input pl-7"
                    placeholder="Ej: 15000"
                    autoFocus
                  />
                </div>
              </div>
              <AddressAutocomplete
                label="Dirección del consultorio (opcional)"
                value={{ address: form.address, latitude: form.latitude, longitude: form.longitude }}
                onChange={({ address, latitude, longitude }) =>
                  setForm(p => ({ ...p, address, latitude, longitude }))
                }
                placeholder="Ej: Av. Santa Fe 1900, Buenos Aires"
              />
            </>
          )}

          {/* ── Step 3: Documentación ────────────────────────────── */}
          {step === 3 && (
            <>
              <p className="text-sm text-text-secondary -mt-1">
                Necesitamos verificar tus credenciales antes de habilitarte. Todos los archivos se almacenan de forma cifrada.
              </p>
              <div>
                <label className="form-label">Título profesional</label>
                <FileUpload
                  onFile={setTitleFile}
                  accept=".pdf,.jpg,.jpeg,.png"
                  label={titleFile ? titleFile.name : 'Subir título (PDF o imagen)'}
                />
              </div>
              <div>
                <label className="form-label">Matrícula profesional</label>
                <FileUpload
                  onFile={setLicenseFile}
                  accept=".pdf,.jpg,.jpeg,.png"
                  label={licenseFile ? licenseFile.name : 'Subir matrícula (PDF o imagen)'}
                />
              </div>
              <div>
                <label className="form-label">DNI <span className="text-text-tertiary text-xs">(frente y dorso en un archivo)</span></label>
                <FileUpload
                  onFile={setDniFile}
                  accept=".pdf,.jpg,.jpeg,.png"
                  label={dniFile ? dniFile.name : 'Subir DNI (PDF o imagen)'}
                />
              </div>
            </>
          )}

          {/* ── Step 4: Revisión ─────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-4 text-sm">
              <div className="rounded-xl bg-bg-surface divide-y divide-border-default border border-border-default overflow-hidden">
                {[
                  ['Especialidad',      form.specialty || '—'],
                  ['Sub-especialidad',  form.subSpecialty || '—'],
                  ['Bio',               form.bio ? form.bio.slice(0, 100) + (form.bio.length > 100 ? '…' : '') : '—'],
                  ['Precio por sesión', form.sessionPrice ? `$${form.sessionPrice} ARS` : '—'],
                  ['Consultorio',       form.address || '—'],
                  ['Foto de perfil',    avatarFile ? avatarFile.name : '—'],
                  ['Título',           titleFile   ? titleFile.name   : '—'],
                  ['Matrícula',        licenseFile ? licenseFile.name : '—'],
                  ['DNI',              dniFile     ? dniFile.name     : '—'],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="font-medium text-text-primary w-36 shrink-0">{label}</span>
                    <span className="text-text-secondary break-all">{value}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-text-tertiary pt-1">
                Al enviar aceptás los Términos de Servicio de Healthier. La revisión demora 24–48 hs hábiles.
              </p>
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3 pt-2 border-t border-border-default">
            {step > 0 && (
              <button onClick={prev} className="btn-secondary flex-1">
                ← Anterior
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button
                onClick={next}
                disabled={!canAdvance()}
                className="btn-primary flex-1"
              >
                Siguiente →
              </button>
            ) : (
              <button onClick={submit} disabled={loading} className="btn-primary flex-1">
                {loading ? 'Enviando…' : 'Enviar para revisión'}
              </button>
            )}
          </div>
        </div>

        {/* Skip option for optional steps (1 and 2) */}
        {(step === 1 || step === 2) && (
          <button onClick={next} className="mt-3 w-full text-center text-sm text-text-tertiary hover:text-text-secondary transition-colors">
            Completar más tarde →
          </button>
        )}
      </div>
    </div>
  )
}
