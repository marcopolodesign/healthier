#!/usr/bin/env node
/**
 * Control: la consulta inmediata aceptada aparece en la agenda y el historial
 * del profesional, y la bonificada no muestra monto ni suma plata.
 *
 *   node scripts/verificar-agenda-profesional.mjs [--mobile ../mobile]
 *
 * Sólo staging (aborta si la URL no es la de staging). Siembra 4 inmediatas de
 * `clinica@staging.healthier.app` —aceptada y cerrada, bonificada y no—, las
 * lee COMO EL PROFESIONAL (login real + RLS, la misma query de
 * `consultationsService.getByProfessional`) y les pasa los helpers de la web
 * (`src/lib/agendaProfesional.js`) y de la app (`mobile/src/lib/agendaProfesional.ts`).
 * Falla (exit 1) si una inmediata no está en "Hoy" de la agenda, si una cerrada
 * no está en el historial, si una bonificada muestra monto o suma a ganancias,
 * o si una no bonificada deja de mostrar su precio. Limpia lo que siembra.
 *
 * Por qué existe: la inmediata nace con scheduled_at = now(); la agenda de la
 * app sólo tenía "Próximas" (scheduled_at >= ahora) e "Historial", así que un
 * segundo después de aceptarla no estaba en ninguna agenda del día. Y las
 * ganancias del inicio sumaban price_at_booking de las bonificadas.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const aca = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]),
)
const URL = env.HEALTHIER_STAGING_SUPABASE_URL
const SERVICE = env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
const ANON = env.HEALTHIER_STAGING_SUPABASE_ANON_KEY
if (!URL?.includes('itjhrvlzuqvyhqtffumc')) { console.error('Sólo staging.'); process.exit(2) }

const i = process.argv.indexOf('--mobile')
// Por defecto, el repo hermano: Healthier/website/scripts -> Healthier/mobile.
const mobileDir = i > 0 ? resolve(process.cwd(), process.argv[i + 1]) : resolve(aca, '../../mobile')
const web = await import(pathToFileURL(join(aca, '../src/lib/agendaProfesional.js')))
const app = await import(pathToFileURL(join(mobileDir, 'src/lib/agendaProfesional.ts')))

const rest = (path, { key = SERVICE, bearer = SERVICE, ...init } = {}) =>
  fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...init.headers },
  }).then(async r => { const t = await r.text(); if (!r.ok) throw new Error(`${path}: ${t}`); return t ? JSON.parse(t) : null })

const camel = o => Array.isArray(o) ? o.map(camel)
  : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), camel(v)]))
  : o

// Login real del profesional.
const login = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'clinica@staging.healthier.app', password: 'staging' }),
}).then(r => r.json())
if (!login.access_token) { console.error('No pude entrar como clinica@:', JSON.stringify(login)); process.exit(2) }
const proId = login.user.id
const [paciente] = await rest(`profiles?email=eq.paciente.completo@staging.healthier.app&select=id`)

const MARCA = 'verificar-agenda-profesional'
const ahora = Date.now()
const base = {
  patient_id: paciente.id, professional_id: proId, modality: 'video', vertical: 'salud', is_on_demand: true,
  price_at_booking: 1000, scheduled_at: new Date(ahora - 5000).toISOString(), closing_notes: MARCA,
  refund_pending: false, reminder_sent: false, reminder_24h_sent: false, duration_minutes: 30, completed_at: null,
}
const casos = [
  { clave: 'aceptada-paga',        ...base, status: 'confirmed', payment_status: 'paid' },
  { clave: 'aceptada-bonificada',  ...base, status: 'confirmed', payment_status: 'exempt' },
  { clave: 'cerrada-paga',         ...base, status: 'completed', payment_status: 'paid',   completed_at: new Date().toISOString() },
  { clave: 'cerrada-bonificada',   ...base, status: 'completed', payment_status: 'exempt', completed_at: new Date().toISOString() },
]

const fallas = []
const chequear = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FALLA'} ${msg}`); if (!ok) fallas.push(msg) }

try {
  await rest(`consultations?closing_notes=eq.${MARCA}`, { method: 'DELETE' })
  const filas = await rest('consultations', { method: 'POST', body: JSON.stringify(casos.map(({ clave, ...f }) => f)) })
  const porClave = Object.fromEntries(casos.map((c, k) => [c.clave, filas[k].id]))

  // Lo mismo que consultationsService.getByProfessional / ConsultationService.getByProfessional.
  const mias = camel(await rest(
    `consultations?select=*&professional_id=eq.${proId}&order=scheduled_at.desc`,
    { key: ANON, bearer: login.access_token },
  ))
  const ids = lista => new Set(lista.map(c => c.id))
  const t = new Date()

  const hoyWeb = ids(web.agendaDelDia(mias, t))
  const hoyApp = ids(app.agendaDelDia(mias, t))
  const histWeb = ids(mias.filter(c => web.enHistorial(c, t)))
  const histApp = ids(app.historial(mias, t))

  for (const [clave, id] of Object.entries(porClave)) {
    chequear(hoyWeb.has(id), `web · agenda de hoy muestra ${clave}`)
    chequear(hoyApp.has(id), `app · agenda de hoy muestra ${clave}`)
    const c = mias.find(x => x.id === id)
    chequear(!!c, `el profesional lee ${clave}`)
    if (!c) continue
    const boni = clave.endsWith('bonificada')
    chequear(web.esBonificada(c) === boni && app.esBonificada(c) === boni, `${clave}: esBonificada = ${boni} (web y app)`)
    chequear(boni ? web.montoVisible(c) === null && app.montoVisible(c) === null
                  : web.montoVisible(c) === 1000 && app.montoVisible(c) === 1000,
             boni ? `${clave}: NO muestra monto` : `${clave}: muestra su precio ($1000)`)
  }
  for (const clave of ['cerrada-paga', 'cerrada-bonificada']) {
    chequear(histWeb.has(porClave[clave]), `web · historial muestra ${clave}`)
    chequear(histApp.has(porClave[clave]), `app · historial muestra ${clave}`)
  }
  const cerradas = mias.filter(c => [porClave['cerrada-paga'], porClave['cerrada-bonificada']].includes(c.id))
  chequear(web.sumarGanancias(cerradas) === 1000 && app.sumarGanancias(cerradas) === 1000,
           'ganancias: paga suma $1000 y la bonificada suma $0 (web y app)')
} finally {
  await rest(`consultations?closing_notes=eq.${MARCA}`, { method: 'DELETE' }).catch(e => console.error('limpieza:', e.message))
}

if (fallas.length) { console.error(`\n${fallas.length} chequeos en rojo.`); process.exit(1) }
console.log('\nTodo en verde.')
