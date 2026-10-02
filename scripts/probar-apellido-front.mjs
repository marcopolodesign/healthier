// Prueba DESDE EL FRONT del apellido obligatorio (migración 183): clic y tipeo
// en un Chromium real contra la URL que se le pase, con cuentas descartables
// `qa-apellido-*@healthier.app`. NUNCA contra producción.
//
//   node scripts/probar-apellido-front.mjs <base-url> <carpeta-capturas>
//
// Recorre:
//   1. Alta de paciente por mail: sin apellido no deja seguir; con apellido
//      queda guardado por separado.
//   2. Alta de profesional por mail: lo mismo.
// El paso para usuarios existentes se prueba aparte (necesita sesión por magic link).
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, mkdirSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:5199'
const OUT = process.argv[3] ?? '/tmp/apellido-capturas'
if (/gethealthier\.vercel\.app/.test(BASE)) throw new Error('Esto no corre contra producción.')
mkdirSync(OUT, { recursive: true })

const env = Object.fromEntries(readFileSync(`${process.env.HOME}/Local/.env`, 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')] }))
const admin = createClient(env.HEALTHIER_STAGING_SUPABASE_URL, env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY)

const stamp = Date.now()
const password = `Qa${Math.random().toString(36).slice(2, 8)}${stamp.toString(36)}!A1`
let fallas = 0
const ok = (cond, msg) => { console.log(`${cond ? '✅' : '❌'} ${msg}`); if (!cond) fallas++ }

async function alta({ ruta, rol, nombre, apellido, captura }) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const email = `qa-apellido-${rol}-${stamp}@healthier.app`
  await page.goto(`${BASE}${ruta}`)
  await page.getByRole('button', { name: /Continuar con email/i }).click()
  await page.getByLabel('Nombre', { exact: true }).fill(nombre)
  await page.getByLabel('Apellido', { exact: true }).fill('   ')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="tel"]').fill('11 5555 0101')
  await page.locator('input[type="password"]').fill(password)
  await page.screenshot({ path: `${OUT}/${captura}-1-formulario.png` })
  await page.getByRole('button', { name: /Crear cuenta/i }).click()
  const toast = page.locator('.fixed.top-4.right-4 p').first()
  await toast.waitFor({ timeout: 5000 }).catch(() => {})
  const textoToast = (await toast.textContent().catch(() => '')) ?? ''
  await page.screenshot({ path: `${OUT}/${captura}-2-sin-apellido.png` })
  const { data: antes } = await admin.from('profiles').select('id').eq('email', email).maybeSingle()
  ok(!antes && /apellido/i.test(textoToast), `${rol}: sin apellido no crea la cuenta (toast: "${textoToast}")`)

  await page.getByLabel('Apellido', { exact: true }).fill(apellido)
  await page.getByRole('button', { name: /Crear cuenta/i }).click()
  await page.waitForURL(/onboarding|dashboard/, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/${captura}-3-despues.png` })
  const { data: perfil } = await admin.from('profiles').select('full_name, first_name, last_name, role').eq('email', email).maybeSingle()
  ok(perfil?.first_name === nombre && perfil?.last_name === apellido && perfil?.full_name === `${nombre} ${apellido}`,
    `${rol}: guardado por separado → ${JSON.stringify(perfil)} · url ${page.url()}`)
  const bloqueo = await page.getByText('Confirmá tu nombre y apellido').isVisible().catch(() => false)
  ok(!bloqueo, `${rol}: el alta nueva NO ve el paso de confirmar apellido`)
  await browser.close()
}

// Sesión real por magic link, canjeada DENTRO de la página (como la abre la persona).
async function entrarCon(page, email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw error
  await page.goto(`${BASE}/login`)
  await page.evaluate(async ({ url, anon, hash }) => {
    const r = await fetch(`${url}/auth/v1/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anon }, body: JSON.stringify({ type: 'magiclink', token_hash: hash }) })
    const s = await r.json()
    localStorage.clear()
    localStorage.setItem(`sb-${new URL(url).hostname.split('.')[0]}-auth-token`, JSON.stringify({ access_token: s.access_token, token_type: s.token_type, expires_in: s.expires_in, expires_at: s.expires_at, refresh_token: s.refresh_token, user: s.user }))
  }, { url: env.HEALTHIER_STAGING_SUPABASE_URL, anon: env.HEALTHIER_STAGING_SUPABASE_ANON_KEY, hash: data.properties.hashed_token })
  await page.goto(`${BASE}/login`)
}

// 3. Alta "con Google": cuenta sin perfil (como queda tras el OAuth) → /completar-registro.
async function altaGoogle() {
  const email = `qa-apellido-google-${stamp}@healthier.app`
  await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: 'mariano QA gomez', name: 'mariano QA gomez' } })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await entrarCon(page, email)
  await page.waitForURL(/completar-registro/, { timeout: 15000 })
  const nombre0 = await page.getByLabel('Nombre', { exact: true }).inputValue()
  const apellido0 = await page.getByLabel('Apellido', { exact: true }).inputValue()
  await page.screenshot({ path: `${OUT}/google-1-propuesta.png` })
  ok(nombre0 === 'mariano QA' && apellido0 === 'gomez', `google: propuesta precargada "${nombre0}" / "${apellido0}"`)
  await page.getByRole('button', { name: /Paciente/ }).click()
  await page.locator('input[type="tel"]').fill('11 5555 0102')
  await page.getByLabel('Apellido', { exact: true }).fill('')
  await page.getByRole('button', { name: /Continuar/ }).click()
  const { data: antes } = await admin.from('profiles').select('id').eq('email', email).maybeSingle()
  ok(!antes, 'google: sin apellido no crea el perfil')
  await page.getByLabel('Nombre', { exact: true }).fill('Mariano QA')
  await page.getByLabel('Apellido', { exact: true }).fill('Gómez')
  await page.getByRole('button', { name: /Continuar/ }).click()
  await page.waitForURL(/onboarding/, { timeout: 15000 }).catch(() => {})
  await page.screenshot({ path: `${OUT}/google-2-despues.png` })
  const { data: perfil } = await admin.from('profiles').select('full_name, first_name, last_name').eq('email', email).maybeSingle()
  ok(perfil?.last_name === 'Gómez' && perfil?.full_name === 'Mariano QA Gómez', `google: guardado ${JSON.stringify(perfil)}`)
  await browser.close()
}

// 4. Usuario que ya existía sin apellido: paso bloqueante al entrar.
async function existente(rol) {
  const email = `qa-apellido-existente-${rol}-${stamp}@healthier.app`
  const nombreViejo = rol === 'professional' ? 'DRA QAPRUEBA RUIZ ANA' : 'jose QA luis perez'
  const { data: u } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { role: rol, full_name: nombreViejo } })
  await admin.from('profiles').update({ phone: '+54 9 11 5555-0103' }).eq('id', u.user.id)
  if (rol === 'professional') {
    await admin.from('professional_profiles').upsert({ user_id: u.user.id, specialty: 'clinica', license_type: 'MN', license_number: '999002', is_verified: true })
  }
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await entrarCon(page, email)
  const paso = page.getByText('Confirmá tu nombre y apellido')
  await paso.waitFor({ timeout: 15000 }).catch(() => {})
  await page.screenshot({ path: `${OUT}/existente-${rol}-1-paso.png` })
  ok(await paso.isVisible(), `existente ${rol}: aparece el paso bloqueante en ${page.url()}`)
  const n0 = await page.getByLabel('Nombre', { exact: true }).inputValue()
  const a0 = await page.getByLabel('Apellido', { exact: true }).inputValue()
  ok(!!n0 && !!a0, `existente ${rol}: propuesta "${n0}" / "${a0}"`)
  const [nombre, apellido] = rol === 'professional' ? ['Ana', 'Qaprueba Ruiz'] : ['José QA Luis', 'Pérez']
  await page.getByLabel('Nombre', { exact: true }).fill(nombre)
  await page.getByLabel('Apellido', { exact: true }).fill(apellido)
  await page.getByRole('button', { name: 'Confirmar' }).click()
  await paso.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
  await page.screenshot({ path: `${OUT}/existente-${rol}-2-despues.png` })
  ok(!(await paso.isVisible()), `existente ${rol}: el paso se cierra al confirmar`)
  await page.reload()
  await page.waitForTimeout(3000)
  ok(!(await paso.isVisible()), `existente ${rol}: no vuelve a aparecer al recargar`)
  const { data: perfil } = await admin.from('profiles')
    .select('full_name, first_name, last_name, professional_profiles!professional_profiles_user_id_fkey(is_verified)').eq('id', u.user.id).single()
  const pp = Array.isArray(perfil.professional_profiles) ? perfil.professional_profiles[0] : perfil.professional_profiles
  ok(perfil.last_name === apellido && (rol !== 'professional' || pp?.is_verified === true),
    `existente ${rol}: guardado ${perfil.full_name} (${perfil.first_name} | ${perfil.last_name})${rol === 'professional' ? ` · sigue verificado: ${pp?.is_verified}` : ''}`)
  await browser.close()
}

// 5. El profesional edita su nombre en /profesional/perfil (entrando por "Mi perfil").
async function proEditaNombre() {
  const email = `qa-apellido-pro-edita-${stamp}@healthier.app`
  const { data: u } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { role: 'professional', first_name: 'Ana', last_name: 'Qaedita Ruiz', full_name: 'Ana Qaedita Ruiz' } })
  await admin.from('profiles').update({ phone: '+54 9 11 5555-0106' }).eq('id', u.user.id)
  await admin.from('professional_profiles').upsert({ user_id: u.user.id, specialty: 'clinica', license_type: 'MN', license_number: '999004', is_verified: true })
  const verificado = async () => (await admin.from('professional_profiles').select('is_verified, reverification_pending').eq('user_id', u.user.id).single()).data
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await entrarCon(page, email)
  await page.waitForURL(/profesional/, { timeout: 15000 })
  // Se entra como entra la persona: el nombre al pie del menú lleva a su perfil.
  await page.getByText('Ana Qaedita Ruiz', { exact: true }).last().click()
  await page.waitForURL(/profesional\/perfil/, { timeout: 10000 })
  const nombre = page.getByLabel('Nombre', { exact: true })
  const apellido = page.getByLabel('Apellido', { exact: true })
  await nombre.waitFor({ timeout: 15000 })
  ok((await nombre.inputValue()) === 'Ana' && (await apellido.inputValue()) === 'Qaedita Ruiz', 'pro perfil: muestra nombre y apellido guardados')

  await apellido.fill('')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await page.waitForTimeout(1500)
  const { data: p0 } = await admin.from('profiles').select('last_name').eq('id', u.user.id).single()
  ok(p0.last_name === 'Qaedita Ruiz', 'pro perfil: apellido vacío no se guarda')

  // Mismas palabras, otro orden: se guarda sin aviso y sigue verificado.
  await nombre.fill('Ana Qaedita')
  await apellido.fill('Ruiz')
  const aviso = page.getByText(/tu perfil vuelve a/i).first()
  ok(!(await aviso.isVisible()), 'pro perfil: reordenar no muestra el aviso de revisión')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await page.waitForTimeout(2500)
  const { data: p1 } = await admin.from('profiles').select('full_name, last_name').eq('id', u.user.id).single()
  const v1 = await verificado()
  ok(p1.last_name === 'Ruiz' && v1.is_verified, `pro perfil: reordenado guardado (${p1.full_name}) y sigue verificado`)
  await page.screenshot({ path: `${OUT}/pro-edita-1-reordenado.png` })

  // Cambia una palabra: aviso + modal "Tu perfil vuelve a revisión" → Guardar igual.
  await apellido.fill('Ruiz Otra')
  ok(await aviso.isVisible(), 'pro perfil: cambiar una palabra muestra el aviso')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  const guardarIgual = page.getByRole('button', { name: 'Guardar igual' })
  await guardarIgual.waitFor({ timeout: 5000 }).catch(() => {})
  await page.screenshot({ path: `${OUT}/pro-edita-2-modal.png` })
  ok(await guardarIgual.isVisible(), 'pro perfil: aparece el modal de revisión')
  await guardarIgual.click()
  await page.waitForTimeout(2500)
  const { data: p2 } = await admin.from('profiles').select('full_name').eq('id', u.user.id).single()
  const v2 = await verificado()
  ok(p2.full_name === 'Ana Qaedita Ruiz Otra' && !v2.is_verified && v2.reverification_pending, `pro perfil: guardado (${p2.full_name}) y quedó en revisión`)
  await browser.close()
}

// 6. Grupo familiar: el titular agrega un familiar desde Perfil → "+ AÑADIR".
async function familiar() {
  const email = `qa-apellido-titular-${stamp}@healthier.app`
  const { data: u } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { role: 'patient', first_name: 'Laura', last_name: 'Qatitular', full_name: 'Laura Qatitular' } })
  await admin.from('profiles').update({ phone: '+54 9 11 5555-0107' }).eq('id', u.user.id)
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await entrarCon(page, email)
  await page.waitForURL(/paciente/, { timeout: 15000 })
  await page.goto(`${BASE}/paciente/perfil`)
  await page.getByText('+ AÑADIR').first().click()
  const campo = (lbl) => page.locator('label', { hasText: new RegExp(`^${lbl}$`) }).locator('xpath=following-sibling::input[1]').last()
  await campo('Nombre').fill('Benjamín QA')
  await campo('Vínculo').fill('Hijo')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await page.waitForTimeout(1500)
  const { data: v0 } = await admin.from('family_members').select('id').eq('patient_id', u.user.id)
  ok(v0.length === 0, 'familiar: sin apellido no se crea')
  await page.screenshot({ path: `${OUT}/familiar-1-sin-apellido.png` })
  await campo('Apellido').fill('Qatitular Gómez')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await page.waitForTimeout(2500)
  const { data: v1 } = await admin.from('family_members').select('full_name, familiar:profiles!familiar_id(full_name, first_name, last_name)').eq('patient_id', u.user.id)
  const f = v1[0]
  ok(f?.full_name === 'Benjamín QA Qatitular Gómez' && f?.familiar?.first_name === 'Benjamín QA' && f?.familiar?.last_name === 'Qatitular Gómez',
    `familiar: guardado ${JSON.stringify(f)}`)
  await page.screenshot({ path: `${OUT}/familiar-2-guardado.png` })
  await browser.close()
}

await familiar()
await proEditaNombre()
await altaGoogle()
await existente('patient')
await existente('professional')
await alta({ ruta: '/registro', rol: 'paciente', nombre: 'Lucía QA', apellido: 'Fernández Paz', captura: 'alta-paciente' })
await alta({ ruta: '/registro-profesional', rol: 'profesional', nombre: 'Tomás QA', apellido: 'de la Fuente', captura: 'alta-profesional' })

console.log(fallas ? `\n${fallas} falla(s)` : '\nTodo en verde')
process.exit(fallas ? 1 : 0)
