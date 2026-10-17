#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Prueba de front (staging): cerrar una consulta desde el DETALLE de consulta
// con y sin matrícula, y con la lectura del perfil cortada (revisión pre-prod
// de la firma, 2026-10-17). Chromium headless, sesión real de cada cuenta.
//
//   node scripts/probar-cierre-firma-front.mjs
//
// En los tres casos la consulta se cierra (el cierre no se frena por la HC):
//   A. clinica@staging (con matrícula): cierra sin aviso y la nota de cierre
//      queda en la HC firmada con su matrícula.
//   B. control-firma@staging (sin matrícula, cuenta propia de
//      verificar-verticales.mjs): cierra y avisa "Falta tu matrícula".
//   C. clinica@staging con la lectura de su perfil cortada: cierra y avisa
//      "No pudimos leer tu perfil profesional", NO "Falta tu matrícula".
// Crea una consulta por caso (paciente.completo@staging) y la deja completada.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'

const env = {}
for (const l of readFileSync(path.join(homedir(), 'Local/.env'), 'utf8').split('\n')) {
  const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l)
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
}
const REF = env.HEALTHIER_STAGING_SUPABASE_REF
const URL_SB = env.HEALTHIER_STAGING_SUPABASE_URL
const ANON = env.HEALTHIER_STAGING_SUPABASE_ANON_KEY
const SERVICE = env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
const WEB = 'https://staging.healthier.com.ar'
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }
const rest = async (ruta, init = {}) => {
  const r = await fetch(`${URL_SB}/rest/v1/${ruta}`, { ...init, headers: { ...H, Prefer: 'return=representation', ...(init.headers ?? {}) } })
  const t = await r.text()
  if (!r.ok) throw new Error(`${ruta} → ${r.status} ${t}`)
  return t ? JSON.parse(t) : null
}

let fallas = 0
const check = (ok, msg) => { console.log(`${ok ? '🟢' : '🔴'} ${msg}`); if (!ok) fallas++ }

const idDe = async email => (await rest(`profiles?select=id&email=eq.${email}`))[0]?.id
const PAC = await idDe('paciente.completo@staging.healthier.app')
const browser = await chromium.launch()

async function cerrar(email, { bloquear = false, resumen }) {
  const pro = await idDe(email)
  if (!pro) throw new Error(`no existe ${email} (correr antes verificar-verticales.mjs)`)
  const [c] = await rest('consultations', {
    method: 'POST',
    body: JSON.stringify({ patient_id: PAC, professional_id: pro, status: 'closing', scheduled_at: new Date().toISOString(), modality: 'video', price_at_booking: 0, payment_status: 'exempt' }),
  })
  const link = await (await fetch(`${URL_SB}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email }) })).json()
  const ses = await (await fetch(`${URL_SB}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token ?? link.properties?.hashed_token }),
  })).json()
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  if (bloquear) await page.route(`**/rest/v1/professional_profiles?*user_id=eq.${pro}*`, r => r.abort('internetdisconnected'))
  await page.goto(`${WEB}/login`)
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(ses)])
  await page.goto(`${WEB}/profesional/consulta/${c.id}`)
  await page.getByRole('button', { name: 'Cerrar consulta' }).last().click({ timeout: 20000 })
  await page.getByPlaceholder(/Qué pasó/).fill(resumen)
  await page.getByText('cerrá dejando un motivo').click()
  await page.getByPlaceholder(/el paciente cortó/).fill('Prueba de front en staging.')
  const avisos = []
  const mirar = setInterval(() => page.locator('body').innerText().then(t => avisos.push(t)).catch(() => {}), 250)
  await page.getByRole('button', { name: 'Confirmar cierre' }).click()
  await page.waitForTimeout(6000)
  clearInterval(mirar)
  await ctx.close()
  const [despues] = await rest(`consultations?select=status,closing_notes&id=eq.${c.id}`)
  const entradas = await rest(`clinical_entries?select=professional_license_number&content=eq.${encodeURIComponent(resumen)}`)
  return { texto: avisos.join('\n'), despues, entradas }
}

const A = await cerrar('clinica@staging.healthier.app', { resumen: `Cierre con matrícula ${Date.now()}` })
check(A.despues.status === 'completed', `A con matrícula: la consulta se cerró (${A.despues.status})`)
check(!/no se pudo asentar/.test(A.texto) && A.entradas[0]?.professional_license_number === '112233', `A: la nota de cierre quedó en la HC firmada (${A.entradas[0]?.professional_license_number ?? 'sin nota'})`)

const B = await cerrar('control-firma@staging.healthier.app', { resumen: `Cierre sin matrícula ${Date.now()}` })
check(B.despues.status === 'completed', `B sin matrícula: la consulta se cerró igual (${B.despues.status})`)
check(/no se pudo asentar en la historia clínica: Falta tu matrícula/.test(B.texto) && B.entradas.length === 0, 'B: avisa "Falta tu matrícula" y no queda nota firmada')

const C = await cerrar('clinica@staging.healthier.app', { bloquear: true, resumen: `Cierre con red cortada ${Date.now()}` })
check(C.despues.status === 'completed', `C red cortada: la consulta se cerró (${C.despues.status})`)
const avisoC = (/no se pudo asentar en la historia clínica: [^\n]*/.exec(C.texto) ?? [''])[0]
check(/No pudimos leer tu perfil profesional/.test(avisoC) && !/Falta tu matrícula/.test(avisoC), `C: el aviso no dice "Falta tu matrícula" (${avisoC.slice(0, 110)})`)

await browser.close()
process.exit(fallas ? 1 : 0)
