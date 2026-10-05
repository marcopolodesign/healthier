// Prueba DESDE EL FRONT de la comisión por profesional (migración 184), contra
// staging: clic y tipeo en un Chromium real, sesión por magic link (sin tocar
// contraseñas). NUNCA contra producción.
//
//   node scripts/probar-comision-front.mjs [base-url] [carpeta-capturas] [--paso=super|pro|todo]
//
// 1. Super admin: Profesionales → ficha de clinica@staging → carga 0% hasta
//    dentro de 30 días con motivo → ve la chapa "Exento" en la lista.
// 2. Ese profesional: ve el aviso en su inicio y la tasa real en Ganancias.
// 3. (--paso=pago o todo) Paciente reserva y paga desde el wizard con el
//    exento y con uno normal. Staging no tiene cuentas de Mercado Pago
//    vinculadas (`mp_accounts` vacía), así que el pago va 100% con Healthy
//    Credits —le carga el saldo justo antes— y pasa igual por mp-payment.
//    Después mira la fila de `payments` y la columna en /super-admin/pagos, y
//    borra lo que creó.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { cargarEnv, sesionDe, llaveSesion } from './guia/sesion.mjs'

const BASE = process.argv[2]?.startsWith('http') ? process.argv[2] : 'https://gethealthier-staging.vercel.app'
const OUT = process.argv.slice(2).find(a => a.startsWith('/')) ?? '/tmp/comision-capturas'
const PASO = (process.argv.find(a => a.startsWith('--paso=')) ?? '--paso=todo').split('=')[1]
if (/gethealthier\.vercel\.app/.test(BASE)) throw new Error('Esto no corre contra producción.')
mkdirSync(OUT, { recursive: true })

const env = cargarEnv()
const PRO = process.env.PRO_EMAIL ?? 'clinica@staging.healthier.app'
const SUPER = 'superadmin@healthier.app'
let fallas = 0
const ok = (cond, msg) => { console.log(`${cond ? '✅' : '❌'} ${msg}`); if (!cond) fallas++ }

async function abrirComo(browser, email, viewport = { width: 1366, height: 900 }) {
  const sesion = await sesionDe(email, env)
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [llaveSesion(env), JSON.stringify(sesion)])
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('   [pageerror]', e.message))
  return page
}

const svc = { apikey: env.service, Authorization: `Bearer ${env.service}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
const rest = async (path, opts = {}) => {
  const r = await fetch(`${env.url}/rest/v1/${path}`, { ...opts, headers: svc })
  const t = await r.text(); return t ? JSON.parse(t) : null
}
const PACIENTE = 'paciente.completo@staging.healthier.app'

/** Reserva + pago desde el front. `nombre` filtra la tarjeta del profesional. */
async function reservarYPagar(browser, { filtro, captura }) {
  const page = await abrirComo(browser, PACIENTE, { width: 390, height: 844 })
  await page.addInitScript(() => { localStorage.setItem('healthier:tour-paciente-visto', '1') })
  await page.goto(`${BASE}/paciente/dashboard`)
  await page.getByRole('button', { name: /^Turnos$/ }).click()
  await page.getByRole('button', { name: /^Clínica$/ }).first().click()
  await page.getByRole('button', { name: /Videoconsulta/ }).click()
  await page.getByRole('button', { name: /^Continuar$/ }).click()
  // "¿Para quién?" sólo aparece si el paciente tiene grupo familiar cargado.
  const paraMi = page.getByRole('button', { name: /Para mí/ })
  const pros = page.getByRole('button', { name: /Valentina Ortega/ })
  await paraMi.or(pros.first()).first().waitFor({ timeout: 15000 })
  if (await paraMi.isVisible()) {
    await paraMi.click()
    await page.getByRole('button', { name: /^Continuar$/ }).click()
  }
  await filtro(page.getByRole('button', { name: /Valentina Ortega/ })).click()
  await page.getByRole('button', { name: /^Continuar$/ }).click()
  // Un día dentro de 3 días y el último horario libre de ese día
  const dia = new Date(Date.now() + 3 * 86400000).getDate().toString().padStart(2, '0')
  await page.getByText(dia, { exact: true }).first().click()
  const horarios = page.getByRole('button', { name: /^\d{2}:\d{2}$/ })
  await horarios.last().waitFor({ timeout: 15000 })
  await horarios.last().click()
  await page.getByRole('button', { name: /Ver resumen/ }).click()
  await page.getByRole('button', { name: /Ir al pago/ }).click()
  await page.waitForURL(/paciente\/pago/)
  await page.getByText('Se cubre por completo con tus Healthy Credits').waitFor({ timeout: 15000 })
  await page.screenshot({ path: `${OUT}/${captura}-a-pago.png` })
  const desde = new Date().toISOString()
  await page.getByRole('button', { name: /Confirmar y Pagar/ }).click()
  await page.waitForURL(u => !/paciente\/pago$/.test(u.pathname), { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${OUT}/${captura}-b-despues.png` })
  await page.context().close()
  const [pago] = await rest(`payments?select=id,consultation_id,gross_amount,platform_fee,net_to_professional,commission_rate_applied,commission_source,status,professional:profiles!professional_id(email)&created_at=gte.${encodeURIComponent(desde)}&order=created_at.desc&limit=1`)
  return pago
}

const browser = await chromium.launch()
const creados = { consultas: [], creditos: [] }
try {
  if (PASO === 'super' || PASO === 'todo') {
    const page = await abrirComo(browser, SUPER)
    await page.goto(`${BASE}/super-admin/dashboard`)
    await page.getByRole('button', { name: /^Profesionales$/ }).first().click()
    await page.getByRole('link', { name: /^Verificados$/ }).first().click()
    await page.waitForURL(/super-admin\/profesionales/)
    await page.getByPlaceholder(/Buscar/i).first().fill(PRO)
    await page.getByText(PRO).first().click()
    const tarjeta = page.getByTestId('comision-profesional')
    await tarjeta.waitFor({ timeout: 15000 })
    await page.screenshot({ path: `${OUT}/1-ficha-antes.png` })
    await tarjeta.getByRole('button', { name: /Cambiar/ }).click()
    const hasta = new Date(Date.now() + 30 * 86400000)
    const iso = hasta.toISOString().slice(0, 10)
    await page.getByTestId('comision-pct').fill('0')
    await page.getByTestId('comision-hasta').fill(iso)
    await page.getByTestId('comision-motivo').fill('Lanzamiento: trae su cartera de pacientes (prueba front)')
    await page.getByTestId('comision-guardar').click()
    await page.getByText('Comisión guardada').waitFor({ timeout: 10000 })
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${OUT}/2-ficha-guardada.png` })
    const textoTarjeta = await tarjeta.innerText()
    ok(/Exento \(0%\)/.test(textoTarjeta) && /Lanzamiento/.test(textoTarjeta), `ficha muestra exento + historial con motivo y quién`)
    // Cerrar la ficha y mirar la chapa en la lista
    await page.keyboard.press('Escape').catch(() => {})
    await page.locator('div.absolute.inset-0.bg-black\\/30').click({ position: { x: 20, y: 20 } }).catch(() => {})
    const fila = page.locator('tr', { hasText: PRO })
    await fila.getByTestId('badge-comision').waitFor({ timeout: 10000 })
    const badge = await fila.getByTestId('badge-comision').innerText()
    const dd = String(hasta.getDate()).padStart(2, '0'), mm = String(hasta.getMonth() + 1).padStart(2, '0')
    ok(badge === 'Exento' && (await fila.innerText()).includes(`hasta ${dd}/${mm}`), `lista: chapa "${badge}" hasta ${dd}/${mm}`)
    await page.screenshot({ path: `${OUT}/3-lista-chapa.png`, fullPage: false })
    await page.context().close()
  }

  if (PASO === 'pro' || PASO === 'todo') {
    const page = await abrirComo(browser, PRO)
    await page.goto(`${BASE}/profesional/dashboard`)
    const aviso = page.getByTestId('aviso-comision')
    await aviso.waitFor({ timeout: 20000 }).catch(() => {})
    const textoAviso = await aviso.innerText().catch(() => '')
    ok(/Sin comisión de Healthier hasta el \d{2}\/\d{2}/.test(textoAviso), `inicio: "${textoAviso.split('\n')[0]}"`)
    await aviso.scrollIntoViewIfNeeded().catch(() => {})
    await page.screenshot({ path: `${OUT}/4-inicio-pro.png` })
    await page.getByRole('link', { name: /Ver desglose/ }).click()
    await page.waitForURL(/profesional\/ganancias/)
    const tasa = page.getByTestId('ganancias-tasa')
    await tasa.waitFor({ timeout: 15000 })
    const textoTasa = await tasa.innerText()
    ok(/Sin comisión de Healthier hasta el/.test(textoTasa) && /100%/.test(textoTasa) && !/20%/.test(textoTasa), `ganancias: "${textoTasa.slice(0, 90)}…"`)
    ok(await page.getByTestId('ganancias-referidos').isVisible(), 'ganancias: línea de pacientes referidos')
    await page.screenshot({ path: `${OUT}/5-ganancias-pro.png` })
    // Mobile
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${BASE}/profesional/dashboard`)
    await page.getByTestId('aviso-comision').waitFor({ timeout: 20000 }).catch(() => {})
    await page.getByTestId('aviso-comision').scrollIntoViewIfNeeded().catch(() => {})
    await page.screenshot({ path: `${OUT}/6-inicio-pro-mobile.png` })
    await page.context().close()
  }
  if (PASO === 'pago' || PASO === 'todo') {
    const [pac] = await rest(`profiles?select=id&email=eq.${encodeURIComponent(PACIENTE)}&role=eq.patient&order=created_at.asc&limit=1`)
    const [{ get_credit_balance: saldoInicial }] = await rest('rpc/get_credit_balance', { method: 'POST', body: JSON.stringify({ p_patient: pac.id }) }).then(x => [{ get_credit_balance: x }])
    // Saldo justo para cubrir dos consultas de $18.000 (Healthy Credits = el
    // único camino de staging sin una cuenta de MP vinculada).
    const falta = Math.max(0, 36000 - Number(saldoInicial))
    if (falta > 0) {
      const [c] = await rest('patient_credits', { method: 'POST', body: JSON.stringify({ patient_id: pac.id, amount: falta, reason: 'adjustment', note: 'probar-comision-front.mjs' }) })
      creados.creditos.push(c.id)
    }

    const exento = await reservarYPagar(browser, { filtro: l => l.filter({ hasNotText: 'Dra.' }), captura: '7-exento' })
    if (exento) creados.consultas.push(exento.consultation_id)
    ok(exento?.professional?.email === PRO && Number(exento.commission_rate_applied) === 0 && exento.commission_source === 'profesional' && Number(exento.net_to_professional) === Number(exento.gross_amount),
      `pago con el exento: ${JSON.stringify(exento && { pro: exento.professional?.email, rate: exento.commission_rate_applied, src: exento.commission_source, bruto: exento.gross_amount, neto: exento.net_to_professional, estado: exento.status })}`)

    const normal = await reservarYPagar(browser, { filtro: l => l.filter({ hasText: 'Dra.' }), captura: '8-normal' })
    if (normal) creados.consultas.push(normal.consultation_id)
    const [{ commission_rate: general }] = await rest('platform_settings?select=commission_rate&id=eq.1')
    ok(normal && Number(normal.commission_rate_applied) === Number(general) && normal.commission_source === 'general' && Number(normal.net_to_professional) === Math.round(Number(normal.gross_amount) * (1 - Number(general)) * 100) / 100,
      `pago con uno normal: ${JSON.stringify(normal && { pro: normal.professional?.email, rate: normal.commission_rate_applied, src: normal.commission_source, bruto: normal.gross_amount, neto: normal.net_to_professional, estado: normal.status })}`)

    // El super admin lo ve en Pagos
    const page = await abrirComo(browser, SUPER)
    await page.goto(`${BASE}/super-admin/dashboard`)
    await page.getByRole('link', { name: /^Pagos$/ }).first().click()
    await page.waitForURL(/super-admin\/pagos/)
    const tasas = page.getByTestId('tasa-aplicada')
    await tasas.first().waitFor({ timeout: 20000 }).catch(() => {})
    const textos = await tasas.allInnerTexts()
    ok(textos.some(t => /^0% · tasa propia$/.test(t)) && textos.some(t => t.includes('· general')), `super admin / Pagos: ${JSON.stringify(textos.slice(0, 4))}`)
    await tasas.first().scrollIntoViewIfNeeded().catch(() => {})
    await page.screenshot({ path: `${OUT}/9-super-pagos.png` })
    await page.context().close()
  }
} finally {
  await browser.close()
  // Limpieza: lo que creó el paso del pago (consultas, pagos, movimientos de
  // créditos). Borrar el canje devuelve el saldo que tenía el paciente.
  for (const id of creados.consultas) {
    await rest(`patient_credits?consultation_id=eq.${id}`, { method: 'DELETE' })
    await rest(`payments?consultation_id=eq.${id}`, { method: 'DELETE' })
    await rest(`consultations?id=eq.${id}`, { method: 'DELETE' })
  }
  for (const id of creados.creditos) await rest(`patient_credits?id=eq.${id}`, { method: 'DELETE' })
}
console.log(fallas ? `\n❌ ${fallas} en rojo` : '\n✅ Front OK')
process.exit(fallas ? 1 : 0)
