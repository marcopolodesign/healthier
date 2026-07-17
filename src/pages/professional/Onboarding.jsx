import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, Stethoscope, User, MapPin, FileText, ClipboardText, VideoCamera, Buildings, LockKey, MagnifyingGlass } from '@phosphor-icons/react';
import { professionalService } from '../../services/professionalService'
import { profilesService } from '../../services/profilesService'
import { zonesService } from '../../services/zonesService'
import { SPECIALTY_LABELS, PROFESSION_CATEGORIES, specialtiesForCategory, categoryForSpecialty } from '../../lib/verticals'
import AddressAutocomplete from '../../components/common/AddressAutocomplete'
import { AnimatedTagCascade } from '../../components/common/AnimatedTagCascade'
import FileUpload from '../../components/FileUpload'
import { geocodeAddress } from '../../lib/geo'
import { toast } from '../../components/Toast'
import OnboardingPreview from '../../components/professional/OnboardingPreview'

const MODALITIES = [
  { id: 'virtual',    label: 'Solo virtual',        icon: VideoCamera },
  { id: 'presencial', label: 'Solo presencial',      icon: Buildings   },
  { id: 'ambas',      label: 'Virtual y presencial', icon: MapPin      },
]

// Rango sugerido por zona — valor recomendado destacado (pedido de Nacho Arteaga, 2026-07-08).
// Sin datos de mercado por barrio todavía, se usa un rango razonable único para el MVP.
const SUGGESTED_PRICE_RANGE = { min: 20000, max: 35000, recommended: 25000 }

const STEPS = [
  { label: 'Especialidad',      short: 'Especialidad',   icon: Stethoscope  },
  { label: 'Tu presentación',   short: 'Perfil',         icon: User         },
  { label: 'Tarifas y lugar',   short: 'Tarifas',        icon: MapPin       },
  { label: 'Documentación',     short: 'Documentos',     icon: FileText    },
  { label: 'Datos y privacidad', short: 'Privacidad',    icon: LockKey      },
  { label: 'Revisión y envío',  short: 'Revisión',       icon: ClipboardText},
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
    licenseType: 'MN', licenseNumber: '', cuitNumber: '',
    modalityPreference: 'ambas', zoneId: '',
  })
  const [zones, setZones] = useState([])
  const [avatarFile, setAvatarFile]     = useState(null)
  const [avatarPreview, setAvatarPreview] = useState(null)
  const [titleFile, setTitleFile]       = useState(null)
  const [licenseFile, setLicenseFile]   = useState(null)
  const [dniFile, setDniFile]           = useState(null)
  const [malpracticeFile, setMalpracticeFile]         = useState(null)
  const [specialistCertFile, setSpecialistCertFile]   = useState(null)
  const [cuitFile, setCuitFile]                       = useState(null)
  const [categoryId, setCategoryId]     = useState(null)
  const [specialtySearch, setSpecialtySearch] = useState('')
  const [privacyAccepted, setPrivacyAccepted] = useState(false)

  useEffect(() => {
    zonesService.getActive().then(setZones).catch(() => {})
  }, [])

  useEffect(() => {
    if (!isResubmit || !profile?.id) return
    professionalService.getByUserId(profile.id).then(p => {
      if (!p) return
      setForm({
        specialty:     p.specialty     || '',
        subSpecialty:  p.subSpecialty  || '',
        bio:           p.bio           || '',
        sessionPrice:  p.sessionPrice?.toString() || '',
        address:       p.address       || '',
        latitude:      p.latitude      || null,
        longitude:     p.longitude     || null,
        licenseType:   p.licenseType   || 'MN',
        licenseNumber: p.licenseNumber || '',
        cuitNumber:    p.cuitNumber    || '',
        modalityPreference: p.modalityPreference || 'ambas',
        zoneId:        p.zoneId        || '',
      })
      if (p.specialty) setCategoryId(categoryForSpecialty(p.specialty))
    })
  }, [isResubmit, profile?.id])

  const handleAvatar = file => {
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
  }

  // Per-step validation
  const canAdvance = () => {
    if (step === 0) return !!categoryId && !!form.specialty && form.licenseNumber.length > 0
    if (step === 4) return privacyAccepted
    return true
  }

  const next = () => { if (canAdvance()) setStep(s => s + 1) }
  const prev = () => setStep(s => s - 1)

  const submit = async () => {
    setLoading(true)
    try {
      // Independent uploads to different storage paths — no data dependency
      // between them, so run concurrently instead of serializing round-trips.
      const uploadDoc = (file, fileName) =>
        file ? professionalService.uploadDocument(profile.id, file, 'professional-docs', fileName) : Promise.resolve('')

      const [, titleUrl, licenseUrl, dniUrl, malpracticeUrl, specialistCertUrl, cuitUrl] = await Promise.all([
        avatarFile ? profilesService.uploadAvatar(profile.id, avatarFile) : Promise.resolve(null),
        uploadDoc(titleFile, 'titulo'),
        uploadDoc(licenseFile, 'matricula'),
        uploadDoc(dniFile, 'dni'),
        uploadDoc(malpracticeFile, 'seguro_mala_praxis'),
        uploadDoc(specialistCertFile, 'certificado_especialista'),
        uploadDoc(cuitFile, 'cuit'),
      ])

      const payload = {
        ...form,
        sessionPrice:       form.sessionPrice ? Number(form.sessionPrice) : null,
        zoneId:             form.zoneId || null,
        titleDocumentUrl:   titleUrl   || undefined,
        licenseDocumentUrl: licenseUrl || undefined,
        dniDocumentUrl:     dniUrl     || undefined,
        malpracticeInsuranceDocumentUrl:  malpracticeUrl    || undefined,
        specialistCertificateDocumentUrl: specialistCertUrl || undefined,
        cuitDocumentUrl:                  cuitUrl           || undefined,
        license_type:       form.licenseType,
        license_number:     form.licenseNumber,
        isVerified:         false,
        isActive:           false,
        submittedAt:        new Date().toISOString(),
        rejectionReason:    null,
        rejectedAt:         null,
      }
      if (payload.latitude == null && payload.address) {
        const geo = await geocodeAddress(payload.address)
        if (geo) { payload.latitude = geo.lat; payload.longitude = geo.lng }
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
    <div className="min-h-screen bg-bg-primary grid lg:grid-cols-2">
      {/* Left — form wizard */}
      <div className="py-10 px-4 overflow-y-auto">
      <div className="max-w-lg mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="page-title-lg text-text-primary">
            {isResubmit ? 'Corregir y reenviar' : 'Completá tu perfil clínico'}
          </h1>
          <p className="text-text-secondary mt-1.5 text-base">
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
                  <span className={`text-xs font-medium hidden sm:block ${current ? 'text-brand' : done ? 'text-text-secondary' : 'text-text-tertiary'}`}>
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
          <h2 className="font-semibold text-text-primary text-xl border-b border-border-default pb-3">
            {STEPS[step].label}
          </h2>

          {/* ── Step 0: Especialidad ─────────────────────────────── */}
          {step === 0 && (
            <>
              <div>
                <label className="form-label">¿Cuál es tu profesión? <span className="text-danger">*</span></label>
                <div className="mb-4">
                  <AnimatedTagCascade
                    animate={false}
                    items={PROFESSION_CATEGORIES.map(c => ({ value: c.id, label: c.label, icon: c.icon }))}
                    value={categoryId}
                    onSelect={id => {
                      if (id === categoryId) return
                      setCategoryId(id)
                      setSpecialtySearch('')
                      setForm(p => ({ ...p, specialty: '' }))
                    }}
                  />
                </div>

                {categoryId && (() => {
                  const catSpecialties = specialtiesForCategory(categoryId)
                  return (
                    <>
                      {catSpecialties.length > 4 && (
                        <div className="relative mb-3">
                          <MagnifyingGlass className="h-4 w-4 text-text-tertiary absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={specialtySearch}
                            onChange={e => setSpecialtySearch(e.target.value)}
                            className="form-input pl-9"
                            placeholder="Buscar especialidad..."
                          />
                        </div>
                      )}
                      <AnimatedTagCascade
                        items={catSpecialties.filter(s =>
                          s.label.toLowerCase().includes(specialtySearch.toLowerCase())
                        )}
                        value={form.specialty}
                        onSelect={value => setForm(p => ({ ...p, specialty: value }))}
                        cascadeKey={categoryId}
                      />
                    </>
                  )
                })()}
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
              <div>
                <label className="form-label">Matrícula <span className="text-danger">*</span></label>
                <div className="flex gap-2 mb-3">
                  {['MN', 'MP'].map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setForm(p => ({ ...p, licenseType: type }))}
                      className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                        form.licenseType === type
                          ? 'bg-brand text-white border-brand'
                          : 'bg-white border-border-default text-text-secondary'
                      }`}
                    >
                      {type === 'MN' ? 'MN — Matrícula Nacional' : 'MP — Matrícula Provincial'}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={form.licenseNumber}
                  onChange={e => setForm(p => ({ ...p, licenseNumber: e.target.value }))}
                  className="form-input"
                  placeholder="Ej: 123456"
                />
                <p className="text-xs text-text-tertiary mt-1">Número de matrícula</p>
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
                <label className="form-label">Modalidad de atención</label>
                <div className="grid grid-cols-3 gap-2">
                  {MODALITIES.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setForm(p => ({ ...p, modalityPreference: m.id }))}
                      className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-center transition-colors ${
                        form.modalityPreference === m.id
                          ? 'bg-brand text-white border-brand'
                          : 'bg-white border-border-default text-text-secondary'
                      }`}
                    >
                      <m.icon className="h-5 w-5" />
                      <span className="text-xs font-medium leading-tight">{m.label}</span>
                    </button>
                  ))}
                </div>
              </div>

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
                <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2">
                  <p className="text-sm text-blue-700">
                    Rango sugerido: ${SUGGESTED_PRICE_RANGE.min.toLocaleString('es-AR')}–${SUGGESTED_PRICE_RANGE.max.toLocaleString('es-AR')} ·{' '}
                    <span className="font-semibold">recomendado ${SUGGESTED_PRICE_RANGE.recommended.toLocaleString('es-AR')}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setForm(p => ({ ...p, sessionPrice: String(SUGGESTED_PRICE_RANGE.recommended) }))}
                    className="text-xs font-semibold text-blue-700 hover:text-blue-900 whitespace-nowrap"
                  >
                    Usar
                  </button>
                </div>
              </div>

              {form.modalityPreference !== 'virtual' && (
                <>
                  <div>
                    <label className="form-label">Zona de atención presencial</label>
                    <select
                      value={form.zoneId}
                      onChange={e => setForm(p => ({ ...p, zoneId: e.target.value }))}
                      className="form-select"
                    >
                      <option value="">Seleccioná tu barrio</option>
                      {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                    </select>
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
            </>
          )}

          {/* ── Step 3: Documentación ────────────────────────────── */}
          {step === 3 && (
            <>
              <p className="text-base text-text-secondary -mt-1">
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
              <div>
                <label className="form-label">Seguro de mala praxis <span className="text-text-tertiary text-xs">(recomendado)</span></label>
                <FileUpload
                  onFile={setMalpracticeFile}
                  accept=".pdf,.jpg,.jpeg,.png"
                  label={malpracticeFile ? malpracticeFile.name : 'Subir póliza de responsabilidad civil profesional'}
                />
              </div>
              {form.subSpecialty && (
                <div>
                  <label className="form-label">Certificado de especialista <span className="text-text-tertiary text-xs">(requerido si declarás sub-especialidad)</span></label>
                  <FileUpload
                    onFile={setSpecialistCertFile}
                    accept=".pdf,.jpg,.jpeg,.png"
                    label={specialistCertFile ? specialistCertFile.name : `Subir certificado de especialista en ${form.subSpecialty}`}
                  />
                  <p className="text-xs text-text-tertiary mt-1">La matrícula acredita el título general — para ejercer como especialista se requiere el certificado emitido por el Ministerio de Salud o el colegio profesional correspondiente.</p>
                </div>
              )}
              <div>
                <label className="form-label">CUIT / Monotributo <span className="text-text-tertiary text-xs">(para facturación)</span></label>
                <input
                  type="text"
                  value={form.cuitNumber}
                  onChange={e => setForm(p => ({ ...p, cuitNumber: e.target.value }))}
                  className="form-input mb-2"
                  placeholder="Ej: 20-12345678-9"
                />
                <FileUpload
                  onFile={setCuitFile}
                  accept=".pdf,.jpg,.jpeg,.png"
                  label={cuitFile ? cuitFile.name : 'Subir constancia de CUIT/Monotributo (AFIP)'}
                />
              </div>
            </>
          )}

          {/* ── Step 4: Datos y privacidad ───────────────────────── */}
          {step === 4 && (
            <>
              <p className="text-base text-text-secondary -mt-1">
                Nos tomamos muy en serio la privacidad, cumpliendo con la Ley 25.326 y la Ley 26.529 de derechos
                del paciente. Obtené más información en nuestros{' '}
                <a href="/terminos" target="_blank" rel="noreferrer" className="text-brand font-medium underline">Términos y Condiciones</a>.
              </p>
              <label className="flex items-start gap-3 p-3 rounded-xl border border-border-default cursor-pointer">
                <input
                  type="checkbox"
                  checked={privacyAccepted}
                  onChange={e => setPrivacyAccepted(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-brand"
                />
                <span className="text-sm text-text-secondary">
                  Acepto los{' '}
                  <a href="/terminos" target="_blank" rel="noreferrer" className="text-brand font-medium underline">Términos del servicio</a>
                  {' '}y el manejo de datos personales conforme a la Ley 25.326.
                </span>
              </label>
            </>
          )}

          {/* ── Step 5: Revisión ─────────────────────────────────── */}
          {step === 5 && (
            <div className="space-y-4 text-sm">
              <div className="rounded-xl bg-bg-surface divide-y divide-border-default border border-border-default overflow-hidden">
                {[
                  ['Especialidad',      SPECIALTY_LABELS[form.specialty] || '—'],
                  ['Sub-especialidad',  form.subSpecialty || '—'],
                  ['Matrícula',         form.licenseNumber ? `${form.licenseType} ${form.licenseNumber}` : '—'],
                  ['Bio',               form.bio ? form.bio.slice(0, 100) + (form.bio.length > 100 ? '…' : '') : '—'],
                  ['Precio por sesión', form.sessionPrice ? `$${form.sessionPrice} ARS` : '—'],
                  ['Modalidad',         MODALITIES.find(m => m.id === form.modalityPreference)?.label || '—'],
                  ...(form.modalityPreference !== 'virtual'
                    ? [['Zona',         zones.find(z => z.id === form.zoneId)?.name || '—']]
                    : []),
                  ['Consultorio',       form.address || '—'],
                  ['Foto de perfil',    avatarFile ? avatarFile.name : '—'],
                  ['Título',           titleFile   ? titleFile.name   : '—'],
                  ['Doc. matrícula',   licenseFile ? licenseFile.name : '—'],
                  ['DNI',              dniFile     ? dniFile.name     : '—'],
                  ['Seguro mala praxis', malpracticeFile ? malpracticeFile.name : '—'],
                  ...(form.subSpecialty ? [['Cert. especialista', specialistCertFile ? specialistCertFile.name : '—']] : []),
                  ['CUIT/Monotributo', form.cuitNumber || cuitFile ? [form.cuitNumber, cuitFile?.name].filter(Boolean).join(' — ') : '—'],
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
          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2 border-t border-border-default">
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

        {/* Skip option for optional steps (1, 2 and 3 — documentación ya se puede enviar sin
            archivos, esto solo lo hace explícito para que no parezca un paso bloqueante) */}
        {(step === 1 || step === 2 || step === 3) && (
          <button onClick={next} className="mt-3 w-full text-center text-sm text-text-tertiary hover:text-text-secondary transition-colors">
            {step === 3 ? 'Subo los documentos después →' : 'Completar más tarde →'}
          </button>
        )}
      </div>
      </div>

      {/* Right — live preview panel */}
      <div className="hidden lg:flex bg-bg-secondary p-8">
        <OnboardingPreview step={step} form={form} profile={profile} avatarPreview={avatarPreview} />
      </div>
    </div>
  )
}
