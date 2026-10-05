// Prueba DESDE EL FRONT de la comisión por profesional (migración 184), contra
// staging: clic y tipeo en un Chromium real, sesión por magic link (sin tocar
// contraseñas). NUNCA contra producción.
//
//   node scripts/probar-comision-front.mjs [base-url] [carpeta-capturas] [--paso=super|pro|todo]
//
// 1. Super admin: Profesionales → ficha de clinica@staging → carga 0% hasta
//    dentro de 30 días con motivo → ve la chapa "Exento" en la lista.
// 2. Ese profesional: ve el aviso en su inicio y la tasa real en Ganancias.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { cargarEnv, sesionDe, llaveSesion } from './guia/sesion.mjs'

const BASE = process.argv[2]?.startsWith('http') ? process.argv[2] : 'https://gethealthier-staging.vercel.app'
const OUT = process.argv.slice(2).find(a => a.startsWith('/')) ?? '/tmp/comision-capturas'
const PASO = (process.argv.find(a => a.startsWith('--paso=')) ?? '--paso=todo').split('=')[1]
if (/gethealthier\.vercel\.app/.test(BASE)) throw new Error('Esto no corre contra producción.')
mkdirSync(OUT, { recursive: true })

const env = cargarEnv()
const PRO = process.env.PRO_EMAIL ?? 'clinica@staging.healthier.app'
const SUPER = 'superadmin@healthier.app'
let fallas = 0
const ok = (cond, msg) => { console.log(`${cond ? '✅' : '❌'} ${msg}`); if (!cond) fallas++ }

async function abrirComo(browser, email, viewport = { width: 1366, height: 900 }) {
  const sesion = await sesionDe(email, env)
  const ctx = await browser.newContext({ viewport })
  await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [llaveSesion(env), JSON.stringify(sesion)])
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('   [pageerror]', e.message))
  return page
}

const browser = await chromium.launch()
try {
  if (PASO === 'super' || PASO === 'todo') {
    const page = await abrirComo(browser, SUPER)
    await page.goto(`${BASE}/super-admin/dashboard`)
    await page.getByRole('button', { name: /^Profesionales$/ }).first().click()
    await page.getByRole('link', { name: /^Verificados$/ }).first().click()
    await page.waitForURL(/super-admin\/profesionales/)
    await page.getByPlaceholder(/Buscar/i).first().fill(PRO)
    await page.getByText(PRO).first().click()
    const tarjeta = page.getByTestId('comision-profesional')
    await tarjeta.waitFor({ timeout: 15000 })
    await page.screenshot({ path: `${OUT}/1-ficha-antes.png` })
    await tarjeta.getByRole('button', { name: /Cambiar/ }).click()
    const hasta = new Date(Date.now() + 30 * 86400000)
    const iso = hasta.toISOString().slice(0, 10)
    await page.getByTestId('comision-pct').fill('0')
    await page.getByTestId('comision-hasta').fill(iso)
    await page.getByTestId('comision-motivo').fill('Lanzamiento: trae su cartera de pacientes (prueba front)')
    await page.getByTestId('comision-guardar').click()
    await page.getByText('Comisión guardada').waitFor({ timeout: 10000 })
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${OUT}/2-ficha-guardada.png` })
    const textoTarjeta = await tarjeta.innerText()
    ok(/Exento \(0%\)/.test(textoTarjeta) && /Lanzamiento/.test(textoTarjeta), `ficha muestra exento + historial con motivo y quién`)
    // Cerrar la ficha y mirar la chapa en la lista
    await page.keyboard.press('Escape').catch(() => {})
    await page.locator('div.absolute.inset-0.bg-black\\/30').click({ position: { x: 20, y: 20 } }).catch(() => {})
    const fila = page.locator('tr', { hasText: PRO })
    await fila.getByTestId('badge-comision').waitFor({ timeout: 10000 })
    const badge = await fila.getByTestId('badge-comision').innerText()
    const dd = String(hasta.getDate()).padStart(2, '0'), mm = String(hasta.getMonth() + 1).padStart(2, '0')
    ok(badge === 'Exento' && (await fila.innerText()).includes(`hasta ${dd}/${mm}`), `lista: chapa "${badge}" hasta ${dd}/${mm}`)
    await page.screenshot({ path: `${OUT}/3-lista-chapa.png`, fullPage: false })
    await page.context().close()
  }

  if (PASO === 'pro' || PASO === 'todo') {
    const page = await abrirComo(browser, PRO)
    await page.goto(`${BASE}/profesional/dashboard`)
    const aviso = page.getByTestId('aviso-comision')
    await aviso.waitFor({ timeout: 20000 }).catch(() => {})
    const textoAviso = await aviso.innerText().catch(() => '')
    ok(/Sin comisión de Healthier hasta el \d{2}\/\d{2}/.test(textoAviso), `inicio: "${textoAviso.split('\n')[0]}"`)
    await aviso.scrollIntoViewIfNeeded().catch(() => {})
    await page.screenshot({ path: `${OUT}/4-inicio-pro.png` })
    await page.getByRole('link', { name: /Ver desglose/ }).click()
    await page.waitForURL(/profesional\/ganancias/)
    const tasa = page.getByTestId('ganancias-tasa')
    await tasa.waitFor({ timeout: 15000 })
    const textoTasa = await tasa.innerText()
    ok(/Sin comisión de Healthier hasta el/.test(textoTasa) && /100%/.test(textoTasa) && !/20%/.test(textoTasa), `ganancias: "${textoTasa.slice(0, 90)}…"`)
    ok(await page.getByTestId('ganancias-referidos').isVisible(), 'ganancias: línea de pacientes referidos')
    await page.screenshot({ path: `${OUT}/5-ganancias-pro.png` })
    // Mobile
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${BASE}/profesional/dashboard`)
    await page.getByTestId('aviso-comision').waitFor({ timeout: 20000 }).catch(() => {})
    await page.getByTestId('aviso-comision').scrollIntoViewIfNeeded().catch(() => {})
    await page.screenshot({ path: `${OUT}/6-inicio-pro-mobile.png` })
    await page.context().close()
  }
} finally {
  await browser.close()
}
console.log(fallas ? `\n❌ ${fallas} en rojo` : '\n✅ Front OK')
process.exit(fallas ? 1 : 0)
