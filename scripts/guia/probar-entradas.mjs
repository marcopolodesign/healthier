#!/usr/bin/env node
// Prueba desde el front que cada rol llegue a SU guía navegando, como lo haría
// la persona: entra con su cuenta demo de staging, toca "Guía de uso" en su
// menú y mira que abra la guía que le corresponde (con "vos" marcado).
//
//   node scripts/guia/probar-entradas.mjs           # contra staging
import { chromium } from 'playwright'
import { cargarEnv, sesionDe, llaveSesion } from './sesion.mjs'

const APP = process.env.GUIA_APP || 'https://gethealthier-staging.vercel.app'
const env = cargarEnv()
const DESK = { viewport: { width: 1440, height: 900 } }
const MOVIL = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }

const CASOS = [
  { quien: 'paciente.completo@staging.healthier.app', desde: '/paciente/perfil', vista: MOVIL, guia: 'paciente',
    tocar: (p) => p.getByRole('button', { name: /Guía de uso/ }) },
  { quien: 'clinica@staging.healthier.app', desde: '/profesional/dashboard', vista: DESK, guia: 'profesional',
    tocar: (p) => p.locator('aside a', { hasText: 'Guía de uso' }) },
  { quien: 'clinica@staging.healthier.app', desde: '/profesional/dashboard', vista: MOVIL, guia: 'profesional',
    antes: async (p) => { await p.getByRole('button', { name: /Más/ }).last().click(); await p.waitForTimeout(800) },
    tocar: (p) => p.locator('button', { hasText: 'Guía de uso' }) },
  { quien: 'farmacia@staging.healthier.app', desde: '/farmacia/pedidos', vista: DESK, guia: 'farmacia',
    tocar: (p) => p.locator('aside a', { hasText: 'Guía de uso' }) },
  { quien: 'despacho@staging.healthier.app', desde: '/despacho', vista: DESK, guia: 'emergencias',
    tocar: (p) => p.locator('aside a', { hasText: 'Guía de uso' }) },
  { quien: 'operador@staging.healthier.app', desde: '/despacho', vista: DESK, guia: 'emergencias',
    tocar: (p) => p.locator('aside a', { hasText: 'Guía de uso' }) },
  { quien: 'superadmin@healthier.app', desde: '/super-admin/dashboard', vista: DESK, guia: 'super-admin',
    tocar: (p) => p.locator('aside a', { hasText: 'Guía de uso' }) },
  { quien: 'superadmin@healthier.app', desde: '/super-admin/dashboard', vista: MOVIL, guia: 'super-admin',
    antes: async (p) => { await p.getByRole('button', { name: /Más/ }).last().click(); await p.waitForTimeout(800) },
    tocar: (p) => p.locator('button', { hasText: 'Guía de uso' }) },
]

const navegador = await chromium.launch()
let fallas = 0
for (const c of CASOS) {
  const ctx = await navegador.newContext(c.vista)
  const s = await sesionDe(c.quien, env)
  await ctx.addInitScript(({ k, s }) => {
    if (sessionStorage.getItem('x')) return
    localStorage.setItem(k, JSON.stringify(s))
    for (const t of ['healthier:tour-profesional-visto', 'healthier:tour-paciente-visto']) localStorage.setItem(t, '1')
    sessionStorage.setItem('x', '1')
  }, { k: llaveSesion(env), s })
  const p = await ctx.newPage()
  const nombre = `${c.quien.split('@')[0]} (${c.vista === MOVIL ? 'teléfono' : 'computadora'})`
  try {
    await p.goto(APP + c.desde, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
    if (c.antes) await c.antes(p)
    const boton = c.tocar(p).first()
    await boton.scrollIntoViewIfNeeded()
    // En la computadora la guía se abre en otra pestaña; en el teléfono, en la misma.
    const [nueva] = await Promise.all([ctx.waitForEvent('page', { timeout: 4000 }).catch(() => null), boton.click()])
    const g = nueva ?? p
    await g.waitForLoadState('networkidle'); await g.waitForTimeout(1200)
    const url = new URL(g.url()).pathname
    const vos = await g.locator('.g-roles a.on .g-vos').count()
    if (url !== `/guia/${c.guia}`) throw new Error(`abrió ${url}`)
    if (!(await g.locator('.guia h1').first().isVisible())) throw new Error('la guía no se ve')
    console.log(`✓ ${nombre}: menú → /guia/${c.guia}${vos ? ' (con "vos")' : ''}`)
  } catch (e) {
    fallas++; console.log(`✗ ${nombre}: ${e.message.split('\n')[0]}`)
  }
  await ctx.close()
}
await navegador.close()
process.exit(fallas ? 1 : 0)
