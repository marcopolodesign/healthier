// Código de referido del profesional, guardado entre la visita a `/r/<codigo>`
// y el alta. Mismo mecanismo que `lib/utms.js` — y con el mismo TTL, para que
// las dos atribuciones caduquen juntas y no queden contradiciéndose.
const STORAGE_KEY = 'healthier_referral'
const TS_KEY = 'healthier_referral_ts'
const TTL_MS = 30 * 24 * 60 * 60 * 1000

function isExpired() {
  const ts = localStorage.getItem(TS_KEY)
  return ts ? (Date.now() - parseInt(ts)) > TTL_MS : false
}

/**
 * Se llama al resolver el link, con el dueño del código ya confirmado por la base.
 * `tipo` = 'profesional' | 'paciente' | 'socio' (socio comercial, ej. LIFT). `professionalId` queda sólo para el link del profesional.
 */
export function storeReferral({ codigo, tipo = 'profesional', professionalId = null, professionalName = null, nombre = null, descuento = null }, { conservarTs = false } = {}) {
  if (!codigo) return
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    codigo, tipo, professionalId, professionalName, nombre: nombre ?? professionalName, descuento,
  }))
  // `conservarTs`: completar datos del mismo link (ej. el % del socio) no
  // tiene que estirarle la vigencia.
  if (!conservarTs || !localStorage.getItem(TS_KEY)) localStorage.setItem(TS_KEY, String(Date.now()))
}

export function getStoredReferral() {
  if (isExpired()) { clearReferral(); return null }
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') }
  catch { return null }
}

export function clearReferral() {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(TS_KEY)
  try { sessionStorage.removeItem(SOCIO_SESION_KEY) } catch { /* sin storage */ }
}

// ── Link de socio comercial abierto en ESTA sesión del navegador ────────────
// El canje automático después del login (App.jsx) sólo corre si la persona
// pasó por /r/<codigo> en esta misma pestaña/sesión: un link viejo guardado en
// localStorage no atribuye a nadie que entre otro día.
const SOCIO_SESION_KEY = 'healthier_socio_link_sesion'
const ALTA_KEY = 'healthier_alta_en_curso'

export function marcarLinkDeSocioEnSesion(codigo) {
  try { sessionStorage.setItem(SOCIO_SESION_KEY, codigo) } catch { /* sin storage */ }
}

export function linkDeSocioEnSesion() {
  try { return sessionStorage.getItem(SOCIO_SESION_KEY) } catch { return null }
}

// Mientras el alta (Register / CompleteProfile) hace su propio canje, el
// automático no corre: manda el código que la persona eligió o cambió ahí.
export function marcarAltaEnCurso(enCurso) {
  try {
    if (enCurso) sessionStorage.setItem(ALTA_KEY, '1')
    else sessionStorage.removeItem(ALTA_KEY)
  } catch { /* sin storage */ }
}

export function altaEnCurso() {
  try { return sessionStorage.getItem(ALTA_KEY) === '1' } catch { return false }
}

/**
 * UTMs equivalentes al link de referido.
 *
 * Se mezclan con las UTMs reales al registrarse para que el link aparezca como
 * un canal más en los reportes que ya existen, en vez de ser un dato paralelo
 * que hay que acordarse de cruzar. Las UTMs explícitas de la URL ganan: si
 * alguien mandó el link dentro de una campaña paga, la campaña es la fuente.
 */
export function referralUtms(referral) {
  if (!referral) return {}
  if (referral.tipo === 'socio') {
    return { utm_source: 'socio', utm_medium: 'link_del_socio', utm_campaign: referral.codigo }
  }
  const paciente = referral.tipo === 'paciente'
  return {
    utm_source: paciente ? 'referido_paciente' : 'referido_profesional',
    utm_medium: paciente ? 'link_del_paciente' : 'link_del_profesional',
    utm_campaign: referral.codigo,
  }
}

// ── Canje que no llegó a hacerse ────────────────────────────────────────────
// Si `canjear_codigo` falla por red o por un 5xx (`motivo: 'error'`) el código
// NO se tira: queda acá y se reintenta en el próximo arranque con sesión de
// paciente. El servidor decide cuándo ya no vale (ya consultó, ya tiene
// referente…): recién ahí se borra.
const PENDIENTE_KEY = 'healthier_canje_pendiente'

export function guardarCanjePendiente({ codigo, via = 'codigo' }) {
  if (!codigo) return
  try { localStorage.setItem(PENDIENTE_KEY, JSON.stringify({ codigo, via })) } catch { /* sin storage */ }
}

export function leerCanjePendiente() {
  try { return JSON.parse(localStorage.getItem(PENDIENTE_KEY) ?? 'null') } catch { return null }
}

export function borrarCanjePendiente() {
  try { localStorage.removeItem(PENDIENTE_KEY) } catch { /* sin storage */ }
}

/** Llama a `canjear()` y, si da error de red/servidor, reintenta UNA vez. */
export async function canjearConReintento(canjear) {
  const r = await canjear()
  return r?.motivo === 'error' ? await canjear() : r
}
