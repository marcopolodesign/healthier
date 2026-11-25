// ---------------------------------------------------------------------------
// Recorrido de navegación (`flow_url`)
//
// Graba cada pantalla que ve la persona para poder medir por dónde pasó antes
// de registrarse y antes de reservar. Mismo concepto que `flow_url` de BIGG
// (bigg-21/assets/js/main.js): array de { url, name, at }. La app mobile guarda
// la misma forma (mobile/src/lib/flowUrl.ts), con `url` = `app:/ruta`.
//
// PRIVACIDAD — es una app de salud, así que lo que se guarda es lo mínimo:
//   · `url` = origin + pathname (+ utm_* de lista blanca). Nunca el resto de la
//     query (mails, tokens, códigos de magic link, `code`, `token_hash`, DNI…),
//     nunca el hash.
//   · Los segmentos que identifican a alguien (uuid, números largos, mails) se
//     reemplazan por `:id`; el código de un link de referido, por `:codigo`.
//   · Se borra al cerrar sesión, para que el recorrido de una persona no
//     termine pegado al alta de otra que usa el mismo navegador.
//
// Es SPA: se registra en cada cambio de ruta (FlowUrlTracker, en App.jsx), no
// sólo en la carga de la página.
// ---------------------------------------------------------------------------

export const FLOW_KEY = 'healthier_flow'
export const FLOW_RESERVA_KEY = 'healthier_flow_reserva'
export const FLOW_MAX = 40
const FLOW_TTL_MS = 30 * 24 * 60 * 60 * 1000

export const UTM_PERMITIDOS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id']

// Pantallas conocidas (ruta ya normalizada → nombre legible). Lo que no está
// acá se nombra por su ruta.
const PANTALLAS = [
  ['/', 'Inicio'],
  ['/landing/pediatria', 'Landing pediatría'],
  ['/landing/sin-cobertura-medica', 'Landing sin cobertura médica'],
  ['/landing/medico-online', 'Landing médico online'],
  ['/landing/profesionales', 'Landing profesionales'],
  ['/r/:codigo', 'Link de referido'],
  ['/guia', 'Guía de uso'],
  ['/guia/:x', 'Guía de uso'],
  ['/login', 'Ingresar'],
  ['/registro', 'Registro de paciente'],
  ['/registro-profesional', 'Registro de profesional'],
  ['/completar-registro', 'Completar registro'],
  ['/recuperar-contrasena', 'Recuperar contraseña'],
  ['/restablecer-contrasena', 'Restablecer contraseña'],
  ['/reactivar-cuenta', 'Reactivar cuenta'],
  ['/acceso-familiar', 'Acceso familiar'],
  ['/paciente/onboarding', 'Onboarding del paciente'],
  ['/paciente/dashboard', 'Inicio del paciente'],
  ['/paciente/consultas', 'Mis consultas'],
  ['/paciente/documentos', 'Mis documentos'],
  ['/paciente/perfil', 'Perfil del paciente'],
  ['/paciente/invitar', 'Invitar'],
  ['/paciente/familiar/:id', 'Ficha de familiar'],
  ['/paciente/ondemand/:x', 'Consulta inmediata'],
  ['/paciente/sos', 'Emergencias'],
  ['/paciente/notificaciones', 'Notificaciones'],
  ['/paciente/buscar-disponibles', 'Profesionales disponibles'],
  ['/paciente/buscar', 'Buscar profesional'],
  ['/paciente/profesional/:id', 'Perfil del profesional'],
  ['/paciente/biovisor', 'BioVisor'],
  ['/paciente/nutriplan', 'NutriPlan'],
  ['/paciente/farmacia', 'Farmacia'],
  ['/paciente/farmacia/checkout', 'Farmacia: checkout'],
  ['/paciente/farmacia/pago', 'Farmacia: pago'],
  ['/paciente/farmacia/pedidos', 'Farmacia: mis pedidos'],
  ['/paciente/farmacia/pedido/:id', 'Farmacia: pedido'],
  ['/paciente/comprobantes', 'Comprobantes'],
  ['/paciente/videollamada/:id', 'Videollamada'],
  ['/paciente/reservar', 'Reservar consulta'],
  ['/paciente/sala-espera/:id', 'Sala de espera'],
  ['/paciente/pago', 'Pago de la consulta'],
  ['/paciente/agregar-tarjeta', 'Agregar tarjeta'],
  ['/paciente/consulta/review/:id', 'Opinión de la consulta'],
  ['/paciente/consulta/resumen/:id', 'Resumen de la consulta'],
  ['/paciente/recetas', 'Mis recetas'],
  ['/paciente/certificados', 'Mis certificados'],
  ['/paciente/ordenes-estudios', 'Mis órdenes de estudios'],
  ['/paciente/derivaciones/:id', 'Derivación'],
  ['/paciente/receta/:id', 'Receta'],
  ['/paciente/historia-clinica', 'Historia clínica'],
  ['/paciente/ia', 'Asistente de salud'],
  ['/paciente/fastpass', 'Fila de espera'],
  ['/paciente/salud', 'Resumen de salud'],
  ['/paciente/turno-confirmado/:id', 'Turno confirmado'],
  ['/paciente/camino/:id', 'Camino al consultorio'],
  ['/profesional/onboarding', 'Onboarding del profesional'],
  ['/profesional/dashboard', 'Inicio del profesional'],
  ['/profesional/agenda', 'Agenda'],
  ['/profesional/perfil', 'Perfil del profesional (edición)'],
  ['/profesional/consulta/:id', 'Detalle de consulta'],
  ['/profesional/atencion/:id', 'Atención'],
  ['/profesional/videollamada/:id', 'Videollamada'],
  ['/profesional/emergencias', 'Emergencias (profesional)'],
]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX_LARGO = /^[0-9a-f]{20,}$/i

/** ¿Este segmento de la ruta identifica a alguien o algo puntual? */
function esDatoPuntual(seg) {
  let s = seg
  try { s = decodeURIComponent(seg) } catch { /* queda tal cual */ }
  return UUID.test(s)
    || HEX_LARGO.test(s)
    || /^\d{5,}$/.test(s)          // DNI, ids numéricos
    || /[@\s]/.test(s)             // mails, nombres
    || s.length > 40               // tokens
}

/** Ruta sin datos personales: ids → `:id`, código de referido → `:codigo`. */
export function normalizarRuta(pathname) {
  const segs = String(pathname || '/').split('/').filter(Boolean)
  const limpia = segs.map((seg, i) => {
    if (segs[0] === 'r' && i === 1) return ':codigo'
    return esDatoPuntual(seg) ? ':id' : seg
  })
  return '/' + limpia.join('/')
}

/** Nombre legible de una ruta ya normalizada. */
export function nombreDePantalla(rutaNormalizada) {
  const exacta = PANTALLAS.find(([r]) => r === rutaNormalizada)
  if (exacta) return exacta[1]
  // `/x/:x` (un segmento libre al final, ej. /guia/paciente): se compara con
  // el último segmento comodín.
  const segs = rutaNormalizada.split('/')
  if (segs.length > 2) {
    const conComodin = [...segs.slice(0, -1), ':x'].join('/')
    const c = PANTALLAS.find(([r]) => r === conComodin)
    if (c) return c[1]
  }
  return rutaNormalizada
}

/**
 * URL a guardar: origin + ruta normalizada + utm_* permitidos. `base` es
 * 'https://staging.healthier.com.ar' en la web y 'app:' en la app.
 */
export function urlLimpia({ origin, pathname, search }) {
  const ruta = normalizarRuta(pathname)
  let qs = ''
  try {
    const params = new URLSearchParams(search || '')
    const q = new URLSearchParams()
    UTM_PERMITIDOS.forEach(k => {
      const v = params.get(k)
      if (v) q.set(k, v.slice(0, 120))
    })
    qs = q.toString()
  } catch { /* sin query */ }
  return `${origin || ''}${ruta}${qs ? `?${qs}` : ''}`
}

const ahoraISO = (ms = Date.now()) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

// ── Almacenamiento: sessionStorage + localStorage, con memoria de respaldo ──
let enMemoria = []
let marcaEnMemoria = null

function leerStorage(key) {
  try {
    return sessionStorage.getItem(key) || localStorage.getItem(key)
  } catch { return null }
}

function escribirStorage(key, raw) {
  try { sessionStorage.setItem(key, raw) } catch { /* webview sin storage */ }
  try { localStorage.setItem(key, raw) } catch { /* idem */ }
}

function borrarStorage(key) {
  try { sessionStorage.removeItem(key) } catch { /* idem */ }
  try { localStorage.removeItem(key) } catch { /* idem */ }
}

export function leerRecorrido() {
  try {
    const raw = leerStorage(FLOW_KEY)
    const arr = raw ? JSON.parse(raw) : enMemoria
    if (!Array.isArray(arr)) return []
    const limite = Date.now() - FLOW_TTL_MS
    return arr.filter(e => e && typeof e.url === 'string' && Date.parse(e.at) > limite)
  } catch {
    return enMemoria
  }
}

function guardarRecorrido(flujo) {
  enMemoria = flujo
  escribirStorage(FLOW_KEY, JSON.stringify(flujo))
}

/** Tope: se conserva la primera (la entrada, de donde vino) y las últimas. */
export function recortar(flujo, max = FLOW_MAX) {
  return flujo.length > max ? [flujo[0], ...flujo.slice(-(max - 1))] : flujo
}

/**
 * Anota la pantalla actual. Una recarga o una URL igual a la última no cuenta
 * como pantalla nueva. Nunca tira: un fallo acá no puede romper la navegación.
 */
export function registrarPantalla(loc = (typeof window !== 'undefined' ? window.location : null), ahora = Date.now()) {
  try {
    if (!loc) return
    const url = urlLimpia({ origin: loc.origin, pathname: loc.pathname, search: loc.search })
    ultimaPantalla = { url, name: nombreDePantalla(normalizarRuta(loc.pathname)) }
    anotarPantallaEnBase(ultimaPantalla, ahora)
    const flujo = leerRecorrido()
    const ultima = flujo[flujo.length - 1]
    if (ultima && ultima.url === url) return
    flujo.push({
      url,
      name: nombreDePantalla(normalizarRuta(loc.pathname)),
      at: ahoraISO(ahora),
    })
    guardarRecorrido(recortar(flujo))
  } catch { /* sin recorrido no pasa nada */ }
}

/** Olvida todo (cierre de sesión): el recorrido es de la persona, no del navegador. */
export function reiniciarRecorrido() {
  seguir = false
  ultimaUrlEnviada = null
  enMemoria = []
  marcaEnMemoria = null
  borrarStorage(FLOW_KEY)
  borrarStorage(FLOW_RESERVA_KEY)
}

function leerMarcaReserva() {
  try { return leerStorage(FLOW_RESERVA_KEY) || marcaEnMemoria } catch { return marcaEnMemoria }
}

/** Lo que pasó desde la última reserva (o todo, si es la primera). */
export function recorridoDesdeUltimaReserva() {
  const flujo = leerRecorrido()
  const marca = leerMarcaReserva()
  if (!marca) return flujo
  const nuevo = flujo.filter(e => e.at > marca)
  return nuevo.length ? nuevo : flujo.slice(-1)
}

// ── Después del alta: cada pantalla del paciente logueado va a la base ─────
// (migración 247, tabla `recorrido_paciente`). `profiles.flow_url` se escribe
// una sola vez al terminar el alta; sin esto no se sabe qué hace el paciente
// después. Tope y duplicados los resuelve la RPC (últimas 100 pantallas + 50
// hitos; misma pantalla que la anterior no cuenta); acá sólo se evita mandar
// dos veces seguidas lo mismo.

/** Hitos del embudo: código (el que se guarda) → nombre legible. Mismos que la app. */
export const HITOS = {
  vio_lista_profesionales: 'Vio la lista de profesionales',
  eligio_profesional: 'Eligió profesional',
  vio_horarios: 'Vio horarios',
  eligio_horario: 'Eligió horario',
  sin_disponibilidad: 'Sin disponibilidad',
  llego_al_pago: 'Llegó al pago',
  cargo_medio_de_pago: 'Cargó medio de pago',
  error_de_pago: 'Error de pago',
  pago: 'Pagó',
  pidio_inmediata: 'Pidió consulta inmediata',
}

/**
 * Evento de analítica (`track`, src/utils/analytics.js) → hito. Así los hitos
 * salen de los mismos lugares que ya miden el embudo para GTM/Customer.io, sin
 * sumar llamadas en cada pantalla.
 */
export const HITO_DE_EVENTO = {
  booking_pros_view: 'vio_lista_profesionales',
  booking_pro_select: 'eligio_profesional',
  doctor_selected: 'eligio_profesional',
  map_pro_click: 'eligio_profesional',
  booking_slots_view: 'vio_horarios',
  booking_slot_select: 'eligio_horario',
  booking_no_availability: 'sin_disponibilidad',
  ondemand_no_match: 'sin_disponibilidad',
  begin_checkout: 'llego_al_pago',
  add_payment_info: 'cargo_medio_de_pago',
  payment_error: 'error_de_pago',
  purchase: 'pago',
  ondemand_requested: 'pidio_inmediata',
}

let seguir = false           // ¿hay un paciente logueado?
let ultimaUrlEnviada = null  // para no mandar dos veces seguidas la misma pantalla
let ultimaPantalla = null    // { url, name } — dónde ocurre un hito
let envio = Promise.resolve()
let clienteRecorrido = null  // inyectable (tests); si no, el de la app

function enviarABase(entrada) {
  // En fila: el orden de llegada es el orden del recorrido.
  envio = envio.then(async () => {
    try {
      const client = clienteRecorrido ?? (await import('./supabase')).supabase
      await client.rpc('anotar_recorrido', { p_entradas: [entrada] })
    } catch { /* best-effort */ }
  })
  return envio
}

function anotarPantallaEnBase(pantalla, ahora) {
  if (!seguir || !pantalla || pantalla.url === ultimaUrlEnviada) return null
  ultimaUrlEnviada = pantalla.url
  return enviarABase({ ...pantalla, at: ahoraISO(ahora), via: 'web' })
}

/**
 * Prende o apaga el envío a la base (App.jsx, cuando cambia el perfil). Al
 * prenderse manda la pantalla actual: en la primera carga la ruta se anota
 * antes de que el perfil termine de cargar.
 */
export function seguirRecorridoDelPaciente(activo, client) {
  if (client) clienteRecorrido = client
  const antes = seguir
  seguir = Boolean(activo)
  if (!seguir) { ultimaUrlEnviada = null; return null }
  if (!antes && ultimaPantalla) return anotarPantallaEnBase(ultimaPantalla, Date.now())
  return null
}

/** Hito del embudo en la pantalla actual. Sólo con un paciente logueado. */
export function anotarHito(hito, ahora = Date.now()) {
  if (!seguir || !HITOS[hito]) return null
  const url = ultimaPantalla?.url ?? (typeof window !== 'undefined' ? urlLimpia(window.location) : '')
  if (!url) return null
  return enviarABase({ url, name: HITOS[hito], at: ahoraISO(ahora), via: 'web', hito })
}

// ── Guardado en la base (siempre best-effort: nunca rompe el alta ni la reserva) ──

/** Alta: el recorrido completo hasta ahora. Una sola vez (la RPC no pisa). */
export async function guardarEnPerfil(client) {
  try {
    client ??= (await import('./supabase')).supabase
    const flujo = leerRecorrido()
    if (!flujo.length) return false
    const { data, error } = await client.rpc('registrar_flow_url_perfil', { p_flow: flujo })
    return !error && data === true
  } catch { return false }
}

/** Reserva: el recorrido desde la reserva anterior. Después se corre la marca. */
export async function guardarEnConsulta(consultationId, client) {
  try {
    client ??= (await import('./supabase')).supabase
    if (!consultationId) return false
    const flujo = recorridoDesdeUltimaReserva()
    if (!flujo.length) return false
    const { data, error } = await client.rpc('registrar_flow_url_consulta', { p_consultation_id: consultationId, p_flow: flujo })
    if (error) return false
    const marca = flujo[flujo.length - 1].at
    marcaEnMemoria = marca
    escribirStorage(FLOW_RESERVA_KEY, marca)
    return data === true
  } catch { return false }
}

// ── Para mostrarlo (super admin) ──────────────────────────────────────────

const dos = n => String(n).padStart(2, '0')

/** "2 min", "45 s", "1 h 5 min". */
export function formatearEspera(ms) {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}

/** Filas listas para pintar: hora · pantalla · ruta · tiempo desde el paso anterior. */
export function filasDelRecorrido(flow) {
  if (!Array.isArray(flow)) return []
  return flow.map((e, i) => {
    const t = Date.parse(e?.at)
    const d = Number.isFinite(t) ? new Date(t) : null
    const anterior = i > 0 ? Date.parse(flow[i - 1]?.at) : NaN
    let ruta = String(e?.url ?? '')
    try { const u = new URL(ruta); ruta = u.pathname + u.search } catch { ruta = ruta.replace(/^app:/, '') }
    return {
      hora: d ? d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' }) : '—',
      pantalla: e?.name || ruta,
      ruta,
      espera: i > 0 && Number.isFinite(t) && Number.isFinite(anterior) ? formatearEspera(t - anterior) : '',
      via: e?.via || '',
      hito: e?.hito || '',
    }
  })
}
