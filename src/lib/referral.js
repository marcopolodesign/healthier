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

/** Se llama al resolver el link, con el profesional ya confirmado por la base. */
export function storeReferral({ codigo, professionalId, professionalName }) {
  if (!codigo || !professionalId) return
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ codigo, professionalId, professionalName }))
  localStorage.setItem(TS_KEY, String(Date.now()))
}

export function getStoredReferral() {
  if (isExpired()) { clearReferral(); return null }
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') }
  catch { return null }
}

export function clearReferral() {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(TS_KEY)
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
  return {
    utm_source: 'referido_profesional',
    utm_medium: 'link_del_profesional',
    utm_campaign: referral.codigo,
  }
}
