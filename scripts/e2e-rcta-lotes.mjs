#!/usr/bin/env node
/**
 * De punta a punta, DESDE EL FRONT de staging, los lotes que homologación no
 * provoca: lote partido en varias recetas, recetas compartidas entre
 * medicaciones, errores parciales, filas "a revisar" y "Pendiente de
 * autorización" (migración 223, revisión pre-prod ronda 3).
 *
 *   npm run test:rcta-armado:e2e            # todos
 *   node scripts/e2e-rcta-lotes.mjs parcial compartido a_revisar pendiente
 *
 * Cómo: `rcta-issue` tiene un modo de simulación que SÓLO existe en staging
 * (`RCTA_SIMULAR_LOTE=permitido` + claves de homologación, ver
 * `supabase/functions/_shared/rcta/simulacion.ts`). Emite de verdad contra
 * homologación y reacomoda la respuesta. El front lo pide con
 * `localStorage.rcta_simular_lote`. Todo lo demás —recetario, anular, farmacia,
 * paciente— es la app real, con sesiones reales (magic link del Admin API, sin
 * contraseñas) en un Chromium aislado.
 *
 * Deja las capturas en /tmp/e2e-rcta-lotes/ y anula todo lo que emite.
 * 🔴 Se niega a correr contra otra cosa que staging.
 */
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(RAIZ, 'package.json'))
const { chromium } = require('playwright')
const env = Object.fromEntries(readFileSync(join(process.env.HOME, 'Local/.env'), 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const SB = env.HEALTHIER_STAGING_SUPABASE_URL
const SRV = env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
const ANON = env.HEALTHIER_STAGING_SUPABASE_ANON_KEY
const REF = env.HEALTHIER_STAGING_SUPABASE_REF
const WEB = 'https://staging.healthier.com.ar'
if (!SB?.includes(REF) || REF === 'aixjejdoofervrkggbkd') { console.error('Esto corre sólo contra staging.'); process.exit(2) }

const OUT = '/tmp/e2e-rcta-lotes'
mkdirSync(OUT, { recursive: true })
const PRO = 'clinica@staging.healthier.app'
const FARMACIA = 'farmacia@staging.healthier.app'
const PACIENTE = 'familiar-b48afc8b-53f7-4e0a-a451-1c0acc3c3413@familia.healthier.app' // Benjamín (familiar de paciente.completo)
const TITULAR = '5eed1001-0000-4000-8000-000000000001'                               // a quien le llegan sus avisos
const MED_A = { buscar: 'atorvastatina', opcion: /Atorvastatina 20 mg comp\.x 30(?!\d)/i, nombre: /Atorvastatina/i }
const MED_B = { buscar: 'enalapril', opcion: /Ecaprilat 10 mg comp\.x 30(?!\d)/i, nombre: /Ecaprilat/i }

// ── base (service role, sólo para preparar y comprobar) ───────────────────────
const rest = async (path, init = {}) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers ?? {}) } })
  const t = await r.text(); if (!r.ok) throw new Error(`${path} → ${r.status} ${t}`); return t ? JSON.parse(t) : null
}
const sql = async q => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })
  const t = await r.json(); if (!r.ok || t?.message) throw new Error(JSON.stringify(t)); return t
}
const filasDe = encuentro => rest(`clinical_medications?encounter_id=eq.${encuentro}&posdatada_de=is.null&select=id,medication_name,rcta_status,status,rcta_a_revisar,rcta_autorizacion,rcta_prescription_id,rcta_recetas,rcta_error_detalle,rcta_anulacion_estado&order=created_at`)
const esperar = async (fn, ms = 30000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return v; await new Promise(r => setTimeout(r, 2000)) } }

// Datos del profesional que pide la receta (DNI y sexo), como lo haría el super admin.
const SA_ID = (await rest('profiles?email=eq.superadmin@healthier.app&select=id'))[0].id
const PRO_ID = (await rest(`profiles?email=eq.${PRO}&select=id`))[0].id
const comoSuperAdmin = q => sql(`begin; select set_config('request.jwt.claims', '{"sub":"${SA_ID}","role":"authenticated"}', true); ${q}; commit;`)
const original = (await rest(`profiles?id=eq.${PRO_ID}&select=dni,gender`))[0]
await comoSuperAdmin(`update profiles set dni='30111222', gender='femenino' where id='${PRO_ID}'`)

// ── sesiones aisladas ─────────────────────────────────────────────────────────
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
async function sesion(email, { mobile = false, simular = null } = {}) {
  const gl = await (await fetch(`${SB}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) })).json()
  const s = await (await fetch(`${SB}/auth/v1/verify`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: gl.hashed_token ?? gl.properties?.hashed_token }) })).json()
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(([k, v, sim]) => {
    if (!localStorage.getItem('__e2e')) { localStorage.setItem(k, v); localStorage.setItem('__e2e', '1') }
    if (sim) localStorage.setItem('rcta_simular_lote', sim); else localStorage.removeItem('rcta_simular_lote')
  }, [`sb-${REF}-auth-token`, JSON.stringify({ access_token: s.access_token, token_type: s.token_type, expires_in: s.expires_in, expires_at: s.expires_at, refresh_token: s.refresh_token, user: s.user }), simular])
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('  ⚠ error de página:', e.message))
  return { ctx, page }
}
const cerrarTour = async page => { for (let i = 0; i < 5 && await page.locator('.driver-popover-close-btn').count(); i++) { await page.locator('.driver-popover-close-btn').click(); await page.waitForTimeout(300) } }
const foto = (page, nombre) => page.screenshot({ path: `${OUT}/${nombre}.png` })

// ── profesional ───────────────────────────────────────────────────────────────
function sembrarConsulta() {
  const out = execFileSync('node', [join(RAIZ, 'scripts/seed-videollamada.mjs'), '--profesional', PRO], { encoding: 'utf8' })
  return out.match(/Consulta:\s+(\S+)/)[1]
}
async function abrirRecetario(page, consulta) {
  await page.goto(`${WEB}/profesional/videollamada/${consulta}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(4000); await cerrarTour(page)
  await page.getByText('Recetario', { exact: true }).click(); await page.waitForTimeout(1500)
}
async function cargarMedicacion(page, med) {
  if (!(await page.getByPlaceholder(/Buscá en el vademécum/).count())) {
    const abrir = page.getByRole('button', { name: /Nueva receta|Agregar medicación a esta receta|Recetar medicamentos/ }).first()
    await abrir.click(); await page.waitForTimeout(800)
  }
  const buscar = page.getByPlaceholder(/Buscá en el vademécum/)
  await buscar.click(); await buscar.pressSequentially(med.buscar, { delay: 50 }); await page.waitForTimeout(3500)
  await page.locator('[role="option"], ul li').filter({ hasText: med.opcion }).first().click(); await page.waitForTimeout(600)
  await page.getByPlaceholder('Ej: 1 comprimido, 5ml, 10mg/kg').fill('1 comprimido')
  await page.getByPlaceholder('Ej: 30 comp., 1 frasco').fill('1 caja')
  await page.getByRole('button', { name: 'Guardar medicación' }).click(); await page.waitForTimeout(2500)
}
async function emitir(page) {
  const resp = page.waitForResponse(r => r.url().includes('/functions/v1/rcta-issue'), { timeout: 90000 })
  await page.getByRole('button', { name: /Emitir receta/ }).first().click()
  const r = await resp; const cuerpo = await r.json(); await page.waitForTimeout(4000)
  if (process.env.E2E_VERBOSO) console.log('  rcta-issue', r.status(), JSON.stringify(cuerpo).slice(0, 600), '| pedido:', r.request().postData()?.slice(0, 200))
  return { status: r.status(), cuerpo }
}
const renglon = (page, med) => page.locator('div.rounded-xl.border').filter({ hasText: med.nombre }).first()
async function anularDesde(page, med, { foto: nombreFoto = null } = {}) {
  await renglon(page, med).getByRole('button', { name: 'Anular', exact: true }).click()
  await page.getByPlaceholder('Ej.: cambio de dosis').waitFor()
  await page.waitForTimeout(2500)                                    // la vista previa
  const tambien = await page.getByTestId('anular-tambien').count() ? await page.getByTestId('anular-tambien').innerText() : ''
  if (nombreFoto) await foto(page, nombreFoto)
  const resp = page.waitForResponse(r => r.url().includes('/functions/v1/rcta-anular') && r.request().postData()?.includes('"motivo"'), { timeout: 90000 })
  await page.getByRole('button', { name: /^Anular( \d+ recetas| receta)$/ }).click()
  const r = await resp; await page.waitForTimeout(3000)
  return { tambien, cuerpo: await r.json() }
}

// ── escenarios ────────────────────────────────────────────────────────────────
const resultados = []
const caso = async (nombre, fn) => {
  process.stdout.write(`▸ ${nombre}\n`)
  try { await fn(); resultados.push([nombre, 'ok']); console.log('  ✔') } catch (e) { resultados.push([nombre, e.message]); console.log('  ✖', e.message) }
}
const pedidos = process.argv.slice(2)
const corre = n => !pedidos.length || pedidos.includes(n)

if (corre('parcial')) await caso('Errores parciales: lo que salió queda emitido, lo que falló en error con su motivo', async () => {
  const consulta = sembrarConsulta()
  const { ctx, page } = await sesion(PRO, { simular: 'parcial' })
  await abrirRecetario(page, consulta)
  await cargarMedicacion(page, MED_A); await cargarMedicacion(page, MED_B)
  const { status, cuerpo } = await emitir(page)
  assert.equal(status, 200, JSON.stringify(cuerpo))
  assert.equal(cuerpo.fallidas.length, 1)
  await foto(page, '1-parcial-recetario')
  const filas = await filasDe((await rest(`clinical_medications?id=eq.${cuerpo.emitidas[0]}&select=encounter_id`))[0].encounter_id)
  assert.deepEqual(filas.map(f => f.rcta_status), ['issued', 'error'])
  assert.match(await renglon(page, MED_B).innerText(), /VERIFIQUE LOS NOMBRES/)
  // Se limpia: la que salió se anula.
  const a = await anularDesde(page, MED_A)
  assert.equal(a.cuerpo.sinConfirmar, 0)
  await ctx.close()
})

if (corre('compartido')) await caso('1 y 3 · Receta compartida: anular una avisa y anula también la otra medicación', async () => {
  const consulta = sembrarConsulta()
  const { ctx, page } = await sesion(PRO, { simular: 'lote_compartido' })
  await abrirRecetario(page, consulta)
  await cargarMedicacion(page, MED_A); await cargarMedicacion(page, MED_B)
  const { status, cuerpo } = await emitir(page)
  assert.equal(status, 200, JSON.stringify(cuerpo))
  assert.equal(cuerpo.recetas.length, 2)
  await foto(page, '2-compartido-recetario')
  const { tambien, cuerpo: an } = await anularDesde(page, MED_A, { foto: '2-compartido-modal' })
  assert.match(tambien, /Ecaprilat/i, 'el modal avisa que también se anula la otra medicación')
  assert.equal(an.anuladas.length, 2, 'se anulan las dos recetas del lote')
  assert.equal(an.sinConfirmar, 0)
  const filas = await filasDe((await rest(`clinical_medications?id=eq.${cuerpo.emitidas[0]}&select=encounter_id`))[0].encounter_id)
  assert.ok(filas.every(f => f.rcta_status === 'anulada' && f.rcta_anulacion_estado === 'confirmada'), JSON.stringify(filas))
  await foto(page, '2-compartido-anuladas')
  await ctx.close()
})

if (corre('a_revisar')) await caso('2 y 5 · "A revisar": no se re-emite, se anula, y "Reintentar" funciona', async () => {
  const consulta = sembrarConsulta()
  const { ctx, page } = await sesion(PRO, { simular: 'a_revisar' })
  await abrirRecetario(page, consulta)
  await cargarMedicacion(page, MED_A); await cargarMedicacion(page, MED_B)
  const { status, cuerpo } = await emitir(page)
  assert.equal(status, 200, JSON.stringify(cuerpo))
  assert.equal(cuerpo.sinUbicar.length, 2)
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(3000); await cerrarTour(page)
  await page.getByText('Recetario', { exact: true }).click(); await page.waitForTimeout(1500)
  await foto(page, '3-a-revisar-recetario')
  assert.match(await renglon(page, MED_A).innerText(), /Recetas emitidas en este lote/)
  assert.equal(await renglon(page, MED_A).locator('input[type="checkbox"]').count(), 0, 'no se puede volver a emitir')
  const encuentro = (await rest(`clinical_medications?id=eq.${cuerpo.medicationIds[0]}&select=encounter_id`))[0].encounter_id
  const antes = await filasDe(encuentro)
  assert.ok(antes.every(f => f.rcta_a_revisar === true), JSON.stringify(antes))
  // Se rompe a propósito el identificador de la receta para que el servicio no
  // confirme la anulación, y así aparezca "Reintentar".
  const buenas = antes[0].rcta_recetas
  for (const f of antes) await rest(`clinical_medications?id=eq.${f.id}`, { method: 'PATCH', body: JSON.stringify({ rcta_recetas: f.rcta_recetas.map(r => ({ ...r, id: 'NOEXISTE' + r.id })) }) })
  const { tambien, cuerpo: an } = await anularDesde(page, MED_A, { foto: '3-a-revisar-modal' })
  assert.match(tambien, /Ecaprilat/i)
  assert.ok(an.sinConfirmar > 0, 'la anulación quedó sin confirmar')
  for (const f of antes) await rest(`clinical_medications?id=eq.${f.id}`, { method: 'PATCH', body: JSON.stringify({ rcta_recetas: buenas }) })
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(3000); await cerrarTour(page)
  await page.getByText('Recetario', { exact: true }).click(); await page.waitForTimeout(1500)
  await foto(page, '3-a-revisar-reintentar')
  const resp = page.waitForResponse(r => r.url().includes('/functions/v1/rcta-anular'), { timeout: 90000 })
  await renglon(page, MED_A).getByRole('button', { name: /Reintentar/ }).click()
  const re = await (await resp).json()
  assert.equal(re.reintento, true); assert.equal(re.sinConfirmar, 0, JSON.stringify(re))
  const despues = await filasDe(encuentro)
  assert.ok(despues.every(f => f.rcta_anulacion_estado === 'confirmada'), JSON.stringify(despues))
  await ctx.close()
})

if (corre('pendiente')) await caso('4 · Pendiente compartida: la farmacia autoriza y el aviso sale sólo cuando se puede comprar', async () => {
  const consulta = sembrarConsulta()
  const pro = await sesion(PRO, { simular: 'compartido_pendiente' })
  await abrirRecetario(pro.page, consulta)
  await cargarMedicacion(pro.page, MED_A); await cargarMedicacion(pro.page, MED_B)
  const { status, cuerpo } = await emitir(pro.page)
  assert.equal(status, 200, JSON.stringify(cuerpo))
  assert.equal(cuerpo.pendientesDeAutorizacion, 2)
  await foto(pro.page, '4-pendiente-recetario')
  const encuentro = (await rest(`clinical_medications?id=eq.${cuerpo.medicationIds[0]}&select=encounter_id`))[0].encounter_id
  const [filaA, filaB] = await filasDe(encuentro)
  const [r1, r2] = cuerpo.recetas.map(r => r.prescriptionId)
  const t0 = new Date().toISOString()
  const avisos = () => rest(`notificaciones?user_id=eq.${TITULAR}&tipo=eq.receta-autorizada&created_at=gt.${t0}&select=titulo&order=created_at`)

  const paciente = await sesion(PACIENTE, { mobile: true })
  // Lo que ve el paciente en "Tus recetas vigentes": el estado de cada una.
  const verFarmacia = async nombre => {
    await paciente.page.goto(`${WEB}/paciente/farmacia`, { waitUntil: 'networkidle' }); await paciente.page.waitForTimeout(3500)
    const seccion = paciente.page.getByText('Tus recetas vigentes').first()
    if (await seccion.count()) await seccion.scrollIntoViewIfNeeded()
    await foto(paciente.page, nombre)
    const tarjeta = med => paciente.page.locator('div.rounded-\\[24px\\]').filter({ hasText: med.nombre }).filter({ hasText: /Vigente|Pendiente de autorización/ }).first()
    const estado = async med => (await tarjeta(med).count()) ? ((await tarjeta(med).innerText()).match(/Vigente|Pendiente de autorización/) ?? [''])[0] : ''
    return { a: await estado(MED_A), b: await estado(MED_B) }
  }
  assert.deepEqual(await verFarmacia('4-paciente-antes'), { a: 'Pendiente de autorización', b: 'Pendiente de autorización' })
  const est = async id => (await sql(`select estado from farmacia_recetas_de('b48afc8b-53f7-4e0a-a451-1c0acc3c3413') where clinical_medication_id='${id}'`))[0]?.estado
  assert.equal(await est(filaA.id), 'pendiente'); assert.equal(await est(filaB.id), 'pendiente')

  const farmacia = await sesion(FARMACIA)
  const autorizar = async (med, receta, nombreFoto) => {
    await farmacia.page.goto(`${WEB}/farmacia/pedidos`, { waitUntil: 'networkidle' }); await farmacia.page.waitForTimeout(3000); await cerrarTour(farmacia.page)
    // La fila de ESA medicación, mostrando sólo la receta que le queda pendiente.
    const fila = farmacia.page.getByTestId('recetas-por-autorizar').locator('tr', { hasText: med.nombre })
      .filter({ hasText: new RegExp(`N° ${receta}$|N° ${receta} ·`, 'm') }).first()
    await fila.getByRole('button', { name: 'Autorizar' }).click(); await farmacia.page.waitForTimeout(600)
    await foto(farmacia.page, nombreFoto)
    await farmacia.page.getByRole('button', { name: 'Sí, autorizar' }).click(); await farmacia.page.waitForTimeout(3500)
  }
  // A sólo está en R1. Autorizarla deja a A comprable; B sigue pendiente por R2.
  await autorizar(MED_A, r1, '4-farmacia-autoriza-r1')
  assert.equal(await est(filaA.id), 'vigente'); assert.equal(await est(filaB.id), 'pendiente')
  const tras1 = await esperar(async () => { const a = await avisos(); return a.length ? a : null }, 20000)
  assert.equal(tras1?.length, 1, JSON.stringify(tras1)); assert.match(tras1[0].titulo, /Atorvastatina/i)
  assert.deepEqual(await verFarmacia('4-paciente-tras-r1'), { a: 'Vigente', b: 'Pendiente de autorización' })
  // Ahora la de B (su N° pendiente es R2).
  await autorizar(MED_B, r2, '4-farmacia-autoriza-r2')
  assert.equal(await est(filaB.id), 'vigente')
  const tras2 = await esperar(async () => { const a = await avisos(); return a.length >= 2 ? a : null }, 20000)
  assert.equal(tras2?.length, 2, JSON.stringify(tras2)); assert.match(tras2[1].titulo, /Ecaprilat/i)
  assert.deepEqual(await verFarmacia('4-paciente-tras-r2'), { a: 'Vigente', b: 'Vigente' })
  // Se limpia desde el recetario.
  await pro.page.reload({ waitUntil: 'networkidle' }); await pro.page.waitForTimeout(3000); await cerrarTour(pro.page)
  await pro.page.getByText('Recetario', { exact: true }).click(); await pro.page.waitForTimeout(1500)
  const an = await anularDesde(pro.page, MED_A)
  assert.equal(an.cuerpo.sinConfirmar, 0)
  for (const s of [pro, paciente, farmacia]) await s.ctx.close()
})

await browser.close()
await comoSuperAdmin(`update profiles set dni=${original.dni ? `'${original.dni}'` : 'null'}, gender=${original.gender ? `'${original.gender}'` : 'null'} where id='${PRO_ID}'`)
console.log(`\nCapturas en ${OUT}`)
const mal = resultados.filter(([, r]) => r !== 'ok')
console.log(mal.length ? `✖ ${mal.length} de ${resultados.length} casos fallaron` : `✔ ${resultados.length} casos`)
process.exit(mal.length ? 1 : 0)
