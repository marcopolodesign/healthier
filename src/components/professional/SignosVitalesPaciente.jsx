import { AppleLogo, Drop, Heart, Heartbeat, Warning } from '@phosphor-icons/react'

/**
 * Signos vitales del paciente, arriba de todo en el panel clínico (Nacho,
 * reunión del 2026-10-22: "signos vitales arriba, al empezar la videollamada").
 * Va como segunda fila de la tarjeta del paciente, que es chrome fijo del
 * panel: se ve apenas abre la consulta, sigue a la vista en Recetario y en
 * Cerrar, y no se va al scrollear la planilla.
 *
 * Son los que manda el teléfono del paciente —Apple Health, y el Oura Ring a
 * través de Apple Health (migración 170)— más el peso y la talla de su perfil.
 * Sólo lectura: el profesional los asienta en "06. Vitales" de la consulta
 * estructurada, que los precarga con el mismo criterio de 7 días.
 *
 * Diseño revisado por Felipe (2026-10-22): una tira en línea y no tiles con
 * label — el ícono y la unidad ya dicen qué es cada número, y la tira tiene que
 * comerle poco alto a un panel que comparte pantalla con el video.
 */

// Mismo umbral que la precarga de "06. Vitales" (`saludReciente` en
// ConsultaEstructurada): lo que se precarga no se marca como desactualizado.
const DESACTUALIZADO_MS = 7 * 24 * 60 * 60 * 1000

// Espacio duro entre número y unidad: "72 lpm" no se parte en dos renglones.
const NBSP = ' '

const numero = n => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 1 })

/** "recién", "hace 40 min", "hace 3 h", "hace 1 día", "hace 12 días". */
function haceCuanto(iso, ahora) {
  const min = Math.max(0, Math.floor((ahora - new Date(iso).getTime()) / 60000))
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return d === 1 ? 'hace 1 día' : `hace ${d} días`
}

function Valor({ icon: Icon, iconClass, valor, unidad, apagado }) {
  return (
    <span className="flex items-baseline gap-0.5 whitespace-nowrap">
      {Icon && <Icon weight="fill" className={`h-3.5 w-3.5 shrink-0 self-center mr-0.5 ${iconClass}`} />}
      {valor == null ? (
        <span className="text-base leading-5 text-text-tertiary">—</span>
      ) : (
        <>
          <span className={`text-base font-medium leading-5 tabular-nums ${apagado ? 'text-text-secondary' : 'text-text-primary'}`}>
            {numero(valor)}
          </span>
          <span className="text-xs text-text-tertiary">{NBSP}{unidad}</span>
        </>
      )}
    </span>
  )
}

export default function SignosVitalesPaciente({ loading, patient }) {
  // Mientras carga no se dibuja nada: un "sin datos" que después se convierte
  // en números haría saltar el panel y, por un instante, diría algo falso.
  if (loading || !patient) return null

  const { fcLpm, saturacionPct, saludSincronizadoAt, weightKg, heightCm } = patient
  const hayVitales = fcLpm != null || saturacionPct != null
  const hayPerfil = weightKg != null || heightCm != null

  if (!hayVitales && !hayPerfil) {
    return (
      <div role="group" aria-label="Signos vitales" className="border-t border-border-subtle px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs leading-4 text-text-tertiary">
          <Heartbeat className="h-3.5 w-3.5 shrink-0" />
          Sin signos vitales: el paciente no compartió Apple Health.
        </p>
      </div>
    )
  }

  const ahora = Date.now()
  const conFecha = hayVitales && saludSincronizadoAt
  const desactualizado = conFecha && ahora - new Date(saludSincronizadoAt).getTime() > DESACTUALIZADO_MS

  return (
    <div role="group" aria-label="Signos vitales" className="border-t border-border-subtle px-3 pt-2 pb-2.5">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
        <Valor icon={Heart} iconClass="text-danger" valor={fcLpm} unidad="lpm" apagado={desactualizado} />
        <Valor icon={Drop} iconClass="text-info" valor={saturacionPct} unidad="%" apagado={desactualizado} />
        {hayPerfil && (
          <>
            {/* Peso y talla son otra fuente (los carga el paciente en su perfil). */}
            <span className="w-px h-4 bg-border-subtle" aria-hidden="true" />
            <Valor valor={weightKg} unidad="kg" />
            <Valor valor={heightCm} unidad="cm" />
          </>
        )}
      </div>
      <p className="mt-0.5 flex items-center gap-1 text-xs leading-4 text-text-tertiary">
        {desactualizado
          ? <Warning weight="fill" className="h-3 w-3 shrink-0 text-warning" />
          : <AppleLogo weight="fill" className="h-3 w-3 shrink-0" />}
        <span className={desactualizado ? 'text-text-secondary' : undefined}>
          {conFecha
            ? `Apple Health · ${haceCuanto(saludSincronizadoAt, ahora)}${desactualizado ? ' · desactualizado' : ''}`
            : hayVitales ? 'Apple Health' : 'Sin datos de Apple Health'}
        </span>
      </p>
    </div>
  )
}
