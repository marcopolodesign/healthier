#!/usr/bin/env node
// Las capturas WEB de la guía de uso (/guia), sacadas de la plataforma de
// verdad, con sus marcas numeradas medidas sobre la pantalla (no puestas a ojo).
//
// Corre contra STAGING (base propia, datos sembrados, cuentas demo): nunca
// contra producción ni con datos reales de pacientes.
//
//   node scripts/guia/capturas.mjs                 # todas
//   node scripts/guia/capturas.mjs pro-agenda ...  # sólo esas
//   GUIA_APP=http://localhost:5173 node scripts/guia/capturas.mjs   # contra local
//
// Deja cada captura en public/guia-img/<id>.jpg y la posición de sus marcas en
// src/guia/marcas.json. Las de la app las saca scripts/guia/capturas-app.mjs.
// Qué captura sacar y qué marcar vive en scripts/guia/tomas.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { cargarEnv, sesionDe, llaveSesion } from './sesion.mjs'
import { TOMAS } from './tomas.mjs'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const APP = process.env.GUIA_APP || 'https://gethealthier-staging.vercel.app'
const SALIDA = path.join(RAIZ, 'public/guia-img')
const MARCAS = path.join(RAIZ, 'src/guia/marcas.json')
fs.mkdirSync(SALIDA, { recursive: true })

const DESK = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }
const MOVIL = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
// Lo que la plataforma muestra una sola vez (tours, invitaciones): ya visto.
const YA_VISTO = ['healthier:tour-profesional-visto', 'healthier:tour-paciente-visto', 'healthier:guia-simulacion-vista']

const env = cargarEnv()
const sesiones = new Map()
const sesion = async (email) => {
  if (!sesiones.has(email)) sesiones.set(email, await sesionDe(email, env))
  return sesiones.get(email)
}

/** PATCH a una tabla de staging con la service key (sólo para t.antes). */
const rest = async (tabla, filtro, cuerpo) => {
  const r = await fetch(`${env.url}/rest/v1/${tabla}?${filtro}`, { method: 'PATCH', body: JSON.stringify(cuerpo),
    headers: { apikey: env.service, Authorization: `Bearer ${env.service}`, 'Content-Type': 'application/json' } })
  if (!r.ok) throw new Error(`${tabla}: ${r.status} ${await r.text()}`)
}

const solo = process.argv.slice(2)
const marcas = fs.existsSync(MARCAS) ? JSON.parse(fs.readFileSync(MARCAS, 'utf8')) : {}
const navegador = await chromium.launch()
let fallas = 0
for (const t of TOMAS.filter((t) => !solo.length || solo.includes(t.id))) {
  const base = t.movil ? MOVIL : DESK
  // Una toma puede pedir una pantalla más alta cuando lo que explica no entra.
  const opts = t.alto ? { ...base, viewport: { ...base.viewport, height: t.alto } } : base
  const ctx = await navegador.newContext({ ...opts, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires',
    geolocation: { latitude: -34.5889, longitude: -58.4306 }, permissions: ['geolocation'] })
  const s = t.quien ? await sesion(t.quien) : null
  // Lo que la toma necesita en la base justo antes (ej. que una profesional
  // figure disponible ahora: la presencia vence a la hora).
  if (t.antes) await t.antes(rest)
  await ctx.addInitScript(({ llave, s, yaVisto }) => {
    try {
      if (sessionStorage.getItem('guia-puesta')) return
      localStorage.clear()
      if (s) localStorage.setItem(llave, JSON.stringify(s))
      for (const k of yaVisto) localStorage.setItem(k, '1')
      sessionStorage.setItem('guia-puesta', '1')
    } catch { /* nada */ }
  }, { llave: llaveSesion(env), s, yaVisto: YA_VISTO })
  const p = await ctx.newPage()
  const errores = []
  p.on('pageerror', (e) => errores.push(e.message))
  try {
    await p.goto(APP + (t.url ?? '/'), { waitUntil: 'networkidle', timeout: 45000 })
    await p.waitForTimeout(1500)
    // Las cuentas demo viejas piden confirmar nombre y apellido una vez: se
    // confirma con lo que ya tienen (es lo que haría la persona).
    const confirmar = p.locator('[aria-labelledby="confirmar-apellido-titulo"] button[type="submit"]')
    if (await confirmar.isVisible().catch(() => false)) {
      await confirmar.click(); await p.waitForTimeout(2000)
      await p.goto(APP + (t.url ?? '/'), { waitUntil: 'networkidle', timeout: 45000 }); await p.waitForTimeout(1500)
    }
    if (t.pasos) await t.pasos(p)
    await p.waitForLoadState('networkidle').catch(() => {})
    await p.waitForTimeout(t.espera ?? 900)
    const { width: W, height: H } = opts.viewport
    const medidas = []
    for (const [n, loc] of t.marcas ?? []) {
      // De todo lo que coincide, lo más chico que se vea: un texto suelto suele
      // coincidir también con todos sus contenedores, y el número va en el de adentro.
      const todos = await loc(p).all().catch(() => [])
      let caja = null
      for (const el of todos.slice(0, 40)) {
        const b = await el.boundingBox({ timeout: 1500 }).catch(() => null)
        if (!b || b.width < 2 || b.height < 2 || b.y >= H || b.y + b.height <= 0) continue
        if (!caja || b.width * b.height < caja.width * caja.height) caja = b
      }
      if (!caja || caja.width < 2) { console.log(`   · ${t.id}: la marca ${n} no aparece`); continue }
      const x = Math.max(0, caja.x), y = Math.max(0, caja.y)
      const w = Math.min(caja.width - (x - caja.x), W - x), h = Math.min(caja.height - (y - caja.y), H - y)
      if (h <= 4 || w <= 4) { console.log(`   · ${t.id}: la marca ${n} queda fuera de pantalla`); continue }
      const pc = (v, d) => Math.round((v / d) * 1000) / 10
      medidas.push({ n, x: pc(x, W), y: pc(y, H), w: pc(w, W), h: pc(h, H) })
    }
    await p.screenshot({ path: path.join(SALIDA, `${t.id}.jpg`), type: 'jpeg', quality: 80 })
    marcas[t.id] = { movil: !!t.movil, app: false, ancho: W, alto: H, marcas: medidas }
    const faltan = (t.marcas?.length ?? 0) - medidas.length
    console.log(`${faltan ? '△' : '✓'} ${t.id} (${medidas.length} marcas)${errores.length ? '  errores JS: ' + errores.join(' | ').slice(0, 200) : ''}`)
  } catch (e) {
    fallas++
    console.log(`✗ ${t.id}: ${e.message.split('\n')[0]}`)
    await p.screenshot({ path: path.join(SALIDA, `_fallo-${t.id}.jpg`), type: 'jpeg', quality: 60 }).catch(() => {})
  }
  await ctx.close()
}
await navegador.close()
fs.writeFileSync(MARCAS, JSON.stringify(Object.fromEntries(Object.entries(marcas).sort()), null, 1) + '\n')
process.exit(fallas ? 1 : 0)
