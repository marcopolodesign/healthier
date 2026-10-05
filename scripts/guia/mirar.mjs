#!/usr/bin/env node
// Recorre la guía publicada (o local) como la ve alguien sin sesión, en la
// computadora y en el teléfono: que cada guía abra, que todas sus capturas
// carguen, que no haya scroll de costado y que la del super admin mande al
// login. Saca una captura de cada una para mirarla.
//
//   node scripts/guia/mirar.mjs                         # contra staging
//   GUIA_APP=http://localhost:5191 node scripts/guia/mirar.mjs
//   node scripts/guia/mirar.mjs --super                 # además, la del super admin con su sesión
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { cargarEnv, sesionDe, llaveSesion } from './sesion.mjs'

const APP = process.env.GUIA_APP || 'https://gethealthier-staging.vercel.app'
const SALIDA = process.env.GUIA_MIRAR || '/tmp/guia-mirar'
fs.mkdirSync(SALIDA, { recursive: true })
const PUBLICAS = ['', 'paciente', 'profesional', 'farmacia', 'emergencias']
const navegador = await chromium.launch()
let fallas = 0
const mal = (m) => { fallas++; console.log('  ✗', m) }

async function revisar(ctx, slug, tag) {
  const p = await ctx.newPage()
  const errores = []
  p.on('pageerror', (e) => errores.push(e.message))
  await p.goto(`${APP}/guia${slug ? '/' + slug : ''}`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(800)
  if (!(await p.locator('.guia h1').first().isVisible().catch(() => false))) { mal(`${tag} /guia/${slug}: no abrió`); return p }
  // Bajar de a poco para que carguen las capturas (loading="lazy") y entren las animaciones.
  const alto = await p.evaluate(() => document.body.scrollHeight)
  for (let y = 0; y < alto; y += 700) { await p.evaluate((v) => window.scrollTo(0, v), y); await p.waitForTimeout(120) }
  await p.waitForTimeout(1200)
  const imgs = await p.evaluate(() => [...document.querySelectorAll('.guia img')].map((i) => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 })))
  for (const i of imgs.filter((i) => !i.ok)) mal(`${tag} /guia/${slug}: no carga ${i.src}`)
  const ancho = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (ancho > 1) mal(`${tag} /guia/${slug}: scroll de costado (${ancho}px)`)
  if (errores.length) mal(`${tag} /guia/${slug}: errores JS ${errores.join(' | ').slice(0, 200)}`)
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300)
  await p.screenshot({ path: path.join(SALIDA, `${tag}-${slug || 'inicio'}.jpg`), type: 'jpeg', quality: 70, fullPage: true })
  console.log(`✓ ${tag} /guia/${slug} — ${imgs.length} capturas`)
  return p
}

for (const [tag, opts] of [['desk', { viewport: { width: 1440, height: 900 } }], ['movil', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  const ctx = await navegador.newContext(opts)
  for (const s of PUBLICAS) await (await revisar(ctx, s, tag)).close()
  // Sin sesión, la del super admin manda al login.
  const p = await ctx.newPage()
  await p.goto(`${APP}/guia/super-admin`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
  if (!new URL(p.url()).pathname.startsWith('/login')) mal(`${tag} /guia/super-admin sin sesión no fue al login (${p.url()})`)
  else console.log(`✓ ${tag} /guia/super-admin sin sesión → login`)
  await ctx.close()
}

if (process.argv.includes('--super')) {
  const env = cargarEnv()
  for (const [email, debe] of [['superadmin@healthier.app', true], ['paciente.completo@staging.healthier.app', false]]) {
    const s = await sesionDe(email, env)
    const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } })
    await ctx.addInitScript(({ k, s }) => { if (!sessionStorage.getItem('x')) { localStorage.setItem(k, JSON.stringify(s)); sessionStorage.setItem('x', '1') } }, { k: llaveSesion(env), s })
    if (debe) await (await revisar(ctx, 'super-admin', 'super')).close()
    else {
      const p = await ctx.newPage()
      await p.goto(`${APP}/guia/super-admin`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
      if (new URL(p.url()).pathname !== '/guia') mal(`un paciente en /guia/super-admin no volvió a /guia (${p.url()})`)
      else console.log('✓ un paciente en /guia/super-admin → /guia')
    }
    await ctx.close()
  }
}
await navegador.close()
console.log(fallas ? `FALLARON ${fallas}` : 'TODO OK', '· capturas en', SALIDA)
process.exit(fallas ? 1 : 0)
