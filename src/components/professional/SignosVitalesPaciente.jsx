import { useEffect, useState } from 'react'
import {
  AppleLogo, ArrowsClockwise, Check, CircleNotch, Drop, Heart, Heartbeat, Info, Warning,
} from '@phosphor-icons/react'
import { esDeHoy } from '../../lib/consultaDraft'

/**
 * Signos vitales del paciente, arriba de todo en el panel clínico (Nacho,
 * reunión del 2026-10-22: "signos vitales arriba, al empezar la videollamada").
 * Va como segunda fila de la tarjeta del paciente, que es chrome fijo del
 * panel: se ve apenas abre la consulta, sigue a la vista en Recetario y en
 * Cerrar, y no se va al scrollear la planilla. En el teléfono, la hoja cerrada
 * asoma lo justo para mostrarla entera (ver `useAsomaDeLaHoja` en VideoCall).
 *
 * Mateo, sobre lo que significa "al día": "tienen que pedirse en el momento".
 *  · La app del paciente sube FC y SatO2 al entrar a la llamada, con la fecha
 *    REAL de cada medición (migración 215: `fc_medido_at`, `saturacion_medido_at`).
 *  · "Pedir ahora" se los pide a su teléfono en plena llamada (`pedido`, lo
 *    maneja VideoCall por el canal de la sala; no existe en la atención
 *    presencial de emergencia, que no tiene app del otro lado).
 *  · Lo que no se midió hoy se muestra igual, marcado "no es de hoy".
 *
 * Peso y talla son del perfil y van sin fecha. Diseño: Felipe (dos rondas).
 */

const NBSP = ' '
const TZ = 'America/Argentina/Buenos_Aires'
const numero = n => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 1 })
const HORA = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const DIA = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: 'numeric', month: 'numeric' })
const DIA_ANIO = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: 'numeric', month: 'numeric', year: '2-digit' })
const ANIO = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, year: 'numeric' })

/** Hoy: "Medido hace 3 min". Ayer: "Medido ayer, 22:14". Antes: "Medido el 12/10". */
function medido(iso, ahora) {
  const t = new Date(iso).getTime()
  if (esDeHoy(iso, ahora)) {
    const min = Math.max(0, Math.floor((ahora - t) / 60000))
    if (min < 1) return 'Medido recién'
    if (min < 60) return `Medido hace ${min} min`
    return `Medido hace ${Math.floor(min / 60)} h`
  }
  if (esDeHoy(iso, ahora - 24 * 60 * 60 * 1000)) return `Medido ayer, ${HORA.format(t)}`
  const fecha = ANIO.format(t) === ANIO.format(ahora) ? DIA.format(t) : DIA_ANIO.format(t)
  return `Medido el ${fecha}`
}

const exacto = iso => `${DIA.format(new Date(iso))} ${HORA.format(new Date(iso))}`

/** La hora de ahora, cada minuto: la consulta dura un rato y "hace X" no puede congelarse. */
function useAhora() {
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  return ahora
}

// Qué decir cuando el pedido no trajo mediciones (copy de Felipe). Queda hasta
// el próximo pedido: así no se pierde de vista la fecha de la medición vieja.
const MENSAJE_PEDIDO = {
  sin_datos: 'No llegaron mediciones nuevas de su teléfono.',
  sin_permiso: 'Le pedimos que habilite Salud en su teléfono.',
  rechazado: 'No habilitó Salud esta vez.',
  no_disponible: 'Hace falta que entre desde la app en un iPhone.',
  sin_respuesta: 'No respondió. Probá de nuevo en un momento.',
  error: 'No se pudieron leer sus mediciones. Probá de nuevo.',
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

/** "Pedir ahora" → "Pidiendo…" → "Recibido" (3 s). */
function BotonPedir({ estado, onPedir }) {
  if (estado === 'pidiendo') {
    return (
      <span className="ml-auto shrink-0 flex items-center gap-1 text-xs text-text-tertiary whitespace-nowrap">
        <CircleNotch className="h-3 w-3 animate-spin" /> Pidiendo…
      </span>
    )
  }
  if (estado === 'recibido') {
    return (
      <span className="ml-auto shrink-0 flex items-center gap-1 text-xs font-medium text-brand whitespace-nowrap">
        <Check className="h-3 w-3" weight="bold" /> Recibido
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onPedir}
      aria-label="Pedir signos vitales al teléfono del paciente"
      className="ml-auto shrink-0 flex items-center gap-1 text-xs font-medium text-brand hover:text-brand-hover whitespace-nowrap"
    >
      <ArrowsClockwise className="h-3 w-3" /> Pedir ahora
    </button>
  )
}

/**
 * `pedido` (opcional, sólo en la videollamada): `{ puedePedir, estado, onPedir }`.
 * `estado`: idle | pidiendo | recibido | sin_datos | sin_permiso | rechazado |
 * no_disponible | sin_respuesta | error.
 */
export default function SignosVitalesPaciente({ loading, patient, pedido }) {
  const ahora = useAhora()

  // Mientras carga no se dibuja nada: un "sin datos" que después se convierte
  // en números haría saltar el panel y, por un instante, diría algo falso.
  if (loading || !patient) return null

  const { fcLpm, saturacionPct, fcMedidoAt, saturacionMedidoAt, weightKg, heightCm } = patient
  const hayVitales = fcLpm != null || saturacionPct != null
  const hayPerfil = weightKg != null || heightCm != null
  const conBoton = !!pedido?.puedePedir
  const estado = pedido?.estado ?? 'idle'
  const boton = conBoton && <BotonPedir estado={estado} onPedir={pedido.onPedir} />
  const mensaje = conBoton ? MENSAJE_PEDIDO[estado] : null
  const lineaMensaje = mensaje && (
    <p className="mt-0.5 flex items-center gap-1 text-xs leading-4 text-text-secondary" role="status">
      <Info className="h-3 w-3 shrink-0" /> {mensaje}
    </p>
  )

  if (!hayVitales && !hayPerfil) {
    return (
      <div role="group" aria-label="Signos vitales" className="border-t border-border-subtle px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs leading-4 text-text-tertiary">
          <Heartbeat className="h-3.5 w-3.5 shrink-0" />
          {conBoton ? 'Sin signos vitales del paciente.' : 'Sin signos vitales del teléfono del paciente.'}
          {boton}
        </div>
        {lineaMensaje}
      </div>
    )
  }

  // La fecha que se muestra es la de la medición MÁS VIEJA de las que hay: si
  // la FC es de hoy y la saturación de la semana pasada, el conjunto no es de hoy.
  const fechas = [
    fcLpm != null ? fcMedidoAt ?? null : undefined,
    saturacionPct != null ? saturacionMedidoAt ?? null : undefined,
  ].filter(f => f !== undefined)
  const sinFecha = fechas.some(f => !f || !Number.isFinite(new Date(f).getTime()))
  const masVieja = sinFecha ? null : fechas.reduce((a, b) => (new Date(a) < new Date(b) ? a : b), fechas[0])
  const viejo = hayVitales && (sinFecha || !esDeHoy(masVieja, ahora))

  let fuente
  if (!hayVitales) fuente = 'Sin datos del teléfono del paciente'
  else if (sinFecha) fuente = 'Sin fecha de medición'
  else fuente = `${medido(masVieja, ahora)}${viejo ? ' · no es de hoy' : ''}`
  const detalle = hayVitales && !sinFecha
    ? [fcLpm != null && `FC: ${exacto(fcMedidoAt)}`, saturacionPct != null && `SatO₂: ${exacto(saturacionMedidoAt)}`].filter(Boolean).join(' · ')
    : undefined

  const apagado = viejo
  return (
    <div role="group" aria-label="Signos vitales" className="border-t border-border-subtle px-3 pt-2 pb-2.5">
      <div className={`flex flex-wrap items-center gap-x-3.5 gap-y-1 transition-opacity ${estado === 'pidiendo' ? 'opacity-60' : ''}`}>
        <Valor icon={Heart} iconClass="text-danger" valor={fcLpm} unidad="lpm" apagado={apagado} />
        <Valor icon={Drop} iconClass="text-info" valor={saturacionPct} unidad="%" apagado={apagado} />
        {hayPerfil && (
          <>
            {/* Peso y talla, del perfil: cambian despacio y van sin fecha. */}
            <span className="w-px h-4 bg-border-subtle" aria-hidden="true" />
            <Valor valor={weightKg} unidad="kg" />
            <Valor valor={heightCm} unidad="cm" />
          </>
        )}
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-xs leading-4 text-text-tertiary">
        {viejo
          ? <Warning weight="fill" className="h-3 w-3 shrink-0 text-warning" />
          : hayVitales
            ? <AppleLogo weight="fill" className="h-3 w-3 shrink-0" />
            : <Heartbeat className="h-3 w-3 shrink-0" />}
        <span className={`min-w-0 truncate ${viejo ? 'text-text-secondary' : ''}`} title={detalle}>{fuente}</span>
        {boton}
      </div>
      {lineaMensaje}
    </div>
  )
}
