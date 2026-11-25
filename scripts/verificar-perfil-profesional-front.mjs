#!/usr/bin/env node
/**
 * Control del perfil del profesional (2026-11-25) — DESDE EL FRONT.
 *
 * Entra como paciente (sesión por magic link del Admin API, sin contraseña), y
 * recorre lo que hace una persona, con clics:
 *   Inicio → "Sacá un turno" → modalidad → lista → "Ver perfil y horarios"
 *   → (perfil) tocar la modalidad → aparecen los horarios → tocar uno
 *   → "Agendar · …" → resumen del turno con esa modalidad, fecha y hora
 *   → "Ir al pago" → pantalla de pago (NO se paga).
 * Una vez con Videoconsulta y otra con Presencial, a 390 y a 1440 px.
 *
 * Falla si el perfil deja de mostrar horarios al tocar una modalidad, si el
 * botón no se arma con el horario elegido, o si el resumen/pago no llegan con
 * la modalidad y la hora correctas.
 *
 *   APP_URL=http://localhost:5291 node scripts/verificar-perfil-profesional-front.mjs [--capturas <dir>]
 *
 * Necesita VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY
 * del MISMO entorno que APP_URL (staging), y PACIENTE_EMAIL (por defecto
 * paciente@healthier.app). No escribe nada en la base: el turno no se paga.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const APP_URL = process.env.APP_URL || 'http://localhost:5291'
const SB_URL = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const EMAIL = process.env.PACIENTE_EMAIL || 'paciente@healthier.app'
const iCap = process.argv.indexOf('--capturas')
const CAPTURAS = iCap > 0 ? process.argv[iCap + 1] : null
const SOLO = process.env.SOLO // "390" | "1440" para correr un ancho solo

if (!SB_URL || !ANON || !SERVICE) {
  console.error('Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(2)
}
if (/aixjejdoofervrkggbkd/.test(SB_URL)) {
  console.error('Esto corre contra STAGING, no contra producción.')
  process.exit(2)
}
if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true })

async function post(url, body, key) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${url} → ${r.status} ${await r.text()}`)
  return r.json()
}

async function sesion(email) {
  const link = await post(`${SB_URL}/auth/v1/admin/generate_link`, { type: 'magiclink', email }, SERVICE)
  const hash = link.hashed_token || link.properties?.hashed_token
  return post(`${SB_URL}/auth/v1/verify`, { type: 'magiclink', token_hash: hash }, ANON)
}

const fallas = []
const ok = (cond, msg) => { if (cond) console.log(`  ✓ ${msg}`); else { console.log(`  ✗ ${msg}`); fallas.push(msg) } }

async function captura(page, nombre) {
  if (!CAPTURAS) return
  await page.waitForTimeout(400) // que terminen las transiciones de color
  await page.screenshot({ path: join(CAPTURAS, `${nombre}.png`), fullPage: false })
}

async function recorrido(browser, ancho, alto, modalidad) {
  const etiqueta = modalidad === 'virtual' ? 'Videoconsulta' : 'Presencial'
  console.log(`\n· ${ancho}px — ${etiqueta}`)
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 2, locale: 'es-AR' })
  const page = await ctx.newPage()
  page.on('pageerror', e => fallas.push(`[${ancho}/${modalidad}] error de página: ${e.message}`))
  const s = await sesion(EMAIL)
  const ref = new URL(SB_URL).hostname.split('.')[0]
  await page.goto(`${APP_URL}/login`)
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`sb-${ref}-auth-token`, JSON.stringify(s)])
  await page.goto(`${APP_URL}/paciente/dashboard`)
  await page.waitForURL(/\/paciente\/dashboard/, { timeout: 20000 })

  // Inicio → "Sacá un turno" (la tarjeta del carrusel de consulta inmediata o
  // el atajo de turnos, el que esté a la vista).
  await page.getByText('Hola,').first().waitFor({ timeout: 20000 })
  // El recorrido de bienvenida (primera vez) tapa el inicio: se cierra como lo cerraría la persona.
  const tour = page.getByText('Bienvenido a Healthier')
  if (await tour.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: '×' }).first().click().catch(() => {})
    await page.keyboard.press('Escape').catch(() => {})
  }
  // Inicio: la tarjeta de Clínica dice "Sacá un turno" cuando no hay nadie en
  // línea. Si hay alguien, se entra por Turnos → "Agendá tu consulta" → Clínica.
  const sacar = page.locator('button').filter({ hasText: 'Clínica' }).filter({ hasText: 'Sacá un turno' }).first()
  if (await sacar.isVisible().catch(() => false)) {
    await sacar.click()
  } else {
    await page.getByRole('link', { name: /Turnos/ }).or(page.getByRole('button', { name: /^Turnos$/ })).first().click()
    await page.waitForURL(/\/paciente\/consultas/, { timeout: 15000 })
    await page.locator('button').filter({ hasText: /^Clínica/ }).first().click()
  }
  await page.waitForURL(/\/paciente\/reservar/, { timeout: 15000 })

  // Si el wizard arranca en la vertical, elegir Clínica.
  if (await page.getByText('¿Qué especialidad buscás?').isVisible().catch(() => false)) {
    await page.getByRole('button', { name: /Clínica/ }).first().click()
  }
  // Modalidad: si vino preseleccionada y no es la que se quiere, volver a elegirla.
  await page.getByText(/¿Cómo querés consultar\?|Elegí tu profesional/).first().waitFor({ timeout: 15000 })
  if (await page.getByText('Elegí tu profesional').isVisible().catch(() => false)) {
    await page.locator('div.sticky').first().locator('button').first().click() // flecha de volver del wizard
  }
  await page.getByText('¿Cómo querés consultar?').waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: new RegExp(etiqueta) }).first().click()
  await page.getByRole('button', { name: /^Continuar$|Buscar turnos|Videoconsulta con/ }).last().click()
  await page.getByText('Elegí tu profesional').waitFor({ timeout: 15000 })
  await page.waitForSelector('[data-testid="reserva-ver-perfil"]', { timeout: 15000 })
  await captura(page, `web-${ancho}-1-lista-${modalidad}`)

  // "Ver perfil y horarios" del primero que ofrece esa modalidad.
  await page.locator('[data-testid="reserva-ver-perfil"]').first().click()
  await page.waitForURL(/\/paciente\/profesional\//, { timeout: 15000 })
  await page.waitForSelector('[data-testid="perfil-nombre"]', { timeout: 15000 })
  const nombre = (await page.locator('[data-testid="perfil-nombre"]').textContent())?.trim()
  ok(!!nombre, `se llegó al perfil (${nombre})`)
  ok(await page.getByRole('heading', { name: 'Atiende' }).isVisible(), 'el perfil muestra "Atiende"')

  // Tocar la modalidad (si ya vino elegida, tocarla de nuevo no la cambia).
  const boton = page.locator(`[data-testid="perfil-modalidad-${modalidad}"]`)
  ok(await boton.isVisible(), `fila ${etiqueta} visible`)
  await boton.click()
  ok((await boton.getAttribute('aria-checked')) === 'true', `${etiqueta} queda elegida`)
  await page.waitForSelector('[data-testid="perfil-grilla"], [data-testid="perfil-sin-horarios"]', { timeout: 15000 })
  const slots = page.locator('[data-testid="perfil-slot"]')
  const n = await slots.count()
  ok(n > 0, `al tocar ${etiqueta} aparecen horarios (${n})`)
  await page.locator('[data-testid="perfil-horarios"]').scrollIntoViewIfNeeded()
  await captura(page, `web-${ancho}-2-perfil-${modalidad}`)
  if (!n) { await ctx.close(); return }

  // Tocar un horario → el botón dice "Agendar · <día> <hora>".
  const elegido = slots.nth(Math.min(1, n - 1))
  const hora = (await elegido.textContent()).trim()
  await elegido.click()
  const cta = page.locator('[data-testid="perfil-agendar"]')
  const textoCta = (await cta.textContent()).trim()
  ok(new RegExp(`^Agendar · .+ ${hora}$`).test(textoCta), `el botón dice "${textoCta}"`)
  await captura(page, `web-${ancho}-3-perfil-${modalidad}-elegido`)

  await cta.click()
  await page.waitForURL(/\/paciente\/reservar\?.*fecha=.*hora=/, { timeout: 15000 })
  const url = new URL(page.url())
  ok(url.searchParams.get('modality') === modalidad, `el wizard recibe modality=${modalidad}`)
  await page.getByText('Resumen del turno').waitFor({ timeout: 20000 })
  const resumen = await page.locator('body').innerText()
  ok(resumen.includes(etiqueta), `el resumen dice ${etiqueta}`)
  const hhmm = hora.padStart(5, '0')
  ok(resumen.includes(hhmm), `el resumen tiene la hora ${hhmm}`)
  ok(resumen.includes(url.searchParams.get('fecha')), `el resumen tiene la fecha ${url.searchParams.get('fecha')}`)
  await captura(page, `web-${ancho}-4-resumen-${modalidad}`)

  // Al pago, sin pagar.
  await page.getByRole('button', { name: 'Ir al pago' }).click()
  await page.waitForURL(/\/paciente\/pago/, { timeout: 15000 })
  await page.waitForTimeout(2500)
  const pago = await page.locator('body').innerText()
  ok(/presencial/i.test(pago) === (modalidad === 'presencial'), `la pantalla de pago es ${etiqueta.toLowerCase()}`)
  // La pantalla de pago no muestra la hora (nunca la mostró): se mira lo que
  // recibió, que es lo que va a crear la consulta.
  const estado = await page.evaluate(() => window.history.state?.usr ?? null)
  const esperado = new Date(`${url.searchParams.get('fecha')}T${hhmm}:00-03:00`).toISOString()
  ok(estado?.scheduledAt === esperado, `el pago recibe el turno ${esperado} (${estado?.scheduledAt})`)
  ok(estado?.modality === modalidad, `el pago recibe modality=${modalidad}`)
  await captura(page, `web-${ancho}-5-pago-${modalidad}`)
  await ctx.close()
}

const browser = await chromium.launch()
try {
  const anchos = [[390, 844], [1440, 900]].filter(([w]) => !SOLO || String(w) === SOLO)
  for (const [w, h] of anchos) {
    for (const m of ['virtual', 'presencial']) {
      try { await recorrido(browser, w, h, m) } catch (e) { fallas.push(`[${w}/${m}] ${e.message.split('\n')[0]}`); console.log(`  ✗ ${e.message.split('\n')[0]}`) }
    }
  }
} finally {
  await browser.close()
}
if (fallas.length) {
  console.log(`\n✗ ${fallas.length} falla(s):\n- ${fallas.join('\n- ')}`)
  process.exit(1)
}
console.log('\n✓ Perfil del profesional: horarios al tocar la modalidad, botón con el horario y resumen/pago correctos.')
