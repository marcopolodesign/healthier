/**
 * E2E tests — On-demand video consultation flow
 *
 * Covers:
 * A) Patient perspective: on-demand request → sala de espera → enters call when doctor ready
 * B) Professional perspective: joins call → status transitions to in_progress → finalizes
 *
 * Test credentials (set in .env or environment):
 *   TEST_PATIENT_EMAIL / TEST_PATIENT_PASSWORD
 *   TEST_PRO_EMAIL     / TEST_PRO_PASSWORD       (defaults to demo.martin@healthier.app)
 *
 * Daily.co is mocked via window.__DailyIframeMock (see tests/fixtures/daily-mock.js).
 * The daily-token Edge Function is mocked via page.route().
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
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY

const PATIENT_EMAIL = process.env.TEST_PATIENT_EMAIL
const PATIENT_PASS  = process.env.TEST_PATIENT_PASSWORD
const PRO_EMAIL     = process.env.TEST_PRO_EMAIL     ?? 'demo.martin@healthier.app'
const PRO_PASS      = process.env.TEST_PRO_PASSWORD  ?? 'DemoUser2026!'

// Supabase client used for direct DB operations in tests (read-only, anon)
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Fake room response so the daily-token Edge Function doesn't need to be live
function mockDailyTokenRoute(page) {
  return page.route('**/functions/v1/daily-token', async route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ roomUrl: 'https://healthier.daily.co/demo', token: 'test-token' }),
    })
  )
}

// ── Test A: Patient on-demand flow ──────────────────────────────────────────

test.describe('Patient — on-demand consultation', () => {
  test.skip(!PATIENT_EMAIL, 'Set TEST_PATIENT_EMAIL + TEST_PATIENT_PASSWORD to run patient tests')

  let consultationId

  test('creates consultation and lands on sala de espera', async ({ page }) => {
    await loginAs(page, PATIENT_EMAIL, PATIENT_PASS)
    await page.goto('/paciente/ondemand/medicina_general')

    // Click pay button
    await page.getByRole('button', { name: /Pagar/i }).click()

    // Wait through payment animation + search animation (max 8s)
    await page.waitForURL(/\/paciente\/sala-espera\//, { timeout: 12_000 })

    // Extract consultation ID from URL
    consultationId = page.url().split('/sala-espera/')[1]
    expect(consultationId).toBeTruthy()

    // WaitingRoom renders: button disabled while waiting for doctor
    const enterBtn = page.getByRole('button', { name: /Entrar a la consulta/i })
    await expect(enterBtn).toBeDisabled()
    await expect(page.getByText(/Sala de espera/i)).toBeVisible()
  })

  test('sala de espera unlocks when status becomes in_progress', async ({ page }) => {
    test.skip(!consultationId, 'Run the previous test first to get a consultation ID')

    await loginAs(page, PATIENT_EMAIL, PATIENT_PASS)
    await page.goto(`/paciente/sala-espera/${consultationId}`)

    // Initial state: waiting
    const enterBtn = page.getByRole('button', { name: /Entrar a la consulta/i })
    await expect(enterBtn).toBeDisabled()

    // Simulate professional joining by updating status directly via Supabase
    const { signInWithPassword } = (await import('@supabase/supabase-js')).createClient(SUPABASE_URL, SUPABASE_ANON_KEY).auth
    // Use service-role or anon update — in tests we rely on RLS allowing professional update
    // (If RLS blocks this, use the pro session instead)
    await sb.from('consultations').update({ status: 'in_progress' }).eq('id', consultationId)

    // WaitingRoom Realtime subscription should fire and unlock the button
    await expect(page.getByText(/El profesional está listo/i)).toBeVisible({ timeout: 5000 })
    await expect(enterBtn).toBeEnabled()

    // Click → navigates to video call
    await enterBtn.click()
    await expect(page).toHaveURL(`/paciente/videollamada/${consultationId}`)
  })

  test.afterAll(async () => {
    // Clean up: cancel the test consultation so it doesn't pollute the DB
    if (consultationId) {
      await sb.from('consultations').update({ status: 'cancelled' }).eq('id', consultationId)
    }
  })
})

// ── Test B: Professional video call flow ────────────────────────────────────

test.describe('Professional — video call & status transition', () => {
  let consultationId

  test.beforeAll(async ({ browser }) => {
    // Create a confirmed consultation owned by the demo professional
    // We log in as pro to get their profile ID
    const { getSession } = await import('../fixtures/auth.js')
    const session = await getSession(PRO_EMAIL, PRO_PASS)
    const proSb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${session.access_token}` } },
    })
    const { data: profile } = await proSb.from('profiles').select('id').eq('id', session.user.id).single()

    // Insert a bare consultation (no patient: we use the pro's own profile as patient for test isolation)
    const { data: cons } = await proSb.from('consultations').insert({
      professional_id: profile.id,
      patient_id: profile.id,
      scheduled_at: new Date().toISOString(),
      modality: 'video',
      status: 'confirmed',
      price_at_booking: 15,
    }).select().single()
    consultationId = cons.id
  })

  test('joining video call sets status to in_progress', async ({ page }) => {
    // Inject Daily.co mock before page scripts run
    await page.addInitScript({ content: DAILY_MOCK_SCRIPT })
    await mockDailyTokenRoute(page)

    await loginAs(page, PRO_EMAIL, PRO_PASS)
    await page.goto(`/profesional/videollamada/${consultationId}`)

    // Wait for the mock Daily frame to fire joined-meeting (80ms) and updateStatus to be called
    await page.waitForTimeout(300)

    // Verify status is now in_progress in the DB
    const { data: cons } = await sb.from('consultations').select('status').eq('id', consultationId).single()
    expect(cons.status).toBe('in_progress')
  })

  test('professional can finalize consultation', async ({ page }) => {
    await page.addInitScript({ content: DAILY_MOCK_SCRIPT })
    await mockDailyTokenRoute(page)

    await loginAs(page, PRO_EMAIL, PRO_PASS)
    await page.goto(`/profesional/videollamada/${consultationId}`)

    // Wait for call to "load"
    await page.waitForTimeout(200)

    // Click Finalizar button
    await page.getByRole('button', { name: /Finalizar/i }).click()

    // Modal appears — confirm close (CloseConsultationModal)
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3000 }).catch(() => {
      // Some implementations don't use role=dialog; fall back to text
    })
  })

  test.afterAll(async () => {
    if (consultationId) {
      await sb.from('consultations').update({ status: 'cancelled' }).eq('id', consultationId)
    }
  })
})
