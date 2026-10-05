// Prueba DESDE EL FRONT de la migración 186 (prueba ↔ prueba, real ↔ real),
// contra staging: clic en un Chromium real, sesión por magic link (sin tocar
// contraseñas). NUNCA contra producción.
//
//   node scripts/probar-cuentas-de-prueba-front.mjs [base-url] [carpeta-capturas]
//
// Necesita en staging un profesional REAL de psicología en línea y un paciente
// real — los crea `--sembrar` (cuentas descartables @example.com) y los borra
// `--limpiar`. El profesional de prueba de Pediatría (`pediatria@staging`) se
// pone en línea solo.
//
// 1. Paciente de prueba (tomas.gimenez@staging): en el inicio, Pediatría
//    disponible y Psicología apagada (sólo hay uno real en línea); "Buscar por
//    nombre" no muestra al real; Pediatría → "Empezar" → le asigna al de prueba
//    → paga (modo demo) → la consulta queda con el profesional de prueba.
// 2. Paciente real: Pediatría apagada (sólo hay uno de prueba), Psicología →
//    "Empezar" → le asigna al real. No paga.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { cargarEnv, sesionDe, llaveSesion } from './guia/sesion.mjs'

const BASE = process.argv.slice(2).find(a => a.startsWith('http')) ?? 'https://gethealthier-staging.vercel.app'
const OUT = process.argv.slice(2).find(a => a.startsWith('/')) ?? '/tmp/pruebas-186'
if (/gethealthier\.vercel\.app/.test(BASE)) throw new Error('Esto no corre contra producción.')
mkdirSync(OUT, { recursive: true })

const env = cargarEnv()
const svc = { apikey: env.service, Authorization: `Bearer ${env.service}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
const rest = async (path, opts = {}) => {
  const r = await fetch(`${env.url}/rest/v1/${path}`, { ...opts, headers: { ...svc, ...(opts.headers ?? {}) } })
  const t = await r.text(); return t ? JSON.parse(t) : null
}
// tomas.gimenez y no paciente@healthier.app: el demo de staging no tiene nombre
// y apellido cargados y el paso bloqueante de la 183 tapa todo.
const PACIENTE_PRUEBA = process.env.PACIENTE_PRUEBA ?? 'tomas.gimenez@staging.healthier.app'
const PACIENTE_REAL = 'real.paciente.186@example.com'
const PRO_REAL = 'real.pro.186@example.com'
const PRO_PRUEBA = 'pediatria@staging.healthier.app'
let fallas = 0
const ok = (cond, msg) => { console.log(`${cond ? '✅' : '❌'} ${msg}`); if (!cond) fallas++ }

async function idDe(email) {
  const [p] = await rest(`profiles?select=id&email=eq.${encodeURIComponent(email)}&titular_id=is.null`)
  return p?.id
}

if (process.argv.includes('--limpiar')) {
  for (const email of [PRO_REAL, PACIENTE_REAL]) {
    const id = await idDe(email)
    if (!id) continue
    await rest(`consultations?or=(patient_id.eq.${id},professional_id.eq.${id})`, { method: 'DELETE' })
    await rest(`professional_profiles?user_id=eq.${id}`, { method: 'DELETE' })
    const r = await fetch(`${env.url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: svc })
    console.log(`borrado ${email}: ${r.status}`)
  }
  process.exit(0)
}

async function abrirComo(browser, email) {
  const sesion = await sesionDe(email, env)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await ctx.addInitScript(([k, v]) => {
    try { localStorage.setItem(k, v); localStorage.setItem('healthier:tour-paciente-visto', '1') } catch {}
  }, [llaveSesion(env), JSON.stringify(sesion)])
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('   [pageerror]', e.message))
  return page
}

// Las tarjetas del carrusel "Atención inmediata": nombre → 'Empezar' | 'Sacá un turno'
async function tarjetas(page) {
  await page.locator('button.od-card').first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(2500) // el pool llega después del primer render
  const textos = await page.locator('button.od-card').allInnerTexts()
  return Object.fromEntries(textos.map(t => {
    const lineas = t.split('\n').map(s => s.trim()).filter(Boolean)
    const nombre = lineas.find(l => !/^\$|Empezar|Sacá un turno|Sin profesionales/.test(l)) ?? lineas[0]
    return [nombre, /Empezar/.test(t) ? 'Empezar' : 'Sacá un turno']
  }))
}
const buscar = (obj, re) => Object.entries(obj).find(([k]) => re.test(k))?.[1]

// Pone en línea al de prueba de Pediatría y verifica que el real siga en línea.
await rest(`professional_profiles?user_id=eq.${await idDe(PRO_PRUEBA)}`, { method: 'PATCH', body: JSON.stringify({ on_demand_last_seen_at: new Date().toISOString() }) })
await rest(`professional_profiles?user_id=eq.${await idDe(PRO_REAL)}`, { method: 'PATCH', body: JSON.stringify({ on_demand_last_seen_at: new Date().toISOString() }) })

const browser = await chromium.launch()
const creadas = []
try {
  // ── 1 · Paciente de prueba ────────────────────────────────────────────────
  let page = await abrirComo(browser, PACIENTE_PRUEBA)
  await page.goto(`${BASE}/paciente/dashboard`)
  let t = await tarjetas(page)
  await page.screenshot({ path: `${OUT}/1a-prueba-inicio.png` })
  console.log('   tarjetas (prueba):', JSON.stringify(t))
  ok(buscar(t, /Pediatr/) === 'Empezar', 'paciente de prueba: Pediatría disponible (hay uno de prueba en línea)')
  ok(buscar(t, /Psicolog|Mente|mental/i) === 'Sacá un turno', 'paciente de prueba: Psicología apagada (sólo hay uno REAL en línea)')

  await page.getByText('Buscar por nombre').first().click()
  await page.waitForURL(/buscar-disponibles/)
  await page.waitForTimeout(2500)
  const lista = await page.locator('main, body').first().innerText()
  await page.screenshot({ path: `${OUT}/1b-prueba-buscar.png` })
  ok(!/Mundoreal/.test(lista), 'paciente de prueba: "Buscar por nombre" no muestra al profesional real')
  ok(/Bruno Salas/.test(lista), 'paciente de prueba: "Buscar por nombre" muestra al de prueba (Bruno Salas)')

  await page.goto(`${BASE}/paciente/dashboard`)
  await tarjetas(page)
  await page.locator('button.od-card', { hasText: /Pediatr/ }).click()
  await page.waitForURL(/ondemand\/pediatria/)
  // "¿Para quién?" aparece si tiene grupo familiar
  const paraMi = page.getByRole('button', { name: /Para mí/ })
  await page.waitForTimeout(2500)
  if (await paraMi.isVisible().catch(() => false)) {
    await paraMi.click()
    await page.getByRole('button', { name: /^Continuar$/ }).click().catch(() => {})
  }
  await page.getByText(/Bruno Salas|Sin disponibilidad/).first().waitFor({ timeout: 20000 })
  await page.screenshot({ path: `${OUT}/1c-prueba-asignado.png` })
  const asignado = await page.locator('body').innerText()
  ok(/Bruno Salas/.test(asignado) && !/Mundoreal/.test(asignado), 'paciente de prueba: Pediatría le asigna al profesional de prueba')

  // Staging no tiene Mercado Pago vinculado: se paga como "consulta bonificada"
  // (payment_exempt, prendido sólo durante este paso), que crea la consulta por
  // el mismo `ensureConsultation` que el pago con tarjeta.
  const pid = await idDe(PACIENTE_PRUEBA)
  await rest(`profiles?id=eq.${pid}`, { method: 'PATCH', body: JSON.stringify({ payment_exempt: true }) })
  const desde = new Date().toISOString()
  try {
    await page.reload()
    await page.waitForTimeout(2500)
    if (await paraMi.isVisible().catch(() => false)) {
      await paraMi.click()
      await page.getByRole('button', { name: /^Continuar$/ }).click().catch(() => {})
    }
    const pagar = page.getByRole('button', { name: /Pagar|Iniciar|Confirmar/ }).last()
    await pagar.waitFor({ timeout: 20000 })
    await page.screenshot({ path: `${OUT}/1d-prueba-bonificada.png` })
    await pagar.click()
    await page.waitForTimeout(6000)
    await page.screenshot({ path: `${OUT}/1e-prueba-despues-de-pagar.png` })
  } finally {
    await rest(`profiles?id=eq.${pid}`, { method: 'PATCH', body: JSON.stringify({ payment_exempt: false }) })
  }
  const nuevas = await rest(`consultations?select=id,status,professional:profiles!professional_id(email)&patient_id=eq.${pid}&created_at=gte.${encodeURIComponent(desde)}`)
  creadas.push(...(nuevas ?? []).map(c => c.id))
  console.log('   consultas creadas:', JSON.stringify(nuevas))
  ok((nuevas ?? []).length > 0 && nuevas.every(c => c.professional?.email === PRO_PRUEBA), 'paciente de prueba: la consulta se creó con el profesional de prueba (ninguna con uno real)')
  await page.context().close()

  // ── 2 · Paciente real ─────────────────────────────────────────────────────
  page = await abrirComo(browser, PACIENTE_REAL)
  await page.goto(`${BASE}/paciente/dashboard`)
  t = await tarjetas(page)
  await page.screenshot({ path: `${OUT}/2a-real-inicio.png` })
  console.log('   tarjetas (real):', JSON.stringify(t))
  ok(buscar(t, /Pediatr/) === 'Sacá un turno', 'paciente real: Pediatría apagada (sólo hay uno de PRUEBA en línea)')
  ok(buscar(t, /Psicolog|Mente|mental/i) === 'Empezar', 'paciente real: Psicología disponible (el real)')

  await page.getByText('Buscar por nombre').first().click()
  await page.waitForURL(/buscar-disponibles/)
  await page.waitForTimeout(2500)
  const listaReal = await page.locator('body').innerText()
  await page.screenshot({ path: `${OUT}/2b-real-buscar.png` })
  ok(!/Bruno Salas|Valentina Ortega/.test(listaReal), 'paciente real: "Buscar por nombre" no muestra profesionales de prueba')
  ok(/Mundoreal/.test(listaReal), 'paciente real: "Buscar por nombre" muestra al real')

  await page.goto(`${BASE}/paciente/dashboard`)
  await tarjetas(page)
  await page.locator('button.od-card', { hasText: /Psicolog|Mente|mental/i }).click()
  await page.waitForURL(/ondemand\//)
  await page.waitForTimeout(2500)
  const paraMi2 = page.getByRole('button', { name: /Para mí/ })
  if (await paraMi2.isVisible().catch(() => false)) {
    await paraMi2.click()
    await page.getByRole('button', { name: /^Continuar$/ }).click().catch(() => {})
  }
  await page.getByText(/Mundoreal|Sin disponibilidad/).first().waitFor({ timeout: 20000 })
  await page.screenshot({ path: `${OUT}/2c-real-asignado.png` })
  ok(/Mundoreal/.test(await page.locator('body').innerText()), 'paciente real: Psicología le asigna al profesional real')
  await page.context().close()
} finally {
  await browser.close()
  // Lo que se creó en el paso 1 se borra (staging).
  for (const id of creadas) {
    await rest(`consultation_validation_codes?consultation_id=eq.${id}`, { method: 'DELETE' })
    await rest(`consultations?id=eq.${id}`, { method: 'DELETE' })
  }
}
console.log(fallas ? `\n❌ ${fallas} falla(s) — capturas en ${OUT}` : `\n✅ todo en orden — capturas en ${OUT}`)
process.exit(fallas ? 1 : 0)
