#!/usr/bin/env node
// Prueba DESDE EL FRONT del beneficio LIFT (migración 252) — staging.
//
//   node scripts/probar-beneficio-socio-front.mjs [base] [carpeta-capturas]
//   (base por defecto https://staging.healthier.com.ar)
//
// Paciente: /r/lift → crear cuenta (dice "Beneficio LIFT") → Perfil muestra el
// beneficio → reservar un turno → la pantalla de pago muestra −20% → paga con
// la tarjeta de prueba APRO → reservar otro → la pantalla de pago ya no muestra
// el descuento. Super admin: /super-admin/socios muestra al paciente, el
// descuento usado y el QR.
//
// Sólo staging: siembra durante la corrida un vendedor simulado de MP para el
// profesional (igual que verificar-despacho-ondemand.mjs) y lo borra al final.
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, mkdirSync } from 'node:fs'

const BASE = process.argv[2] ?? 'https://staging.healthier.com.ar'
const OUT = process.argv[3] ?? '/tmp/beneficio-socio-capturas'
if (/gethealthier\.vercel\.app|www\.healthier\.com\.ar/.test(BASE)) throw new Error('Esto no corre contra producción.')
mkdirSync(OUT, { recursive: true })

const env = Object.fromEntries(readFileSync(`${process.env.HOME}/Local/.env`, 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')] }))
const webEnv = (() => {
  try {
    return Object.fromEntries(readFileSync(`${process.env.HOME}/Local/Healthier/website/.env`, 'utf8').split('\n')
      .filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')] }))
  } catch { return {} }
})()
const SB_URL = env.HEALTHIER_STAGING_SUPABASE_URL
const admin = createClient(SB_URL, env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY)
const MP_TEST_TOKEN = env.MP_ACCESS_TOKEN_SANDBOX ?? webEnv.MP_ACCESS_TOKEN_SANDBOX

const stamp = Date.now()
const password = `Qa${Math.random().toString(36).slice(2, 8)}${stamp.toString(36)}!A1`
let fallas = 0
const ok = (cond, msg) => { console.log(`${cond ? '✅' : '❌'} ${msg}`); if (!cond) fallas++ }
const restaurar = []

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
}

/** Próximo día hábil (lun–vie) en Buenos Aires, a partir de pasado mañana. */
function proximoHabil(offset = 2) {
  const d = new Date(Date.now() + offset * 86400000)
  while ([0, 6].includes(new Date(d.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' })).getDay())) d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
}

/** Del wizard con el turno precargado hasta /paciente/pago. */
async function irAPagar(page, proUserId, fecha, hora, captura) {
  await page.goto(`${BASE}/paciente/reservar?vertical=clinica&proId=${proUserId}&modality=virtual&fecha=${fecha}&hora=${hora}`)
  for (let i = 0; i < 6 && !/\/paciente\/pago/.test(page.url()); i++) {
    const boton = page.getByRole('button', { name: /^(Continuar|Ir al pago|Ir a pagar|Confirmar)/ }).last()
    await boton.waitFor({ timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(800)
    if (await boton.isEnabled().catch(() => false)) await boton.click().catch(() => {})
    await page.waitForTimeout(1200)
  }
  await page.waitForURL(/\/paciente\/pago/, { timeout: 15000 }).catch(() => {})
  await page.getByText('A pagar hoy').waitFor({ timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/${captura}.png`, fullPage: true })
}

const browser = await chromium.launch()
try {
  // ── Profesional de prueba con MP simulado ─────────────────────────────
  const { data: pro } = await admin.from('profiles').select('id').eq('email', 'profesional@healthier.app').single()
  const { data: pp } = await admin.from('professional_profiles').select('price_video').eq('user_id', pro.id).single()
  const PRECIO = Number(pp.price_video)
  const { data: yaTenia } = await admin.from('mp_accounts').select('id').eq('professional_id', pro.id).maybeSingle()
  if (!yaTenia && MP_TEST_TOKEN) {
    const yo = await fetch('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${MP_TEST_TOKEN}` } }).then(r => r.json())
    await admin.from('mp_accounts').insert({
      professional_id: pro.id, mp_user_id: String(yo.id), access_token: MP_TEST_TOKEN, active: true, live_mode: false,
      mp_nickname: 'vendedor-simulado-control', connected_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(),
    })
    restaurar.push(() => admin.from('mp_accounts').delete().eq('professional_id', pro.id).eq('mp_nickname', 'vendedor-simulado-control'))
  }

  // ── 1. Paciente: link de LIFT → alta ──────────────────────────────────
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const email = `qa-lift-front-${stamp}@staging.healthier.app`
  await page.goto(`${BASE}/r/lift`)
  await page.getByText(/20% off en tu primera consulta/).waitFor({ timeout: 15000 }).catch(() => {})
  await page.screenshot({ path: `${OUT}/1-landing-lift.png` })
  ok(await page.getByText(/20% off en tu primera consulta/).isVisible(), '/r/lift muestra "20% off en tu primera consulta"')
  await page.getByRole('link', { name: /Crear mi cuenta/ }).click()
  await page.getByRole('button', { name: /Continuar con email/i }).click()
  await page.getByLabel('Nombre', { exact: true }).fill('Socia QA')
  await page.getByLabel('Apellido', { exact: true }).fill('Lift')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="tel"]').fill('11 5555 0199')
  await page.locator('input[type="password"]').fill(password)
  ok(await page.getByText(/Beneficio\s+LIFT\s+en tu primera consulta/).isVisible(), 'el alta dice "Beneficio LIFT en tu primera consulta"')
  await page.screenshot({ path: `${OUT}/2-registro.png` })
  await page.getByRole('button', { name: /Crear cuenta/i }).click()
  await page.waitForURL(/onboarding|dashboard/, { timeout: 25000 }).catch(() => {})
  const { data: perfil } = await admin.from('profiles').select('id').eq('email', email).single()
  // El onboarding del paciente (5 pasos) no es parte de esto y tiene su propio
  // control: se da por terminado para seguir con el beneficio.
  await admin.from('profiles').update({
    es_prueba: true, dni: String(30000000 + (stamp % 9999999)), gender: 'femenino', birth_date: '1990-05-05',
    coverage_type: 'particular', consentimiento_at: new Date().toISOString(), consentimiento_version: '3.0',
    onboarding_completado_at: new Date().toISOString(),
  }).eq('id', perfil.id)
  await page.goto(`${BASE}/paciente/dashboard`)
  await page.waitForTimeout(2000)
  const { data: atr } = await admin.from('socio_atribuciones').select('origen').eq('paciente_id', perfil.id).maybeSingle()
  ok(atr?.origen === 'link', `quedó atribuida a LIFT por el link (${atr?.origen})`)

  // ── 2. Perfil muestra el beneficio ────────────────────────────────────
  await page.goto(`${BASE}/paciente/perfil`)
  await page.getByTestId('beneficio-socio').waitFor({ timeout: 15000 }).catch(() => {})
  await page.screenshot({ path: `${OUT}/3-perfil.png`, fullPage: true })
  ok(/20% off en tu primera consulta/.test(await page.getByTestId('beneficio-socio').textContent().catch(() => '')), 'Perfil: "Beneficio LIFT · 20% off en tu primera consulta"')

  // ── 3. Primer turno: −20% ─────────────────────────────────────────────
  const fecha1 = proximoHabil(2)
  await irAPagar(page, pro.id, fecha1, '10:00', '4-pago-primera')
  const texto1 = await page.locator('body').innerText()
  const conDesc = (PRECIO * 0.8).toLocaleString('es-AR')
  ok(/Beneficio LIFT \(20%\)/.test(texto1) && texto1.includes(`$${conDesc}`), `pantalla de pago: "Beneficio LIFT (20%)" y a pagar $${conDesc} (url ${page.url()})`)

  // Pagar con tarjeta nueva de prueba (Brick de MP).
  let pagado = false
  try {
    await page.getByRole('button', { name: /Agregar nueva tarjeta/i }).click()
    // Pagar sin guardar la tarjeta (modo cobro del Brick).
    await page.getByLabel(/Guardar esta tarjeta/).uncheck()
    await page.waitForTimeout(4000)
    // Los campos sensibles del Brick son iframes de MP (secure fields), en orden: número, vencimiento, CVV.
    const seguros = page.locator('iframe[src*="secure-fields"], iframe[name*="cardNumber"], iframe[name*="expirationDate"], iframe[name*="securityCode"]')
    await seguros.first().waitFor({ timeout: 20000 })
    const nombres = await seguros.evaluateAll(fs => fs.map(f => f.getAttribute('name') || f.getAttribute('id') || f.src))
    console.log(`   iframes del Brick: ${nombres.join(' | ')}`)
    const valores = ['5031755734530604', '11/30', '123']
    for (let i = 0; i < Math.min(3, await seguros.count()); i++) {
      await seguros.nth(i).contentFrame().locator('input:visible').first().fill(valores[i])
    }
    await page.locator('input[name="HOLDER_NAME"], #form-checkout__cardholderName, input[id*="cardholderName"]').first().fill('APRO')
    const doc = page.locator('input[name="IDENTIFICATION_NUMBER"], input[id*="identificationNumber"], input[placeholder="99999999"]').first()
    if (await doc.isVisible().catch(() => false)) {
      await doc.click()
      await doc.pressSequentially('12345678', { delay: 40 })
      await doc.press('Tab')
    }
    await page.waitForTimeout(1500)
    const mail = page.locator('input[name="EMAIL"], input[id*="email"]').first()
    if (await mail.isVisible().catch(() => false)) await mail.fill('comprador.prueba@example.com')
    await page.screenshot({ path: `${OUT}/5-brick.png`, fullPage: true })
    const pagar = page.getByRole('button', { name: /^Pagar|Confirmar y Pagar/ }).last()
    await pagar.click()
    // El Brick a veces valida el documento recién en el primer intento: un reintento.
    await page.waitForURL(/turno-confirmado/, { timeout: 15000 }).catch(async () => {
      await pagar.click().catch(() => {})
      await page.waitForURL(/turno-confirmado/, { timeout: 40000 })
    })
    pagado = true
  } catch (e) {
    await page.screenshot({ path: `${OUT}/5-brick-error.png`, fullPage: true })
    console.log(`   (no se pudo completar el Brick desde el front: ${e.message.split('\n')[0]})`)
  }
  ok(pagado, 'pagó desde el front con la tarjeta de prueba APRO')
  const { data: pago1 } = await admin.from('payments').select('charged_amount, descuento_socio, precio_lista, status')
    .eq('patient_id', perfil.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  ok(pago1?.status === 'approved' && Number(pago1?.charged_amount) === PRECIO * 0.8 && Number(pago1?.descuento_socio) === PRECIO * 0.2,
    `cobro: ${JSON.stringify(pago1)}`)

  // ── 4. Segundo turno: sin descuento ───────────────────────────────────
  await irAPagar(page, pro.id, proximoHabil(3), '11:00', '6-pago-segunda')
  const texto2 = await page.locator('body').innerText()
  ok(!/Beneficio LIFT/.test(texto2) && texto2.includes(`$${PRECIO.toLocaleString('es-AR')}`), `segundo turno sin descuento: a pagar $${PRECIO.toLocaleString('es-AR')}`)
  await page.goto(`${BASE}/paciente/perfil`)
  await page.getByTestId('beneficio-socio').waitFor({ timeout: 15000 }).catch(() => {})
  ok(/Ya lo usaste/.test(await page.getByTestId('beneficio-socio').textContent().catch(() => '')), 'Perfil: "Ya lo usaste en tu primera consulta"')
  await page.close()

  // ── 5. Super admin ────────────────────────────────────────────────────
  const sa = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await entrarCon(sa, 'superadmin@healthier.app')
  await sa.waitForTimeout(1500)
  await sa.goto(`${BASE}/super-admin/dashboard`)
  await sa.getByRole('link', { name: /Socios comerciales/ }).first().click().catch(async () => {
    await sa.getByRole('button', { name: /Pacientes/ }).first().click()
    await sa.getByRole('link', { name: /Socios comerciales/ }).first().click()
  })
  await sa.waitForURL(/super-admin\/socios/, { timeout: 15000 }).catch(() => {})
  await sa.getByText('Incluir', { exact: false }).first().click().catch(() => {})
  await sa.getByText(email).waitFor({ timeout: 15000 }).catch(() => {})
  await sa.screenshot({ path: `${OUT}/7-super-admin-socios.png`, fullPage: true })
  const textoSa = await sa.locator('body').innerText()
  ok(/super-admin\/socios/.test(sa.url()), `se llega desde el menú (${sa.url()})`)
  ok(textoSa.includes(email), 'el super admin ve a la socia nueva')
  const fila = await sa.locator('tr', { hasText: email }).innerText().catch(() => '')
  ok(/Usado/.test(fila), `y su descuento como "Usado" (${fila.replace(/\s+/g, ' ')})`)
  ok(await sa.locator('img[alt^="QR de LIFT"]').isVisible().catch(() => false), 'muestra el QR de LIFT')
  ok(/healthier\.com\.ar\/r\/lift/.test(textoSa), 'con el link público /r/lift')
} catch (err) {
  fallas++
  console.error(`❌ ${err.message}`)
} finally {
  for (const fn of restaurar.reverse()) await fn()
  await browser.close()
}
console.log(fallas ? `\n❌ ${fallas} falla(s) — capturas en ${OUT}` : `\n✅ Todo en orden — capturas en ${OUT}`)
process.exit(fallas ? 1 : 0)
