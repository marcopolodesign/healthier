#!/usr/bin/env node
// Prueba DESDE EL FRONT de "Solicitar receta" / "Ya tengo receta" (migraciones
// 254/256) — SÓLO STAGING.
//
//   node scripts/probar-solicitar-receta-front.mjs [base] [carpeta-capturas]
//   (base por defecto http://localhost:5191 con .env.local apuntando a staging)
//
// Super admin: marca a profesional@ como "médico de Healthier" con el switch.
// Paciente: Bóveda → Farmacia → busca → "Pedir receta" → hoja V3 → "Comprar y
//   pedir receta" → checkout → paga con la tarjeta de prueba APRO → pedido
//   "Esperando tu receta / Reservado, no cobrado".
// Médico: menú "Pedidos de receta" → Tomar → consulta con el pedido → (receta
//   emitida) → "Receta lista: cobrar y enviar" → pedido "Cobrado".
// Otro pedido: el médico "No corresponde recetar" → paciente ve "No se te cobró nada".
// "Ya tengo receta": el paciente sube una foto → paga → la farmacia la ve,
//   rechaza la primera y aprueba la segunda.
// Super admin: Farmacia muestra lo reservado y la columna Receta.
//
// Siembra durante la corrida un vendedor simulado de MP para la farmacia (igual
// que verificar-solicitar-receta.mjs) y lo borra al final.
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, mkdirSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:5191'
const OUT = process.argv[3] ?? '/tmp/solicitar-receta-front'
if (/gethealthier\.vercel\.app|www\.healthier\.com\.ar/.test(BASE)) throw new Error('Esto no corre contra producción.')
mkdirSync(OUT, { recursive: true })
const SOLO = process.env.SOLO ? process.env.SOLO.split(',') : null
const corre = paso => !SOLO || SOLO.includes(paso)

const leer = ruta => {
  try {
    return Object.fromEntries(readFileSync(ruta, 'utf8').split('\n')
      .filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')] }))
  } catch { return {} }
}
const env = { ...leer(`${process.env.HOME}/Local/Healthier/website/.env`), ...leer(`${process.env.HOME}/Local/.env`) }
const SB_URL = env.HEALTHIER_STAGING_SUPABASE_URL
const admin = createClient(SB_URL, env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY)
const MP_TEST_TOKEN = env.MP_ACCESS_TOKEN_SANDBOX
const FARMACIA_ID = '10000000-0000-0000-0000-000000000001'
const PRODUCTO = 'Amoxicilina 500mg x 21'
const PACIENTE = 'paciente@healthier.app'
const MEDICO = 'profesional@healthier.app'

let fallas = 0
const ok = (cond, msg) => { console.log(`${cond ? '✅' : '❌'} ${msg}`); if (!cond) fallas++ }
const restaurar = []
const foto = async (page, nombre) => page.screenshot({ path: `${OUT}/${nombre}.png`, fullPage: false })

async function entrarCon(page, email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw error
  await page.goto(`${BASE}/login`)
  await page.evaluate(async ({ url, anon, hash }) => {
    const r = await fetch(`${url}/auth/v1/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anon }, body: JSON.stringify({ type: 'magiclink', token_hash: hash }) })
    const s = await r.json()
    localStorage.clear()
    localStorage.setItem(`sb-${new URL(url).hostname.split('.')[0]}-auth-token`, JSON.stringify({ access_token: s.access_token, token_type: s.token_type, expires_in: s.expires_in, expires_at: s.expires_at, refresh_token: s.refresh_token, user: s.user }))
  }, { url: SB_URL, anon: env.HEALTHIER_STAGING_SUPABASE_ANON_KEY, hash: data.properties.hashed_token })
  await page.goto(`${BASE}/login`)
  await page.waitForURL(u => !/\/login/.test(u.pathname), { timeout: 20000 })
}

const idDe = async email => (await admin.from('profiles').select('id').eq('email', email).eq('role', email === PACIENTE ? 'patient' : 'professional').order('created_at').limit(1)).data?.[0]?.id
const ultimoPedido = async pacienteId => (await admin.from('medication_orders')
  .select('id, payment_status, status, receta_estado, receta_medico_id, receta_consulta_id, total')
  .eq('patient_id', pacienteId).neq('payment_status', 'no_pagado').order('created_at', { ascending: false }).limit(1).maybeSingle()).data

/** Suelta las reservas que dejó una corrida anterior (mp-capture, con la service key). */
async function liberarPendientes(pacienteId) {
  const { data } = await admin.from('medication_orders').select('id').eq('patient_id', pacienteId).eq('payment_status', 'autorizado')
  for (const o of data ?? []) {
    await fetch(`${SB_URL}/functions/v1/mp-capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ action: 'cancel-pharmacy-order', orderId: o.id, motivo: 'Limpieza de la prueba.' }),
    })
  }
}

/** El "Tomar" de la tarjeta del paciente de la prueba (puede haber pedidos de otros). */
const tomarDelPaciente = page => page.locator('div.rounded-\\[20px\\]', { hasText: 'Paciente Demo' })
  .getByRole('button', { name: 'Tomar' }).last()

async function vaciarCarrito(pacienteId) {
  await liberarPendientes(pacienteId)
  const { data } = await admin.from('medication_orders').select('id').eq('patient_id', pacienteId).eq('payment_status', 'no_pagado').eq('status', 'pendiente')
  for (const o of data ?? []) await admin.from('medication_orders').delete().eq('id', o.id)
}

/** Bóveda → Farmacia → busca el producto → "Pedir receta". */
async function abrirHoja(page) {
  await page.goto(`${BASE}/paciente/documentos`)
  await page.getByText('Farmacia', { exact: true }).first().click()
  await page.waitForURL(/\/paciente\/farmacia/, { timeout: 15000 })
  const buscar = page.getByPlaceholder('Buscar productos…')
  await buscar.click()
  await buscar.pressSequentially('amoxicilina 500', { delay: 30 })
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: /Pedir receta/ }).first().click()
  await page.getByText('Te hacemos la receta, sin costo.').waitFor({ timeout: 10000 })
  await page.waitForTimeout(900) // que termine de subir la hoja
}

/** Del carrito al pago con la tarjeta de prueba de crédito (Mastercard APRO). */
async function pagarConTarjetaDePrueba(page, prefijo) {
  await page.getByRole('button', { name: /Proceder al checkout/ }).click()
  await page.waitForURL(/\/paciente\/farmacia\/checkout/)
  await page.getByRole('button', { name: /Continuar a pago/ }).click()
  await page.waitForURL(/\/paciente\/farmacia\/pago/)
  await page.getByText(/Reservamos el pago en tu tarjeta de crédito/).waitFor({ timeout: 15000 })
  await foto(page, `${prefijo}-pago-aviso-reserva`)
  if (process.env.TARJETA === 'guardada') {
    // La tarjeta guardada (camino de "tarjeta guardada + CVV"): sólo el código.
    await page.waitForTimeout(4000)
    await page.locator('#cvv-tarjeta-guardada').fill('123')
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: /Reservar y pedir receta/ }).click()
    await page.waitForURL(/\/paciente\/farmacia\/pedido\//, { timeout: 40000 })
    return
  }
  await page.getByRole('button', { name: /Agregar nueva tarjeta/i }).click()
  await page.getByLabel(/Guardar esta tarjeta/).uncheck().catch(() => {})
  await page.waitForTimeout(4000)
  const seguros = page.locator('iframe[src*="secure-fields"], iframe[name*="cardNumber"], iframe[name*="expirationDate"], iframe[name*="securityCode"]')
  await seguros.first().waitFor({ timeout: 20000 })
  const valores = ['5031755734530604', '11/30', '123']
  for (let i = 0; i < Math.min(3, await seguros.count()); i++) {
    await seguros.nth(i).contentFrame().locator('input:visible').first().fill(valores[i])
  }
  await page.locator('input[name="HOLDER_NAME"], #form-checkout__cardholderName, input[id*="cardholderName"]').first().fill('APRO')
  const doc = page.locator('input[name="IDENTIFICATION_NUMBER"], input[id*="identificationNumber"], input[placeholder="99999999"]').first()
  if (await doc.isVisible().catch(() => false)) { await doc.click(); await doc.pressSequentially('12345678', { delay: 40 }); await doc.press('Tab') }
  await page.waitForTimeout(1500)
  const mail = page.locator('input[name="EMAIL"], input[id*="email"]').first()
  if (await mail.isVisible().catch(() => false)) await mail.fill('comprador.prueba@example.com')
  const pagar = page.getByRole('button', { name: /^Pagar|Reservar y pedir receta/ }).last()
  await pagar.click()
  await page.waitForURL(/\/paciente\/farmacia\/pedido\//, { timeout: 15000 }).catch(async () => {
    await pagar.click().catch(() => {})
    await page.waitForURL(/\/paciente\/farmacia\/pedido\//, { timeout: 40000 })
  })
}

const browser = await chromium.launch()
let actual = null
const nueva = async (viewport = { width: 390, height: 844 }) => {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  actual = page
  page.on('pageerror', e => console.log(`   [pageerror] ${e.message}`))
  page.on('response', async r => {
    if (/functions\/v1\/mp-/.test(r.url()) && r.request().method() === 'POST') {
      console.log(`   [${r.url().split('/').pop()}] ${r.status()} ${(await r.text().catch(() => '')).slice(0, 300)}`)
    }
  })
  return page
}

try {
  const pacienteId = await idDe(PACIENTE)
  const medicoId = await idDe(MEDICO)

  // Vendedor simulado de MP para la farmacia, sólo durante la corrida.
  const { data: yaTenia } = await admin.from('pharmacy_mp_accounts').select('pharmacy_id').eq('pharmacy_id', FARMACIA_ID).maybeSingle()
  if (!yaTenia) {
    const yo = await fetch('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${MP_TEST_TOKEN}` } }).then(r => r.json())
    await admin.from('pharmacy_mp_accounts').insert({
      pharmacy_id: FARMACIA_ID, mp_user_id: String(yo.id), access_token: MP_TEST_TOKEN, active: true, live_mode: false,
      mp_nickname: 'vendedor-simulado-front', connected_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(),
    })
    restaurar.push(() => admin.from('pharmacy_mp_accounts').delete().eq('pharmacy_id', FARMACIA_ID).eq('mp_nickname', 'vendedor-simulado-front'))
  }

  // ── 1. Super admin: el switch "Médico de Healthier" ─────────────────────
  if (corre('admin')) {
    await admin.from('professional_profiles').update({ medico_healthier: false }).eq('user_id', medicoId)
    const page = await nueva({ width: 1440, height: 900 })
    await entrarCon(page, 'superadmin@healthier.app')
    await page.getByRole('button', { name: /^Profesionales$/ }).first().click().catch(() => {})
    await page.getByRole('link', { name: /Verificados/ }).first().click()
    await page.waitForURL(/\/super-admin\/profesionales/)
    // Las cuentas demo de staging son "de prueba" (229): se incluyen.
    await page.getByLabel(/Incluir cuentas de prueba/).check().catch(() => {})
    await page.getByPlaceholder(/Buscar profesional/).fill(MEDICO)
    await page.getByText('Valentina Ortega').first().click()
    const sw = page.getByRole('switch', { name: 'Médico de Healthier' })
    await sw.waitFor({ timeout: 15000 })
    await sw.scrollIntoViewIfNeeded()
    await sw.click()
    await page.getByText('Ahora atiende los pedidos de receta').waitFor({ timeout: 10000 })
    await foto(page, 'web-superadmin-switch-medico')
    const { data: pp } = await admin.from('professional_profiles').select('medico_healthier').eq('user_id', medicoId).single()
    ok(pp.medico_healthier === true, 'super admin: el switch marca a profesional@ como médico de Healthier')
    await page.context().close()
  }

  // ── 2. Paciente: hoja V3 → comprar y pedir receta → reserva ─────────────
  let pedidoA = null
  if (corre('solicitar')) {
    await vaciarCarrito(pacienteId)
    const page = await nueva()
    await entrarCon(page, PACIENTE)
    await abrirHoja(page)
    await foto(page, 'web-paciente-hoja-v3')
    ok(await page.getByRole('button', { name: 'Comprar y pedir receta' }).isVisible(), 'hoja V3: "Comprar y pedir receta" + "Ya tengo receta" + "Videoconsulta"')
    await page.getByRole('button', { name: 'Comprar y pedir receta' }).click()
    await page.getByRole('button', { name: /Proceder al checkout/ }).waitFor({ timeout: 15000 })
    await foto(page, 'web-paciente-carrito')
    await pagarConTarjetaDePrueba(page, 'web-paciente')
    await page.getByText('Esperando tu receta').waitFor({ timeout: 20000 })
    await foto(page, 'web-paciente-pedido-esperando')
    pedidoA = await ultimoPedido(pacienteId)
    ok(pedidoA?.payment_status === 'autorizado' && pedidoA?.receta_estado === 'pendiente', `pedido reservado: ${JSON.stringify(pedidoA)}`)
    ok(await page.getByText('Reservado, no cobrado').isVisible(), 'pantalla: "Reservado, no cobrado"')
    await page.context().close()
  }

  // ── 3. Médico: Pedidos de receta → Tomar → consulta → cobrar ────────────
  if (corre('medico')) {
    pedidoA ??= await ultimoPedido(pacienteId)
    const page = await nueva({ width: 1440, height: 900 })
    await entrarCon(page, MEDICO)
    await page.getByRole('link', { name: /Pedidos de receta/ }).first().click()
    await page.waitForURL(/\/profesional\/pedidos-receta/)
    await tomarDelPaciente(page).waitFor({ timeout: 15000 })
    await foto(page, 'web-medico-tablero')
    await tomarDelPaciente(page).click()
    await page.waitForURL(/\/profesional\/consulta\//, { timeout: 20000 })
    await page.getByText('Pedido de receta de farmacia').waitFor({ timeout: 20000 })
    await foto(page, 'web-medico-consulta-con-pedido')
    const tomado = await ultimoPedido(pacienteId)
    ok(tomado?.receta_estado === 'en_curso' && tomado?.receta_medico_id === medicoId, 'el médico tomó el pedido y se abrió la consulta')

    // La receta: en homologación se puede emitir, pero el Recetario necesita
    // firma, catálogo y obra social. Si EMITIR_POR_FRONT no está, se siembra
    // la receta emitida igual que verificar-solicitar-receta.mjs (sólo script).
    if (!process.env.EMITIR_POR_FRONT) {
      const { data: rx } = await admin.from('clinical_medications').insert({
        patient_id: pacienteId, professional_id: medicoId, professional_license_type: 'MN', professional_license_number: '0',
        medication_name: PRODUCTO, dosage_text: 'cada 8 horas', rcta_status: 'issued', rcta_issued_at: new Date().toISOString(),
      }).select('id').single()
      restaurar.push(() => admin.from('clinical_medications').update({ status: 'cancelled' }).eq('id', rx.id))
      console.log('   · receta emitida sembrada por script (no por el Recetario)')
    }
    const cobrar = page.getByRole('button', { name: /Receta lista: cobrar y enviar a la farmacia/ })
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => /Receta lista: cobrar/.test(b.textContent) && !b.disabled), null, { timeout: 30000 })
    await foto(page, 'web-medico-consulta-lista-para-cobrar')
    await cobrar.click()
    await page.waitForURL(/\/profesional\/pedidos-receta/, { timeout: 30000 })
    await page.getByText(/Enviado a la farmacia/).first().waitFor({ timeout: 20000 })
    await foto(page, 'web-medico-tablero-hoy')
    const cobrado = await ultimoPedido(pacienteId)
    ok(cobrado?.payment_status === 'pagado' && cobrado?.receta_estado === 'resuelta', `cobrado: ${JSON.stringify(cobrado)}`)
    await page.context().close()

    const pac = await nueva()
    await entrarCon(pac, PACIENTE)
    await pac.goto(`${BASE}/paciente/farmacia/pedidos`)
    await pac.getByText(/Pedido confirmado|La farmacia lo está preparando/).first().click()
    await pac.getByText('Cobrado', { exact: true }).waitFor({ timeout: 15000 })
    await foto(pac, 'web-paciente-pedido-cobrado')
    ok(true, 'paciente: el pedido se ve "Cobrado" con el médico que lo atendió')
    await pac.context().close()
  }

  // ── 4. Otro pedido: "No corresponde recetar" → liberado ─────────────────
  if (corre('rechazo')) {
    await vaciarCarrito(pacienteId)
    const page = await nueva()
    await entrarCon(page, PACIENTE)
    await abrirHoja(page)
    await page.getByRole('button', { name: 'Comprar y pedir receta' }).click()
    await page.getByRole('button', { name: /Proceder al checkout/ }).waitFor({ timeout: 15000 })
    await pagarConTarjetaDePrueba(page, 'web-paciente-2')
    await page.getByText('Esperando tu receta').waitFor({ timeout: 20000 })

    const med = await nueva({ width: 1440, height: 900 })
    await entrarCon(med, MEDICO)
    await med.getByRole('link', { name: /Pedidos de receta/ }).first().click()
    await tomarDelPaciente(med).click()
    await med.waitForURL(/\/profesional\/consulta\//, { timeout: 20000 })
    await med.getByRole('button', { name: 'No corresponde recetar' }).click()
    await med.getByPlaceholder(/Ej.: Necesitás una consulta/).fill('Necesitás una consulta presencial antes de empezar este tratamiento.')
    await foto(med, 'web-medico-no-corresponde')
    await med.getByRole('button', { name: /Cancelar el pedido sin cobrar/ }).click()
    await med.waitForURL(/\/profesional\/pedidos-receta/, { timeout: 20000 })
    await med.context().close()

    await page.waitForTimeout(6000)
    await page.reload()
    await page.getByText('No se te cobró nada').waitFor({ timeout: 30000 })
    await foto(page, 'web-paciente-pedido-liberado')
    const libId = page.url().split('/pedido/')[1]
    const lib = (await admin.from('medication_orders').select('id, payment_status, status, receta_estado').eq('id', libId).single()).data
    ok(lib?.status === 'cancelado' && lib?.receta_estado === 'rechazada', `liberado: ${JSON.stringify(lib)}`)
    await page.context().close()
  }

  // ── 5. "Ya tengo receta": subir → farmacia rechaza / aprueba ────────────
  if (corre('subida')) {
    const img = `${OUT}/receta-de-prueba.png`
    // Una "receta" mínima: un PNG generado en el momento.
    const p0 = await nueva({ width: 600, height: 800 })
    await p0.setContent('<div style="font:24px serif;padding:40px;background:#fff;height:720px">Rp/<br><br>Amoxicilina 500mg x 21<br>1 caja<br><br>Dra. Prueba · MN 0<br>26/11/2026</div>')
    await p0.screenshot({ path: img })
    await p0.context().close()

    for (const [n, aprobar] of [[1, false], [2, true]]) {
      await vaciarCarrito(pacienteId)
      const page = await nueva()
      await entrarCon(page, PACIENTE)
      await abrirHoja(page)
      const elegir = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: 'Ya tengo receta' }).click()
      await (await elegir).setFiles(img)
      await page.getByText('¿Se lee bien?').waitFor()
      await page.waitForTimeout(500)
      if (n === 1) await foto(page, 'web-paciente-ya-tengo-receta')
      await page.getByRole('button', { name: /Usar esta/ }).click()
      await page.getByRole('button', { name: /Proceder al checkout/ }).waitFor({ timeout: 20000 })
      await pagarConTarjetaDePrueba(page, `web-paciente-subida-${n}`)
      await page.getByText('La farmacia está revisando tu receta').waitFor({ timeout: 20000 })
      if (n === 1) await foto(page, 'web-paciente-pedido-farmacia-revisando')
      const pedido = await ultimoPedido(pacienteId)

      const far = await nueva({ width: 1440, height: 900 })
      await entrarCon(far, 'farmacia@staging.healthier.app')
      await far.getByRole('link', { name: 'Pedidos' }).first().click().catch(() => {})
      await far.waitForURL(/\/farmacia\/pedidos/)
      if (n === 1) await foto(far, 'web-farmacia-lista')
      await far.getByRole('button', { name: 'Revisar receta' }).first().click()
      await far.getByText('Receta subida por el paciente', { exact: true }).waitFor({ timeout: 15000 })
      await far.waitForTimeout(1500)
      if (n === 1) await foto(far, 'web-farmacia-revisar-receta')
      if (aprobar) {
        await far.getByRole('button', { name: 'Aprobar receta' }).click()
      } else {
        await far.getByRole('button', { name: 'Rechazar' }).click()
        await far.getByPlaceholder(/No se lee la fecha/).fill('No se lee la fecha de la receta.')
        await far.getByRole('button', { name: 'Rechazar receta' }).click()
      }
      await far.waitForTimeout(8000)
      const fin = (await admin.from('medication_orders').select('payment_status, status, receta_estado').eq('id', pedido.id).single()).data
      ok(aprobar ? fin.payment_status === 'pagado' : (fin.status === 'cancelado' && fin.payment_status !== 'pagado'),
        `farmacia ${aprobar ? 'aprueba → cobrado' : 'rechaza → liberado'}: ${JSON.stringify(fin)}`)
      await far.reload()
      await far.waitForTimeout(1500)
      await foto(far, `web-farmacia-${aprobar ? 'aprobada' : 'rechazada'}`)
      await far.context().close()
      await page.reload()
      await page.waitForTimeout(1500)
      await foto(page, `web-paciente-subida-${aprobar ? 'cobrado' : 'liberado'}`)
      await page.context().close()
    }
  }

  // ── 6. Super admin: Farmacia ────────────────────────────────────────────
  if (corre('adminfarmacia')) {
    const page = await nueva({ width: 1440, height: 900 })
    await entrarCon(page, 'superadmin@healthier.app')
    await page.getByRole('link', { name: 'Farmacia' }).first().click()
    await page.waitForURL(/\/super-admin\/farmacia/)
    await page.getByLabel(/Incluir cuentas de prueba/).check().catch(() => {})
    await page.waitForTimeout(2000)
    await page.getByText('Reservado, esperando receta').waitFor({ timeout: 15000 })
    await page.locator('th', { hasText: 'Receta' }).scrollIntoViewIfNeeded()
    await foto(page, 'web-superadmin-farmacia')
    ok(true, 'super admin: Farmacia muestra lo reservado y la columna Receta')
    await page.context().close()
  }
} catch (e) {
  fallas++
  console.log(`❌ ${e.message.split('\n')[0]}\n${(e.stack ?? '').split('\n').find(l => l.includes('probar-solicitar')) ?? ''}`)
  if (actual) await actual.screenshot({ path: `${OUT}/_error.png` }).catch(() => {})
} finally {
  for (const f of restaurar.reverse()) await Promise.resolve().then(f).catch(() => {})
  await browser.close()
}

console.log(fallas ? `\n❌ ${fallas} falla(s). Capturas en ${OUT}` : `\n✅ Todo en verde. Capturas en ${OUT}`)
process.exit(fallas ? 1 : 0)
