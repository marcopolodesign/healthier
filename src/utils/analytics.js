// GTM / dataLayer tracking helper — spec by Henry (Hyppo), 2026-07-27.
//
// CRITICAL — Ley 25.326 (health data): never push PII or health data here.
// No plaintext email/name/phone/DNI/address, no payment card numbers, no
// blood type/allergies/diagnoses, no chat or document content. Only a
// hashed user_id, categories/types, booleans, and generic payment methods.

import { cioTrack } from './customerio'

export const ROLE_TO_USER_TYPE = {
  patient: 'paciente',
  professional: 'profesional',
  admin: 'admin',
  super_admin: 'super_admin',
}

let hashedUserId
let userType

/**
 * Query param + campo de evento para la señal de INTENCIÓN al entrar a
 * `/login` desde un link que ya sabe a qué público apunta (ej. la landing de
 * Profesionales manda `?entry_intent=profesional`). Deliberadamente NO se
 * llama `flow` ni `role`: en el momento en que se lee, el usuario todavía no
 * escribió el email — no es un rol confirmado, es de dónde vino el click.
 * Cualquiera puede entrar por el link "equivocado" y loguearse con el otro
 * rol. El rol real recién se conoce en `login_success`, con `profile.role`.
 */
export const LOGIN_ENTRY_INTENT_PARAM = 'entry_intent'

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Call once profile is known (login, session restore). */
export async function setAnalyticsUser(profile) {
  if (!profile?.id) {
    clearAnalyticsUser()
    return
  }
  hashedUserId = await sha256Hex(profile.id)
  userType = ROLE_TO_USER_TYPE[profile.role] ?? profile.role ?? undefined
}

/** Call on logout. */
export function clearAnalyticsUser() {
  hashedUserId = undefined
  userType = undefined
}

// Safety net only — correct call sites (never passing PII in the first
// place) are the real defense. Catches accidental leaks by key name.
// `specialty`/`vertical` (which also catches `sub_specialty`) are here for the
// same reason HEALTH_KEY_PATTERN in customerio.js blocks them: attached to an
// identified patient they're health data, not just a profile attribute. They
// still reach Customer.io — but only via `cioIdentifyProfessional`'s identify
// traits, never via a dataLayer/GTM event.
const PII_KEY_PATTERN = /email|password|full[_-]?name|phone|address|dni|blood|allerg|diagnos|insurance|card[_-]?number|cvv|cbu|alias|specialty|vertical/i

function sanitize(params) {
  const clean = {}
  for (const [key, value] of Object.entries(params)) {
    // Booleans/numbers can't leak free-text content — only gate string/object
    // values by key name (e.g. block allergies:'penicilina' but allow the
    // has_allergies:false flag through even though its name matches "allerg").
    if (typeof value !== 'boolean' && typeof value !== 'number' && PII_KEY_PATTERN.test(key)) continue
    clean[key] = value
  }
  return clean
}

/**
 * Push an event to window.dataLayer. Never pass PII/health data in params.
 * `user_id`/`user_type` always come from the hashed session cache — never
 * pass either yourself. If an event needs the identity available the moment
 * it fires (e.g. right after login, before App.jsx's profile-effect would
 * otherwise pick it up), call `await setAnalyticsUser(profile)` first.
 *
 * `app_path` (never `page_path`): GTM already has a built-in "Page Path"
 * variable that reads `location.pathname` at the moment the TAG fires — not
 * when the event was generated. In a SPA those two moments can differ (a
 * redirect runs in between), and a param named the same as GTM's built-in
 * confuses anyone reading the debugger: Henry saw a `login_view` with
 * `page_path: '/login'` (our data, correct) next to the built-in "Page Path"
 * already showing `/paciente/dashboard` (the real browser URL, also
 * correct) and read the two as a contradiction. `app_path` doesn't collide
 * with any GTM built-in.
 */
export function track(eventName, params = {}, cioOnlyParams = {}) {
  // Fan-out a Customer.io con los params SIN sanitizar por PII — Customer.io
  // es mensajería y necesita la identidad real, al revés que GTM. Igual pasa
  // por su propia guarda de datos de salud (`sanitizeEventProps`), que es más
  // estricta en lo clínico y más laxa en lo personal. Va primero para que un
  // fallo del snippet no impida el push al dataLayer.
  //
  // `cioOnlyParams` es para lo que Customer.io necesita y GTM no puede recibir
  // —el nombre del profesional, por ejemplo—: se manda acá y nunca llega al
  // dataLayer, en vez de mandarlo a los dos y depender del filtro de PII.
  cioTrack(eventName, { ...params, ...cioOnlyParams })

  window.dataLayer = window.dataLayer || []
  const { user_id: _ignoredRawId, user_type: _ignoredRawType, ...rest } = sanitize(params)
  window.dataLayer.push({
    event: eventName,
    ...rest,
    user_id: hashedUserId,
    user_type: userType,
    timestamp: Date.now(),
  })
}

/** Generic payment-brand string for add_payment_info/purchase — never the card number. */
export function getPaymentMethod(chargeInfo) {
  return chargeInfo?.paymentMethodId || 'saved_card'
}

/** GA4 e-commerce line item for a single consultation (booking or on-demand). */
export function buildConsultaItem({ id, name, category, price }) {
  return [{ item_id: id, item_name: name, item_category: category, price, quantity: 1 }]
}
