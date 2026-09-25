/**
 * E2E — /paciente/perfil muestra lo guardado sin recargar.
 *
 * Control del bug del 2026-09-25: al apretar "Guardar", teléfono, DNI, obra
 * social y el resto volvían a "—" hasta recargar la página, aunque en la base
 * estaban bien guardados. `onProfileUpdate` recibía el perfil viejo con sólo el
 * nombre cambiado y la pantalla se repintaba con eso.
 *
 * Crea un paciente descartable con el service role, entra por el formulario de
 * login, edita, guarda, mira la pantalla SIN recargar y lo borra al final.
 * Las tres claves (URL, anon, service role) tienen que ser del mismo entorno
 * que la app — ver la nota en playwright.config.js.
 *
 *   VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npx playwright test tests/e2e/perfil-paciente.spec.js
 */

import { test, expect } from '@playwright/test'
import { randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { loginAs } from '../fixtures/auth.js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

test.describe('Paciente — perfil después de guardar', () => {
  test.skip(!SUPABASE_URL || !SERVICE_ROLE_KEY, 'Hacen falta VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY')

  const admin = createClient(SUPABASE_URL ?? 'http://x', SERVICE_ROLE_KEY ?? 'x')
  const email = `e2e-perfil-${Date.now()}@healthier.test`
  const password = `E2e-${randomUUID()}`
  let userId

  test.beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { role: 'patient', full_name: 'Paciente E2E Perfil' },
    })
    if (error) throw error
    userId = data.user.id
    const { error: pErr } = await admin.from('profiles').upsert({
      id: userId, email, role: 'patient', full_name: 'Paciente E2E Perfil',
    })
    if (pErr) throw pErr
  })

  test.afterAll(async () => {
    if (!userId) return
    await admin.from('profiles').delete().eq('id', userId)
    await admin.auth.admin.deleteUser(userId)
  })

  // El input o el valor mostrado que va debajo de cada etiqueta.
  const campo = (page, etiqueta) =>
    page.locator('div.flex.flex-col', { has: page.locator('label', { hasText: new RegExp(`^${etiqueta}$`) }) }).first()

  test('teléfono, DNI y obra social se ven apenas se guarda', async ({ page }) => {
    await loginAs(page, email, password)
    await page.goto('/paciente/perfil')
    await page.getByRole('button', { name: /Editar/ }).first().click()

    await campo(page, 'Teléfono').locator('input[type="tel"]').fill('11 5555 1234')
    await campo(page, 'DNI').locator('input').fill('30111222')
    await campo(page, 'Obra Social').locator('input').fill('OSDE E2E')

    // Se anota cada cosa que muestran esos campos desde que se aprieta
    // "Guardar". El bug pintaba "—" y a veces se corregía solo unos
    // milisegundos después (un revalidado del perfil por atrás), así que mirar
    // el estado final no alcanza: hay que ver si pasó por "—".
    await page.evaluate(() => {
      window.__vistos = []
      const leer = () => {
        // Sólo la primera etiqueta de cada una: el contacto de emergencia
        // también tiene un "Teléfono", que acá queda vacío a propósito.
        const vistas = new Set()
        for (const label of document.querySelectorAll('label')) {
          const nombre = label.textContent.trim()
          if (!['DNI', 'Obra Social', 'Teléfono'].includes(nombre) || vistas.has(nombre)) continue
          vistas.add(nombre)
          const caja = label.parentElement
          if (caja.querySelector('input, select')) continue // todavía editando
          window.__vistos.push(`${label.textContent.trim()}=${caja.lastElementChild.textContent.trim()}`)
        }
      }
      new MutationObserver(leer).observe(document.body, { subtree: true, childList: true, characterData: true })
    })

    await page.getByRole('button', { name: /Guardar/ }).first().click()
    await expect(page.getByText('Perfil actualizado')).toBeVisible()
    await page.waitForTimeout(1500)

    const vistos = await page.evaluate(() => window.__vistos)
    expect(vistos.length).toBeGreaterThan(0)
    expect(vistos.filter(v => v.endsWith('=—')), `se vio "—" después de guardar: ${vistos.join(', ')}`).toEqual([])

    // Sin recargar: la pantalla tiene que mostrar lo guardado, no "—".
    await expect(campo(page, 'Teléfono')).toContainText('11 5555 1234')
    await expect(campo(page, 'DNI')).toContainText('30111222')
    await expect(campo(page, 'Obra Social')).toContainText('OSDE E2E')

    const { data } = await admin.from('profiles').select('dni, insurance_name, phone').eq('id', userId).single()
    expect(data.dni).toBe('30111222')
    expect(data.insurance_name).toBe('OSDE E2E')
    expect(data.phone).toContain('11 5555 1234')
  })
})
