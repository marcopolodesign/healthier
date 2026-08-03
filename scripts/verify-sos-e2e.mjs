// E2E verification of the production SOS flow on gethealthier.vercel.app
// Paciente: real Chrome, regular (persistent) context. Profesional: incognito context.
// Usage: node scripts/verify-sos-e2e.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = 'https://gethealthier.vercel.app'
const SHOTS = '/tmp/sos-e2e'
fs.mkdirSync(SHOTS, { recursive: true })

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false })

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  if (/dashboard|admin|profesionales/.test(page.url())) { log(`already logged in: ${email} → ${page.url()}`); return }
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/dashboard|admin|profesionales/, { timeout: 20000 })
  log(`login ok: ${email} → ${page.url()}`)
}

const run = async () => {
  // ---- Paciente: regular Chrome window (persistent context) ----
  const patientCtx = await chromium.launchPersistentContext('/tmp/sos-e2e-chrome-profile', {
    channel: 'chrome',
    headless: false,
    viewport: { width: 420, height: 880 },
    geolocation: { latitude: -34.5885, longitude: -58.3974 },
    permissions: ['geolocation'],
  })
  const patient = patientCtx.pages()[0] ?? (await patientCtx.newPage())
  await login(patient, 'paciente@healthier.app', 'paciente')

  // 1. Dashboard: SOS card must be enabled (no "Próximamente", clickable)
  await patient.goto(`${BASE}/paciente/dashboard`, { waitUntil: 'networkidle' })
  await patient.waitForTimeout(2500)
  const proximamente = await patient.getByText('Próximamente').count()
  log(`dashboard: "Próximamente" pills found: ${proximamente} (expected 0 on SOS card)`)
  await shot(patient, '01-paciente-dashboard')

  // The SOS card is further down the scrollable home — bring it into view first
  const sosCard = patient.getByText('EMERGENCIA S.O.S').first()
  await sosCard.scrollIntoViewIfNeeded()
  await patient.waitForTimeout(1500)
  await shot(patient, '01b-sos-card')
  for (let i = 0; i < 4 && !/paciente\/sos/.test(patient.url()); i++) {
    await sosCard.click({ timeout: 5000 }).catch((e) => log(`click attempt ${i + 1} error: ${e.message.split('\n')[0]}`))
    await patient.waitForTimeout(2000)
  }
  if (!/paciente\/sos/.test(patient.url())) throw new Error(`SOS card click never navigated (url=${patient.url()})`)
  log('SOS card click → /paciente/sos OK')

  // 2. Triage or resume: if an active emergency exists we land straight on tracking
  await patient.waitForTimeout(2500)
  let bodyNow = await patient.locator('body').innerText()
  if (/UTM-\d{4}/.test(bodyNow)) {
    log(`RESUME PATH: landed directly on tracking for ${bodyNow.match(/UTM-\d{4}/)[0]}`)
  } else {
    await shot(patient, '02-triage-empty')
    await patient.getByText('Dolor opresivo en el pecho', { exact: false }).first().click()
    await patient.waitForTimeout(400)
    await shot(patient, '03-triage-selected')
    await patient.getByRole('button', { name: /continuar/i }).click()
    await patient.waitForTimeout(1200)

    // 3. Confirm: price + honest copy, then dispatch
    const bodyTxt = await patient.locator('body').innerText()
    log(`confirm screen mentions $50: ${bodyTxt.includes('50')}; mentions "finalizar": ${/finalizar/i.test(bodyTxt)}`)
    await shot(patient, '04-confirm')
    await patient.getByRole('button', { name: /solicitar/i }).click()
    log('dispatch requested…')
    await patient.waitForTimeout(6000)
  }
  await shot(patient, '05-tracking-dispatched')
  const track1 = await patient.locator('body').innerText()
  const code = (track1.match(/UTM-\d{4}/) ?? [])[0]
  log(`tracking: dispatch code=${code ?? 'NOT FOUND'}; Ortega shown=${track1.includes('Ortega')}`)

  // ---- Profesional: incognito context in the same real Chrome ----
  const proBrowser = await chromium.launch({ channel: 'chrome', headless: false })
  const proCtx = await proBrowser.newContext({ viewport: { width: 480, height: 900 } })
  const pro = await proCtx.newPage()
  await login(pro, 'profesional@healthier.app', 'profesional')

  // 4. Professional dashboard should show the emergency banner (fresh load)
  await pro.waitForTimeout(3000)
  const proDash = await pro.locator('body').innerText()
  log(`pro dashboard mentions emergencia: ${/emergencia/i.test(proDash)}`)
  await shot(pro, '06-pro-dashboard-banner')

  await pro.goto(`${BASE}/profesional/emergencias`, { waitUntil: 'networkidle' })
  await pro.waitForTimeout(2500)
  const proEm = await pro.locator('body').innerText()
  log(`pro emergencias: code match=${code && proEm.includes(code)}; symptom shown=${/dolor opresivo/i.test(proEm)}`)
  await shot(pro, '07-pro-emergencia-dispatched')

  // 5. Step statuses: En camino → Llegué → Cerrar
  const clickIf = async (re, name) => {
    const btn = pro.getByRole('button', { name: re }).first()
    if (await btn.count()) { await btn.click(); await pro.waitForTimeout(2500); log(`pro clicked: ${name}`) ; return true }
    log(`pro button NOT found: ${name}`); return false
  }
  await clickIf(/aceptar emergencia/i, 'Aceptar emergencia (→ in_transit)')
  await shot(pro, '08-pro-in-transit')

  // Patient side must reflect via realtime (no reload!) — verified visually via screenshots
  await patient.waitForTimeout(3000)
  await shot(patient, '09-paciente-in-transit-realtime')

  await clickIf(/llegué al paciente/i, 'Llegué al paciente (→ arrived)')
  await pro.waitForTimeout(1500)
  const proArr = await pro.locator('body').innerText()
  log(`pro arrived screen: symptom "Dolor opresivo" shown=${/dolor opresivo/i.test(proArr)}; honest empty state=${/sin síntomas registrados/i.test(proArr)}`)
  await shot(pro, '10-pro-arrived')
  await patient.waitForTimeout(3000)
  await shot(patient, '11-paciente-arrived-realtime')

  await clickIf(/cerrar emergencia/i, 'Cerrar emergencia (→ completed)')
  await pro.waitForTimeout(2500)
  await shot(pro, '12-pro-closed')
  await patient.waitForTimeout(4000)
  await shot(patient, '13-paciente-completed')
  log(`patient final url: ${patient.url()}`)

  // 6. Super-admin: emergencies page shows the run (new incognito-like context)
  const saCtx = await proBrowser.newContext({ viewport: { width: 1440, height: 900 } })
  const sa = await saCtx.newPage()
  await login(sa, 'superadmin@healthier.app', 'superadmin')
  await sa.goto(`${BASE}/super-admin/emergencias`, { waitUntil: 'networkidle' })
  await sa.waitForTimeout(2500)
  const saTxt = await sa.locator('body').innerText()
  log(`super-admin lists code ${code}: ${code && saTxt.includes(code)}; shows Completada: ${/completada/i.test(saTxt)}`)
  await shot(sa, '14-superadmin-emergencias')

  log('DONE')
  await patientCtx.close(); await proBrowser.close()
}

run().catch(async (e) => { console.error('E2E FAILED:', e.message); process.exit(1) })
