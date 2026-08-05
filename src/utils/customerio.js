// Customer.io CDP — capa de mensajería (email + WhatsApp al profesional).
//
// ⚠️ Esto NO es lo mismo que `utils/analytics.js`, y la diferencia es a propósito.
//
//   • analytics.js → GTM/GA4. Plataforma publicitaria. Cero PII, siempre.
//   • customerio.js → Customer.io. Herramienta de mensajería bajo contrato de
//     encargado de tratamiento. NECESITA email, teléfono y nombre — sin eso no
//     puede mandar el mail ni el WhatsApp, que es literalmente para lo que está.
//
// Lo que sí sigue prohibido acá es el DATO DE SALUD (Ley 25.326 art. 8, datos
// sensibles): diagnósticos, alergias, medicación, motivo de consulta, contenido
// de chat o de documentos, y — clave — la ESPECIALIDAD asociada a un paciente.
// "paciente@x.com + cardiólogo" permite inferir una condición de salud de una
// persona identificada; eso no sale de la plataforma.
//
// La especialidad SÍ viaja, pero sólo como atributo del PROFESIONAL (dato
// profesional público, no de salud). En los eventos del paciente va el
// `professional_id` y el nombre; la especialidad se resuelve del lado de
// Customer.io mirando el perfil del médico. Decisión de Mateo (2026-08-05).
//
// Identificador de persona = `profiles.id` (uuid de Supabase), con email y
// teléfono como traits. Es lo que permite que un evento del paciente traiga
// `professional_id` y que Customer.io matchee esa persona para mandarle el
// WhatsApp al médico.

const GLOBAL = 'cioanalytics'

export const ROLE_TO_USER_TYPE = {
  patient: 'paciente',
  professional: 'profesional',
  admin: 'admin',
  super_admin: 'super_admin',
}

/** El snippet crea `window.cioanalytics` y encola llamadas hasta que carga. */
function cio() {
  const a = typeof window !== 'undefined' ? window[GLOBAL] : null
  return a && typeof a.track === 'function' ? a : null
}

// ── Guardas de datos sensibles ─────────────────────────────────────────────

// Claves que nunca salen en el payload de un evento. `specialty`/`vertical`
// están acá a propósito: son datos de salud EN EL CONTEXTO DE UN PACIENTE.
// Para el profesional entran por `cioIdentifyProfessional`, que usa otra guarda.
const HEALTH_KEY_PATTERN =
  /allerg|alerg|diagnos|symptom|sintoma|síntoma|medicat|medicaci|prescription|receta|blood|sangre|condition|clinical|clinica|clínica|historia|triage|icd|loinc|observ|motivo|reason|note|nota|message|mensaje|chat|document|doc_type|vertical|specialty|especialidad/i

// Texto largo = riesgo de texto clínico libre metido en un campo cualquiera.
const MAX_STRING_LEN = 120

function isSafeValue(value) {
  if (typeof value === 'string') return value.length <= MAX_STRING_LEN
  return ['number', 'boolean'].includes(typeof value) || value === null
}

/** Filtra un payload de evento: fuera datos de salud y texto libre largo. */
export function sanitizeEventProps(props = {}) {
  const clean = {}
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue
    // Booleanos y números no pueden filtrar texto clínico, así que pasan aunque
    // el nombre matchee (ej. `has_notes: true` sí, `notes: "..."` no).
    const typeIsInert = typeof value === 'boolean' || typeof value === 'number'
    if (!typeIsInert && HEALTH_KEY_PATTERN.test(key)) continue
    if (!isSafeValue(value)) continue
    clean[key] = value
  }
  return clean
}

function compact(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  )
}

// ── Teléfono → E.164 ───────────────────────────────────────────────────────

/**
 * Customer.io necesita E.164 para mandar WhatsApp; en la base los teléfonos
 * están cargados a mano y vienen de cualquier forma ("11 5555-0000", "011...",
 * "+54 9 11...").
 *
 * Reglas aplicadas (Argentina):
 *   • Ya empieza con "+" → se respeta tal cual, sólo se limpian separadores.
 *   • Empieza con 54 → se le antepone "+".
 *   • 10 dígitos (área + número, sin 0 y sin 15) → "+549" + número. El 9 es
 *     obligatorio para móviles argentinos en WhatsApp.
 *   • Se sacan el 0 inicial de larga distancia y el 15 de celular.
 *
 * Si no cae en ningún caso se manda `phone_raw` igual, para no perder el dato
 * y poder corregirlo desde Customer.io.
 */
export function toE164Ar(raw) {
  if (!raw) return null
  const trimmed = String(raw).trim()
  if (trimmed.startsWith('+')) return '+' + trimmed.slice(1).replace(/\D/g, '')

  let digits = trimmed.replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('54')) return '+' + digits
  if (digits.startsWith('0')) digits = digits.slice(1)
  // 15 de celular: va después del código de área (2 a 4 dígitos).
  digits = digits.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2')
  if (digits.length === 10) return '+549' + digits
  return null
}

function toUnixSeconds(value) {
  if (!value) return undefined
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined
}

// ── Identify ───────────────────────────────────────────────────────────────

let lastIdentifiedId = null

/**
 * Identifica a la persona en Customer.io. Se llama en TODOS los puntos de
 * entrada de sesión (login email, Google, registro, restore de sesión y alta
 * de perfil) porque todos terminan seteando `profile` en App.jsx.
 *
 * @param {object} profile — fila de `profiles` en camelCase
 * @param {object} [extraTraits] — atributos extra ya sanitizados por el caller
 */
export function cioIdentify(profile, extraTraits = {}) {
  const a = cio()
  if (!a || !profile?.id) return

  const phone = toE164Ar(profile.phone)
  a.identify(String(profile.id), compact({
    email:      profile.email,
    name:       profile.fullName ?? profile.full_name,
    phone,
    phone_raw:  phone ? undefined : profile.phone,
    role:       profile.role,
    user_type:  ROLE_TO_USER_TYPE[profile.role] ?? profile.role,
    created_at: toUnixSeconds(profile.createdAt ?? profile.created_at),
    ...extraTraits,
  }))
  lastIdentifiedId = String(profile.id)
}

/**
 * Atributos extra del profesional. Acá SÍ entra la especialidad: es un dato
 * profesional del médico, no un dato de salud de un paciente.
 */
export function cioIdentifyProfessional(profile, professionalProfile = {}) {
  cioIdentify(profile, compact({
    specialty:              professionalProfile.specialty,
    sub_specialty:          professionalProfile.subSpecialty ?? professionalProfile.sub_specialty,
    professional_profile_id: professionalProfile.id,
    is_verified:            professionalProfile.isVerified ?? professionalProfile.is_verified,
    is_on_demand:           professionalProfile.isOnDemand ?? professionalProfile.is_on_demand,
    session_price:          professionalProfile.sessionPrice ?? professionalProfile.session_price,
  }))
}

/** Logout — corta la sesión anónima para que el próximo usuario no herede identidad. */
export function cioReset() {
  const a = cio()
  if (!a || typeof a.reset !== 'function') return
  a.reset()
  lastIdentifiedId = null
}

export function cioIdentifiedId() {
  return lastIdentifiedId
}

// ── Track / page ───────────────────────────────────────────────────────────

/**
 * Evento a Customer.io. El payload pasa siempre por `sanitizeEventProps`.
 * `page_path` se agrega solo — casi todo evento lo quiere y nadie se acuerda.
 */
export function cioTrack(event, props = {}) {
  const a = cio()
  if (!a) return
  a.track(event, {
    ...sanitizeEventProps(props),
    page_path: typeof window !== 'undefined' ? normalizePath(window.location.pathname) : undefined,
  })
}

/** Pageview de SPA. El snippet ya dispara la primera; ésta cubre las rutas. */
export function cioPage(pathname, props = {}) {
  const a = cio()
  if (!a || typeof a.page !== 'function') return
  const path = normalizePath(pathname)
  a.page(path, sanitizeEventProps({ page_path: path, ...props }))
}

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * La URL cruda no se puede mandar tal cual: `/paciente/ondemand/dermatologia`
 * lleva la especialidad en el path, o sea el dato de salud del paciente metido
 * en el `page_path` de cada evento de esa pantalla. Se enmascara ese segmento,
 * y de paso los uuid, para que las rutas agrupen bien en Customer.io en vez de
 * generar una página distinta por consulta.
 */
export function normalizePath(pathname = '') {
  const masked = String(pathname)
    .split('/')
    .map((seg) => (UUID_SEGMENT.test(seg) ? ':id' : seg))
    .join('/')
  return masked.replace(/^\/paciente\/ondemand\/[^/]+/, '/paciente/ondemand/:vertical')
}

/** Igual que normalizePath pero para una URL completa. */
function normalizeUrl(url) {
  try {
    const u = new URL(url)
    u.pathname = normalizePath(u.pathname)
    u.search = '' // los query params nunca son necesarios y sí pueden traer PII
    return u.toString()
  } catch {
    return url
  }
}

const URL_FIELDS = ['url', 'referrer']
const PATH_FIELDS = ['path', 'name']

function maskUrlFields(obj) {
  if (!obj || typeof obj !== 'object') return
  for (const f of URL_FIELDS) if (typeof obj[f] === 'string') obj[f] = normalizeUrl(obj[f])
  for (const f of PATH_FIELDS) if (typeof obj[f] === 'string' && obj[f].startsWith('/')) obj[f] = normalizePath(obj[f])
}

let maskingInstalled = false

/**
 * El SDK adjunta `context.page.url/path/referrer` a TODOS los eventos por su
 * cuenta, con la URL cruda del browser. En `/paciente/ondemand/dermatologia`
 * eso mete la especialidad del paciente en cada evento de esa pantalla, por
 * más que nuestro `page_path` vaya enmascarado.
 *
 * Este middleware corre sobre todo lo que sale — incluyendo lo que genera el
 * propio SDK — así que es el único lugar donde el enmascarado es completo.
 * Se instala antes que nada en App.jsx.
 */
export function installPathMasking() {
  const a = cio()
  if (!a || maskingInstalled || typeof a.addSourceMiddleware !== 'function') return
  maskingInstalled = true
  a.addSourceMiddleware(({ payload, next }) => {
    maskUrlFields(payload?.obj?.context?.page)
    maskUrlFields(payload?.obj?.properties)
    next(payload)
  })
}

// ── Auto-capture de clicks ─────────────────────────────────────────────────

const CLICKABLE = 'button, a, [role="button"], [data-cio-event]'

// Rutas donde el TEXTO de un botón es, en sí mismo, dato de salud: el nombre
// de un estudio en la bóveda, una categoría de la historia clínica, un síntoma
// del triage, un medicamento en farmacia, un mensaje del chat de IA.
//
// Es un guard por RUTA y no un `data-cio-ignore` por componente a propósito:
// una pantalla clínica nueva bajo cualquiera de estos prefijos queda protegida
// sola, sin depender de que alguien se acuerde de poner el atributo.
//
// En estas rutas el click se sigue contando (cuántos, en qué sección) pero SIN
// label, sin href y sin test_id — sólo la forma, nunca el contenido.
const CLINICAL_ROUTES =
  /^\/(paciente\/(documentos|ia|biovisor|nutriplan|farmacia|salud|historia-clinica|ondemand|sos|fastpass|videollamada|consulta)|profesional\/(consulta|historia-clinica|nutriplan|paciente|emergencias|videollamada))/

function isClinicalRoute() {
  return CLINICAL_ROUTES.test(window.location.pathname)
}

let autocaptureInstalled = false

function labelFor(el) {
  const explicit = el.dataset?.cioLabel || el.getAttribute('aria-label') || el.getAttribute('title')
  const text = (explicit || el.textContent || '').replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  // Un label largo casi nunca es un botón: es una card entera con contenido
  // adentro. Ese contenido puede ser clínico, así que no se manda.
  return text.length <= 60 ? text : undefined
}

function sectionFor(el) {
  const explicit = el.closest('[data-cio-section]')?.dataset?.cioSection
  if (explicit) return explicit
  // Fallback: primeros dos segmentos de la ruta (/paciente/consultas → paciente_consultas)
  return window.location.pathname.split('/').filter(Boolean).slice(0, 2).join('_') || 'home'
}

function onDocumentClick(e) {
  const el = e.target?.closest?.(CLICKABLE)
  if (!el || el.closest('[data-cio-ignore]')) return

  const isLink = el.tagName === 'A'
  const event = el.dataset?.cioEvent || (isLink ? 'link_clicked' : 'button_clicked')

  // Cualquier data-cio-prop-* del elemento entra como propiedad del evento.
  const extra = {}
  for (const [key, value] of Object.entries(el.dataset || {})) {
    if (key.startsWith('cioProp')) {
      const name = key.slice('cioProp'.length).replace(/^[A-Z]/, (c) => c.toLowerCase())
      extra[name.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())] = value
    }
  }

  // En ruta clínica se manda la forma del click, nunca su contenido.
  const clinical = isClinicalRoute()

  cioTrack(event, {
    label:      clinical ? undefined : labelFor(el),
    section:    sectionFor(el),
    element:    el.tagName.toLowerCase(),
    test_id:    clinical ? undefined : el.dataset?.testid,
    href:       !clinical && isLink ? el.getAttribute('href') : undefined,
    page_title: clinical ? undefined : document.title,
    is_clinical_area: clinical || undefined,
    ...extra,
  })
}

/**
 * Captura TODOS los clicks en botones y links del sitio, sin tocar los
 * componentes. Fase de captura para que un `stopPropagation()` de un handler
 * de React no se coma el evento.
 *
 * Para excluir una zona clínica: `<div data-cio-ignore>`.
 * Para nombrar un botón: `data-cio-event="reserva_click"`.
 * Para agregarle datos: `data-cio-prop-modality="video"`.
 */
export function installClickAutocapture() {
  if (autocaptureInstalled || typeof document === 'undefined') return () => {}
  autocaptureInstalled = true
  document.addEventListener('click', onDocumentClick, true)
  return () => {
    document.removeEventListener('click', onDocumentClick, true)
    autocaptureInstalled = false
  }
}
