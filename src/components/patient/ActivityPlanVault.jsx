import { useEffect, useState } from 'react'
import { CircleNotch, ClockCounterClockwise, ListChecks } from '@phosphor-icons/react'
import { getPlanesByTipo, TIPO_LABELS } from '../../services/activityPlanService'

// Vista del paciente para un plan de actividad (Salud Mental / Rehabilitación /
// Preparador Físico) — mismo criterio que el NutriPlan real: plan vigente
// primero, historial de planes anteriores debajo, estado vacío si nunca le
// armaron ninguno. Se usa embebida dentro de la categoría correspondiente en
// `/paciente/documentos` (Bóveda). Ver migración 171 / activityPlanService.js.

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })
}

function PlanCard({ plan, vigente }) {
  return (
    <div className={`rounded-2xl p-5 border shadow-sm ${vigente ? 'bg-white border-brand/20' : 'bg-bg-secondary border-border-default'}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <h4 className="font-semibold text-[15px] text-text-primary leading-tight">
          {plan.titulo || TIPO_LABELS[plan.tipo]}
        </h4>
        {vigente && (
          <span className="text-[10px] font-semibold uppercase tracking-widest text-brand bg-brand-muted px-2 py-1 rounded-full shrink-0">
            Vigente
          </span>
        )}
      </div>
      {plan.professional?.fullName && (
        <p className="text-[12px] text-text-tertiary font-medium mb-2">
          {plan.professional.fullName} · {fmtDate(plan.updatedAt)}
        </p>
      )}
      {plan.indicaciones && (
        <p className="text-[13px] text-text-secondary mb-3 leading-snug">{plan.indicaciones}</p>
      )}
      {plan.items?.length > 0 && (
        <ul className="space-y-2">
          {plan.items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2 bg-bg-primary/60 rounded-xl p-3">
              <ListChecks className="h-4 w-4 text-brand shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-text-primary leading-tight">{item.nombre}</p>
                {item.detalle && <p className="text-[12px] text-text-secondary mt-0.5">{item.detalle}</p>}
                {item.frecuencia && <p className="text-[11px] text-text-tertiary mt-0.5">{item.frecuencia}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function ActivityPlanVault({ patientId, tipo }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [vigentes, setVigentes] = useState([])
  const [anteriores, setAnteriores] = useState([])

  useEffect(() => {
    if (!patientId || !tipo) return
    let cancelled = false
    setLoading(true)
    setError(null)
    getPlanesByTipo(patientId, tipo)
      .then(({ vigentes, anteriores }) => {
        if (cancelled) return
        setVigentes(vigentes)
        setAnteriores(anteriores)
      })
      .catch(err => { if (!cancelled) setError(err.message || 'No pudimos cargar tu plan.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [patientId, tipo])

  if (loading) {
    return <div className="flex justify-center py-8"><CircleNotch className="h-5 w-5 animate-spin text-brand" /></div>
  }

  if (error) {
    return <p className="text-sm text-red-500 text-center py-4">{error}</p>
  }

  if (vigentes.length === 0 && anteriores.length === 0) {
    return (
      <div className="bg-bg-secondary rounded-2xl p-6 text-center border border-border-default">
        <p className="text-[14px] font-medium text-text-secondary">
          Cuando tu profesional te indique una rutina, la vas a ver acá.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {vigentes.map(plan => <PlanCard key={plan.id} plan={plan} vigente />)}

      {anteriores.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2 mt-2">
            <ClockCounterClockwise className="h-4 w-4 text-text-tertiary" />
            <h3 className="text-[12px] font-semibold text-text-secondary uppercase tracking-widest">Planes anteriores</h3>
          </div>
          <div className="space-y-3">
            {anteriores.map(plan => <PlanCard key={plan.id} plan={plan} vigente={false} />)}
          </div>
        </div>
      )}
    </div>
  )
}
