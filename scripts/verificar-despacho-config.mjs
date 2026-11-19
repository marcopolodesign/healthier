#!/usr/bin/env node
/**
 * Control DESDE EL FRONT de /despacho/configuracion (migración 241), staging:
 *   · el admin del despacho ve la tarjeta "Mercado Pago" y "Conectar" lleva a
 *     auth.mercadopago.com (se corta ahí: el sandbox de staging no deja
 *     completar el OAuth); con la cuenta sembrada ve "conectado" y desconecta;
 *   · el operador del despacho (emergency_operator) NO ve la tarjeta de MP;
 *   · se ve el registro de operadores con DNI, selfie y el resultado de SISA.
 *
 *   BASE=http://localhost:5199 node scripts/verificar-despacho-config.mjs
 * (la web tiene que apuntar a la base de staging: VITE_SUPABASE_URL/ANON de staging)
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:5199'
const g = Object.fromEntries(readFileSync(`${process.env.HOME}/Local/.env`, 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()] }))
const URL_ = g.HEALTHIER_STAGING_SUPABASE_URL
const ENTIDAD = '20000000-0000-0000-0000-000000000001'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
mkdirSync('/tmp/despacho-config', { recursive: true })

let fallas = 0
const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) fallas++ }
const admin = createClient(URL_, g.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
async function sesion(email) {
  const { data: l } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const c = createClient(URL_, g.HEALTHIER_STAGING_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await c.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' })
  if (error) throw error
  return { s: data.session, uid: data.user.id }
}
const KEY = `sb-${new URL(URL_).hostname.split('.')[0]}-auth-token`

// Un registro del día de prueba (con selfie) para que la lista tenga algo que mostrar.
const op = await sesion('operador3@staging.healthier.app')
const cop = createClient(URL_, g.HEALTHIER_STAGING_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
await cop.auth.setSession({ access_token: op.s.access_token, refresh_token: op.s.refresh_token })
await admin.from('operadores_del_dia').delete().eq('profile_id', op.uid)
const ruta = `${op.uid}/front.png`
await cop.storage.from('operadores-dia').upload(ruta, PNG, { contentType: 'image/png', upsert: true })
const { error: regErr } = await cop.rpc('registrar_operador_del_dia', { p_nombre: 'Lucía Front Prueba', p_dni: '27555444', p_foto_path: ruta })
if (regErr) throw regErr
await admin.from('emergency_provider_mp_accounts').delete().eq('provider_id', ENTIDAD)

const browser = await chromium.launch()
async function abrir(email, viewport = { width: 1280, height: 900 }) {
  const { s } = await sesion(email)
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', e => errs.push(e.message))
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(s)])
  await page.goto(BASE + '/despacho/configuracion', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForSelector('text=Operadores de los últimos días', { timeout: 60000 })
  await page.waitForTimeout(2500)
  return { page, ctx, errs }
}

// ── Admin del despacho ──────────────────────────────────────────────────────
{
  const { page, ctx, errs } = await abrir('despacho@staging.healthier.app')
  ok(await page.getByRole('heading', { name: 'Mercado Pago' }).isVisible(), 'admin: se ve la tarjeta "Mercado Pago"')
  ok(await page.getByText('No conectado').isVisible(), 'admin: sin cuenta, dice "No conectado"')
  await page.screenshot({ path: '/tmp/despacho-config/01-admin-no-conectado.png', fullPage: true })
  // "Conectar" arranca el OAuth: la navegación va a auth.mercadopago.com
  let destino = null
  await page.route('**/auth.mercadopago.com/**', r => { destino = r.request().url(); r.abort() })
  await page.getByRole('button', { name: /Conectar/ }).click()
  await page.waitForTimeout(3500)
  ok(destino?.includes('auth.mercadopago.com/authorization') && destino.includes(`state=v2.${ENTIDAD}.`), `admin: "Conectar" abre el OAuth de Mercado Pago con el state de la entidad (${destino?.slice(0, 70)}…)`)
  // La cuenta conectada (sembrada: el OAuth real no se puede completar en staging)
  await admin.from('emergency_provider_mp_accounts').upsert({ provider_id: ENTIDAD, mp_user_id: '999000111', access_token: 'TEST-falso', active: true, mp_nickname: 'MEDIZIN_PRUEBA', expires_at: new Date(Date.now() + 90 * 864e5).toISOString() }, { onConflict: 'provider_id' })
  await page.goto(BASE + '/despacho/configuracion?mp_connected=1', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForSelector('text=Operadores de los últimos días', { timeout: 60000 })
  await page.waitForTimeout(3000)
  ok(await page.getByText('Mercado Pago conectado').first().isVisible() && await page.getByText('MEDIZIN_PRUEBA').isVisible(), 'admin: con la cuenta conectada se ve "Mercado Pago conectado" y el nombre de la cuenta')
  await page.screenshot({ path: '/tmp/despacho-config/02-admin-conectado.png', fullPage: true })
  ok(await page.getByText('Lucía Front Prueba').isVisible() && await page.getByText('DNI 27555444').isVisible(), 'admin: el registro de operadores muestra nombre y DNI')
  const textoSisa = await page.getByText(/SISA|Figura en|No figura/).first().innerText()
  ok(/SISA|Figura|figura/.test(textoSisa), `admin: se ve el resultado de SISA ("${textoSisa}")`)
  const img = page.getByAltText('Selfie de Lucía Front Prueba')
  await img.waitFor({ timeout: 8000 }).catch(() => {})
  ok(await img.count() === 1 && await img.evaluate(i => i.complete), 'admin: se ve la selfie')
  page.once('dialog', d => d.accept())
  await page.getByRole('button', { name: 'Desconectar' }).click()
  await page.waitForTimeout(3500)
  ok(await page.getByText('No conectado').isVisible(), 'admin: "Desconectar" vuelve a "No conectado"')
  const { data: cuenta } = await admin.from('emergency_provider_mp_accounts').select('active').eq('provider_id', ENTIDAD).maybeSingle()
  ok(cuenta?.active === false, 'admin: la cuenta quedó inactiva en la base')
  // Lista de profesionales de la entidad (modo operador, migración 242)
  const { data: pro } = await admin.from('profiles').select('id, full_name').eq('email', 'profesional@healthier.app').single()
  await admin.from('emergency_provider_profesionales').delete().eq('provider_id', ENTIDAD).eq('professional_id', pro.id)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=Profesionales de la entidad', { timeout: 60000 })
  await page.getByPlaceholder('Buscar un profesional por nombre').fill(pro.full_name.slice(0, 5))
  const cand = page.getByRole('button', { name: new RegExp(pro.full_name) }).first()
  await cand.waitFor({ timeout: 10000 })
  await cand.click()
  await page.waitForTimeout(2000)
  ok(await page.getByText('DNI 28456789').first().isVisible(), 'admin: agrega un profesional a la lista y se ve con su DNI')
  await page.screenshot({ path: '/tmp/despacho-config/04-lista-profesionales.png', fullPage: true })
  await page.getByRole('button', { name: 'Quitar' }).first().click()
  await page.waitForTimeout(1500)
  ok(await page.getByText('Todavía no cargaron profesionales').isVisible(), 'admin: "Quitar" saca al profesional de la lista')
  ok(errs.length === 0, `admin: sin errores de JS (${errs.join(' | ')})`)
  await ctx.close()
}
// ── Operador del despacho (no admin) ────────────────────────────────────────
{
  const { page, ctx, errs } = await abrir('operador@staging.healthier.app')
  ok(await page.getByRole('heading', { name: 'Mercado Pago' }).count() === 0, 'operador del despacho: NO ve la tarjeta de Mercado Pago')
  ok(await page.getByText('Lucía Front Prueba').isVisible(), 'operador del despacho: sí ve el registro de operadores')
  await page.screenshot({ path: '/tmp/despacho-config/03-operador-despacho.png', fullPage: true })
  ok(errs.length === 0, `operador del despacho: sin errores de JS (${errs.join(' | ')})`)
  await ctx.close()
}
await browser.close()

await admin.from('emergency_provider_mp_accounts').delete().eq('provider_id', ENTIDAD)
await admin.from('operadores_del_dia').delete().eq('profile_id', op.uid)
await admin.storage.from('operadores-dia').remove([ruta])
console.log(fallas ? `\n❌ ${fallas} en rojo` : '\n✅ todo en verde')
process.exit(fallas ? 1 : 0)
