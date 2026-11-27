#!/usr/bin/env node
/**
 * Control de "Solicitar receta" / "Ya tengo receta" en la farmacia
 * (migración 254) — SÓLO STAGING.
 *
 *   node scripts/verificar-solicitar-receta.mjs
 *
 * Lo que tiene que seguir siendo cierto, y que si se rompe no se ve en pantalla
 * hasta que le pasa a un paciente (regla: plata y permisos del lado del servidor):
 *
 *   1. Un paciente no puede ponerse a mano 'autorizado' / 'pagado', ni tocar
 *      `receta_*`, ni aprobarse su propia receta, ni agregar un producto con
 *      receta sin camino (`receta_via`) ni marcarlo en uno de venta libre.
 *   2. "Ya tengo receta" sólo vale con un archivo SUYO que exista en el bucket.
 *   3. Un profesional que no es "médico de Healthier" no ve ni toma pedidos, y
 *      nadie más que el super admin puede marcarlo.
 *   4. Dos médicos toman el mismo pedido a la vez → uno solo; hay UNA consulta
 *      (sin costo) y el otro deja de verlo. Reintentar devuelve la misma.
 *   5. Capturar sin receta emitida → rechazado (RECETA_NO_RESUELTA) y no se cobra.
 *   6. Sólo la farmacia (o un admin) aprueba/rechaza una receta subida.
 *   7. Rechazar (médico o farmacia) cancela el pedido y libera la retención sola.
 *   8. Mercado Pago de punta a punta con tarjeta de PRUEBA: mp-payment retiene
 *      (capture:false), el médico rechaza → se libera; con receta emitida →
 *      mp-capture cobra; el barrido libera lo que pasó de 5 días.
 *
 * Mercado Pago: staging no tiene cuenta de farmacia vinculada por OAuth; se
 * siembra, SÓLO durante la corrida, una fila de `pharmacy_mp_accounts` con el
 * access token TEST de la plataforma y se borra al final. Tarjeta de prueba de
 * MP (titular "APRO" aprueba). Nunca se cobra nada real.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const leerEnv = (ruta) => {
  try {
    return Object.fromEntries(
      readFileSync(ruta, 'utf8').split('\n')
        .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
    )
  } catch { return {} }
}
const env = {
  ...leerEnv(join(homedir(), 'Local', 'Healthier', 'website', '.env')),
  ...leerEnv(join(homedir(), 'Local', 'Healthier', '.env')),
  ...leerEnv(join(homedir(), 'Local', '.env')),
}

const URL = env.HEALTHIER_STAGING_SUPABASE_URL
const ANON = env.HEALTHIER_STAGING_SUPABASE_ANON_KEY
const SERVICE = env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
const MP_TEST_TOKEN = env.MP_ACCESS_TOKEN_SANDBOX
const MP_PUBLIC_KEY = env.VITE_MP_PUBLIC_KEY_SANDBOX
const COMPRADOR = 'comprador.prueba@example.com'
const FARMACIA_ID = '10000000-0000-0000-0000-000000000001'
if (!URL || !SERVICE) { console.error('Faltan HEALTHIER_STAGING_* en ~/Local/.env'); process.exit(1) }
if (URL.includes('aixjejdoofervrkggbkd')) { console.error('Esto es producción. Sólo staging.'); process.exit(1) }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })

let fallos = 0
const ok = m => console.log(`  ✅ ${m}`)
const mal = m => { fallos++; console.log(`  ❌ ${m}`) }
const nota = m => console.log(`  ·  ${m}`)
const bloque = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`)
const esperar = ms => new Promise(r => setTimeout(r, ms))
const chequear = (cond, bien, mala) => (cond ? ok(bien) : mal(mala))

/** Sesión real sin contraseña: magic link generado con la service key. */
async function sesion(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(`magic link ${email}: ${error.message}`)
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data: s, error: e2 } = await c.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' })
  if (e2) throw new Error(`sesión ${email}: ${e2.message}`)
  return { c, id: s.user.id, email }
}

async function llamar(quien, funcion, body) {
  const headers = { apikey: ANON, 'Content-Type': 'application/json' }
  if (quien) {
    const { data: { session } } = await quien.c.auth.getSession()
    headers.Authorization = `Bearer ${session.access_token}`
  } else headers.Authorization = `Bearer ${SERVICE}`
  const res = await fetch(`${URL}/functions/v1/${funcion}`, { method: 'POST', headers, body: JSON.stringify(body) })
  const j = await res.json().catch(() => ({}))
  return { http: res.status, data: j.data ?? null, error: j.error ?? null, code: j.code ?? null }
}

async function tokenDePrueba(titular) {
  const res = await fetch(`https://api.mercadopago.com/v1/card_tokens?public_key=${MP_PUBLIC_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      card_number: '5031755734530604',
      expiration_month: 11, expiration_year: 2030, security_code: '123',
      cardholder: { name: titular, identification: { type: 'DNI', number: '12345678' } },
    }),
  })
  const j = await res.json()
  if (!j.id) throw new Error(`card_token: ${JSON.stringify(j)}`)
  return j.id
}

const creados = { ordenes: [], consultas: [], recetas: [], archivos: [] }
const restaurar = []

// Paciente de prueba SIN receta vigente que cubra el producto: si ya tuviera una,
// el camino "sin receta" ni haría falta y los chequeos no probarían nada.
const { data: productoElegido } = await admin.from('pharmacy_products')
  .select('id').eq('pharmacy_id', FARMACIA_ID).ilike('name', 'Amoxicilina 500mg x 21').limit(1).single()
let paciente = null
for (const email of ['paciente.completo@staging.healthier.app', 'julieta.sosa@staging.healthier.app', 'camila.benitez@staging.healthier.app',
  'control-paciente@staging.healthier.app', 'op-test-paciente@staging.healthier.app', 'paciente.incompleto@staging.healthier.app']) {
  const { data: u } = await admin.from('profiles').select('id, es_prueba').eq('email', email).maybeSingle()
  if (!u?.es_prueba) continue
  const { data: rs } = await admin.rpc('farmacia_recetas_de', { p_patient: u.id, p_excluir_pedido: null })
  const cubre = (rs ?? []).some(r => r.estado === 'vigente' && (r.producto_ids ?? []).includes(productoElegido.id))
  if (!cubre) { paciente = await sesion(email); break }
}
if (!paciente) throw new Error('ningún paciente de prueba sin receta vigente para el producto')
nota(`paciente de la corrida: ${paciente.email}`)
const medA = await sesion('clinica@staging.healthier.app')
const medB = await sesion('profesional@healthier.app')
const sinMarca = await sesion('demo.ana@healthier.app')
const farmacia = await sesion('farmacia@staging.healthier.app')
const superAdmin = await sesion('superadmin@healthier.app')

// ── Producto con receta de prueba ───────────────────────────────────────────
const { data: producto } = await admin.from('pharmacy_products')
  .select('id, name, presentation, price, prescription_type')
  .eq('pharmacy_id', FARMACIA_ID).ilike('name', 'Amoxicilina 500mg x 21').limit(1).single()
const { data: libre } = await admin.from('pharmacy_products')
  .select('id').eq('pharmacy_id', FARMACIA_ID).eq('prescription_type', 'venta_libre').limit(1).single()
if (!producto || !libre) throw new Error('faltan productos de prueba en staging')

// El paciente no tiene que tener ya una receta vigente que cubra el producto
// (si no, el camino "sin receta" ni haría falta). Se anota y se sigue.
{
  const { data: cubre } = await admin.rpc('farmacia_recetas_de', { p_patient: paciente.id, p_excluir_pedido: null })
  const vigentes = (cubre ?? []).filter(r => r.estado === 'vigente' && (r.producto_ids ?? []).includes(producto.id))
  if (vigentes.length) nota(`⚠ el paciente ya tiene ${vigentes.length} receta(s) vigente(s) para el producto: algunos chequeos pueden no aplicar`)
}

// Médicos de Healthier de la corrida: A y B marcados; "sinMarca" no.
for (const pro of [medA, medB, sinMarca]) {
  const { data: antes } = await admin.from('professional_profiles')
    .select('medico_healthier, is_verified').eq('user_id', pro.id).single()
  restaurar.push(() => admin.from('professional_profiles').update(antes).eq('user_id', pro.id))
}
await admin.from('professional_profiles').update({ medico_healthier: true, is_verified: true }).in('user_id', [medA.id, medB.id])
await admin.from('professional_profiles').update({ medico_healthier: false, is_verified: true }).eq('user_id', sinMarca.id)

// Teléfono del paciente (lo ve el médico en la lista).
{
  const { data: antes } = await admin.from('profiles').select('phone, payment_exempt').eq('id', paciente.id).single()
  restaurar.push(() => admin.from('profiles').update(antes).eq('id', paciente.id))
  await admin.from('profiles').update({ phone: antes.phone || '+5491100000000', payment_exempt: false }).eq('id', paciente.id)
}

/** Un pedido ya retenido (como lo deja mp-payment), armado con la service key. */
async function pedidoRetenido({ via = 'solicitar', archivo = null, minutosAtras = 0 } = {}) {
  const { data: o, error } = await admin.from('medication_orders').insert({
    patient_id: paciente.id, pharmacy_id: FARMACIA_ID, subtotal: producto.price, total: producto.price,
    payment_status: 'autorizado', receta_estado: 'pendiente',
    autorizado_at: new Date(Date.now() - minutosAtras * 60000).toISOString(),
  }).select('id').single()
  if (error) throw new Error(`pedido: ${error.message}`)
  creados.ordenes.push(o.id)
  const { error: e2 } = await admin.from('medication_order_items').insert({
    order_id: o.id, pharmacy_product_id: producto.id, medication_name: producto.name, presentation: producto.presentation,
    quantity: 1, unit_price: producto.price, requires_prescription: true, receta_via: via, receta_archivo_path: archivo,
  })
  if (e2) throw new Error(`item: ${e2.message}`)
  return o.id
}
const leerPedido = async id => (await admin.from('medication_orders').select('*').eq('id', id).single()).data

async function limpiarCarrito() {
  const { data } = await admin.from('medication_orders').select('id').eq('patient_id', paciente.id)
    .eq('payment_status', 'no_pagado').eq('status', 'pendiente')
  for (const o of data ?? []) {
    await admin.from('payments').delete().eq('order_id', o.id)
    await admin.from('medication_orders').delete().eq('id', o.id)
  }
}

try {
  // ── 1. El paciente no puede escribir lo del servidor ─────────────────────
  bloque('1. El paciente no escribe plata ni receta')
  {
    await limpiarCarrito()
    // Sin camino y sin receta → HR001
    let r = await paciente.c.rpc('agregar_item_pedido_medicamentos', { p_product_id: producto.id, p_delta: 1 })
    chequear(r.error && /receta vigente/i.test(r.error.message), 'producto con receta sin camino ni receta → rechazado',
      `agregó con receta sin camino (${JSON.stringify(r.error ?? r.data)})`)
    await limpiarCarrito()

    r = await paciente.c.rpc('agregar_item_pedido_medicamentos', { p_product_id: libre.id, p_delta: 1, p_receta_via: 'solicitar' })
    chequear(r.error, 'marcar "solicitar" en un producto de venta libre → rechazado', 'marcó solicitar en venta libre')
    await limpiarCarrito()

    r = await paciente.c.rpc('agregar_item_pedido_medicamentos',
      { p_product_id: producto.id, p_delta: 1, p_receta_via: 'subida', p_receta_archivo_path: null })
    chequear(r.error, '"subida" sin archivo → rechazado', '"subida" sin archivo pasó')
    await limpiarCarrito()

    r = await paciente.c.rpc('agregar_item_pedido_medicamentos',
      { p_product_id: producto.id, p_delta: 1, p_receta_via: 'subida', p_receta_archivo_path: `${paciente.id}/no-existe.pdf` })
    chequear(r.error, '"subida" con un archivo que no existe en el bucket → rechazado', '"subida" con archivo inexistente pasó')
    await limpiarCarrito()

    r = await paciente.c.rpc('agregar_item_pedido_medicamentos',
      { p_product_id: producto.id, p_delta: 1, p_receta_via: 'subida', p_receta_archivo_path: `${medA.id}/ajeno.pdf` })
    chequear(r.error, '"subida" con un archivo de la carpeta de OTRO → rechazado', '"subida" con carpeta ajena pasó')
    await limpiarCarrito()

    // Camino válido: solicitar
    r = await paciente.c.rpc('agregar_item_pedido_medicamentos', { p_product_id: producto.id, p_delta: 1, p_receta_via: 'solicitar' })
    chequear(!r.error && r.data, 'con "solicitar" se agrega sin receta', `no pudo agregar con solicitar: ${r.error?.message}`)
    const cartId = r.data
    if (cartId) {
      creados.ordenes.push(cartId)
      for (const patch of [
        { payment_status: 'autorizado' }, { payment_status: 'pagado' },
        { receta_estado: 'resuelta' }, { receta_medico_id: medA.id }, { autorizado_at: new Date().toISOString() },
      ]) {
        const { error } = await paciente.c.from('medication_orders').update(patch).eq('id', cartId)
        const { data: fila } = await admin.from('medication_orders').select('payment_status, receta_estado, receta_medico_id, autorizado_at').eq('id', cartId).single()
        const intacto = fila.payment_status === 'no_pagado' && fila.receta_estado === null && fila.receta_medico_id === null && fila.autorizado_at === null
        chequear(error && intacto, `el paciente no puede escribir ${Object.keys(patch)[0]}`, `el paciente escribió ${JSON.stringify(patch)} → ${JSON.stringify(fila)}`)
      }
      const { data: it } = await admin.from('medication_order_items').select('id').eq('order_id', cartId).single()
      await paciente.c.from('medication_order_items').update({ receta_aprobada_at: new Date().toISOString() }).eq('id', it.id)
      const { data: it2 } = await admin.from('medication_order_items').select('receta_aprobada_at').eq('id', it.id).single()
      chequear(it2.receta_aprobada_at === null, 'el paciente no puede aprobarse su propia receta', 'el paciente se aprobó la receta')
      const { error: eIns } = await paciente.c.from('medication_order_items').insert({
        order_id: cartId, pharmacy_product_id: libre.id, medication_name: 'x', quantity: 1, unit_price: 1, receta_via: 'solicitar' })
      chequear(eIns, 'el paciente no inserta items a mano', 'el paciente insertó un item a mano')
      // La consulta "de receta" no se inventa
      const { error: eC } = await paciente.c.from('consultations').insert({
        patient_id: paciente.id, professional_id: medA.id, status: 'confirmed', scheduled_at: new Date().toISOString(),
        modality: 'video', payment_status: 'exempt', price_at_booking: 0, medication_order_id: cartId })
      chequear(eC, 'el paciente no se arma una consulta marcada como "de receta"', 'el paciente creó una consulta de receta')
    }
    await limpiarCarrito()
  }

  // ── 2. Subida real al bucket + marca válida ──────────────────────────────
  bloque('2. "Ya tengo receta": el archivo tiene que existir y ser suyo')
  let rutaSubida = null
  {
    rutaSubida = `${paciente.id}/control-${Date.now()}.pdf`
    const up = await paciente.c.storage.from('recetas-subidas').upload(rutaSubida, new Blob(['%PDF-1.4 control'], { type: 'application/pdf' }), { contentType: 'application/pdf' })
    chequear(!up.error, 'el paciente sube su archivo a su carpeta', `no pudo subir: ${up.error?.message}`)
    creados.archivos.push(rutaSubida)
    const ajeno = await paciente.c.storage.from('recetas-subidas').upload(`${medA.id}/x.pdf`, new Blob(['x'], { type: 'application/pdf' }), { contentType: 'application/pdf' })
    chequear(ajeno.error, 'no puede subir a la carpeta de otro', 'subió a la carpeta de otro')
    if (ajeno.data) creados.archivos.push(`${medA.id}/x.pdf`)
    const r = await paciente.c.rpc('agregar_item_pedido_medicamentos',
      { p_product_id: producto.id, p_delta: 1, p_receta_via: 'subida', p_receta_archivo_path: rutaSubida })
    chequear(!r.error, 'con su archivo, "subida" se agrega', `no agregó con archivo propio: ${r.error?.message}`)
    await limpiarCarrito()
    const lee = await sinMarca.c.storage.from('recetas-subidas').download(rutaSubida)
    chequear(lee.error, 'un profesional cualquiera no puede leer la receta subida', 'un profesional leyó la receta subida')
    const leeF = await farmacia.c.storage.from('recetas-subidas').download(rutaSubida)
    chequear(!leeF.error, 'la farmacia sí la puede leer', `la farmacia no pudo leerla: ${leeF.error?.message}`)
  }

  // ── 3. Quién es médico de Healthier ──────────────────────────────────────
  bloque('3. Sólo el médico de Healthier ve y toma pedidos')
  const pedidoA = await pedidoRetenido()
  {
    let r = await sinMarca.c.rpc('medico_pedidos_de_receta')
    chequear(r.error, 'un profesional sin la marca no ve la lista', 'un profesional sin marca ve la lista')
    r = await sinMarca.c.rpc('medico_tomar_pedido_de_receta', { p_order: pedidoA })
    chequear(r.error && (await leerPedido(pedidoA)).receta_estado === 'pendiente', 'un profesional sin la marca no toma el pedido', 'un profesional sin marca tomó el pedido')
    r = await paciente.c.rpc('medico_pedidos_de_receta')
    chequear(r.error, 'un paciente no ve la lista', 'un paciente ve la lista')
    // 258: nadie de afuera pregunta quién es médico de Healthier.
    r = await paciente.c.rpc('es_medico_healthier', { p_user: medA.id })
    chequear(r.error, 'un usuario no puede preguntar quién es médico de Healthier (258)', `es_medico_healthier abierta: ${JSON.stringify(r.data)}`)
    const { error } = await medA.c.from('professional_profiles').update({ medico_healthier: false }).eq('user_id', medA.id)
    const { data: p } = await admin.from('professional_profiles').select('medico_healthier').eq('user_id', medA.id).single()
    chequear(error && p.medico_healthier === true, 'el propio profesional no se saca/pone la marca', 'el profesional cambió su propia marca')
    const { error: e2 } = await sinMarca.c.from('professional_profiles').update({ medico_healthier: true }).eq('user_id', sinMarca.id)
    const { data: p2 } = await admin.from('professional_profiles').select('medico_healthier').eq('user_id', sinMarca.id).single()
    chequear(e2 && p2.medico_healthier === false, 'un profesional no se marca a sí mismo', 'un profesional se marcó a sí mismo')
    const { error: e3 } = await superAdmin.c.from('professional_profiles').update({ medico_healthier: true }).eq('user_id', sinMarca.id)
    const { data: p3 } = await admin.from('professional_profiles').select('medico_healthier').eq('user_id', sinMarca.id).single()
    chequear(!e3 && p3.medico_healthier === true, 'el super admin sí puede marcar a un médico', `el super admin no pudo marcar: ${e3?.message}`)
    await admin.from('professional_profiles').update({ medico_healthier: false }).eq('user_id', sinMarca.id)
  }

  // ── 4. Toma atómica ──────────────────────────────────────────────────────
  bloque('4. Dos médicos toman el mismo pedido → uno solo')
  {
    const [a, b] = await Promise.all([
      medA.c.rpc('medico_tomar_pedido_de_receta', { p_order: pedidoA }),
      medB.c.rpc('medico_tomar_pedido_de_receta', { p_order: pedidoA }),
    ])
    const ganadores = [a, b].filter(x => !x.error)
    chequear(ganadores.length === 1, 'exactamente uno se lo queda', `tomaron ${ganadores.length}: ${JSON.stringify([a.error?.message, b.error?.message])}`)
    const ganador = a.error ? medB : medA
    const perdedor = a.error ? medA : medB
    const consultaId = ganadores[0]?.data
    if (consultaId) creados.consultas.push(consultaId)
    const { data: cons } = await admin.from('consultations').select('*').eq('medication_order_id', pedidoA)
    chequear(cons?.length === 1, 'hay UNA consulta para el pedido', `hay ${cons?.length} consultas`)
    if (cons?.length === 1) {
      const c = cons[0]
      chequear(c.professional_id === ganador.id && c.patient_id === paciente.id && c.payment_status === 'exempt' && Number(c.price_at_booking) === 0,
        'la consulta es del ganador, del paciente, sin costo', `consulta rara: ${JSON.stringify(c)}`)
    }
    const o = await leerPedido(pedidoA)
    chequear(o.receta_estado === 'en_curso' && o.receta_medico_id === ganador.id && o.receta_consulta_id === consultaId,
      'el pedido queda en_curso con su médico y su consulta', `pedido: ${JSON.stringify(o)}`)
    const { data: listaG } = await ganador.c.rpc('medico_pedidos_de_receta')
    const mio = (listaG ?? []).find(x => x.order_id === pedidoA)
    chequear(mio && mio.tomado_por_mi && mio.paciente_telefono, 'el ganador lo ve con el teléfono del paciente', `el ganador no lo ve bien: ${JSON.stringify(mio)}`)
    chequear(mio && mio.lista_para_cobrar === false, 'sin receta emitida, "lista para cobrar" es falso', `lista_para_cobrar=${mio?.lista_para_cobrar}`)
    const { data: listaP } = await perdedor.c.rpc('medico_pedidos_de_receta')
    chequear(!(listaP ?? []).some(x => x.order_id === pedidoA), 'el otro médico ya no lo ve', 'el otro médico lo sigue viendo')
    const re = await ganador.c.rpc('medico_tomar_pedido_de_receta', { p_order: pedidoA })
    chequear(!re.error && re.data === consultaId, 'reintentar devuelve la misma consulta', `reintento: ${JSON.stringify(re)}`)
    const mp = await perdedor.c.rpc('medico_rechazar_pedido_de_receta', { p_order: pedidoA, p_motivo: 'no era mío' })
    chequear(mp.error && (await leerPedido(pedidoA)).receta_estado === 'en_curso', 'el que no lo tiene no lo puede rechazar', 'el perdedor rechazó un pedido ajeno')

    // ── 5. Capturar sin receta emitida ─────────────────────────────────────
    bloque('5. Capturar sin receta emitida → rechazado')
    let c = await llamar(ganador, 'mp-capture', { action: 'capture-pharmacy-order', orderId: pedidoA })
    chequear(c.http === 422 && c.code === 'RECETA_NO_RESUELTA', 'el médico asignado no cobra sin receta emitida', `capture sin receta: ${JSON.stringify(c)}`)
    c = await llamar(farmacia, 'mp-capture', { action: 'capture-pharmacy-order', orderId: pedidoA })
    chequear(c.http === 422 && c.code === 'RECETA_NO_RESUELTA', 'la farmacia tampoco', `capture farmacia sin receta: ${JSON.stringify(c)}`)
    c = await llamar(perdedor, 'mp-capture', { action: 'capture-pharmacy-order', orderId: pedidoA })
    chequear(c.http === 403, 'otro médico no puede cobrar un pedido que no es suyo (403)', `capture de otro médico: ${c.http}`)
    c = await llamar(paciente, 'mp-capture', { action: 'capture-pharmacy-order', orderId: pedidoA })
    chequear(c.http === 403, 'el paciente no puede disparar el cobro (403)', `capture del paciente: ${c.http}`)
    c = await llamar(paciente, 'mp-capture', { action: 'cancel-pharmacy-order', orderId: pedidoA, motivo: 'x' })
    chequear(c.http === 403, 'el paciente no libera un pedido que ya tomó un médico (403)', `cancel del paciente tras tomarlo: ${c.http}`)
    chequear((await leerPedido(pedidoA)).payment_status === 'autorizado', 'el pedido sigue retenido', 'el pedido cambió de estado')

    // ── Con receta emitida el médico puede cobrar (la validación pasa) ─────
    const { data: rx } = await admin.from('clinical_medications').insert({
      patient_id: paciente.id, professional_id: ganador.id, professional_license_type: 'MN', professional_license_number: '0',
      medication_name: 'Amoxicilina 500mg x 21', dosage_text: 'cada 8 horas', rcta_status: 'issued', rcta_issued_at: new Date().toISOString(),
    }).select('id').single()
    creados.recetas.push(rx.id)
    const { data: lista2 } = await ganador.c.rpc('medico_pedidos_de_receta')
    chequear((lista2 ?? []).find(x => x.order_id === pedidoA)?.lista_para_cobrar === true,
      'con la receta emitida, "lista para cobrar" pasa a verdadero', 'no detecta la receta emitida')
    // Sin pago en MP (pedido sembrado): la validación pasa y recién falla por no haber pago.
    c = await llamar(ganador, 'mp-capture', { action: 'capture-pharmacy-order', orderId: pedidoA })
    chequear(c.http === 422 && /No authorized payment/.test(c.error ?? ''), 'con receta emitida la validación pasa (sólo falta el pago de MP, sembrado)', `capture con receta: ${JSON.stringify(c)}`)
    const it = (await admin.from('medication_order_items').select('clinical_medication_id').eq('order_id', pedidoA).single()).data
    chequear(it.clinical_medication_id === rx.id, 'el item quedó atado a la receta emitida', 'el item no se ató a la receta')
    // Esta receta no puede quedar viva para las pruebas de Mercado Pago de más abajo.
    await admin.from('consultations').delete().eq('medication_order_id', pedidoA)
    await admin.from('payments').delete().eq('order_id', pedidoA)
    await admin.from('medication_orders').delete().eq('id', pedidoA)
    // Las historias clínicas no se borran (Ley 26.529): se dan de baja.
    await admin.from('clinical_medications').update({ status: 'cancelled' }).eq('id', rx.id)
  }

  // ── 6/7. Rechazar libera sola ────────────────────────────────────────────
  bloque('7. El médico rechaza → el pedido se cancela solo')
  {
    const id = await pedidoRetenido()
    const sinMotivo = await medA.c.rpc('medico_rechazar_pedido_de_receta', { p_order: id, p_motivo: '  ' })
    chequear(sinMotivo.error, 'rechazar exige un motivo', 'rechazó sin motivo')
    const r = await medA.c.rpc('medico_rechazar_pedido_de_receta', { p_order: id, p_motivo: 'No corresponde un antibiótico sin consulta' })
    chequear(!r.error, 'el médico rechaza', `no pudo rechazar: ${r.error?.message}`)
    let o
    for (let i = 0; i < 20; i++) { await esperar(1500); o = await leerPedido(id); if (o.status === 'cancelado') break }
    chequear(o.status === 'cancelado' && o.payment_status === 'no_pagado' && o.cancellation_reason?.includes('antibiótico'),
      'el pedido queda cancelado, sin cobrar, con el motivo del médico', `pedido tras rechazar: ${JSON.stringify(o)}`)
  }

  bloque('6. Sólo la farmacia aprueba/rechaza una receta subida')
  {
    const id = await pedidoRetenido({ via: 'subida', archivo: rutaSubida })
    let r = await paciente.c.rpc('farmacia_resolver_receta_subida', { p_order: id, p_aprobar: true })
    chequear(r.error, 'el paciente no aprueba su receta', 'el paciente aprobó su receta')
    r = await medA.c.rpc('farmacia_resolver_receta_subida', { p_order: id, p_aprobar: true })
    chequear(r.error, 'un médico no aprueba una receta subida', 'un médico aprobó')
    r = await sinMarca.c.rpc('farmacia_recetas_subidas_del_pedido', { p_order: id })
    chequear(r.error, 'un profesional no lista las recetas subidas', 'un profesional las listó')
    r = await farmacia.c.rpc('farmacia_resolver_receta_subida', { p_order: id, p_aprobar: false, p_motivo: '' })
    chequear(r.error, 'rechazar exige un motivo', 'rechazó sin motivo')
    r = await farmacia.c.rpc('farmacia_recetas_subidas_del_pedido', { p_order: id })
    chequear(!r.error && r.data?.length === 1, 'la farmacia ve el archivo a revisar', `la farmacia no lo ve: ${r.error?.message}`)
    r = await farmacia.c.rpc('farmacia_resolver_receta_subida', { p_order: id, p_aprobar: true })
    chequear(!r.error && r.data?.estado === 'aprobada_cobrando', 'la farmacia aprueba', `aprobar: ${JSON.stringify(r)}`)
    const { data: it } = await admin.from('medication_order_items').select('receta_aprobada_at').eq('order_id', id).single()
    chequear(it.receta_aprobada_at, 'la aprobación queda registrada', 'no se registró la aprobación')
    await esperar(3000) // el cobro automático falla (pedido sembrado, sin pago de MP): queda retenido
    chequear((await leerPedido(id)).payment_status === 'autorizado', 'sin pago de MP real el pedido sigue retenido (no se marca pagado a mano)', 'quedó pagado sin cobro')

    const id2 = await pedidoRetenido({ via: 'subida', archivo: rutaSubida })
    r = await farmacia.c.rpc('farmacia_resolver_receta_subida', { p_order: id2, p_aprobar: false, p_motivo: 'La receta está vencida' })
    chequear(!r.error, 'la farmacia rechaza con motivo', `rechazar: ${r.error?.message}`)
    let o
    for (let i = 0; i < 20; i++) { await esperar(1500); o = await leerPedido(id2); if (o.status === 'cancelado') break }
    chequear(o.status === 'cancelado' && o.payment_status === 'no_pagado' && o.cancellation_reason === 'La receta está vencida',
      'el rechazo de la farmacia cancela el pedido solo, con su motivo', `pedido tras rechazo: ${JSON.stringify(o)}`)
  }

  // ── Barrido: lo retenido hace más de 5 días se libera ────────────────────
  bloque('Barrido de retenciones vencidas')
  {
    const viejo = await pedidoRetenido({ minutosAtras: 6 * 24 * 60 })
    const fresco = await pedidoRetenido({ minutosAtras: 60 })
    const s = await llamar(null, 'mp-capture', { action: 'sweep' })
    chequear(s.http === 200 && s.data?.farmacia, 'el barrido corre y reporta farmacia', `sweep: ${JSON.stringify(s)}`)
    const ov = await leerPedido(viejo), of = await leerPedido(fresco)
    chequear(ov.status === 'cancelado' && ov.payment_status === 'no_pagado' && /no se resolvió a tiempo/i.test(ov.cancellation_reason ?? ''),
      'lo retenido hace 6 días se libera solo', `viejo: ${JSON.stringify(ov)}`)
    chequear(of.payment_status === 'autorizado' && of.status === 'pendiente', 'lo de hace una hora NO se toca', `fresco: ${JSON.stringify(of)}`)
  }

  // ── 8. Mercado Pago de punta a punta (tarjeta de prueba) ─────────────────
  bloque('8. Mercado Pago: retener, liberar y cobrar (tarjeta de prueba)')
  if (!MP_TEST_TOKEN || !MP_PUBLIC_KEY) {
    nota('faltan MP_ACCESS_TOKEN_SANDBOX / VITE_MP_PUBLIC_KEY_SANDBOX: se saltea')
  } else {
    const { data: yaTenia } = await admin.from('pharmacy_mp_accounts').select('pharmacy_id').eq('pharmacy_id', FARMACIA_ID).maybeSingle()
    if (!yaTenia) {
      const yo = await fetch('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${MP_TEST_TOKEN}` } }).then(r => r.json())
      await admin.from('pharmacy_mp_accounts').insert({
        pharmacy_id: FARMACIA_ID, mp_user_id: String(yo.id), access_token: MP_TEST_TOKEN, active: true, live_mode: false,
        mp_nickname: 'vendedor-simulado-control', connected_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(),
      })
      restaurar.push(() => admin.from('pharmacy_mp_accounts').delete().eq('pharmacy_id', FARMACIA_ID).eq('mp_nickname', 'vendedor-simulado-control'))
      nota(`vendedor simulado para la farmacia (cuenta TEST ${yo.id})`)
    }

    async function retener() {
      await limpiarCarrito()
      const r = await paciente.c.rpc('agregar_item_pedido_medicamentos', { p_product_id: producto.id, p_delta: 1, p_receta_via: 'solicitar' })
      if (r.error || !r.data) throw new Error(`carrito: ${r.error?.message}`)
      creados.ordenes.push(r.data)
      const pago = await llamar(paciente, 'mp-payment', {
        orderId: r.data, cardToken: await tokenDePrueba('APRO'), paymentMethodId: 'master', payerEmail: COMPRADOR,
      })
      return { orderId: r.data, pago }
    }

    // (a) retener y que el médico rechace → se libera en MP
    const a = await retener()
    if (!a.pago.data?.authorized) {
      mal(`mp-payment no retuvo: ${JSON.stringify(a.pago)}`)
    } else {
      const oa = await leerPedido(a.orderId)
      chequear(oa.payment_status === 'autorizado' && oa.receta_estado === 'pendiente' && oa.autorizado_at,
        'mp-payment retiene: pedido autorizado, receta pendiente', `pedido: ${JSON.stringify(oa)}`)
      const { data: pa } = await admin.from('payments').select('status, mp_payment_id').eq('order_id', a.orderId).single()
      chequear(pa.status === 'authorized', 'el pago quedó "authorized" (capture:false), sin cobrar', `pago: ${JSON.stringify(pa)}`)
      const lista = await medA.c.rpc('medico_pedidos_de_receta')
      chequear((lista.data ?? []).some(x => x.order_id === a.orderId), 'el pedido retenido aparece en la lista del médico', 'no aparece en la lista')
      const rr = await medA.c.rpc('medico_rechazar_pedido_de_receta', { p_order: a.orderId, p_motivo: 'Control: no corresponde' })
      chequear(!rr.error, 'el médico rechaza', `rechazo: ${rr.error?.message}`)
      let ob, pb
      for (let i = 0; i < 25; i++) {
        await esperar(2000)
        ob = await leerPedido(a.orderId)
        pb = (await admin.from('payments').select('status, auth_cancelled_at').eq('order_id', a.orderId).single()).data
        if (pb.status === 'cancelled') break
      }
      chequear(pb.status === 'cancelled' && ob.status === 'cancelado' && ob.payment_status === 'no_pagado',
        'la retención se libera en MP y el pedido queda cancelado', `tras rechazar: pago=${JSON.stringify(pb)} pedido=${JSON.stringify(ob)}`)
      const rep = await llamar(null, 'mp-capture', { action: 'cancel-pharmacy-order', orderId: a.orderId, motivo: 'otra vez' })
      chequear(rep.http === 200 && rep.data?.alreadyCancelled, 'liberar dos veces es idempotente', `segundo cancel: ${JSON.stringify(rep)}`)
    }

    // (b) retener, con receta emitida el médico cobra → pagado
    const b = await retener()
    if (!b.pago.data?.authorized) {
      mal(`mp-payment no retuvo (b): ${JSON.stringify(b.pago)}`)
    } else {
      const t = await medB.c.rpc('medico_tomar_pedido_de_receta', { p_order: b.orderId })
      if (t.data) creados.consultas.push(t.data)
      chequear(!t.error, 'el médico toma el pedido retenido', `tomar: ${t.error?.message}`)
      let c = await llamar(medB, 'mp-capture', { action: 'capture-pharmacy-order', orderId: b.orderId })
      chequear(c.http === 422 && c.code === 'RECETA_NO_RESUELTA', 'sin receta emitida no cobra (con MP real)', `capture sin receta: ${JSON.stringify(c)}`)
      const { data: pStill } = await admin.from('payments').select('status').eq('order_id', b.orderId).single()
      chequear(pStill.status === 'authorized', 'y la retención sigue intacta en MP', `pago: ${pStill.status}`)
      const { data: rx } = await admin.from('clinical_medications').insert({
        patient_id: paciente.id, professional_id: medB.id, professional_license_type: 'MN', professional_license_number: '0',
        medication_name: 'Amoxicilina 500mg x 21', dosage_text: 'cada 8 horas', rcta_status: 'issued', rcta_issued_at: new Date().toISOString(),
      }).select('id').single()
      creados.recetas.push(rx.id)
      c = await llamar(medB, 'mp-capture', { action: 'capture-pharmacy-order', orderId: b.orderId })
      chequear(c.http === 200 && c.data?.captured, 'con la receta emitida, el médico cobra', `capture: ${JSON.stringify(c)}`)
      const ob = await leerPedido(b.orderId)
      const { data: pb } = await admin.from('payments').select('status, captured_at').eq('order_id', b.orderId).single()
      chequear(pb.status === 'approved' && ob.payment_status === 'pagado' && ob.receta_estado === 'resuelta' && ob.status === 'pendiente',
        'pago aprobado, pedido pagado y receta resuelta (la farmacia lo prepara)', `tras cobrar: pago=${JSON.stringify(pb)} pedido=${JSON.stringify(ob)}`)
      const rep = await llamar(medB, 'mp-capture', { action: 'capture-pharmacy-order', orderId: b.orderId })
      chequear(rep.http === 200 && rep.data?.alreadyCaptured, 'cobrar dos veces es idempotente', `segundo capture: ${JSON.stringify(rep)}`)
      const lib = await llamar(null, 'mp-capture', { action: 'cancel-pharmacy-order', orderId: b.orderId, motivo: 'x' })
      chequear(lib.http === 409, 'un pedido ya cobrado no se puede liberar', `cancel de pagado: ${JSON.stringify(lib)}`)
    }
  }
} catch (e) {
  mal(`la corrida se cortó: ${e.stack || e.message}`)
} finally {
  bloque('Limpieza')
  for (const f of creados.archivos) await admin.storage.from('recetas-subidas').remove([f])
  for (const id of creados.consultas) await admin.from('consultations').delete().eq('id', id)
  await admin.from('consultations').delete().in('medication_order_id', creados.ordenes.length ? creados.ordenes : ['00000000-0000-0000-0000-000000000000'])
  if (creados.ordenes.length) await admin.from('payments').delete().in('order_id', creados.ordenes)
  for (const id of creados.ordenes) await admin.from('medication_orders').delete().eq('id', id)
  for (const id of creados.recetas) await admin.from('clinical_medications').update({ status: 'cancelled' }).eq('id', id)
  await limpiarCarrito()
  for (const f of restaurar.reverse()) { try { await f() } catch { /* ya borrado */ } }
  nota('restaurado')
}

console.log(fallos ? `\n❌ ${fallos} chequeo(s) en rojo.\n` : '\n✅ Solicitar receta: todo en verde.\n')
process.exit(fallos ? 1 : 0)
