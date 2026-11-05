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
    }
  })
}
