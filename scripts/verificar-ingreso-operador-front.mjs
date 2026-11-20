#!/usr/bin/env node
/**
 * Control DESDE EL FRONT de la aprobación del modo operador (migración 243), staging:
 *   · un pedido pendiente aparece en la Cola del despacho y "Aprobar" lo entrega;
 *   · "Rechazar" lo corta y la cuenta ve el motivo;
 *   · "Cargar DNI" (admin) completa el DNI que falta de un profesional de la lista;
 *   · el super admin ve la lista por entidad y el log de ingresos (con quién aprobó).
 *
 *   BASE=http://localhost:5199 node scripts/verificar-ingreso-operador-front.mjs
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:5199'
const g = Object.fromEntries(readFileSync(`${process.env.HOME}/Local/.env`, 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()] }))
const URL_ = g.HEALTHIER_STAGING_SUPABASE_URL
const ENTIDAD = '20000000-0000-0000-0000-000000000001'
const KEY = `sb-${new URL(URL_).hostname.split('.')[0]}-auth-token`
mkdirSync('/tmp/ingreso-front', { recursive: true })

let fallas = 0
const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) fallas++ }
const admin = createClient(URL_, g.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
async function sesion(email) {
  const { data: l } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const c = createClient(URL_, g.HEALTHIER_STAGING_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await c.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' })
  if (error) throw error
  return data.session
}
const fn = async (jwt, body) => (await fetch(`${URL_}/functions/v1/operador-modo`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) })).json()

const op = await sesion('operador4@staging.healthier.app')
const { data: pro } = await admin.from('profiles').select('id, full_name, dni').eq('email', 'profesional@healthier.app').single()
const { data: sinDni } = await admin.from('profiles').select('id, full_name, dni').eq('email', 'demo.martin@healthier.app').single()
await admin.from('emergency_provider_profesionales').upsert([{ provider_id: ENTIDAD, professional_id: pro.id, active: true }, { provider_id: ENTIDAD, professional_id: sinDni.id, active: true }], { onConflict: 'provider_id,professional_id' })
await admin.from('profiles').update({ dni: null }).eq('id', sinDni.id)
await admin.from('operador_ingresos').update({ estado: 'cancelado' }).eq('estado', 'pendiente')

const browser = await chromium.launch()
async function abrir(email, ruta, esperar) {
  const s = await sesion(email)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', e => errs.push(e.message))
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(s)])
  await page.goto(BASE + ruta, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForSelector(esperar, { timeout: 60000 })
  return { page, ctx, errs }
}

// ── Despacho: aprobar ───────────────────────────────────────────────────────
const ped = await fn(op.access_token, { dni: pro.dni })
ok(ped.modo === 'pendiente', `la cuenta pide el ingreso (${ped.modo ?? JSON.stringify(ped)})`)
{
  const { page, ctx, errs } = await abrir('despacho@staging.healthier.app', '/despacho', 'text=Cola de despacho')
  await page.waitForSelector('[data-testid="ingresos-pendientes"]', { timeout: 20000 }).catch(() => {})
  ok(await page.getByTestId('ingresos-pendientes').isVisible(), 'la Cola del despacho muestra el ingreso por aprobar')
  ok(await page.getByText(pro.full_name).first().isVisible() && await page.getByText('operador4@staging.healthier.app').first().isVisible(), 'dice quién quiere entrar como quién')
  await page.screenshot({ path: '/tmp/ingreso-front/01-cola-pendiente.png', fullPage: true })
  await page.getByRole('button', { name: 'Aprobar' }).click()
  await page.waitForTimeout(2500)
  ok(await page.getByTestId('ingresos-pendientes').count() === 0, 'al aprobar, el pedido sale de la Cola')
  const r = await fn(op.access_token, { ingresoId: ped.ingreso_id })
  ok(r.modo === 'profesional' && !!r.session?.access_token, 'la cuenta retira la sesión del profesional recién tras la aprobación')
  ok(errs.length === 0, `despacho: sin errores de JS (${errs.join(' | ')})`)
  await ctx.close()
}
// ── Despacho: rechazar ──────────────────────────────────────────────────────
const ped2 = await fn(op.access_token, { dni: pro.dni })
{
  const { page, ctx } = await abrir('despacho@staging.healthier.app', '/despacho', 'text=Cola de despacho')
  await page.waitForSelector('[data-testid="ingresos-pendientes"]', { timeout: 20000 }).catch(() => {})
  page.once('dialog', d => d.accept('No lo conozco'))
  await page.getByRole('button', { name: 'Rechazar' }).click()
  await page.waitForTimeout(2500)
  const r = await fn(op.access_token, { ingresoId: ped2.ingreso_id })
  ok(r.modo === 'rechazado' && r.motivo === 'No lo conozco' && !r.session, 'rechazar: la cuenta ve el motivo y no hay sesión')
  await ctx.close()
}
// ── Configuración: cargar el DNI que falta ──────────────────────────────────
{
  const { page, ctx, errs } = await abrir('despacho@staging.healthier.app', '/despacho/configuracion', 'text=Profesionales de la entidad')
  await page.waitForTimeout(2500)
  ok(await page.getByText('Sin DNI cargado').first().isVisible(), 'la lista avisa que a un profesional le falta el DNI')
  const nuevo = String(40000000 + Math.floor(Math.random() * 9000000))
  page.once('dialog', d => d.accept(nuevo))
  await page.getByRole('button', { name: 'Cargar DNI' }).first().click()
  await page.waitForTimeout(3000)
  ok(await page.getByText(`DNI ${nuevo}`).isVisible(), 'el admin carga el DNI desde la pantalla y se ve en la lista')
  await page.screenshot({ path: '/tmp/ingreso-front/02-config-dni.png', fullPage: true })
  ok(errs.length === 0, `config: sin errores de JS (${errs.join(' | ')})`)
  await ctx.close()
}
// ── Super admin ─────────────────────────────────────────────────────────────
{
  const { page, ctx, errs } = await abrir('superadmin@healthier.app', '/super-admin/emergencias', '[data-testid="operadores-de-entidad"]')
  ok(await page.getByText('Operadores y profesionales por entidad').isVisible(), 'super admin: ve el bloque de operadores por entidad')
  ok(await page.getByText(pro.full_name).first().isVisible(), 'super admin: ve la lista de profesionales de la entidad')
  ok(await page.getByText(/aprobó/).first().isVisible(), 'super admin: el log de ingresos dice quién aprobó')
  await page.screenshot({ path: '/tmp/ingreso-front/03-superadmin.png', fullPage: true })
  ok(errs.length === 0, `super admin: sin errores de JS (${errs.join(' | ')})`)
  await ctx.close()
}
await browser.close()
await admin.from('emergency_provider_profesionales').delete().eq('provider_id', ENTIDAD).eq('professional_id', sinDni.id) // profesional@ queda activo en la lista para las pruebas
await admin.from('profiles').update({ dni: sinDni.dni }).eq('id', sinDni.id)
await new Promise(r => setTimeout(r, 8000))
await fetch(`https://api.supabase.com/v1/projects/${g.HEALTHIER_STAGING_SUPABASE_REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${g.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'curl/8' }, body: JSON.stringify({ query: `select set_config('request.jwt.claims', json_build_object('sub',(select id from profiles where email='superadmin@healthier.app'),'role','authenticated')::text, true); update professional_profiles set is_verified=true, reverification_pending=false, reverification_changes='[]'::jsonb where user_id='${sinDni.id}'` }) })
console.log(fallas ? `\n❌ ${fallas} en rojo` : '\n✅ todo en verde')
process.exit(fallas ? 1 : 0)
