#!/usr/bin/env node
/**
 * Control DESDE EL FRONT de la pantalla web del operador de emergencias (Medizin), staging.
 * Todo se hace en el browser, a tamaño de celular (390x844), contra la base de staging:
 *
 *   A · registro del día: operador2 con un DNI que NO está en la lista → nombre + selfie →
 *       guardia → el despacho le asigna → "En camino" en vivo → "Llegué" → cierre trasladado
 *       (foto de recepción + diagnóstico) → "Terminar turno".
 *       El paciente ve el NOMBRE y la FOTO del operador y los cambios en vivo.
 *   B · modo profesional: operador1 con el DNI de un profesional de la lista → "Esperando que
 *       el despacho confirme" → el despacho aprueba en la Cola → atiende como el profesional
 *       (sin ganancias, verificación ni Mercado Pago) → llegué → cierre en el lugar → terminar
 *       turno descarta la sesión en el acto y vuelve al login.
 *   C · el despacho rechaza con motivo: el operador ve el motivo real.
 *
 *   BASE=http://127.0.0.1:5190 node scripts/verificar-operador-web-front.mjs
 * Capturas en /tmp/operador-web/.
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, mkdirSync, existsSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5190'
const g = Object.fromEntries(readFileSync(`${process.env.HOME}/Local/.env`, 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()] }))
const URL_ = g.HEALTHIER_STAGING_SUPABASE_URL
const MOVIL = '40000000-0000-0000-0000-000000000001'
const ENTIDAD = '20000000-0000-0000-0000-000000000001'
const KEY = `sb-${new URL(URL_).hostname.split('.')[0]}-auth-token`
const SELFIE = process.env.SELFIE ?? '/tmp/operador-web/selfie.png'
const RECEPCION = process.env.RECEPCION ?? '/tmp/operador-web/recepcion.png'
mkdirSync('/tmp/operador-web', { recursive: true })
if (!existsSync(SELFIE) || !existsSync(RECEPCION)) throw new Error(`Faltan ${SELFIE} y ${RECEPCION} (PNG de prueba)`)

let fallas = 0
const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) fallas++ }
const admin = createClient(URL_, g.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
async function sesion(email) {
  const { data: l } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const c = createClient(URL_, g.HEALTHIER_STAGING_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await c.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' })
  if (error) throw error
  return { session: data.session, client: c, uid: data.user.id }
}

const browser = await chromium.launch()
async function abrir(email, ruta, esperar, { viewport = { width: 390, height: 844 } } = {}) {
  const s = await sesion(email)
  const ctx = await browser.newContext({ viewport, hasTouch: true, permissions: ['geolocation'], geolocation: { latitude: -34.61, longitude: -58.4 } })
  // La sesión se siembra UNA vez por pestaña (antes de que cargue nada): si después se descarta, no vuelve.
  await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('sembrada')) { sessionStorage.setItem('sembrada', '1'); localStorage.setItem(k, v) } }, [KEY, JSON.stringify(s.session)])
  const page = await ctx.newPage()
  page.setDefaultTimeout(150000) // la máquina de desarrollo suele ir cargada
  const errs = []
  page.on('pageerror', e => { if (!/Lock broken by another request with the 'steal' option/.test(e.message)) errs.push(e.message) })
  await page.goto(BASE + ruta, { waitUntil: 'domcontentloaded', timeout: 150000 })
  if (esperar) await page.waitForSelector(esperar, { timeout: 150000 })
  return { page, ctx, errs, s }
}
const shot = (page, n) => page.screenshot({ path: `/tmp/operador-web/${n}.png` })
const hay = async (page, texto, ms = 60000) => page.getByText(texto).first().waitFor({ timeout: ms }).then(() => true).catch(() => false)

// ── Fixtures ────────────────────────────────────────────────────────────────
const { data: pro } = await admin.from('profiles').select('id, full_name, dni, email').eq('email', 'profesional@healthier.app').single()
const paciente = { id: (await sesion('paciente@healthier.app')).uid }
await admin.from('emergency_provider_profesionales').upsert({ provider_id: ENTIDAD, professional_id: pro.id, active: true }, { onConflict: 'provider_id,professional_id' })
const DNI_PRO = String(pro.dni ?? '')
if (!/^\d{7,8}$/.test(DNI_PRO)) { await admin.from('profiles').update({ dni: '33444555' }).eq('id', pro.id) }
const dniPro = /^\d{7,8}$/.test(DNI_PRO) ? DNI_PRO : '33444555'
const { data: ops } = await admin.from('profiles').select('id, email').in('email', ['operador1@staging.healthier.app', 'operador2@staging.healthier.app'])
const op1 = ops.find(o => o.email.startsWith('operador1')), op2 = ops.find(o => o.email.startsWith('operador2'))
async function limpiar() {
  await admin.from('emergencies').update({ status: 'cancelled' }).in('status', ['in_transit', 'arrived', 'dispatched', 'awaiting_dispatch', 'pending']).eq('ambulance_id', MOVIL)
  await admin.from('operador_ingresos').update({ estado: 'cancelado' }).in('estado', ['pendiente', 'aprobado'])
}
await limpiar()
await admin.from('operadores_del_dia').delete().in('profile_id', [op1.id, op2.id])
await admin.from('ambulances').update({ status: 'disponible' }).eq('id', MOVIL)

const despachoS = await sesion('despacho@staging.healthier.app')
async function nuevaEmergenciaAsignada(codigo) {
  const { data: e } = await admin.from('emergencies').insert({
    patient_id: paciente.id, triage_code: 'ROJO', status: 'pending', patient_latitude: -34.599, patient_longitude: -58.39, price_at_request: 50,
  }).select().single()
  await admin.from('emergencies').update({
    status: 'awaiting_dispatch', paid_at: new Date().toISOString(),
    notes: JSON.stringify(['Dolor opresivo en el pecho', 'Dificultad severa para respirar']),
    direccion: 'Av. Las Heras 2200', direccion_piso: 'Recoleta · piso 4, B',
  }).eq('id', e.id)
  const { error } = await despachoS.client.from('emergencies').update({
    ambulance_id: MOVIL, provider_id: ENTIDAD, operator_id: despachoS.uid, professional_id: null,
    status: 'in_transit', dispatched_at: new Date().toISOString(), dispatch_code: codigo,
  }).eq('id', e.id).eq('status', 'awaiting_dispatch')
  if (error) throw error
  return e.id
}

// ═══ A · registro del día (DNI fuera de la lista) ═══════════════════════════
console.log('\n▸ A · registro del día, DNI que no está en la lista')
if (!process.env.SALTEAR_A) {
  const { page, ctx, errs } = await abrir('operador2@staging.healthier.app', '/operador', 'text=¿Quién sale hoy?')
  await shot(page, 'A1-dni')
  ok(await page.getByRole('button', { name: 'Continuar' }).isDisabled(), 'sin DNI el botón no avanza')
  await page.fill('#dni', '30999888')
  await page.getByTestId('dni-continuar').click()
  ok(await hay(page, 'Registro del día'), 'DNI fuera de la lista → registro del día (nombre + selfie)')
  await page.setInputFiles('[data-testid="selfie"]', SELFIE)
  await page.fill('#nombre', 'Julián Ríos')
  await shot(page, 'A2-registro')
  await page.getByTestId('registro-listo').click()
  ok(await hay(page, 'En guardia'), 'registrado: queda en guardia')
  ok(await hay(page, 'Hoy sale Julián Ríos', 3000), 'la guardia dice quién sale hoy')
  await shot(page, 'A3-guardia')
  const { data: reg } = await admin.from('operadores_del_dia').select('nombre, dni, foto_path').eq('profile_id', op2.id).maybeSingle()
  ok(reg?.nombre === 'Julián Ríos' && reg?.dni === '30999888' && !!reg?.foto_path, 'el registro quedó guardado con nombre, DNI y selfie')

  // El despacho le asigna una emergencia: el operador la ve SIN recargar.
  const eid = await nuevaEmergenciaAsignada('UTM-7250')
  ok(await hay(page, 'En camino'), 'la emergencia aparece sola en "En camino" (Realtime)')
  ok((await page.getByTestId('direccion').textContent())?.includes('Av. Las Heras 2200'), 'la dirección es el título')
  ok((await page.getByTestId('abrir-maps').getAttribute('href'))?.startsWith('https://maps.google.com/?q=-34.599,-58.39'), '"Abrir en Maps" apunta a las coordenadas')
  ok(await hay(page, 'Dolor opresivo en el pecho', 3000), 'se ven los síntomas')
  const alto = await page.getByTestId('llegue').evaluate(el => el.getBoundingClientRect().height)
  ok(alto >= 56, `el botón "Llegué" mide ${Math.round(alto)}px (>= 56)`)
  const desborde = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  ok(!desborde, 'sin scroll horizontal en el celular')
  await shot(page, 'A4-en-camino')

  // El paciente: nombre y foto del operador del día + cambios en vivo.
  const pac = await abrir('paciente@healthier.app', '/paciente/sos', '[data-testid="sos-operador-nombre"]')
  ok((await pac.page.getByTestId('sos-operador-nombre').textContent())?.includes('Julián Ríos'), 'el paciente ve "Va Julián Ríos" (el operador del día, no la cuenta fija)')
  const fotoSrc = await pac.page.getByTestId('sos-operador-foto').getAttribute('src').catch(() => null)
  ok(!!fotoSrc && fotoSrc.includes('operadores-dia'), 'el paciente ve la foto del operador (URL firmada del bucket)')
  await shot(pac.page, 'A5-paciente-en-camino')

  await page.getByTestId('llegue').click()
  ok(await hay(page, 'En el lugar'), '"Llegué" → pantalla "En el lugar"')
  ok(await hay(pac.page, 'llegó a tu ubicación'), 'el paciente ve "llegó a tu ubicación" en vivo')
  await shot(page, 'A6-llegue')
  await shot(pac.page, 'A7-paciente-llego')

  await page.getByTestId('ir-a-cierre').click()
  ok(await hay(page, '¿Cómo terminó?'), 'cierre: ¿Cómo terminó?')
  ok(await page.getByText('Foto de recepción').count() === 0, 'sin traslado NO se pide la foto de recepción')
  await page.getByRole('radio', { name: 'Trasladado' }).click()
  ok(await hay(page, 'Foto de recepción', 3000), 'con traslado sí aparece la foto de recepción')
  await page.fill('#institucion', 'Hospital Fernández')
  await page.setInputFiles('[data-testid="foto-recepcion"]', RECEPCION)
  ok(await page.getByTestId('recepcion-subida').waitFor({ timeout: 20000 }).then(() => true).catch(() => false), 'la recepción se sube y dice la hora')
  ok(await page.getByTestId('cerrar-emergencia').isDisabled(), 'sin diagnóstico no deja cerrar')
  await page.fill('#diagnostico', 'Crisis hipertensiva')
  await shot(page, 'A8-cierre')
  await page.getByTestId('cerrar-emergencia').click()
  ok(await hay(page, 'En guardia'), 'cerrada: vuelve a la guardia')
  const { data: cerrada } = await admin.from('emergencies').select('status, desenlace, cierre_sin_atencion, professional_id, cuenta_operador_id').eq('id', eid).single()
  ok(cerrada.status === 'completed' && cerrada.desenlace === 'traslado' && cerrada.cierre_sin_atencion?.includes('Crisis hipertensiva'), `la base: completed, traslado, diagnóstico guardado (${JSON.stringify(cerrada)})`)
  ok(await hay(pac.page, 'Atención finalizada', 15000), 'el paciente ve "Atención finalizada" en vivo')
  await pac.ctx.close()

  ok(errs.length === 0, `A: sin errores de JS durante el turno (${errs.join(' | ')})`)
  await page.getByTestId('terminar-turno').click()
  await page.waitForURL('**/login', { timeout: 120000 }).catch(() => {})
  await page.waitForLoadState('domcontentloaded')
  ok(page.url().includes('/login'), 'Terminar turno → vuelve al login')
  const claves = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('sb-')))
  ok(claves.length === 0, `la sesión se descartó del navegador (claves sb-*: ${claves.length})`)
  await ctx.close()
}

// ═══ B · modo profesional con aprobación del despacho ═══════════════════════
console.log('\n▸ B · DNI de un profesional de la lista → aprobación → atiende como el profesional')
await limpiar()
{
  const { page, ctx, errs } = await abrir('operador1@staging.healthier.app', '/operador', 'text=¿Quién sale hoy?')
  await page.fill('#dni', dniPro)
  await page.getByTestId('dni-continuar').click()
  ok(await hay(page, 'Esperando que el despacho confirme'), 'DNI de un profesional de la lista → "Esperando que el despacho confirme"')
  await shot(page, 'B1-espera')

  const des = await abrir('despacho@staging.healthier.app', '/despacho', 'text=Cola de despacho', { viewport: { width: 1280, height: 900 } })
  await des.page.waitForSelector('[data-testid="ingresos-pendientes"]', { timeout: 20000 }).catch(() => {})
  await des.page.getByRole('button', { name: 'Aprobar' }).click()
  ok(await hay(page, 'Atendés como', 30000), 'el despacho aprueba y el operador entra solo (sin tocar nada): "Atendés como …"')
  await shot(page, 'B2-guardia-profesional')
  const nombrePro = (await page.getByText(/Atendés como/).first().textContent()) ?? ''
  ok(nombrePro.includes(pro.full_name), `atiende como ${pro.full_name}`)
  const { data: modo } = await admin.from('operador_sesiones_log').select('operator_id, professional_id').eq('operator_id', op1.id).order('created_at', { ascending: false }).limit(1)
  ok(modo?.[0]?.professional_id === pro.id, 'la sesión quedó anotada en el log inmutable')

  // Sin ganancias, verificación ni Mercado Pago.
  const texto = (await page.locator('body').innerText()).toLowerCase()
  ok(!/ganancias|mercado pago|verificaci|comisi/.test(texto), 'la pantalla no muestra ganancias, verificación ni Mercado Pago')
  for (const ruta of ['/profesional/ganancias', '/profesional/configuracion', '/profesional/dashboard']) {
    await page.goto(BASE + ruta, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)
    ok(new URL(page.url()).pathname === '/operador', `${ruta} no se abre en modo operador: vuelve a /operador (url: ${page.url()})`)
  }
  await page.goto(BASE + '/operador', { waitUntil: 'domcontentloaded' })
  ok(await hay(page, 'En guardia', 30000), 'recargar /operador retoma la guardia (sin pedir DNI de nuevo)')

  const eid = await nuevaEmergenciaAsignada('UTM-7251')
  ok(await hay(page, 'En camino'), 'la emergencia aparece sola')
  const { data: asignada } = await admin.from('emergencies').select('professional_id, cuenta_operador_id').eq('id', eid).single()
  ok(asignada.professional_id === pro.id, 'la emergencia quedó a nombre del profesional')
  await shot(page, 'B3-en-camino')
  await page.getByTestId('llegue').click()
  ok(await hay(page, 'En el lugar'), '"Llegué"')
  ok(await page.getByTestId('atender').isVisible(), 'como profesional ve "Atender al paciente (receta)" (camino de siempre)')
  await shot(page, 'B4-llegue')
  await page.getByTestId('ir-a-cierre').click()
  await page.getByRole('radio', { name: 'En el lugar' }).click()
  await page.fill('#diagnostico', 'Cuadro ansioso')
  await page.getByTestId('cerrar-emergencia').click()
  ok(await hay(page, 'En guardia'), 'cierre "En el lugar" con diagnóstico → guardia')

  // Terminar turno: la sesión se descarta en el acto.
  const antes = await page.evaluate((k) => localStorage.getItem(k), KEY)
  ok(!!antes, 'antes de terminar hay sesión (la del profesional)')
  ok(errs.length === 0, `B: sin errores de JS durante el turno (${errs.join(' | ')})`)
  await page.getByTestId('terminar-turno').click()
  await page.waitForURL('**/login', { timeout: 120000 }).catch(() => {})
  await page.waitForLoadState('domcontentloaded')
  ok(page.url().includes('/login'), 'Terminar turno → login')
  const claves = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('sb-')))
  ok(claves.length === 0, 'la sesión del profesional ya no está en el navegador')
  await page.goto(BASE + '/profesional/dashboard', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  ok(page.url().includes('/login'), 'después de terminar, /profesional/dashboard manda al login (no queda como el profesional)')
  await des.ctx.close(); await ctx.close()
}

// ═══ C · el despacho rechaza ════════════════════════════════════════════════
console.log('\n▸ C · el despacho rechaza con motivo')
await limpiar()
{
  const { page, ctx } = await abrir('operador1@staging.healthier.app', '/operador', 'text=¿Quién sale hoy?')
  await page.fill('#dni', dniPro)
  await page.getByTestId('dni-continuar').click()
  await hay(page, 'Esperando que el despacho confirme')
  const des = await abrir('despacho@staging.healthier.app', '/despacho', 'text=Cola de despacho', { viewport: { width: 1280, height: 900 } })
  await des.page.waitForSelector('[data-testid="ingresos-pendientes"]', { timeout: 20000 }).catch(() => {})
  des.page.once('dialog', d => d.accept('No lo conozco'))
  await des.page.getByRole('button', { name: 'Rechazar' }).click()
  ok(await hay(page, 'No lo conozco', 30000), 'el operador ve el motivo real del rechazo')
  await shot(page, 'C1-rechazado')
  await des.ctx.close(); await ctx.close()
}

await limpiar()
await browser.close()
console.log(fallas ? `\n❌ ${fallas} chequeos fallaron` : '\n✅ todo en verde')
process.exit(fallas ? 1 : 0)
