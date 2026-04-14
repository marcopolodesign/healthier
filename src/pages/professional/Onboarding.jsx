import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckIcon } from '@heroicons/react/24/solid'
import { professionalService } from '../../services/professionalService'
import FileUpload from '../../components/FileUpload'
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

const STEPS = ['Información personal', 'Título profesional', 'Matrícula y DNI', 'Revisión y envío']

export default function Onboarding({ profile }) {
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const [form, setForm] = useState({
    specialty: '', subSpecialty: '', bio: '', sessionPrice: '',
  })
  const [titleFile, setTitleFile] = useState(null)
  const [licenseFile, setLicenseFile] = useState(null)
  const [dniFile, setDniFile] = useState(null)

  const next = () => setStep(s => Math.min(s + 1, 3))
  const prev = () => setStep(s => Math.max(s - 1, 0))

  const submit = async () => {
    setLoading(true)
    try {
      // Upload documents
      let titleUrl = '', licenseUrl = '', dniUrl = ''
      if (titleFile) titleUrl = await professionalService.uploadDocument(profile.id, titleFile, 'professional-docs', 'titulo')
      if (licenseFile) licenseUrl = await professionalService.uploadDocument(profile.id, licenseFile, 'professional-docs', 'matricula')
      if (dniFile) dniUrl = await professionalService.uploadDocument(profile.id, dniFile, 'professional-docs', 'dni')

      await professionalService.upsert(profile.id, {
        ...form,
        sessionPrice: form.sessionPrice ? Number(form.sessionPrice) : null,
        titleDocumentUrl: titleUrl,
        licenseDocumentUrl: licenseUrl,
        dniDocumentUrl: dniUrl,
        isVerified: false,
        isActive: false,
        submittedAt: new Date().toISOString(),
      })

      toast.success('¡Perfil enviado! Un administrador lo revisará pronto.')
      navigate('/profesional/dashboard')
    } catch (err) {
      toast.error(err.message || 'Error al enviar el perfil')
    } finally {
      setLoading(false)
    }
  }

  const canNext = [
    form.specialty && form.bio.length >= 20,
    !!titleFile,
    !!licenseFile && !!dniFile,
    true,
  ][step]

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Completá tu perfil profesional</h1>
        <p className="text-text-secondary mt-1">Necesitamos verificar tu información antes de que puedas recibir pacientes</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={i} className="flex items-center gap-2 flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold transition-colors ${
              i < step ? 'bg-brand text-white' : i === step ? 'bg-brand text-white ring-4 ring-brand-muted' : 'bg-bg-surface text-text-tertiary'
            }`}>
              {i < step ? <CheckIcon className="h-4 w-4" /> : i + 1}
            </div>
            <span className={`text-xs hidden sm:block ${i === step ? 'text-brand font-medium' : 'text-text-tertiary'}`}>{label}</span>
            {i < STEPS.length - 1 && <div className={`flex-1 h-px ${i < step ? 'bg-brand' : 'bg-border-default'}`} />}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="card space-y-5">
        {step === 0 && (
          <>
            <h2 className="font-semibold text-text-primary">Información profesional</h2>
            <div>
              <label className="form-label">Especialidad *</label>
              <select value={form.specialty} onChange={e => setForm(p => ({ ...p, specialty: e.target.value }))} className="form-select">
                <option value="">Seleccioná una especialidad</option>
                {SPECIALTIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Sub-especialidad (opcional)</label>
              <input type="text" value={form.subSpecialty} onChange={e => setForm(p => ({ ...p, subSpecialty: e.target.value }))} placeholder="Ej: Cardiología pediátrica" className="form-input" />
            </div>
            <div>
              <label className="form-label">Presentación / Bio *</label>
              <textarea
                value={form.bio}
                onChange={e => setForm(p => ({ ...p, bio: e.target.value }))}
                rows={4}
                placeholder="Contale a los pacientes sobre tu experiencia, enfoque y cómo podés ayudarlos (mínimo 20 caracteres)"
                className="form-textarea"
              />
              <p className="text-xs text-text-tertiary mt-1">{form.bio.length} caracteres</p>
            </div>
            <div>
              <label className="form-label">Precio por sesión (ARS, opcional)</label>
              <input type="number" value={form.sessionPrice} onChange={e => setForm(p => ({ ...p, sessionPrice: e.target.value }))} placeholder="Ej: 8000" className="form-input" />
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="font-semibold text-text-primary">Título / Diploma profesional</h2>
            <p className="text-sm text-text-secondary">Subí una copia de tu título universitario o diploma habilitante.</p>
            <FileUpload onFile={setTitleFile} accept=".pdf,.jpg,.jpeg,.png" label="Subir título / diploma" hint="PDF, JPG o PNG" />
            {titleFile && <p className="text-sm text-success">✓ Archivo seleccionado: {titleFile.name}</p>}
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="font-semibold text-text-primary">Matrícula profesional y DNI</h2>
            <div>
              <label className="form-label">Matrícula profesional *</label>
              <FileUpload onFile={setLicenseFile} accept=".pdf,.jpg,.jpeg,.png" label="Subir matrícula" hint="PDF, JPG o PNG" />
              {licenseFile && <p className="text-sm text-success mt-2">✓ {licenseFile.name}</p>}
            </div>
            <div className="mt-4">
              <label className="form-label">DNI / Documento de identidad *</label>
              <FileUpload onFile={setDniFile} accept=".pdf,.jpg,.jpeg,.png" label="Subir DNI" hint="Frente y dorso en un solo archivo" />
              {dniFile && <p className="text-sm text-success mt-2">✓ {dniFile.name}</p>}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="font-semibold text-text-primary">Revisión final</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b border-border-default">
                <span className="text-text-secondary">Especialidad</span>
                <span className="font-medium">{SPECIALTIES.find(s => s.value === form.specialty)?.label}</span>
              </div>
              {form.subSpecialty && (
                <div className="flex justify-between py-2 border-b border-border-default">
                  <span className="text-text-secondary">Sub-especialidad</span>
                  <span className="font-medium">{form.subSpecialty}</span>
                </div>
              )}
              <div className="flex justify-between py-2 border-b border-border-default">
                <span className="text-text-secondary">Título profesional</span>
                <span className="font-medium text-success">{titleFile ? '✓ Adjunto' : '—'}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border-default">
                <span className="text-text-secondary">Matrícula</span>
                <span className="font-medium text-success">{licenseFile ? '✓ Adjunto' : '—'}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-text-secondary">DNI</span>
                <span className="font-medium text-success">{dniFile ? '✓ Adjunto' : '—'}</span>
              </div>
            </div>
            <div className="bg-brand-muted border border-brand/20 rounded-lg p-4 text-sm text-brand">
              Un administrador revisará tu documentación en las próximas 24-48 hs. Te notificaremos por email cuando esté aprobado.
            </div>
          </>
        )}
      </div>

      {/* Navigation */}
      <div className="flex gap-3">
        {step > 0 && <button onClick={prev} className="btn-secondary flex-1">Atrás</button>}
        {step < 3 ? (
          <button onClick={next} disabled={!canNext} className="btn-primary flex-1">
            Continuar
          </button>
        ) : (
          <button onClick={submit} disabled={loading} className="btn-primary flex-1">
            {loading ? 'Enviando...' : 'Enviar para revisión'}
          </button>
        )}
      </div>
    </div>
  )
}
