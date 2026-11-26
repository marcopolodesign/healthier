#!/usr/bin/env node
/**
 * Control del beneficio de socio comercial (LIFT, migración 252) — SÓLO STAGING.
 *
 *   node scripts/verificar-beneficio-socio.mjs
 *
 * Lo que tiene que seguir siendo cierto, y que si se rompe cuesta plata sin
 * que se vea en pantalla:
 *
 *   1. El código: uno falso no atribuye; "lift" sí; un segundo código no pisa
 *      al primero; el paciente no puede escribirse la atribución ni el
 *      descuento a mano, ni llamar a la reserva del servidor.
 *   2. Primera consulta con 20%: mp-payment cobra el 80% del precio DE LA BASE
 *      aunque el cliente mande otro monto, y el profesional cobra lo mismo que
 *      sin descuento (lo pone Healthier de su comisión).
 *   3. Segunda consulta: sin descuento.
 *   4. Dos cobros en paralelo de un socio nuevo: el descuento se lo lleva UNO.
 *   5. Consulta cancelada → el descuento vuelve a estar disponible.
 *   6. Comisión del profesional menor al descuento: el split nunca es negativo
 *      y la diferencia queda como liquidación manual al profesional.
 *   7. Liquidación: 5% de lo cobrado por cada consulta terminada, visible para
 *      el super admin y negada al paciente.
 *
 * Mercado Pago: igual que verificar-despacho-ondemand.mjs, se siembra SÓLO
 * durante la corrida un vendedor simulado (token TEST de la plataforma) y se
 * paga con la tarjeta de prueba "APRO". Los pacientes son nuevos y quedan
 * marcados `es_prueba`.
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
if (!URL || !SERVICE) { console.error('Faltan HEALTHIER_STAGING_* en ~/Local/.env'); process.exit(1) }
if (URL.includes('aixjejdoofervrkggbkd')) { console.error('Esto es producción. Sólo staging.'); process.exit(1) }
if (!MP_TEST_TOKEN || !MP_PUBLIC_KEY) { console.error('Faltan MP_ACCESS_TOKEN_SANDBOX / VITE_MP_PUBLIC_KEY_SANDBOX'); process.exit(1) }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })
let fallos = 0
const ok = (cond, m) => { if (cond) console.log(`  ✅ ${m}`); else { fallos++; console.log(`  ❌ ${m}`) } }
const nota = m => console.log(`  ·  ${m}`)
const bloque = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`)
const restaurar = []
const PRECIO = 10000
const stamp = Date.now()

async function sesion(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(`magic link ${email}: ${error.message}`)
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data: s, error: e2 } = await c.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' })
  if (e2) throw new Error(`sesión ${email}: ${e2.message}`)
  return { c, id: s.user.id, email }
}

async function pacienteNuevo(n) {
  const email = `qa-lift-${n}-${stamp}@staging.healthier.app`
  const { data: u, error } = await admin.auth.admin.createUser({
    email, email_confirm: true, user_metadata: { role: 'patient', full_name: `QA Lift ${n}` },
  })
  if (error) throw new Error(`alta ${email}: ${error.message}`)
  await admin.from('profiles').update({ es_prueba: true }).eq('id', u.user.id)
  return sesion(email)
}

async function pagar(quien, consultationId, extra = {}) {
  const { data: { session } } = await quien.c.auth.getSession()
  const res = await fetch(`${URL}/functions/v1/mp-payment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      consultationId, cardToken: await tokenDePrueba('APRO'), paymentMethodId: 'master',
      payerEmail: COMPRADOR, payerDocType: 'DNI', payerDocNumber: '12345678', ...extra,
    }),
  })
  const j = await res.json().catch(() => ({}))
  return { data: j.data ?? null, error: j.error ?? (res.ok ? null : `http ${res.status}`) }
}

async function tokenDePrueba(titular) {
  const res = await fetch(`https://api.mercadopago.com/v1/card_tokens?public_key=${MP_PUBLIC_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      card_number: '5031755734530604', expiration_month: 11, expiration_year: 2030, security_code: '123',
      cardholder: { name: titular, identification: { type: 'DNI', number: '12345678' } },
    }),
  })
  const j = await res.json()
  if (!j.id) throw new Error(`card_token: ${JSON.stringify(j)}`)
  return j.id
}

/** Consulta pendiente de pago, insertada con service role (sin la guardia de agenda de la 249). */
async function consulta(paciente, pro, precio = PRECIO) {
  const { data, error } = await admin.from('consultations').insert({
    patient_id: paciente.id, professional_id: pro.id, status: 'pending', payment_status: 'pending_payment',
    modality: 'video', vertical: 'clinica', price_at_booking: precio,
    scheduled_at: new Date(Date.now() + 86400000 + Math.floor(Math.random() * 1e7)).toISOString(),
  }).select('id').single()
  if (error) throw new Error(`consulta: ${error.message}`)
  return data.id
}

const pagoDe = async (consultationId) => (await admin.from('payments')
  .select('status, gross_amount, precio_lista, descuento_socio, charged_amount, platform_fee, net_to_professional, manual_settlement_amount, commission_rate_applied')
  .eq('consultation_id', consultationId).order('created_at', { ascending: false }).limit(1).maybeSingle()).data

try {
  bloque('Preparando')
  const pro = await sesion('profesional@healthier.app')
  const superadmin = await sesion('superadmin@healthier.app')
  const { data: lift } = await admin.from('socios_comerciales').select('id, descuento_primera_consulta, comision_socio').eq('codigo', 'lift').single()
  ok(lift && Number(lift.descuento_primera_consulta) === 0.2 && Number(lift.comision_socio) === 0.05, 'LIFT cargado: 20% primera consulta, 5% para el socio')

  const { data: yaTenia } = await admin.from('mp_accounts').select('id').eq('professional_id', pro.id).maybeSingle()
  if (!yaTenia) {
    const yo = await fetch('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${MP_TEST_TOKEN}` } }).then(r => r.json())
    await admin.from('mp_accounts').insert({
      professional_id: pro.id, mp_user_id: String(yo.id), access_token: MP_TEST_TOKEN,
      active: true, live_mode: false, mp_nickname: 'vendedor-simulado-control', connected_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    })
    restaurar.push(() => admin.from('mp_accounts').delete().eq('professional_id', pro.id).eq('mp_nickname', 'vendedor-simulado-control'))
    nota('vendedor simulado sembrado')
  }
  const { data: com } = await admin.rpc('comision_efectiva', { p_professional_id: pro.id, p_patient_id: null }).single()
  const tasa = Number(com.rate)
  nota(`comisión vigente del profesional: ${tasa * 100}% (${com.origen})`)

  // ── 1 ──
  bloque('1 · Código y atribución')
  const p1 = await pacienteNuevo(1)
  const falso = (await p1.c.rpc('canjear_codigo', { p_codigo: 'lift-falso', p_via: 'codigo' })).data
  ok(falso?.motivo === 'codigo_invalido', `código falso → ${falso?.motivo}`)
  const { error: insAtr } = await p1.c.from('socio_atribuciones').insert({ paciente_id: p1.id, socio_id: lift.id, origen: 'codigo' })
  ok(!!insAtr, 'el paciente no puede escribirse la atribución')
  const bueno = (await p1.c.rpc('canjear_codigo', { p_codigo: 'LIFT', p_via: 'link' })).data
  ok(bueno?.ok && bueno?.tipo === 'socio', `"LIFT" → ${JSON.stringify(bueno)}`)
  const dos = (await p1.c.rpc('canjear_codigo', { p_codigo: 'lift', p_via: 'codigo' })).data
  ok(dos?.motivo === 'ya_tiene_referente', `segundo canje → ${dos?.motivo}`)
  const { error: rpcReserva } = await p1.c.rpc('reservar_descuento_de_socio', { p_paciente: p1.id, p_consulta: p1.id, p_precio_lista: 1 })
  ok(!!rpcReserva, 'el paciente no puede llamar a la reserva del servidor')
  const { error: insDesc } = await p1.c.from('socio_descuentos').insert({ socio_id: lift.id, paciente_id: p1.id, consultation_id: p1.id, precio_lista: 1, porcentaje: 1, monto: 1 })
  ok(!!insDesc, 'el paciente no puede escribirse un descuento')
  const ben = (await p1.c.rpc('mi_beneficio_de_socio')).data?.[0]
  ok(ben?.disponible === true && Number(ben?.porcentaje) === 0.2, `mi_beneficio_de_socio → ${JSON.stringify(ben)}`)

  // ── 2 ──
  bloque('2 · Primera consulta con 20%')
  const c1 = await consulta(p1, pro)
  const r1 = await pagar(p1, c1, { amount: 1, transaction_amount: 1, descuento: 0.99 })
  ok(r1.data?.approved, `cobro aprobado (${r1.data?.status ?? r1.error})`)
  const pay1 = await pagoDe(c1)
  ok(Number(pay1?.charged_amount) === PRECIO * 0.8, `cobrado ${pay1?.charged_amount} = 80% de ${PRECIO} (lo que mandó el cliente no cuenta)`)
  ok(Number(pay1?.precio_lista) === PRECIO && Number(pay1?.descuento_socio) === PRECIO * 0.2 && Number(pay1?.gross_amount) === PRECIO * 0.8,
    `precio_lista ${pay1?.precio_lista} · descuento ${pay1?.descuento_socio} · bruto ${pay1?.gross_amount}`)
  ok(Number(pay1?.net_to_professional) === Math.round(PRECIO * (1 - tasa) * 100) / 100,
    `el profesional cobra lo mismo que sin descuento: ${pay1?.net_to_professional}`)
  const feeEsperado = Math.max(0, Math.round((PRECIO * tasa - PRECIO * 0.2) * 100) / 100)
  ok(Number(pay1?.platform_fee) === feeEsperado, `comisión de Healthier ${pay1?.platform_fee} (esperado ${feeEsperado})`)
  const { data: d1 } = await admin.from('socio_descuentos').select('estado').eq('consultation_id', c1).single()
  ok(d1?.estado === 'aplicado', `descuento ${d1?.estado}`)
  const ben2 = (await p1.c.rpc('mi_beneficio_de_socio')).data?.[0]
  ok(ben2?.disponible === false, 'después del cobro ya no figura disponible')

  // ── 3 ──
  bloque('3 · Segunda consulta sin descuento')
  const c2 = await consulta(p1, pro)
  const r2 = await pagar(p1, c2)
  const pay2 = await pagoDe(c2)
  ok(r2.data?.approved && Number(pay2?.charged_amount) === PRECIO && Number(pay2?.descuento_socio) === 0,
    `segunda: cobrado ${pay2?.charged_amount}, descuento ${pay2?.descuento_socio}`)

  // ── 4 ──
  bloque('4 · Dos cobros en paralelo')
  const p2 = await pacienteNuevo(2)
  await p2.c.rpc('canjear_codigo', { p_codigo: 'lift', p_via: 'codigo' })
  const [ca, cb] = [await consulta(p2, pro), await consulta(p2, pro)]
  await Promise.all([pagar(p2, ca), pagar(p2, cb)])
  const [pa, pb] = [await pagoDe(ca), await pagoDe(cb)]
  const conDescuento = [pa, pb].filter(p => Number(p?.descuento_socio) > 0).length
  ok(conDescuento === 1, `con descuento: ${conDescuento} de 2 (${pa?.charged_amount} / ${pb?.charged_amount})`)

  // ── 5 ──
  bloque('5 · Cancelar libera el descuento')
  const p3 = await pacienteNuevo(3)
  await p3.c.rpc('canjear_codigo', { p_codigo: 'lift', p_via: 'codigo' })
  const c3a = await consulta(p3, pro)
  const { data: res3 } = await admin.rpc('reservar_descuento_de_socio', { p_paciente: p3.id, p_consulta: c3a, p_precio_lista: PRECIO })
  ok(res3?.length === 1, 'reservado para la consulta A')
  const c3b = await consulta(p3, pro)
  const { data: res3b } = await admin.rpc('reservar_descuento_de_socio', { p_paciente: p3.id, p_consulta: c3b, p_precio_lista: PRECIO })
  ok(!res3b?.length, 'con A reservada, B no tiene descuento')
  await admin.from('consultations').update({ status: 'cancelled' }).eq('id', c3a)
  const ben3 = (await p3.c.rpc('mi_beneficio_de_socio', { p_consulta: c3b })).data?.[0]
  ok(ben3?.disponible === true, 'A cancelada → vuelve a estar disponible')

  // ── 6 ──
  bloque('6 · Comisión del profesional menor al descuento')
  const { data: cambio } = await admin.from('professional_commission_changes')
    .insert({ professional_id: pro.id, rate: 0.10, reason: 'control verificar-beneficio-socio (se borra al terminar)' })
    .select('id').single()
  restaurar.push(() => admin.from('professional_commission_changes').delete().eq('id', cambio.id))
  const r6 = await pagar(p3, c3b)
  const pay6 = await pagoDe(c3b)
  ok(r6.data?.approved, `cobro aprobado (${r6.data?.status ?? r6.error})`)
  ok(Number(pay6?.platform_fee) === 0 && Number(pay6?.charged_amount) === PRECIO * 0.8,
    `split sin comisión negativa: fee ${pay6?.platform_fee}, cobrado ${pay6?.charged_amount}`)
  ok(Number(pay6?.manual_settlement_amount) === PRECIO * 0.1 && Number(pay6?.net_to_professional) === PRECIO * 0.9,
    `Healthier le debe ${pay6?.manual_settlement_amount} al profesional (neto ${pay6?.net_to_professional})`)
  await admin.from('professional_commission_changes').delete().eq('id', cambio.id)

  // ── 7 ──
  bloque('7 · Liquidación del socio')
  await admin.from('consultations').update({ status: 'completed', completed_at: new Date().toISOString() }).in('id', [c1, c2])
  const mes = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 7) + '-01'
  const { data: liq, error: eLiq } = await superadmin.c.rpc('liquidacion_de_socio', { p_socio: lift.id, p_mes: mes, p_incluir_prueba: true })
  const filas = (liq ?? []).filter(f => [c1, c2].includes(f.consultation_id))
  const f1 = filas.find(f => f.consultation_id === c1)
  const f2 = filas.find(f => f.consultation_id === c2)
  ok(!eLiq && filas.length === 2, `super admin ve las 2 consultas terminadas (${eLiq?.message ?? filas.length})`)
  ok(Number(f1?.monto_socio) === PRECIO * 0.8 * 0.05 && Number(f2?.monto_socio) === PRECIO * 0.05,
    `5% de lo cobrado: ${f1?.monto_socio} y ${f2?.monto_socio}`)
  const { error: liqPac } = await p1.c.rpc('liquidacion_de_socio', { p_socio: lift.id, p_mes: mes, p_incluir_prueba: true })
  ok(!!liqPac, 'el paciente no puede ver la liquidación')
  const { data: sinPrueba } = await superadmin.c.rpc('liquidacion_de_socio', { p_socio: lift.id, p_mes: mes, p_incluir_prueba: false })
  ok(!(sinPrueba ?? []).some(f => f.consultation_id === c1), 'sin "incluir prueba" no aparecen cuentas de prueba')
} catch (err) {
  fallos++
  console.error(`\n❌ ${err.message}`)
} finally {
  for (const fn of restaurar.reverse()) await fn()
}

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ Todo en orden')
process.exit(fallos ? 1 : 0)
