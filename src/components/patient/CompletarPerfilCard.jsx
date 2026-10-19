import { Link } from 'react-router-dom'
import { IdentificationCard, CaretRight } from '@phosphor-icons/react'
import { completitudPaciente, debeCompletarPerfil } from '../../lib/pacienteOnboarding'

/**
 * "Te faltan N datos para que te puedan recetar" — en el inicio del paciente
 * mientras le falte algo OBLIGATORIO del onboarding (consentimiento, DNI/sexo/
 * nacimiento, cobertura). Cuenta sólo los obligatorios (Felipe, 2026-10-18):
 * un "3 de 5" que se va con 3/5 parecería a medias. Los opcionales se piden en
 * el wizard y en Perfil, no acá.
 *
 * Se va sola cuando completa lo obligatorio: se deriva del perfil, no hay un
 * "cerrar". Abre el wizard en el primer paso que falta.
 */
export default function CompletarPerfilCard({ profile }) {
  if (!debeCompletarPerfil(profile)) return null
  const c = completitudPaciente(profile)
  const pendientes = c.pasos.filter(s => s.obligatorio && !s.done)
  const n = c.faltan.length

  return (
    <Link
      to={`/paciente/onboarding?paso=${pendientes[0]?.key ?? ''}`}
      className="block w-full rounded-[28px] bg-brand-muted border border-brand/20 p-5 active:scale-[0.98] transition-all"
    >
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-full bg-white/70 flex items-center justify-center flex-shrink-0">
          <IdentificationCard className="w-5 h-5 text-brand" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-text-primary leading-snug">
            {n === 1 ? 'Te falta 1 dato' : `Te faltan ${n} datos`} para que tu médico pueda recetarte
          </p>
          <p className="text-sm text-text-secondary mt-1">{c.faltan.map(f => f.replace(/^Sin /, '')).join(' · ')}</p>
          <div className="flex gap-1.5 mt-3" aria-label={`${c.obligatoriosHechos} de ${c.obligatoriosTotal} pasos`}>
            {c.pasos.filter(s => s.obligatorio).map(s => (
              <span key={s.key} className={`h-1.5 flex-1 rounded-full ${s.done ? 'bg-brand' : 'bg-white'}`} />
            ))}
          </div>
        </div>
        <span className="flex items-center gap-1 text-sm font-semibold text-brand flex-shrink-0 mt-0.5">
          Completar <CaretRight className="w-4 h-4" />
        </span>
      </div>
    </Link>
  )
}
