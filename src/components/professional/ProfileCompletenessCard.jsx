import { Link } from 'react-router-dom'
import { ArrowRight } from '@phosphor-icons/react'
import { getProfileCompleteness } from '../../lib/profileCompleteness'

// Persistent "steps N/5" checklist for a newly-verified professional who
// hasn't finished setting up price/availability yet — nothing in Dashboard.jsx
// used to point that out, so a professional could get approved and never
// realize patients can't actually book them without a schedule loaded.
// Fully derived from real data (no "dismissed" flag in DB) — disappears on
// its own once every step is done.
export default function ProfileCompletenessCard({ profProfile, schedules }) {
  const { steps, completed, total, isComplete } = getProfileCompleteness(profProfile, schedules)
  if (isComplete) return null

  const pending = steps.filter(s => !s.done)

  return (
    <div className="card border-brand/20 bg-brand-muted/20">
      <div className="flex items-center justify-between mb-1">
        <p className="font-semibold text-text-primary">Completá tu perfil</p>
        <span className="text-sm font-medium text-brand shrink-0">{completed}/{total}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white overflow-hidden mb-3">
        <div className="h-full bg-brand rounded-full transition-all" style={{ width: `${(completed / total) * 100}%` }} />
      </div>
      <div className="space-y-1.5">
        {pending.map(step => (
          <Link
            key={step.key}
            to={step.href}
            className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-white hover:bg-bg-surface-hover transition-colors group"
          >
            <span className="text-sm text-text-primary">{step.label}</span>
            <ArrowRight className="h-4 w-4 text-brand shrink-0 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        ))}
      </div>
    </div>
  )
}
