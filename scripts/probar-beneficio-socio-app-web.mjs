#!/usr/bin/env node
// La app (mobile/) corriendo con Expo web contra STAGING: beneficio LIFT.
//
//   cd mobile && (.env apuntando a staging) CI=1 npx expo start --web --port 8095
//   node website/scripts/probar-beneficio-socio-app-web.mjs [http://localhost:8095] [capturas]
//
// No reemplaza al simulador (no hay módulos nativos acá), pero recorre las
// mismas pantallas de la app: Perfil (cargar el código y ver el beneficio) y la
// pantalla de pago de un turno (línea del descuento y total).
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, mkdirSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:8095'
const OUT = process.argv[3] ?? '/tmp/beneficio-socio-app'
mkdirSync(OUT, { recursive: true })
const env = Object.fromEntries(readFileSync(`${process.env.HOME}/Local/.env`, 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')] }))
const SB_URL = env.HEALTHIER_STAGING_SUPABASE_URL
const admin = createClient(SB_URL, env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY)
const stamp = Date.now()
let fallas = 0
const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) fallas++ }

async function pacienteListo(nombre) {
  const email = `qa-lift-app-${nombre}-${stamp}@staging.healthier.app`
  const { data: u } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { role: 'patient', full_name: `App ${nombre} QA` } })
  await admin.from('profiles').update({
    es_prueba: true, first_name: 'App', last_name: `${nombre} QA`, phone: '+54 9 11 5555-0196',
    dni: String(33000000 + (stamp % 999999) + nombre.length), coverage_type: 'particular', gender: 'femenino', birth_date: '1990-01-01',
    consentimiento_at: new Date().toISOString(), consentimiento_version: '3.0', onboarding_completado_at: new Date().toISOString(),
  }).eq('id', u.user.id)
  return { email, id: u.user.id }
}

async function entrar(page, email) {
  const { data } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  await page.goto(BASE)
  await page.evaluate(async ({ url, anon, hash }) => {
    const r = await fetch(`${url}/auth/v1/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anon }, body: JSON.stringify({ type: 'magiclink', token_hash: hash }) })
    const s = await r.json()
    localStorage.setItem(`sb-${new URL(url).hostname.split('.')[0]}-auth-token`, JSON.stringify({ access_token: s.access_token, token_type: s.token_type, expires_in: s.expires_in, expires_at: s.expires_at, refresh_token: s.refresh_token, user: s.user }))
  }, { url: SB_URL, anon: env.HEALTHIER_STAGING_SUPABASE_ANON_KEY, hash: data.properties.hashed_token })
}

const browser = await chromium.launch()
try {
  // 1. Paciente sin beneficio → Perfil → carga "LIFT"
  const a = await pacienteListo('codigo')
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await entrar(page, a.email)
  await page.goto(`${BASE}/profile`)
  const fila = page.getByTestId('cargar-codigo')
  await fila.waitFor({ timeout: 60000 }).catch(() => {})
  await fila.scrollIntoViewIfNeeded().catch(() => {})
  await page.screenshot({ path: `${OUT}/1-perfil-cerrado.png` })
  ok(await fila.isVisible().catch(() => false), 'app · Perfil: "¿Tenés un código de beneficio?"')
  await fila.click().catch(() => {})
  await page.getByPlaceholder('Código').fill('lift').catch(() => {})
  await page.screenshot({ path: `${OUT}/2-perfil-formulario.png` })
  await page.getByText('Cargar', { exact: true }).click().catch(() => {})
  await page.getByTestId('beneficio-socio').waitFor({ timeout: 15000 }).catch(() => {})
  await page.screenshot({ path: `${OUT}/3-perfil-con-beneficio.png` })
  const { data: atr } = await admin.from('socio_atribuciones').select('origen').eq('paciente_id', a.id).maybeSingle()
  ok(atr?.origen === 'codigo', `app · cargó el código y quedó atribuido (${atr?.origen})`)
  ok(/20% de descuento en tu primera consulta/.test(await page.getByTestId('beneficio-socio').textContent().catch(() => '')), 'app · Perfil muestra "Beneficio LIFT · 20% de descuento…"')

  // 2. Pantalla de pago de un turno: −20% y total
  const { data: pro } = await admin.from('profiles').select('id, full_name').eq('email', 'profesional@healthier.app').single()
  const q = new URLSearchParams({ proName: pro.full_name, proId: pro.id, verticalName: 'Clínica', price: '18000', modality: 'virtual', scheduledAt: new Date(Date.now() + 3 * 86400000).toISOString() })
  await page.goto(`${BASE}/consultation/payment?${q}`)
  await page.getByTestId('beneficio-socio-pago').waitFor({ timeout: 30000 }).catch(() => {})
  await page.screenshot({ path: `${OUT}/4-pago.png` })
  const texto = await page.locator('body').innerText()
  ok(/Beneficio LIFT \(20%\)/.test(texto) && texto.includes('−$3.600') && texto.includes('$14.400'), 'app · pago: "Beneficio LIFT (20%) −$3.600" y total $14.400')
} catch (e) {
  fallas++
  console.error(`❌ ${e.message}`)
} finally {
  await browser.close()
}
console.log(fallas ? `\n❌ ${fallas} falla(s) — capturas en ${OUT}` : `\n✅ Todo en orden — capturas en ${OUT}`)
process.exit(fallas ? 1 : 0)
