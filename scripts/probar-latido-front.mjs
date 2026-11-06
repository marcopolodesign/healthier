// Prueba DESDE EL FRONT (Chromium real, clic y tipeo) de que la profesional no
// puede quedar con el switch de consulta inmediata prendido y SIN latido, y de
// que el paciente la ve después. Contra staging (o localhost apuntando a la base
// de staging). NUNCA contra producción. Sesión por magic link, sin contraseñas.
//
//   node scripts/probar-latido-front.mjs [base-url] [--rapido]
//   base por defecto: https://staging.healthier.com.ar
//
// Caso real (prod, 2026-11-05): is_on_demand = true, on_demand_since y
// on_demand_last_seen_at = NULL. Causa: una lectura del perfil que falla (corte
// de red, sesión que se refresca) se leía como "switch apagado" y el layout
// llamaba a goOffline(), que borra el latido sin tocar is_on_demand. Además,
// guardar Configuración con la ficha rancia pisaba el switch.
//
//   S1  lectura del perfil caída (al abrir y en el sondeo de cada minuto)
//   S2  Configuración abierta con el switch apagado, se prende en otra pestaña, se guarda cobro
//   S3  Configuración abierta con el switch prendido, se apaga en otro lado, se guarda cobro
//   S4  Agenda: prender el switch y guardar arranca el latido del layout (sin recargar)
//   S5  el paciente ve a la profesional en "disponibles ahora" cuando está prendida con latido
//
// Usa la cuenta profesional@healthier.app de staging (PRO_EMAIL para otra) y la
// deja apagada al terminar.
import { chromium } from '@playwright/test'
import { cargarEnv, sesionDe, llaveSesion } from './guia/sesion.mjs'

const BASE = process.argv.slice(2).find(a => a.startsWith('http')) ?? 'https://staging.healthier.com.ar'
const RAPIDO = process.argv.includes('--rapido')
if (/(^|\/\/)(www\.)?healthier\.com\.ar|gethealthier\.vercel\.app/.test(BASE)) throw new Error('Esto no corre contra producción.')

const env = cargarEnv()
const PRO = process.env.PRO_EMAIL ?? 'profesional@healthier.app'
const PACIENTE = 'paciente@healthier.app'
const H = { apikey: env.service, Authorization: `Bearer ${env.service}`, 'Content-Type': 'application/json' }
let fallas = 0
const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) fallas++ }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ahora = () => new Date().toISOString()

const usuarios = await (await fetch(`${env.url}/auth/v1/admin/users?per_page=1000`, { headers: H })).json()
const uid = usuarios.users.find(u => u.email === PRO).id
const fila = async () => (await (await fetch(`${env.url}/rest/v1/professional_profiles?user_id=eq.${uid}&select=is_on_demand,on_demand_since,on_demand_last_seen_at`, { headers: H })).json())[0]
const nombre = (await (await fetch(`${env.url}/rest/v1/profiles?id=eq.${uid}&select=full_name`, { headers: H })).json())[0].full_name
// service role: auth.uid() es null, así que el trigger de la 190 no inventa latido
const fijar = v => fetch(`${env.url}/rest/v1/professional_profiles?user_id=eq.${uid}`, { method: 'PATCH', headers: H, body: JSON.stringify(v) })
const apagar = () => fijar({ is_on_demand: false, on_demand_since: null, on_demand_last_seen_at: null })
const estado = f => `on=${f.is_on_demand} since=${f.on_demand_since ? 'sí' : 'NULL'} latido=${f.on_demand_last_seen_at ? 'sí' : 'NULL'}`
const vigente = f => f.is_on_demand && f.on_demand_since && f.on_demand_last_seen_at

const browser = await chromium.launch()
async function contexto(email) {
  const sesion = await sesionDe(email, env)
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  await ctx.addInitScript(([k, v]) => { try {
    localStorage.setItem(k, v)
    localStorage.setItem('healthier:tour-profesional-visto', '1')
    localStorage.setItem('healthier:tour-paciente-visto', '1')
  } catch {} }, [llaveSesion(env), JSON.stringify(sesion)])
  return ctx
}
const activarEnElModal = async page => {
  await page.getByRole('button', { name: /^Activar$/ }).click()
  await page.getByText('Visible para pacientes hasta').first().waitFor({ timeout: 15000 })
}
const lecturaDelPerfil = /\/rest\/v1\/professional_profiles\?.*select=\*%2Cprofiles/

try {
  // ── S1 ────────────────────────────────────────────────────────────────────
  console.log('\nS1 · la lectura del perfil falla con el switch prendido')
  await apagar()
  let ctx = await contexto(PRO)
  let page = await ctx.newPage()
  await page.goto(`${BASE}/profesional/dashboard`)
  await activarEnElModal(page)                       // front: "Activar" en el modal del inicio
  let f = await fila(); ok(vigente(f), `prendido desde el front (${estado(f)})`)
  await page.route(lecturaDelPerfil, r => r.abort('failed'))   // se cae la red para el perfil
  await page.reload(); await sleep(5000)
  f = await fila(); ok(vigente(f), `tras recargar con la lectura caída sigue prendido y con latido (${estado(f)})`)
  if (!RAPIDO) {
    await fijar({ is_on_demand: true, on_demand_since: ahora(), on_demand_last_seen_at: ahora() })   // estado limpio para esta parte
    await page.unroute(lecturaDelPerfil); await page.goto(`${BASE}/profesional/dashboard`)
    await page.getByText('Visible para pacientes hasta').first().waitFor({ timeout: 15000 })
    await page.route(lecturaDelPerfil, r => r.abort('failed'))
    await sleep(70_000)                              // el switch relee cada minuto
    f = await fila(); ok(vigente(f), `tras el sondeo de 1 minuto con la lectura caída sigue con latido (${estado(f)})`)
  }
  await ctx.close()

  // ── S2 ────────────────────────────────────────────────────────────────────
  console.log('\nS2 · Configuración vieja guarda cobro después de prender el switch')
  await apagar()
  ctx = await contexto(PRO)
  const A = await ctx.newPage(); await A.goto(`${BASE}/profesional/configuracion?tab=cuenta`)
  await A.getByRole('button', { name: /Guardar datos de cobro/ }).waitFor({ timeout: 20000 })
  const B = await ctx.newPage(); await B.goto(`${BASE}/profesional/dashboard`)
  await activarEnElModal(B)
  f = await fila(); ok(vigente(f), `se prendió en la otra pestaña (${estado(f)})`)
  await A.bringToFront(); await A.getByRole('button', { name: /Guardar datos de cobro/ }).click(); await sleep(3000)
  f = await fila(); ok(vigente(f), `guardar cobro NO lo apagó (${estado(f)})`)
  await ctx.close()

  // ── S3 ────────────────────────────────────────────────────────────────────
  console.log('\nS3 · Configuración vieja guarda cobro después de apagar el switch')
  await fijar({ is_on_demand: true, on_demand_since: ahora(), on_demand_last_seen_at: ahora() })
  ctx = await contexto(PRO)
  const C = await ctx.newPage(); await C.goto(`${BASE}/profesional/configuracion?tab=cuenta`)
  await C.getByRole('button', { name: /Guardar datos de cobro/ }).waitFor({ timeout: 20000 })
  await apagar()                                     // se apaga "desde otro lado"
  await C.getByRole('button', { name: /Guardar datos de cobro/ }).click(); await sleep(3000)
  f = await fila(); ok(!f.is_on_demand && !f.on_demand_last_seen_at, `guardar cobro NO lo volvió a prender (${estado(f)})`)
  await ctx.close()

  // ── S4 ────────────────────────────────────────────────────────────────────
  console.log('\nS4 · prender el switch desde Agenda arranca el latido del layout')
  await apagar()
  ctx = await contexto(PRO)
  page = await ctx.newPage()
  let pings = 0
  page.on('request', r => { if (r.url().includes('/rpc/professional_online_ping')) pings++ })
  await page.goto(`${BASE}/profesional/agenda`)
  const botonSwitch = page.locator('button.rounded-full').filter({ has: page.locator('div.bg-white') }).first()
  await botonSwitch.waitFor({ timeout: 20000 })
  await botonSwitch.click()                          // front: switch del formulario de Agenda
  await page.getByRole('button', { name: /Guardar|Actualizar/ }).first().click()
  await sleep(2500)
  f = await fila(); ok(vigente(f), `prendido desde Agenda (${estado(f)})`)
  const antes = pings
  await sleep(35_000)                                // un latido del layout (cada 30 s) sin recargar
  ok(pings > antes, `el layout late solo sin recargar (${pings - antes} ping(s) en 35 s)`)
  await ctx.close()

  // ── S5 ────────────────────────────────────────────────────────────────────
  console.log('\nS5 · el paciente ve a la profesional en "disponibles ahora"')
  await fijar({ is_on_demand: true, on_demand_since: ahora(), on_demand_last_seen_at: ahora() })
  ctx = await contexto(PACIENTE)
  page = await ctx.newPage()
  await page.goto(`${BASE}/paciente/buscar-disponibles`)
  await sleep(4000)
  ok(await page.getByText(nombre).first().isVisible().catch(() => false), `el paciente ve a ${nombre} con el switch prendido y latido`)
  await fijar({ on_demand_last_seen_at: null })      // el estado roto de prod: prendido sin latido
  await page.reload(); await sleep(4000)
  ok(!(await page.getByText(nombre).first().isVisible().catch(() => false)), 'sin latido NO aparece (por eso había que evitar el estado)')
  await ctx.close()
} finally {
  await apagar()
  await browser.close()
}
console.log(fallas ? `\n${fallas} falla(s)` : '\nTodo en verde')
process.exit(fallas ? 1 : 0)
