/**
 * E2E — cortar la videoconsulta sin el código de cierre (Mateo, 2026-10-22:
 * "Sino cortás y no se lo pediste — es peligroso").
 *
 * Falla si el profesional, ya en la llamada y sin el código verificado, puede
 * colgar (Finalizar) o salir (Volver) sin que aparezca la hoja para pedírselo
 * al paciente. Y al revés: con el código verificado, no tiene que aparecer.
 *
 * Corre contra STAGING (base propia, datos de prueba). Daily va mockeado
 * (tests/fixtures/daily-mock.js) y `daily-token` también: no se abre ninguna
 * sala real. Siembra una consulta propia y la cancela al terminar.
 *
 * Local (levanta Vite apuntado a staging):
 *   set -a; source ~/Local/.env; set +a
 *   VITE_SUPABASE_URL=$HEALTHIER_STAGING_SUPABASE_URL \
 *   VITE_SUPABASE_ANON_KEY=$HEALTHIER_STAGING_SUPABASE_ANON_KEY \
 *   SUPABASE_SERVICE_ROLE_KEY=$HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY \
 *   npx playwright test tests/e2e/codigo-al-cortar.spec.js
 * Contra el staging deployado: lo mismo + E2E_BASE_URL=https://staging.healthier.com.ar
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { loginAs } from '../fixtures/auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DAILY_MOCK_SCRIPT = readFileSync(join(__dirname, '../fixtures/daily-mock.js'), 'utf8')

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const PRO_EMAIL = process.env.TEST_PRO_EMAIL_STAGING ?? 'clinica@staging.healthier.app'
const PRO_PASS = process.env.TEST_PRO_PASSWORD_STAGING ?? 'staging'
const PACIENTE_EMAIL = 'nacho@staging.healthier.app'
const PACIENTE_PASS = 'staging'

// Nunca contra producción: siembra y cancela consultas.
const ES_STAGING = (SUPABASE_URL ?? '').includes('itjhrvlzuqvyhqtffumc')

test.use({ viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' })

test.describe('Videollamada del profesional — código de cierre al cortar', () => {
  test.skip(!ES_STAGING || !SERVICE_ROLE_KEY, 'Sólo contra staging: VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY de staging')

  const admin = ES_STAGING ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null
  const sembradas = []

  async function sembrarConsulta({ verificada = false } = {}) {
    const buscar = async (email) => {
      const { data, error } = await admin.from('profiles').select('id').eq('email', email).limit(1).single()
      if (error) throw new Error(`No existe ${email}: ${error.message}`)
      return data.id
    }
    const { data, error } = await admin.from('consultations').insert({
      patient_id: await buscar(PACIENTE_EMAIL),
      professional_id: await buscar(PRO_EMAIL),
      status: 'confirmed',
      scheduled_at: new Date().toISOString(),
      modality: 'video',
      price_at_booking: 0,
      payment_status: 'exempt',
      patient_admitted_at: new Date().toISOString(),
      closing_code_verified_at: verificada ? new Date().toISOString() : null,
    }).select('id').single()
    if (error) throw new Error(`No se pudo sembrar la consulta: ${error.message}`)
    sembradas.push(data.id)
    return data.id
  }

  async function entrarALaLlamada(page, id) {
    await page.addInitScript({ content: DAILY_MOCK_SCRIPT })
    await page.route('**/functions/v1/daily-token', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ roomUrl: 'https://healthier.daily.co/test', token: 'test' }),
    }))
    await loginAs(page, PRO_EMAIL, PRO_PASS)
    await page.goto(`/profesional/videollamada/${id}`)
    await expect(page.getByText('Esperando al paciente…')).toBeVisible({ timeout: 15_000 })
    // El paciente "llega": entra al canal de presencia de la sala, como hacen la
    // web y la app del paciente. Eso abre la compuerta y el profesional entra a
    // la llamada (Daily mockeado).
    await presenciaDelPaciente(id)
    await expect(page.getByText('Esperando al paciente…')).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText('Conectando sala…')).toBeHidden({ timeout: 10_000 })
  }

  // Sesión real del paciente en el canal `consultation-waiting-<id>`.
  const canales = []
  async function presenciaDelPaciente(id) {
    const sb = createClient(SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY)
    const { error } = await sb.auth.signInWithPassword({ email: PACIENTE_EMAIL, password: PACIENTE_PASS })
    if (error) throw new Error(`No entró ${PACIENTE_EMAIL}: ${error.message}`)
    const ch = sb.channel(`consultation-waiting-${id}`)
    await new Promise((ok, mal) => ch.subscribe(async (estado) => {
      if (estado === 'SUBSCRIBED') { await ch.track({ role: 'patient' }); ok() }
      else if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') mal(new Error(`canal: ${estado}`))
    }))
    canales.push({ sb, ch })
  }

  test.afterEach(async () => {
    for (const { sb, ch } of canales.splice(0)) await sb.removeChannel(ch)
  })

  const hoja = page => page.getByTestId('codigo-al-cortar')

  test('Finalizar sin código abre la hoja y NO corta', async ({ page }) => {
    const id = await sembrarConsulta()
    await entrarALaLlamada(page, id)

    await page.getByRole('button', { name: 'Finalizar', exact: true }).click()
    await expect(hoja(page)).toBeVisible()
    await expect(page.getByText('Antes de cortar, pedile el código')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/profesional/videollamada/${id}$`))

    // Cerrar la hoja = seguir en la llamada.
    await page.keyboard.press('Escape')
    await expect(hoja(page)).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`/profesional/videollamada/${id}$`))
  })

  test('Volver sin código también abre la hoja', async ({ page }) => {
    const id = await sembrarConsulta()
    await entrarALaLlamada(page, id)

    await page.getByRole('button', { name: 'Volver' }).click()
    await expect(hoja(page)).toBeVisible()
    await expect(page.getByText('Antes de salir, pedile el código')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/profesional/videollamada/${id}$`))
  })

  test('Cortar sin código pide confirmación y recién ahí corta', async ({ page }) => {
    const id = await sembrarConsulta()
    await entrarALaLlamada(page, id)

    await page.getByRole('button', { name: 'Finalizar', exact: true }).click()
    await expect(hoja(page)).toBeVisible()
    await hoja(page).getByRole('button', { name: 'Cortar sin código' }).click()
    await expect(page.getByText('¿Cortar sin el código?')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/profesional/videollamada/${id}$`))
    await page.getByRole('button', { name: 'Sí, cortar sin código' }).click()
    await expect(page).toHaveURL(new RegExp(`/profesional/consulta/${id}$`), { timeout: 10_000 })
  })

  test('con el código verificado, Finalizar corta sin hoja', async ({ page }) => {
    const id = await sembrarConsulta({ verificada: true })
    await entrarALaLlamada(page, id)

    await page.getByRole('button', { name: 'Finalizar', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/profesional/consulta/${id}$`), { timeout: 10_000 })
    await expect(hoja(page)).toHaveCount(0)
  })

  test.afterAll(async () => {
    if (!admin || !sembradas.length) return
    await admin.from('consultations').update({ status: 'cancelled' }).in('id', sembradas)
  })
})
