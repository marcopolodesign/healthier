import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle } from '@phosphor-icons/react'
import { getProfileCompleteness } from '../../lib/profileCompleteness'

// Persistent "steps N/total" checklist so a professional can't finish
// onboarding (or sit in "Perfil en revisión") and never realize patients
// can't actually book them without a price/schedule/zona/avatar loaded.
// Fully derived from real data (no "dismissed" flag in DB).
//
// Always renders the FULL list — done steps too (2026-08-04, Mateo): done
// items show a check mark and sit muted, but stay clickable via the same
// `href` so a professional can go back and edit anything already loaded.
// When every step is done the card doesn't disappear anymore either — it
// switches to a "perfil completo" message, still listing every step as an
// edit shortcut, since that's the whole value of keeping this card around.
// `includeVerification: false` is passed by the not-yet-verified Dashboard
// states — see profileCompleteness.js.
export default function ProfileCompletenessCard({ profProfile, schedules, title = 'Completá tu perfil', includeVerification = true }) {
  const { steps, completed, total, isComplete } = getProfileCompleteness(profProfile, schedules, { includeVerification })

  return (
    <div className="card border-brand/20 bg-brand-muted/20">
      <div className="flex items-center justify-between mb-1">
        <p className="font-semibold text-text-primary">{isComplete ? 'Perfil completo' : title}</p>
        <span className="text-sm font-medium text-brand shrink-0">{completed}/{total}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white overflow-hidden mb-3">
        <div className="h-full bg-brand rounded-full transition-all" style={{ width: `${(completed / total) * 100}%` }} />
      </div>
      {isComplete && (
        <p className="text-sm text-text-secondary mb-3">
          Completaste todos los pasos. Podés seguir editando cualquiera cuando quieras.
        </p>
      )}
      <div className="space-y-1.5">
        {steps.map(step => {
          const rowClass = `flex items-center justify-between gap-3 px-3 py-2 rounded-xl transition-colors group ${
            step.done ? 'bg-white/70' : 'bg-white'
          } ${step.href ? 'hover:bg-bg-surface-hover' : ''}`

          const inner = (
            <>
              <span className={`flex items-center gap-2 text-sm ${step.done ? 'text-text-tertiary' : 'text-text-primary'}`}>
                {step.done && <CheckCircle weight="fill" className="h-4 w-4 text-brand shrink-0" />}
                {step.label}
              </span>
              {step.href && (
                <ArrowRight className="h-4 w-4 text-brand shrink-0 group-hover:translate-x-0.5 transition-transform" />
              )}
            </>
          )

          return step.href ? (
            <Link key={step.key} to={step.href} className={rowClass}>
              {inner}
            </Link>
          ) : (
            <div key={step.key} className={rowClass}>
              {inner}
            </div>
          )
        })}
      </div>
    </div>
  )
}
