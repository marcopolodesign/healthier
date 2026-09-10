#!/usr/bin/env node
/**
 * Arma una consulta lista para entrar a la videollamada, para poder probar las
 * dos puntas a la vez: la **app** haciendo de paciente y el **website** haciendo
 * de profesional.
 *
 * Por qué existe: la combinación app → web es la única que ninguna prueba
 * cubría, y es justo la que un profesional real usa siempre. El 2026-09-10
 * apareció así que el profesional se quedaba en "Esperando al paciente…" para
 * siempre, porque la app no publicaba su presencia — web ↔ web andaba, y por eso
 * había pasado desapercibido meses.
 *
 * Uso (desde `website/`):
 *   node scripts/seed-videollamada.mjs
 *   node scripts/seed-videollamada.mjs --paciente otro@mail --profesional otra@mail
 *   node scripts/seed-videollamada.mjs --entorno produccion    # ⚠️ crea una consulta real
 *
 * 🔴 El paciente TIENE que ser el que está logueado en la app. Para saber quién
 * es sin adivinar: `xcrun simctl openurl <sim> "healthier://profile"`.
 *
 * El procedimiento completo (simulador, Metro, deep links) está en
 * `docs/testing.md` → "Probar la videollamada de verdad: app ↔ web".
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const leerEnv = (ruta) => Object.fromEntries(
  readFileSync(ruta, 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

const arg = (nombre, porDefecto = null) => {
  const i = process.argv.indexOf(`--${nombre}`)
  return i === -1 ? porDefecto : process.argv[i + 1]
}

const aca = dirname(fileURLToPath(import.meta.url))
const ENTORNO = arg('entorno', 'staging')

let URL, KEY, WEB
if (ENTORNO === 'produccion') {
  const env = leerEnv(resolve(aca, '../.env'))
  URL = env.VITE_SUPABASE_URL
  KEY = env.SUPABASE_SERVICE_ROLE_KEY
  WEB = 'https://gethealthier.vercel.app'
} else {
  // Las credenciales de staging viven en el `.env` global, no en el del repo.
  const env = leerEnv(resolve(homedir(), 'Local/.env'))
  URL = env.HEALTHIER_STAGING_SUPABASE_URL
  KEY = env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
  WEB = 'https://gethealthier-staging.vercel.app'
}
if (!URL || !KEY) {
  console.error(`Faltan credenciales de ${ENTORNO}`)
  process.exit(1)
}

const PACIENTE = arg('paciente', ENTORNO === 'produccion'
  ? 'paciente@healthier.app'
  : 'paciente.completo@staging.healthier.app')
const PROFESIONAL = arg('profesional', ENTORNO === 'produccion'
  ? 'profesional@healthier.app'
  : 'clinica@staging.healthier.app')

const rest = async (path, opts = {}) => {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...opts.headers,
    },
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`${path} → ${res.status} ${txt}`)
  return txt ? JSON.parse(txt) : null
}

const buscar = async (email) => {
  const [p] = await rest(`profiles?select=id,full_name,email&email=eq.${encodeURIComponent(email)}`)
  if (!p) throw new Error(`No existe ${email} en ${ENTORNO}`)
  return p
}

const paciente = await buscar(PACIENTE)
const pro = await buscar(PROFESIONAL)

// `price_at_booking: 0` + `payment_status: 'exempt'` saltean el guard de cobro
// de la pantalla del paciente (`pagoOk` en `patient/VideoCall.jsx`) sin tener
// que atravesar Mercado Pago para probar la videollamada.
// ⚠️ `modality` sólo acepta 'video' | 'presencial' (migración 024).
const [consulta] = await rest('consultations', {
  method: 'POST',
  body: JSON.stringify({
    patient_id: paciente.id,
    professional_id: pro.id,
    status: 'confirmed',
    scheduled_at: new Date().toISOString(),
    modality: 'video',
    price_at_booking: 0,
    payment_status: 'exempt',
  }),
})

console.log(`Entorno:     ${ENTORNO}`)
console.log(`Paciente:    ${paciente.full_name} <${paciente.email}>`)
console.log(`Profesional: ${pro.full_name} <${pro.email}>`)
console.log(`Consulta:    ${consulta.id}\n`)
console.log(`Web (profesional):  ${WEB}/profesional/videollamada/${consulta.id}`)
console.log(`App (paciente):     healthier://consultation/video?consultationId=${consulta.id}&doctorName=${encodeURIComponent(pro.full_name)}`)
