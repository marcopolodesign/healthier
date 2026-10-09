#!/usr/bin/env node
/**
 * Control de la Teleclínica por despacho (migración 191) — SÓLO STAGING.
 *
 *   node scripts/verificar-despacho-ondemand.mjs
 *
 * Tres cosas que tienen que seguir siendo ciertas, y que si se rompen no se ven
 * en pantalla hasta que le pasan a un paciente:
 *
 *   1. Toma atómica: dos profesionales aceptan el MISMO pedido a la vez → uno
 *      solo se lo queda, hay UNA consulta, y el otro deja de verlo.
 *   2. Nadie acepta → no se cobra nada: el pedido vence, el token de la tarjeta
 *      se borra y no aparece ninguna fila en `payments`. Igual al cancelar.
 *   3. Rechazo después de aceptar: la consulta queda tomada por el profesional,
 *      el pedido dice `rechazado`, y el paciente puede pagar con otra tarjeta
 *      sobre esa misma consulta (y el pedido pasa a `autorizado`).
 *
 * Además: la RLS no deja que un paciente inserte pedidos a mano ni que nadie
 * lea los tokens guardados.
 *
 * Mercado Pago: staging todavía no tiene ninguna cuenta de vendedor vinculada
 * por OAuth (falta la app de prueba, ver "Te necesitan" 7be0a0d7). Para el punto
 * 3 se siembra, SÓLO durante la corrida, una fila de `mp_accounts` para el
 * profesional con el access token TEST de la plataforma, y se borra al final.
 * Las tarjetas son las de prueba publicadas por MP: titular "APRO" aprueba,
 * "OTHE" rechaza.
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
// Con el token TEST de una cuenta real, MP rechaza a sus propios usuarios de
// prueba como pagadores ("Invalid users involved"/"Payer email forbidden"); un
// mail cualquiera sí pasa.
const COMPRADOR = 'comprador.prueba@example.com'
if (!URL || !SERVICE) { console.error('Faltan HEALTHIER_STAGING_* en ~/Local/.env'); process.exit(1) }
if (URL.includes('aixjejdoofervrkggbkd')) { console.error('Esto es producción. Sólo staging.'); process.exit(1) }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })

let fallos = 0
const ok = m => console.log(`  ✅ ${m}`)
const mal = m => { fallos++; console.log(`  ❌ ${m}`) }
const nota = m => console.log(`  ·  ${m}`)
const bloque = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`)
const esperar = ms => new Promise(r => setTimeout(r, ms))

/** Sesión real sin contraseña: magic link generado con la service key. */
async function sesion(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(`magic link ${email}: ${error.message}`)
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data: s, error: e2 } = await c.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' })
  if (e2) throw new Error(`sesión ${email}: ${e2.message}`)
  return { c, id: s.user.id, email }
}

async function llamar(quien, body, funcion = 'ondemand-despacho') {
  const { data: { session } } = await quien.c.auth.getSession()
  const res = await fetch(`${URL}/functions/v1/${funcion}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await res.json().catch(() => ({}))
  return { data: j.data ?? null, error: j.error ?? (res.ok ? null : `http ${res.status}`) }
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

const VERTICAL = 'clinica'
const inicio = new Date().toISOString()
const creados = { pedidos: [], consultas: [] }
const restaurar = []

const paciente = await sesion('paciente.completo@staging.healthier.app')
const proA = await sesion('clinica@staging.healthier.app')
const proB = await sesion('profesional@healthier.app')

// ── Preparar: los dos profesionales elegibles para Clínica ahora ────────────
bloque('Preparando')
for (const pro of [proA, proB]) {
  const { data: antes } = await admin.from('professional_profiles')
    .select('is_on_demand, on_demand_last_seen_at, mp_connected, is_verified, is_active, specialty').eq('user_id', pro.id).single()
  restaurar.push(() => admin.from('professional_profiles').update(antes).eq('user_id', pro.id))
  await admin.from('professional_profiles').update({
    is_on_demand: true, on_demand_last_seen_at: new Date().toISOString(), mp_connected: true, is_verified: true, is_active: true,
  }).eq('user_id', pro.id)
  nota(`${pro.email} elegible (${antes.specialty})`)
}
// Vendedor simulado: la cuenta TEST de la plataforma, sólo mientras corre.
// Desde la 193, sin fila en `mp_accounts` no se es elegible aunque el flag
// `mp_connected` diga que sí.
async function vendedorSimulado(pro) {
  const { data: yaTenia } = await admin.from('mp_accounts').select('id').eq('professional_id', pro.id).maybeSingle()
  if (yaTenia || !MP_TEST_TOKEN) return
  const yo = await fetch('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${MP_TEST_TOKEN}` } }).then(r => r.json())
  await admin.from('mp_accounts').insert({
    professional_id: pro.id, mp_user_id: String(yo.id), access_token: MP_TEST_TOKEN,
    active: true, live_mode: false, mp_nickname: 'vendedor-simulado-control', connected_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  })
  restaurar.push(() => admin.from('mp_accounts').delete().eq('professional_id', pro.id).eq('mp_nickname', 'vendedor-simulado-control'))
  nota(`vendedor simulado para ${pro.email} (cuenta TEST ${yo.id})`)
}
for (const pro of [proA, proB]) await vendedorSimulado(pro)
const { data: exentoAntes } = await admin.from('profiles').select('payment_exempt').eq('id', paciente.id).single()
restaurar.push(() => admin.from('profiles').update({ payment_exempt: exentoAntes.payment_exempt }).eq('id', paciente.id))

// Un pedido vivo que haya quedado de una corrida anterior bloquea `pedir`.
await admin.from('ondemand_requests').update({ status: 'cancelled' }).eq('patient_id', paciente.id).eq('status', 'pending')

try {
  // ── Elegibilidad: el flag solo no alcanza (193) ──────────────────────────
  bloque('Elegibilidad')
  {
    const elegible = async (pro) => (await admin.rpc('puede_tomar_ondemand', { p_user: pro.id, p_especialidades: ['medicina_general'] })).data
    ;(await elegible(proB)) === true ? ok('con cuenta de MP activa, es elegible') : mal('con cuenta de MP no es elegible')
    await admin.from('mp_accounts').update({ active: false }).eq('professional_id', proB.id)
    ;(await elegible(proB)) === false
      ? ok('con mp_connected=true pero sin cuenta activa, NO es elegible') : mal('sin cuenta activa sigue siendo elegible')
    await admin.from('mp_accounts').update({ active: true }).eq('professional_id', proB.id)
  }

  // ── 0. RLS ────────────────────────────────────────────────────────────────
  bloque('RLS')
  {
    const { error } = await paciente.c.from('ondemand_requests').insert({
      patient_id: paciente.id, vertical: VERTICAL, specialty: 'medicina_general',
      especialidades: ['medicina_general'], expires_at: new Date(Date.now() + 60000).toISOString(),
    })
    error ? ok('el paciente NO puede insertar un pedido a mano (sólo por la función)') : mal('el paciente insertó un pedido salteando el pago')
    const { data: tokens } = await proA.c.from('ondemand_request_cobros').select('*')
    !tokens?.length ? ok('un profesional no ve ningún token de tarjeta') : mal(`un profesional ve ${tokens.length} tokens`)
  }

  // ── Preconsulta armada a mano: se guarda saneada ───────────────────────
  // La tarjeta del pedido la pintan TODOS los profesionales elegibles: una
  // forma rara no puede llegar a sus pantallas (revisión del 2026-10-09).
  bloque('Preconsulta saneada')
  {
    await admin.from('profiles').update({ payment_exempt: true }).eq('id', paciente.id)
    const basura = { main_complaint: 'Dolor (R10.4)', symptom: { label: { x: 1 } }, answers: [null, 'a', { labels: [{}, 'Hoy'], red_flag: 'si' }], extra: 'x'.repeat(5000) }
    const { data } = await llamar(paciente, { action: 'pedir', vertical: VERTICAL, preconsulta: basura })
    if (!data?.requestId) mal(`no se pudo pedir: ${JSON.stringify(data)}`)
    else {
      creados.pedidos.push(data.requestId)
      const { data: fila } = await admin.from('ondemand_requests').select('preconsulta_data').eq('id', data.requestId).single()
      const pc = fila.preconsulta_data
      pc && pc.symptom.label === null && pc.answers.length === 1 && pc.answers[0].labels.join() === 'Hoy' && pc.answers[0].red_flag === false && !('extra' in pc)
        ? ok('una preconsulta con forma rara se guarda saneada') : mal(`se guardó ${JSON.stringify(pc)}`)
      await llamar(paciente, { action: 'cancelar', requestId: data.requestId })
    }
  }

  // ── 1. Toma atómica ──────────────────────────────────────────────────────
  bloque('1. Dos aceptan a la vez → uno gana')
  await admin.from('profiles').update({ payment_exempt: true }).eq('id', paciente.id)
  {
    // La preconsulta va antes del pago (2026-10-09): viaja en el pedido.
    const PRECONSULTA = {
      version: 2,
      symptom: { id: 'fiebre', label: 'Fiebre', icd10_code: 'R50.9', icd10_display: 'Fiebre, no especificada', free_text: null },
      answers: [{ question_id: 'duracion', question_label: '¿Desde cuándo?', values: ['2-3d'], labels: ['Hace 2 o 3 días'], red_flag: false }],
      medication: { taking: false, detail: null },
      has_red_flags: false,
      main_complaint: 'Fiebre (R50.9)',
      symptoms: '¿Desde cuándo? Hace 2 o 3 días',
      current_medications: 'No toma medicación',
    }
    const { data, error } = await llamar(paciente, { action: 'pedir', vertical: VERTICAL, preconsulta: PRECONSULTA })
    if (error || !data?.requestId) { mal(`no se pudo pedir: ${error ?? JSON.stringify(data)}`) }
    else {
      creados.pedidos.push(data.requestId)
      const { data: fila } = await admin.from('ondemand_requests').select('avisados, estado_pago').eq('id', data.requestId).single()
      nota(`pedido ${data.requestId.slice(0, 8)} · avisados=${fila.avisados} · pago=${fila.estado_pago}`)
      fila.avisados >= 2 ? ok(`el aviso salió a ${fila.avisados} profesionales`) : mal(`el aviso salió sólo a ${fila.avisados}`)

      const [vA, vB] = await Promise.all([proA, proB].map(p => p.c.from('ondemand_requests').select('id, preconsulta_data').eq('id', data.requestId)))
      vA.data?.length && vB.data?.length ? ok('los dos profesionales ven el pedido') : mal('alguno de los dos no ve el pedido')
      vA.data?.[0]?.preconsulta_data?.main_complaint === PRECONSULTA.main_complaint
        ? ok('el profesional ve la preconsulta en el pedido, antes de aceptar') : mal('el pedido no trae la preconsulta')

      const [rA, rB] = await Promise.all([proA, proB].map(p => llamar(p, { action: 'aceptar', requestId: data.requestId })))
      const ganadores = [rA, rB].filter(r => r.data?.tomada)
      const perdedores = [rA, rB].filter(r => r.data && r.data.tomada === false)
      ganadores.length === 1 && perdedores.length === 1
        ? ok('exactamente uno lo tomó y el otro recibió "ya lo tomó otro"')
        : mal(`resultado inesperado: A=${JSON.stringify(rA)} B=${JSON.stringify(rB)}`)

      const { data: consultas } = await admin.from('consultations').select('id, professional_id, status, payment_status, preconsulta_data')
        .eq('patient_id', paciente.id).eq('is_on_demand', true).gte('created_at', inicio)
      consultas?.length === 1 ? ok('se creó UNA sola consulta') : mal(`se crearon ${consultas?.length} consultas`)
      consultas?.forEach(c => creados.consultas.push(c.id))
      if (consultas?.[0]) {
        consultas[0].payment_status === 'exempt' && consultas[0].status === 'confirmed'
          ? ok('bonificada: nace confirmada y exenta') : mal(`estado ${consultas[0].status}/${consultas[0].payment_status}`)
        consultas[0].preconsulta_data?.main_complaint === PRECONSULTA.main_complaint
          ? ok('la preconsulta pasó a la consulta: la sala no la vuelve a pedir') : mal('la consulta no tiene la preconsulta del pedido')
      }
      const perdedor = rA.data?.tomada ? proB : proA
      const { data: yaNo } = await perdedor.c.from('ondemand_requests').select('id').eq('id', data.requestId)
      !yaNo?.length ? ok('el que perdió deja de ver el pedido') : mal('el que perdió lo sigue viendo')
    }
  }
  await admin.from('profiles').update({ payment_exempt: false }).eq('id', paciente.id)

  // ── 2. Nadie acepta → no se cobra ────────────────────────────────────────
  bloque('2. Nadie acepta → no se cobra nada')
  for (const modo of ['vence', 'cancela']) {
    const token = await tokenDePrueba('APRO')
    const { data, error } = await llamar(paciente, {
      action: 'pedir', vertical: VERTICAL,
      pago: { cardToken: token, paymentMethodId: 'master', payerEmail: COMPRADOR },
    })
    if (error || !data?.requestId) { mal(`no se pudo pedir (${modo}): ${error}`); continue }
    creados.pedidos.push(data.requestId)
    const { count: conToken } = await admin.from('ondemand_request_cobros').select('request_id', { count: 'exact', head: true }).eq('request_id', data.requestId)
    conToken === 1 ? ok(`(${modo}) el token quedó guardado del lado del servidor`) : mal(`(${modo}) no se guardó el token`)
    const { data: guardado } = await admin.from('ondemand_request_cobros').select('card_token').eq('request_id', data.requestId).maybeSingle()
    guardado?.card_token?.startsWith('enc:v1:') ? ok(`(${modo}) el token está cifrado`) : mal(`(${modo}) el token NO está cifrado`)

    if (modo === 'vence') {
      await admin.from('ondemand_requests').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', data.requestId)
      await admin.rpc('expire_ondemand_requests')
    } else {
      const r = await llamar(paciente, { action: 'cancelar', requestId: data.requestId })
      r.data?.cancelado ? ok('(cancela) la función confirmó la cancelación') : mal(`(cancela) ${JSON.stringify(r)}`)
    }
    const { data: fila } = await admin.from('ondemand_requests').select('status, consultation_id').eq('id', data.requestId).single()
    fila.status === (modo === 'vence' ? 'expired' : 'cancelled') && !fila.consultation_id
      ? ok(`(${modo}) el pedido quedó ${fila.status}, sin consulta`) : mal(`(${modo}) quedó ${JSON.stringify(fila)}`)
    const contarToken = async () => (await admin.from('ondemand_request_cobros').select('request_id', { count: 'exact', head: true }).eq('request_id', data.requestId)).count
    if (modo === 'vence') {
      // 193: el token de un vencido se guarda para "Seguir buscando".
      ;(await contarToken()) === 1 ? ok('(vence) el token se guarda para seguir buscando') : mal('(vence) el token se borró al vencer')
      const sigue = await llamar(paciente, { action: 'extender', requestId: data.requestId })
      sigue.data?.sinToken === false
        ? ok('(vence) "Seguir buscando" no pide la tarjeta de nuevo') : mal(`(vence) seguir buscando: ${JSON.stringify(sigue)}`)
      // Pasado el techo de 20 minutos, el cron lo borra.
      await admin.from('ondemand_requests').update({
        created_at: new Date(Date.now() - 21 * 60000).toISOString(), expires_at: new Date(Date.now() - 1000).toISOString(),
      }).eq('id', data.requestId)
      await admin.rpc('expire_ondemand_requests')
    }
    const tokenDespues = await contarToken()
    tokenDespues === 0 ? ok(`(${modo}) el token se borró`) : mal(`(${modo}) el token sigue guardado`)
    // Y nadie lo puede aceptar ya.
    const tarde = await llamar(proA, { action: 'aceptar', requestId: data.requestId })
    tarde.data?.tomada === false ? ok(`(${modo}) aceptar tarde no toma nada`) : mal(`(${modo}) aceptar tarde: ${JSON.stringify(tarde)}`)
  }
  const { count: pagos } = await admin.from('payments').select('id', { count: 'exact', head: true }).eq('patient_id', paciente.id).gte('created_at', inicio)
  pagos === 0 ? ok('ninguna fila en payments: no se reservó ni cobró nada') : mal(`aparecieron ${pagos} pagos`)

  // ── 3. Rechazo después de aceptar ────────────────────────────────────────
  bloque('3. La tarjeta se rechaza después de que el médico aceptó')
  if (!MP_TEST_TOKEN || !MP_PUBLIC_KEY) {
    mal('faltan MP_ACCESS_TOKEN_SANDBOX / VITE_MP_PUBLIC_KEY_SANDBOX (website/.env)')
  } else {
    // Sólo A elegible, para que lo tome él.
    await admin.from('professional_profiles').update({ is_on_demand: false }).eq('user_id', proB.id)

    const tokenMalo = await tokenDePrueba('OTHE')
    const { data, error } = await llamar(paciente, {
      action: 'pedir', vertical: VERTICAL,
      pago: { cardToken: tokenMalo, paymentMethodId: 'master', payerEmail: COMPRADOR },
    })
    if (error || !data?.requestId) { mal(`no se pudo pedir: ${error}`) }
    else {
      creados.pedidos.push(data.requestId)
      const r = await llamar(proA, { action: 'aceptar', requestId: data.requestId })
      nota(`aceptar → ${JSON.stringify(r.data ?? r.error)}`)
      r.data?.tomada ? ok('el médico tomó la consulta') : mal('el médico no pudo tomarla')
      r.data?.pago === 'rechazado' ? ok(`el pago se rechazó (${r.data.detalle})`) : mal(`se esperaba rechazo, vino ${r.data?.pago}`)
      if (r.data?.consultationId) {
        creados.consultas.push(r.data.consultationId)
        const { data: c } = await admin.from('consultations').select('professional_id, status, payment_status').eq('id', r.data.consultationId).single()
        c.professional_id === proA.id ? ok('la consulta sigue asignada al médico que aceptó') : mal('la consulta perdió al médico')
        c.status !== 'confirmed' ? ok(`la consulta NO quedó confirmada (${c.status}/${c.payment_status})`) : mal('la consulta quedó confirmada sin pago')
        const { data: p } = await admin.from('ondemand_requests').select('estado_pago').eq('id', data.requestId).single()
        p.estado_pago === 'rechazado' ? ok('el pedido dice "rechazado" (lo ve el super admin)') : mal(`el pedido dice ${p.estado_pago}`)

        // El paciente paga con otra tarjeta sobre la MISMA consulta.
        const tokenBueno = await tokenDePrueba('APRO')
        const re = await llamar(paciente, { consultationId: r.data.consultationId, cardToken: tokenBueno, paymentMethodId: 'master', payerEmail: COMPRADOR, authorizeOnly: true, useCredits: false }, 'mp-payment')
        nota(`reintento → ${JSON.stringify(re)}`)
        re?.data?.status === 'authorized' ? ok('con otra tarjeta queda autorizado') : mal(`el reintento no autorizó: ${re?.data?.statusDetail ?? re?.error}`)
        await esperar(500)
        const { data: p2 } = await admin.from('ondemand_requests').select('estado_pago').eq('id', data.requestId).single()
        p2.estado_pago === 'autorizado' ? ok('el pedido pasó a "autorizado"') : mal(`el pedido quedó ${p2.estado_pago}`)
        // Soltar la reserva de prueba.
        await llamar(paciente, { action: 'cancel-auth', consultationId: r.data.consultationId }, 'mp-capture')
      }
    }

    // ── 4. El caso feliz: la tarjeta pasa al aceptar ──────────────────────
    bloque('4. Acepta y la tarjeta pasa → consulta confirmada')
    const tokenBueno = await tokenDePrueba('APRO')
    const p4 = await llamar(paciente, {
      action: 'pedir', vertical: VERTICAL,
      pago: { cardToken: tokenBueno, paymentMethodId: 'master', payerEmail: COMPRADOR },
    })
    if (!p4.data?.requestId) { mal(`no se pudo pedir: ${p4.error}`) }
    else {
      creados.pedidos.push(p4.data.requestId)
      const r = await llamar(proA, { action: 'aceptar', requestId: p4.data.requestId })
      r.data?.pago === 'autorizado' ? ok('reservado contra la cuenta del médico que aceptó') : mal(`vino ${JSON.stringify(r)}`)
      if (r.data?.consultationId) {
        creados.consultas.push(r.data.consultationId)
        const { data: c } = await admin.from('consultations').select('status, payment_status').eq('id', r.data.consultationId).single()
        c.status === 'confirmed' && c.payment_status === 'in_process'
          ? ok('consulta confirmada con la reserva hecha') : mal(`consulta ${c.status}/${c.payment_status}`)
        const { data: pg } = await admin.from('payments').select('status, professional_id').eq('consultation_id', r.data.consultationId).single()
        pg?.status === 'authorized' && pg.professional_id === proA.id
          ? ok('el pago es una pre-autorización a nombre del médico') : mal(`pago ${JSON.stringify(pg)}`)
        await llamar(paciente, { action: 'cancel-auth', consultationId: r.data.consultationId }, 'mp-capture')
        const { data: pg2 } = await admin.from('payments').select('status').eq('consultation_id', r.data.consultationId).single()
        nota(`al cancelar, la reserva queda ${pg2?.status}`)
      }
    }
  }
} finally {
  bloque('Limpieza')
  for (const fn of restaurar.reverse()) await fn()
  if (creados.consultas.length) {
    await admin.from('consultations').update({ status: 'cancelled', cancel_reason: 'control verificar-despacho-ondemand' }).in('id', creados.consultas)
  }
  await admin.from('ondemand_requests').update({ status: 'cancelled' }).in('id', creados.pedidos).eq('status', 'pending')
  nota(`${creados.pedidos.length} pedidos y ${creados.consultas.length} consultas de prueba cerrados`)
}

console.log(fallos ? `\n❌ ${fallos} fallos` : '\n✅ Todo en verde')
process.exit(fallos ? 1 : 0)
