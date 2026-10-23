/**
 * E2E test — Alta de cuenta de profesional
 *
 * Gemelo de `alta-cuenta.spec.js` para /registro-profesional. Existe desde la
 * migración 217 (2026-10-23): el alta pasó a aceptar del metadata sólo
 * `patient` o `professional`, y este test es el que avisa si el profesional
 * deja de quedar profesional (o si el alta se rompe) por el camino real del
 * formulario.
 *
 *   E2E_BASE_URL=https://gethealthier-staging.vercel.app \
 *   VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
 *   npx playwright test tests/e2e/alta-profesional.spec.js
 *
 * Las tres claves tienen que ser del mismo entorno que E2E_BASE_URL (ver
 * playwright.config.js). Crea una cuenta descartable `qa-alta-pro-…` y la borra
 * al terminar, pase o falle.
 */

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const adminSb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const QA_PREFIX = 'qa-alta-pro-'

test.describe('Alta de cuenta de profesional', () => {
  /** @type {{ email: string, id: string | null } | null} */
  let creado = null

  test('completa el formulario real y queda profesional', async ({ page }) => {
    const stamp = Date.now()
    const rand = Math.random().toString(36).slice(2, 8)
    const identidad = {
      nombre: 'QA Pro',
      apellido: 'Automatizada',
      email: `${QA_PREFIX}${stamp}-${rand}@healthier.app`,
      phone: `+549 11 ${String(Math.floor(1000 + Math.random() * 9000))}-${String(Math.floor(1000 + Math.random() * 9000))}`,
      password: `Qa${rand}${stamp.toString(36)}!Aa1`,
    }
    creado = { email: identidad.email, id: null }

    await page.goto('/registro-profesional')
    await page.getByRole('button', { name: /Continuar con email/i }).click()
    await page.getByLabel('Nombre', { exact: true }).fill(identidad.nombre)
    await page.getByLabel('Apellido', { exact: true }).fill(identidad.apellido)
    // El DNI en el alta (feat/dni-en-registro) existe en staging y todavía no
    // en main: se completa sólo si el campo está.
    const dni = page.getByLabel('DNI', { exact: true })
    if (await dni.count()) await dni.fill(String(90_000_000 + Math.floor(Math.random() * 9_999_999)))
    await page.locator('input[type="email"]').fill(identidad.email)
    await page.locator('input[type="tel"]').fill(identidad.phone)
    await page.locator('input[type="password"]').fill(identidad.password)

    const toastError = page.locator('.fixed.top-4.right-4 p').first()
    await page.locator('button[type="submit"]').click()
    await Promise.race([
      page.waitForURL('**/profesional/onboarding', { timeout: 15_000 }),
      toastError.waitFor({ state: 'visible', timeout: 15_000 }),
    ]).catch(() => {})

    if (await toastError.isVisible().catch(() => false)) {
      throw new Error(`El alta de profesional mostró un error en pantalla: "${(await toastError.textContent())?.trim()}"`)
    }
    await expect(page).toHaveURL(/\/profesional\/onboarding/, { timeout: 15_000 })

    let perfil = null
    for (let i = 0; i < 20 && !perfil; i++) {
      const { data } = await adminSb.from('profiles').select('id, role, first_name, last_name').eq('email', identidad.email).maybeSingle()
      perfil = data
      if (!perfil) await new Promise(r => setTimeout(r, 500))
    }
    if (!perfil) throw new Error(`No apareció la fila de profiles para ${identidad.email}`)
    creado.id = perfil.id

    expect(perfil.role).toBe('professional')
    expect(perfil.first_name).toBe(identidad.nombre)
    expect(perfil.last_name).toBe(identidad.apellido)
    // Que el legajo nazca sin verificar lo prueba scripts/verificar-alta-rol.mjs:
    // este test corta en la redirección, antes de que el onboarding lo escriba.
  })

  test.afterEach(async () => {
    if (!creado) return
    if (!creado.email.startsWith(QA_PREFIX)) {
      throw new Error(`Guarda de limpieza: "${creado.email}" no empieza con "${QA_PREFIX}" — NO se borra nada.`)
    }
    if (!creado.id) {
      const { data } = await adminSb.auth.admin.listUsers({ perPage: 1000 })
      creado.id = data?.users?.find(u => u.email === creado.email)?.id ?? null
      if (!creado.id) return
    }
    const { error } = await adminSb.auth.admin.deleteUser(creado.id)
    if (error) console.error(`⚠️  LIMPIEZA FALLIDA — ${creado.email} (${creado.id}): ${error.message}`)
  })
})
