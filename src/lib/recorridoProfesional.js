/**
 * Recorrido del alta de un profesional — lectura de `professional_onboarding_events`.
 *
 * La bitácora guarda asientos crudos; acá se los convierte en la historia que el
 * super admin quiere leer: cuánto pasó entre un evento y el siguiente, dónde se
 * frenó, cuándo retomó, y en qué estado quedó.
 *
 * Toda la lógica de interpretación vive acá y no en la página, para que la
 * vista de recorrido y el sidecart de prospectos cuenten exactamente lo mismo.
 */

// Mismos labels que STEPS en pages/professional/Onboarding.jsx — si ese wizard
// cambia de pasos, actualizar acá también.
export const STEP_LABELS = ['Especialidad', 'Presentación', 'Documentos', 'Privacidad', 'Revisión']

/** Una pausa de más de esto entre dos eventos se lee como "se frenó y retomó". */
export const PAUSA_SIGNIFICATIVA_MS = 2 * 60 * 60 * 1000 // 2 h

/** Sin actividad por más de esto y sin legajo enviado = abandonado, no "en curso". */
export const ABANDONO_MS = 3 * 24 * 60 * 60 * 1000 // 3 días

// Al abrir el wizard se disparan dos asientos casi simultáneos: el que escribe
// el cliente (`wizard_opened`) y el del trigger si el paso cambió en la base.
// Contar los dos infla el recorrido con ruido que no pasó de verdad.
const VENTANA_DUPLICADO_MS = 10 * 1000

// `dot` para el detalle vertical (divs), `fill` para la línea de tiempo, que se
// dibuja en SVG: posicionar puntos sobre un eje continuo necesita porcentajes
// calculados en runtime, y los atributos de SVG los aceptan sin recurrir a un
// style inline (prohibidos en este proyecto, ver CLAUDE.md).
export const EVENT_META = {
  signup:        { label: 'Creó la cuenta',      dot: 'bg-gray-400',  fill: 'fill-gray-400',  texto: 'text-gray-600' },
  wizard_opened: { label: 'Abrió el formulario', dot: 'bg-blue-400',  fill: 'fill-blue-400',  texto: 'text-blue-700' },
  step_reached:  { label: 'Avanzó',              dot: 'bg-brand',     fill: 'fill-brand',     texto: 'text-brand' },
  submitted:     { label: 'Envió el legajo',     dot: 'bg-amber-500', fill: 'fill-amber-500', texto: 'text-amber-700' },
  resubmitted:   { label: 'Reenvió el legajo',   dot: 'bg-amber-500', fill: 'fill-amber-500', texto: 'text-amber-700' },
  verified:      { label: 'Verificado',          dot: 'bg-green-600', fill: 'fill-green-600', texto: 'text-green-700' },
  rejected:      { label: 'Rechazado',           dot: 'bg-red-500',   fill: 'fill-red-500',   texto: 'text-red-700' },
}

/** "2 d 4 h", "1 h 20 min", "35 min", "recién". */
export function formatearDuracion(ms) {
  if (ms == null || ms < 0) return '—'
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'recién'
  if (min < 60) return `${min} min`
  const horas = Math.floor(min / 60)
  if (horas < 24) {
    const resto = min % 60
    return resto ? `${horas} h ${resto} min` : `${horas} h`
  }
  const dias = Math.floor(horas / 24)
  const restoH = horas % 24
  return restoH ? `${dias} d ${restoH} h` : `${dias} d`
}

export function etiquetaEvento(e) {
  const meta = EVENT_META[e.event]
  if (e.event === 'step_reached' || e.event === 'wizard_opened') {
    const paso = STEP_LABELS[e.step] ?? (e.step != null ? `Paso ${e.step}` : null)
    if (!paso) return meta?.label ?? e.event
    return e.event === 'step_reached' ? `Avanzó a "${paso}"` : `Abrió el formulario en "${paso}"`
  }
  if (e.event === 'rejected') {
    return e.detail?.type === 'permanente' ? 'Rechazado (definitivo)' : 'Devuelto para corregir'
  }
  return meta?.label ?? e.event
}

/**
 * Convierte los asientos de un profesional en su recorrido.
 *
 * @param {Array} eventos — filas de professional_onboarding_events, cronológicas
 * @param {object} pro    — { createdAt, submittedAt, verifiedAt, rejectedAt, isVerified, onboardingStep }
 */
export function construirRecorrido(eventos = [], pro = {}, ahora = Date.now()) {
  const ordenados = [...eventos]
    .map(e => ({ ...e, ts: new Date(e.createdAt).getTime() }))
    .sort((a, b) => a.ts - b.ts)

  // Colapsa el ruido de la apertura del wizard: el `step_reached` que dispara
  // el trigger al montar (mismo instante, mismo paso) y las aperturas repetidas
  // de un remontaje (React en dev monta dos veces cada efecto). Se compara
  // contra el último asiento CONSERVADO, no contra el anterior del array, para
  // que descartar uno vuelva adyacentes a los que quedaron.
  const limpios = ordenados.reduce((acc, e) => {
    const previo = acc[acc.length - 1]
    if (previo && e.ts - previo.ts < VENTANA_DUPLICADO_MS) {
      const mismoAsiento = previo.event === e.event && previo.step === e.step
      const pasoDeLaApertura = e.event === 'step_reached' && previo.event === 'wizard_opened' && previo.step === e.step
      if (mismoAsiento || pasoDeLaApertura) return acc
    }
    acc.push(e)
    return acc
  }, [])

  const conPausas = limpios.map((e, i) => {
    const previo = limpios[i - 1]
    const pausaMs = previo ? e.ts - previo.ts : null
    return { ...e, pausaMs, retomo: pausaMs != null && pausaMs >= PAUSA_SIGNIFICATIVA_MS }
  })

  const primero = conPausas[0]
  const ultimo = conPausas[conPausas.length - 1]
  const buscar = ev => conPausas.find(e => e.event === ev)
  const buscarUltimo = ev => [...conPausas].reverse().find(e => e.event === ev)

  const envio = buscar('submitted') ?? buscar('resubmitted')
  const verificacion = buscarUltimo('verified')
  const rechazo = buscarUltimo('rejected')
  const inicioMs = primero?.ts ?? (pro.createdAt ? new Date(pro.createdAt).getTime() : null)
  // Fin = el último asiento, siempre. Usar la fecha de verificación acá dejaba
  // fuera de rango a quien ya está verificado y volvió a tocar algo después.
  const finMs = ultimo?.ts ?? inicioMs

  const inactividadMs = ultimo ? ahora - ultimo.ts : null
  const pasoMasLejano = conPausas.reduce(
    (max, e) => (e.step != null && (max == null || e.step > max) ? e.step : max),
    pro.onboardingStep ?? null,
  )

  let estado
  if (pro.isVerified || verificacion) estado = 'verificado'
  else if (rechazo && (!envio || rechazo.ts > envio.ts)) estado = 'rechazado'
  else if (envio) estado = 'esperando_verificacion'
  else if (inactividadMs != null && inactividadMs > ABANDONO_MS) estado = 'abandonado'
  else estado = 'en_curso'

  return {
    eventos: conPausas,
    inicioMs,
    finMs,
    estado,
    pasoMasLejano,
    // Cuánto tardó desde que creó la cuenta hasta que mandó el legajo.
    tiempoHastaEnvioMs: envio && inicioMs != null ? envio.ts - inicioMs : null,
    // Cuánto esperó (o lleva esperando) la revisión del admin.
    tiempoDeRevisionMs: envio ? (verificacion?.ts ?? rechazo?.ts ?? ahora) - envio.ts : null,
    inactividadMs,
    // Cada vez que volvió después de una pausa larga: es el "dónde retomó".
    retomadas: conPausas.filter(e => e.retomo),
    // La pausa más larga ATRIBUIBLE AL PROFESIONAL — dónde se frenó de verdad.
    // La espera por la revisión del admin se excluye a propósito: es tiempo
    // nuestro, no de él, y ya se reporta aparte en `tiempoDeRevisionMs`.
    pausaMasLarga: conPausas
      .filter(e => e.event !== 'verified' && e.event !== 'rejected')
      .reduce((max, e) => (e.pausaMs > (max?.pausaMs ?? 0) ? e : max), null),
    envio,
    verificacion,
    rechazo,
  }
}

export const ESTADO_META = {
  verificado:            { label: 'Verificado',        cls: 'bg-green-100 text-green-700' },
  esperando_verificacion:{ label: 'Esperando revisión', cls: 'bg-amber-100 text-amber-700' },
  rechazado:             { label: 'Devuelto',          cls: 'bg-red-100 text-red-700' },
  en_curso:              { label: 'En curso',          cls: 'bg-blue-100 text-blue-700' },
  abandonado:            { label: 'Frenado',           cls: 'bg-gray-100 text-gray-600' },
}

/** Una línea que resume el recorrido, para leer sin abrir el detalle. */
export function resumenRecorrido(r) {
  const partes = []
  if (r.tiempoHastaEnvioMs != null) {
    partes.push(`Envió el legajo ${formatearDuracion(r.tiempoHastaEnvioMs)} después de registrarse`)
  } else if (r.pasoMasLejano != null) {
    partes.push(`Llegó hasta "${STEP_LABELS[r.pasoMasLejano] ?? `Paso ${r.pasoMasLejano}`}"`)
  }
  if (r.retomadas.length) {
    partes.push(`retomó ${r.retomadas.length} ${r.retomadas.length === 1 ? 'vez' : 'veces'}`)
  }
  if (r.estado === 'esperando_verificacion' && r.tiempoDeRevisionMs != null) {
    partes.push(`esperando revisión hace ${formatearDuracion(r.tiempoDeRevisionMs)}`)
  } else if (r.estado !== 'verificado' && r.inactividadMs != null) {
    partes.push(`sin actividad hace ${formatearDuracion(r.inactividadMs)}`)
  }
  return partes.join(' · ')
}
