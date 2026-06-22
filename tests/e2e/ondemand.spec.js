/**
 * E2E tests — On-demand video consultation flow
 *
 * Covers:
 * A) Patient perspective: on-demand request → sala de espera → enters call when doctor ready
 * B) Professional perspective: joins call → status transition attempted → Finalizar opens modal
 *
 * Test credentials (set in .env.test or environment):
 *   TEST_PATIENT_EMAIL / TEST_PATIENT_PASSWORD
 *   TEST_PRO_EMAIL     / TEST_PRO_PASSWORD  (defaults to demo.martin@healthier.app)
 *
 * Daily.co is mocked via window.__DailyIframeMock (see tests/fixtures/daily-mock.js).
 * The daily-token Edge Function is mocked via page.route().
 */

import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { loginAs, getSession } from '../fixtures/auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DAILY_MOCK_SCRIPT = readFileSync(join(__dirname, '../fixtures/daily-mock.js'), 'utf8')

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const PATIENT_EMAIL = process.env.TEST_PATIENT_EMAIL
const PATIENT_PASS  = process.env.TEST_PATIENT_PASSWORD
const PRO_EMAIL     = process.env.TEST_PRO_EMAIL    ?? 'demo.martin@healthier.app'
const PRO_PASS      = process.env.TEST_PRO_PASSWORD ?? 'DemoUser2026!'

const adminSb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

function mockDailyTokenRoute(page) {
  return page.route('**/functions/v1/daily-token', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ roomUrl: 'https://healthier.daily.co/demo', token: 'test-token' }),
    })
  )
}

// Wait for the pro video call header to be visible (confirms RequireRole + profile loaded)
async function waitForVideoCallHeader(page) {
  // "Volver" is the back button unique to ProfessionalVideoCall's header
  await expect(page.getByRole('button', { name: /Volver/i })).toBeVisible({ timeout: 10_000 })
}

// ── Test A: Patient on-demand flow ──────────────────────────────────────────

test.describe('Patient — on-demand consultation', () => {
  test.skip(!PATIENT_EMAIL, 'Set TEST_PATIENT_EMAIL + TEST_PATIENT_PASSWORD to run patient tests')

  let consultationId

  test('creates consultation and lands on sala de espera', async ({ page }) => {
    await loginAs(page, PATIENT_EMAIL, PATIENT_PASS)
    await page.goto('/paciente/ondemand/clinica')

    await page.getByRole('button', { name: /Pagar/i }).click()

    // Wait through payment (1.5s) + success (1s) + search animation + consultation create (≤10s total)
    const enterCallBtn = page.getByRole('button', { name: /Entrar a la Llamada/i })
    await expect(enterCallBtn).toBeVisible({ timeout: 12_000 })
    await enterCallBtn.click()

    await page.waitForURL(/\/paciente\/sala-espera\//, { timeout: 8_000 })

    consultationId = page.url().split('/sala-espera/')[1]
    expect(consultationId).toBeTruthy()

    // Button disabled while waiting for doctor
    const enterBtn = page.getByRole('button', { name: /Entrar a la consulta/i })
    await expect(enterBtn).toBeDisabled()
    await expect(page.getByRole('heading', { name: /Sala de espera/i })).toBeVisible()
  })

  test('sala de espera unlocks when status becomes in_progress', async ({ page }) => {
    test.skip(!consultationId, 'Depends on previous test')

    await loginAs(page, PATIENT_EMAIL, PATIENT_PASS)
    await page.goto(`/paciente/sala-espera/${consultationId}`)

    const enterBtn = page.getByRole('button', { name: /Entrar a la consulta/i })
    await expect(enterBtn).toBeDisabled()

    // Simulate the professional joining via direct DB write (bypasses RLS for test isolation)
    await adminSb.from('consultations').update({ status: 'in_progress' }).eq('id', consultationId)

    // Realtime subscription fires → WaitingRoom unlocks
    await expect(page.getByText(/El profesional está listo/i)).toBeVisible({ timeout: 6000 })
    await expect(enterBtn).toBeEnabled()

    await enterBtn.click()
    await expect(page).toHaveURL(`/paciente/videollamada/${consultationId}`)
  })

  test.afterAll(async () => {
    if (consultationId) {
      await adminSb.from('consultations').update({ status: 'cancelled' }).eq('id', consultationId)
    }
  })
})

// ── Test B: Professional video call flow ────────────────────────────────────

test.describe('Professional — video call & status transition', () => {
  let consultationId
  let proProfileId

  test.beforeAll(async () => {
    const session = await getSession(PRO_EMAIL, PRO_PASS)
    proProfileId = session.user.id

    const { data: patient, error: pErr } = await adminSb
      .from('profiles')
      .select('id')
      .eq('role', 'patient')
      .neq('id', proProfileId)
      .limit(1)
      .single()
    if (pErr || !patient) throw new Error(`No patient found: ${pErr?.message}`)

    const { data: cons, error: cErr } = await adminSb
      .from('consultations')
      .insert({
        professional_id: proProfileId,
        patient_id: patient.id,
        scheduled_at: new Date().toISOString(),
        modality: 'video',
        status: 'confirmed',
        price_at_booking: 15,
      })
      .select()
      .single()
    if (cErr || !cons) throw new Error(`Failed to create test consultation: ${cErr?.message}`)
    consultationId = cons.id
  })

  test('joined-meeting mock event triggers updateStatus request', async ({ page }) => {
    expect(consultationId).toBeTruthy()

    await page.addInitScript({ content: DAILY_MOCK_SCRIPT })
    await mockDailyTokenRoute(page)

    // Register BEFORE navigation so no events are missed
    const patchPromise = page.waitForRequest(
      req => req.method() === 'PATCH' && req.url().includes('/rest/v1/consultations'),
      { timeout: 8000 }
    )

    await loginAs(page, PRO_EMAIL, PRO_PASS)
    await page.goto(`/profesional/videollamada/${consultationId}`)
    await waitForVideoCallHeader(page)

    // Wait for the joined-meeting mock (fires 500ms after join()) to trigger the PATCH
    const patchReq = await patchPromise.catch(() => null)
    expect(patchReq, 'updateStatus("in_progress") should have triggered a PATCH request').not.toBeNull()

    const body = patchReq.postData()
    expect(body, 'PATCH body should include in_progress').toContain('in_progress')
  })

  test('Finalizar button opens close modal', async ({ page }) => {
    expect(consultationId).toBeTruthy()

    await page.addInitScript({ content: DAILY_MOCK_SCRIPT })
    await mockDailyTokenRoute(page)

    await loginAs(page, PRO_EMAIL, PRO_PASS)
    await page.goto(`/profesional/videollamada/${consultationId}`)
    await waitForVideoCallHeader(page)

    const finalizarBtn = page.getByRole('button', { name: /Finalizar/i })
    await expect(finalizarBtn).toBeVisible({ timeout: 3000 })
    await finalizarBtn.click()

    // CloseConsultationModal renders — contains a "cerrar" or "finalizar" heading or text
    await expect(
      page.getByText(/cerrar consulta|finalizar consulta|notas de cierre/i).first()
    ).toBeVisible({ timeout: 3000 })
  })

  test.afterAll(async () => {
    if (consultationId) {
      await adminSb.from('consultations').update({ status: 'cancelled' }).eq('id', consultationId)
    }
  })
})
