import { CheckCircle, ShieldCheck, CalendarCheck, VideoCamera, FileText, Prescription } from '@phosphor-icons/react'
import { AnimatedTagCascade } from '../common/AnimatedTagCascade'
import { SPECIALTY_LABELS } from '../../lib/verticals'
import { LAWS } from '../../lib/laws'

// Illustrative clinical-note sections — teases the AI Scribe feature (Fase 3)
// while doubling as the "tags cascading in" preview for Step 0. Not real data.
const NOTE_SECTIONS = [
  { value: 'motivo',      label: 'Motivo de Consulta' },
  { value: 'edad',        label: 'Edad' },
  { value: 'antecedentes', label: 'Antecedentes Médicos' },
  { value: 'medicamentos', label: 'Medicamentos Actuales' },
  { value: 'alergias',    label: 'Alergias' },
  { value: 'examen',      label: 'Examen Físico' },
]

const FEATURES = [
  { icon: CalendarCheck, label: 'Agenda integrada', desc: 'Tus horarios y turnos, todo dentro de Healthier' },
  { icon: VideoCamera,   label: 'Consultas on-demand', desc: 'Video y presencial desde el mismo panel' },
  { icon: FileText,      label: 'Historia clínica compartida', desc: 'Tus pacientes ven su historial en un lugar' },
  { icon: Prescription,  label: 'Receta electrónica', desc: 'Emisión digital vía RCTA' },
]

export default function OnboardingPreview({ step, form, profile, avatarPreview }) {
  const specialtyLabel = SPECIALTY_LABELS[form.specialty]

  return (
    <div className="hidden lg:flex flex-col h-full w-full bg-bg-surface rounded-[1.5rem] border border-border-default p-8 overflow-hidden">
      {step === 0 && (
        <div className="animate-fade-in-up">
          <p className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-1">Nota nueva</p>
          <h3 className="font-serif text-2xl text-text-primary mb-6">
            {specialtyLabel || 'Elegí tu especialidad'}
          </h3>
          <AnimatedTagCascade
            items={NOTE_SECTIONS}
            value={null}
            onSelect={() => {}}
            cascadeKey={form.specialty || 'empty'}
          />
        </div>
      )}

      {step === 1 && (
        <div className="animate-fade-in-up flex flex-col items-center text-center mt-auto mb-auto">
          <div className="h-24 w-24 rounded-full bg-brand-muted border-2 border-brand/30 overflow-hidden flex items-center justify-center mb-4">
            {avatarPreview
              ? <img src={avatarPreview} alt="preview" className="h-full w-full object-cover" />
              : <span className="text-3xl font-serif text-brand">{profile?.fullName?.[0] ?? '?'}</span>}
          </div>
          <h3 className="font-serif text-2xl text-text-primary">{profile?.fullName || 'Tu nombre'}</h3>
          {specialtyLabel && <p className="text-text-tertiary text-sm mt-1">{specialtyLabel}</p>}
          {form.bio && <p className="text-text-secondary text-sm mt-4 max-w-xs">{form.bio}</p>}
        </div>
      )}

      {step === 2 && (
        <div className="animate-fade-in-up">
          <h3 className="font-serif text-2xl text-text-primary mb-1">Funcionalidades de Healthier para tu práctica</h3>
          <p className="text-text-tertiary text-sm mb-6">Sos de los primeros profesionales en Healthier — así se ve tu panel apenas te aprobemos.</p>
          <div className="flex flex-row flex-wrap gap-3">
            {FEATURES.map(f => (
              <div key={f.label} className="flex flex-col items-center justify-center text-center gap-1.5 p-4 w-[calc(50%-0.375rem)] rounded-xl bg-bg-surface-hover">
                <f.icon className="h-6 w-6 text-brand" />
                <p className="text-sm font-medium text-text-primary">{f.label}</p>
                <p className="text-xs text-text-tertiary">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="animate-fade-in-up mt-auto mb-auto text-center">
          <ShieldCheck className="h-12 w-12 text-brand mx-auto mb-4" weight="light" />
          <h3 className="font-serif text-2xl text-text-primary mb-2">Tus documentos, cifrados</h3>
          <p className="text-text-secondary text-sm max-w-xs mx-auto">
            Un administrador revisa tus credenciales en 24–48hs. Todo se almacena de forma cifrada, nadie más los ve.
          </p>
        </div>
      )}

      {step === 4 && (
        <div className="animate-fade-in-up mt-auto mb-auto">
          <div className="space-y-2.5 mb-8">
            {LAWS.map(l => (
              <a
                key={l.code}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 rounded-xl bg-white border border-border-default p-3 hover:border-brand/40 transition-colors group"
              >
                <div>
                  <p className="text-xs font-semibold text-text-primary">{l.code} <span className="font-normal text-text-tertiary">— {l.label}</span></p>
                  <p className="text-[11px] text-text-tertiary mt-0.5">{l.desc}</p>
                </div>
                <span className="text-[11px] font-medium text-brand shrink-0 group-hover:underline">Ver texto →</span>
              </a>
            ))}
          </div>
          <p className="font-serif text-xl text-text-primary text-center leading-snug">
            Tu privacidad y la de tus pacientes<br />está totalmente protegida.
          </p>
        </div>
      )}

      {step === 5 && (
        <div className="animate-fade-in-up mt-auto mb-auto text-center">
          <CheckCircle className="h-12 w-12 text-brand mx-auto mb-4" weight="fill" />
          <h3 className="font-serif text-3xl text-text-primary mb-1">
            Bienvenido, {profile?.fullName?.split(' ')[0] || ''}
          </h3>
          <p className="text-text-tertiary text-sm">Bienvenido a Healthier</p>
        </div>
      )}
    </div>
  )
}
