#!/usr/bin/env node
/**
 * La orden de traslado, el cierre con desenlace, el historial del despacho y
 * la consulta de la emergencia anclada al módulo (migración 213) — contra la
 * base de STAGING, con las sesiones reales de cada rol.
 *
 *   node scripts/verificar-orden-traslado.mjs
 *
 * Falla (exit 1) si vuelve cualquiera de estas cosas:
 *   · se puede cerrar un traslado sin la foto de la orden;
 *   · la hora o el autor de la orden los pone el teléfono, o la orden se puede
 *     editar o borrar;
 *   · un paciente u otro profesional ven (o suben) la foto;
 *   · el despacho de la entidad NO la ve, o no ve el traslado en su historial
 *     con la hora de cierre;
 *   · alguien que no es el módulo de emergencias crea o "ancla" una consulta
 *     a una emergencia.
 *
 * Crea una emergencia de prueba y la borra al final (pase lo que pase).
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)
const URL = env.HEALTHIER_STAGING_SUPABASE_URL
const ANON = env.HEALTHIER_STAGING_SUPABASE_ANON_KEY
const admin = createClient(URL, env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const ENTIDAD = '20000000-0000-0000-0000-000000000001'
const MOVIL_2 = '40000000-0000-0000-0000-000000000002'
const BUCKET = 'ordenes-traslado'

let fallos = 0
const ok = m => console.log(`  ✅ ${m}`)
const mal = m => { fallos++; console.log(`  ❌ ${m}`) }
const nota = m => console.log(`  ·  ${m}`)
const bloque = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`)
const debe = (cond, si, no) => (cond ? ok(si) : mal(no))

async function comoUsuario(email, password = 'staging') {
  const c = createClient(URL, ANON, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login ${email}: ${error.message}`)
  return { c, id: data.user.id }
}

// Un JPEG mínimo válido (1×1).
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
)

const medico = await comoUsuario('clinica@staging.healthier.app')
const paciente = await comoUsuario('sos.paciente@healthier.app', 'emergencia')
const operador = await comoUsuario('operador@staging.healthier.app')
const otroPro = await comoUsuario('pediatria@staging.healthier.app')
const otroPaciente = await comoUsuario('paciente.completo@staging.healthier.app')

bloque('Preparando un traslado de prueba (Móvil 2, médico clinica@)')
const { data: em, error: errEm } = await admin.from('emergencies').insert({
  patient_id: paciente.id, triage_code: 'ROJO', status: 'arrived',
  paid_at: new Date().toISOString(), price_at_request: 50,
  patient_latitude: -34.6037, patient_longitude: -58.3816,
  provider_id: ENTIDAD, ambulance_id: MOVIL_2, professional_id: medico.id,
  operator_id: operador.id, dispatched_at: new Date().toISOString(), dispatch_code: 'UTM-0213',
}).select().single()
if (errEm) { console.error(errEm); process.exit(1) }
nota(`emergencia ${em.id.slice(0, 8)} — arrived`)
const subidas = []
let consultaId = null

try {
  bloque('Nombre del paciente sólo con entidad')
  {
    const { data: suelto, error } = await paciente.c.from('emergencies')
      .insert({ patient_id: paciente.id, status: 'pending', triage_code: 'VERDE', price_at_request: 50, patient_latitude: -34.6, patient_longitude: -58.38 })
      .select('id').single()
    if (error) mal(`el paciente no pudo crear un pedido de prueba: ${error.message}`)
    else {
      const { data: f } = await admin.from('emergencies').select('paciente_nombre').eq('id', suelto.id).single()
      debe(f.paciente_nombre === null, 'un pedido sin entidad no lleva el nombre (lo ven todos los despachos)', 'un pedido sin entidad lleva el nombre del paciente')
      await admin.from('emergencies').delete().eq('id', suelto.id)
    }
  }

  bloque('Desenlace')
  {
    const { error } = await paciente.c.from('emergencies').update({ desenlace: 'traslado' }).eq('id', em.id)
    const { data: fila } = await admin.from('emergencies').select('desenlace').eq('id', em.id).single()
    debe(fila.desenlace === null, 'el paciente no declara cómo terminó', `el paciente pudo declarar el desenlace (${error?.message ?? 'sin error'})`)
  }
  {
    const { error } = await medico.c.from('emergencies').update({ desenlace: 'traslado' }).eq('id', em.id)
    debe(!error, 'el médico declara "traslado"', `el médico no pudo declarar el desenlace: ${error?.message}`)
  }

  bloque('Sin orden, el traslado no se cierra')
  {
    const { error } = await medico.c.from('emergencies')
      .update({ status: 'completed', cierre_sin_atencion: 'Traslado a guardia' }).eq('id', em.id)
    debe(error && /orden de traslado/i.test(error.message),
      `rechazado: "${error?.message}"`, 'SE CERRÓ UN TRASLADO SIN ORDEN')
  }

  bloque('Subir la foto')
  const ruta = `${em.id}/${Date.now()}.jpg`
  {
    const { error } = await paciente.c.storage.from(BUCKET).upload(`${em.id}/paciente.jpg`, JPEG, { contentType: 'image/jpeg' })
    debe(error, 'el paciente no sube fotos al bucket', 'el paciente SUBIÓ una foto de orden')
    if (!error) subidas.push(`${em.id}/paciente.jpg`)
  }
  {
    const { error } = await otroPro.c.storage.from(BUCKET).upload(`${em.id}/otro.jpg`, JPEG, { contentType: 'image/jpeg' })
    debe(error, 'otro profesional no sube fotos', 'otro profesional SUBIÓ una foto de orden')
    if (!error) subidas.push(`${em.id}/otro.jpg`)
  }
  {
    const { error } = await medico.c.storage.from(BUCKET).upload(`no-es-un-uuid/x.jpg`, JPEG, { contentType: 'image/jpeg' })
    debe(error, 'una carpeta que no es una emergencia no habilita nada', 'se subió a una carpeta inválida')
    if (!error) subidas.push('no-es-un-uuid/x.jpg')
  }
  {
    const { error } = await medico.c.storage.from(BUCKET).upload(ruta, JPEG, { contentType: 'image/jpeg' })
    debe(!error, 'el médico sube la foto', `el médico no pudo subir: ${error?.message}`)
    if (!error) subidas.push(ruta)
  }

  bloque('Registrar la orden')
  {
    const { error } = await medico.c.from('emergency_transfer_orders')
      .insert({ emergency_id: em.id, institucion: 'Hospital X', foto_path: `${em.id}/no-existe.jpg` })
    debe(error, 'sin foto subida no se registra', 'se registró una orden sin foto')
  }
  {
    const { error } = await medico.c.from('emergency_transfer_orders')
      .insert({ emergency_id: em.id, institucion: 'Hospital X', foto_path: `${crypto.randomUUID()}/x.jpg` })
    debe(error, 'una foto de otra carpeta no vale', 'se registró una orden con la foto de otra emergencia')
  }
  {
    const { error } = await paciente.c.from('emergency_transfer_orders')
      .insert({ emergency_id: em.id, institucion: 'Hospital X', foto_path: ruta })
    debe(error, 'el paciente no registra órdenes', 'el paciente REGISTRÓ una orden')
  }
  const haceUnAnio = '2025-01-01T00:00:00Z'
  const { data: orden, error: errOrden } = await medico.c.from('emergency_transfer_orders')
    .insert({ emergency_id: em.id, institucion: '  Hospital Fernández ', foto_path: ruta, subida_at: haceUnAnio, subida_por: operador.id })
    .select().single()
  if (errOrden) mal(`el médico no pudo registrar la orden: ${errOrden.message}`)
  else {
    ok('el médico registra la orden')
    debe(Math.abs(Date.now() - new Date(orden.subida_at).getTime()) < 120_000,
      `la hora es la de la base (${orden.subida_at}), no la que mandó el teléfono`, `la hora quedó ${orden.subida_at}`)
    debe(orden.subida_por === medico.id, 'el autor es la sesión, no el que mandó el teléfono', 'el autor quedó falsificado')
    debe(orden.institucion === 'Hospital Fernández', 'la institución queda sin espacios', `institución: "${orden.institucion}"`)

    const { data: upd } = await medico.c.from('emergency_transfer_orders').update({ institucion: 'Otra' }).eq('id', orden.id).select()
    const { data: del } = await medico.c.from('emergency_transfer_orders').delete().eq('id', orden.id).select()
    const { data: sigue } = await admin.from('emergency_transfer_orders').select('institucion').eq('id', orden.id).single()
    debe(!upd?.length && !del?.length && sigue?.institucion === 'Hospital Fernández',
      'la orden no se edita ni se borra', 'la orden se pudo editar o borrar')
    const { error: errPisar } = await medico.c.storage.from(BUCKET).upload(ruta, JPEG, { contentType: 'image/jpeg', upsert: true })
    debe(errPisar, 'la foto no se pisa', 'la foto de la orden se pudo reemplazar')
  }

  bloque('Negativa firmada (opcional) — no reemplaza a la orden')
  {
    const rutaNeg = `${em.id}/negativa-${Date.now()}.jpg`
    const { error: errSub } = await medico.c.storage.from(BUCKET).upload(rutaNeg, JPEG, { contentType: 'image/jpeg' })
    if (!errSub) subidas.push(rutaNeg)
    const { error: errNeg } = await medico.c.from('emergency_transfer_orders').insert({ emergency_id: em.id, tipo: 'negativa', foto_path: rutaNeg })
    debe(!errSub && !errNeg, 'el médico sube una negativa sin institución', `no pudo subir la negativa: ${errSub?.message || errNeg?.message}`)
    // Con una foto propia (no la de la negativa: si no, frena el UNIQUE y no la regla).
    const rutaSin = `${em.id}/sin-inst-${Date.now()}.jpg`
    const { error: errSubSin } = await medico.c.storage.from(BUCKET).upload(rutaSin, JPEG, { contentType: 'image/jpeg' })
    if (!errSubSin) subidas.push(rutaSin)
    for (const institucion of [undefined, '   ']) {
      const { error: errSinInst } = await medico.c.from('emergency_transfer_orders').insert({ emergency_id: em.id, tipo: 'orden_traslado', institucion, foto_path: rutaSin })
      debe(errSinInst && !/duplicate|unique/i.test(errSinInst.message), `una orden de traslado sin institución (${institucion === undefined ? 'nula' : 'en blanco'}) no se registra`, `se registró una orden sin institución (${errSinInst?.message ?? 'sin error'})`)
    }
  }

  bloque('Quién ve la orden')
  for (const [quien, s, debeVer] of [['el médico', medico, true], ['el despacho de la entidad', operador, true], ['el paciente (en su HC)', paciente, true], ['otro paciente', otroPaciente, false], ['otro profesional', otroPro, false]]) {
    const { data } = await s.c.from('emergency_transfer_orders').select('id').eq('emergency_id', em.id)
    const { data: url } = await s.c.storage.from(BUCKET).createSignedUrl(ruta, 60)
    const ve = (data?.length ?? 0) > 0 && !!url?.signedUrl
    const nada = (data?.length ?? 0) === 0 && !url?.signedUrl
    debeVer ? debe(ve, `${quien} la ve (fila + foto)`, `${quien} NO la ve`)
            : debe(nada, `${quien} no la ve`, `${quien} VE la orden`)
  }

  bloque('La consulta de la emergencia nace sólo del módulo')
  {
    const { error } = await paciente.c.from('consultations').insert({
      patient_id: paciente.id, professional_id: medico.id, status: 'pending', modality: 'presencial',
      payment_status: 'pending_payment', scheduled_at: new Date().toISOString(), emergency_id: em.id,
    })
    debe(error, 'el paciente no crea una consulta anclada a la emergencia', 'el paciente CREÓ una consulta de emergencia')
  }
  {
    const { data: cid, error } = await medico.c.rpc('iniciar_atencion_emergencia', { p_emergency_id: em.id })
    debe(!error && cid, 'iniciar_atencion_emergencia sigue abriendo la atención', `no abre la atención: ${error?.message}`)
    consultaId = cid
    if (cid) {
      const { error: errSuelta } = await medico.c.from('consultations').update({ emergency_id: null }).eq('id', cid)
      const { data: c } = await admin.from('consultations').select('emergency_id').eq('id', cid).single()
      debe(errSuelta && c.emergency_id === em.id, 'el médico no la desancla', 'la consulta se pudo desanclar de la emergencia')
    }
  }

  bloque('Con la orden, se cierra; el historial tiene la hora')
  {
    const { error } = await medico.c.from('emergencies')
      .update({ status: 'completed', cierre_sin_atencion: 'Traslado al Hospital Fernández', completed_at: haceUnAnio }).eq('id', em.id)
    debe(!error, 'el médico cierra el traslado', `no cierra: ${error?.message}`)
    const { data: hist } = await operador.c.from('emergencies')
      .select('id, status, completed_at, desenlace, paciente_nombre, ordenes:emergency_transfer_orders(id, tipo, institucion)')
      .eq('provider_id', ENTIDAD).in('status', ['completed', 'cancelled']).eq('id', em.id).maybeSingle()
    debe(hist?.status === 'completed', 'el operador lo ve en el historial', 'el operador NO ve el traslado terminado')
    debe(hist?.completed_at && Math.abs(Date.now() - new Date(hist.completed_at).getTime()) < 120_000,
      'completed_at = hora de la base', `completed_at = ${hist?.completed_at}`)
    debe(hist?.desenlace === 'traslado' && hist?.ordenes?.filter(o => o.tipo === 'orden_traslado').length === 1, 'con su desenlace y su orden', 'falta el desenlace o la orden en el historial')
    debe(!!hist?.paciente_nombre, `con el nombre del paciente ("${hist?.paciente_nombre}") aunque ya no lea su ficha`, 'el historial no tiene el nombre del paciente')
    const { data: otrasActivas } = await admin.from('emergencies').select('id')
      .eq('patient_id', paciente.id).not('status', 'in', '("completed","cancelled")')
    if (otrasActivas?.length) nota('el paciente tiene otra emergencia activa en staging: no se puede chequear que el despacho deje de leer su ficha')
    else {
      const { data: ficha } = await operador.c.from('profiles').select('id').eq('id', paciente.id)
      debe(!ficha?.length, 'cerrada, el despacho ya no lee la ficha del paciente', 'el despacho sigue leyendo la ficha completa del paciente')
    }
    const { error: errNombre } = await paciente.c.from('emergencies').update({ paciente_nombre: 'Otro' }).eq('id', em.id)
    const { data: nom } = await admin.from('emergencies').select('paciente_nombre').eq('id', em.id).single()
    debe(nom?.paciente_nombre === hist?.paciente_nombre, 'nadie pisa la copia del nombre', `la copia del nombre cambió (${errNombre?.message ?? ''})`)
    const { error: errTarde } = await medico.c.storage.from(BUCKET).upload(`${em.id}/tarde.jpg`, JPEG, { contentType: 'image/jpeg' })
    debe(errTarde, 'cerrada, ya no se suben fotos', 'se subió una foto con la emergencia cerrada')
    if (!errTarde) subidas.push(`${em.id}/tarde.jpg`)
  }
  bloque('El despacho sube la orden y cierra con desenlace')
  {
    const { data: e2 } = await admin.from('emergencies').insert({
      patient_id: paciente.id, triage_code: 'AMARILLO', status: 'arrived', paid_at: new Date().toISOString(), price_at_request: 50,
      patient_latitude: -34.6, patient_longitude: -58.38, provider_id: ENTIDAD, ambulance_id: MOVIL_2, professional_id: medico.id,
      dispatched_at: new Date().toISOString(), dispatch_code: 'UTM-0215', cierre_sin_atencion: 'Rechazó la atención',
    }).select('id').single()
    try {
      const { data: est0 } = await operador.c.rpc('estado_atencion_emergencia', { p_emergency_id: e2.id })
      debe(est0 === null, 'sin atención, el despacho lee estado null', `estado: ${est0}`)
      const { error: errSinDes } = await operador.c.from('emergencies').update({ status: 'completed' }).eq('id', e2.id)
      debe(errSinDes && /cómo terminó/i.test(errSinDes.message), 'el despacho no cierra sin decir cómo terminó', `el despacho cerró sin desenlace (${errSinDes?.message ?? 'sin error'})`)
      // Sólo una negativa: no alcanza para un traslado.
      const rN = `${e2.id}/negativa.jpg`
      await medico.c.storage.from(BUCKET).upload(rN, JPEG, { contentType: 'image/jpeg' }); subidas.push(rN)
      await medico.c.from('emergency_transfer_orders').insert({ emergency_id: e2.id, tipo: 'negativa', foto_path: rN })
      const { error: errSoloNeg } = await operador.c.from('emergencies').update({ status: 'completed', desenlace: 'traslado' }).eq('id', e2.id)
      debe(errSoloNeg && /orden de traslado/i.test(errSoloNeg.message), 'con sólo la negativa, un traslado no se cierra', 'se cerró un traslado con sólo la negativa')
      const rO = `${e2.id}/orden-despacho.jpg`
      const { error: errSubOp } = await operador.c.storage.from(BUCKET).upload(rO, JPEG, { contentType: 'image/jpeg' })
      if (!errSubOp) subidas.push(rO)
      const { data: oOp, error: errRegOp } = await operador.c.from('emergency_transfer_orders').insert({ emergency_id: e2.id, institucion: 'Hospital Rivadavia', foto_path: rO }).select('subida_por').single()
      debe(!errSubOp && !errRegOp && oOp?.subida_por === operador.id, 'el despacho de la entidad sube la orden él mismo', `el despacho no pudo subir la orden: ${errSubOp?.message || errRegOp?.message}`)
      const { error: errCierre } = await operador.c.from('emergencies').update({ status: 'completed', desenlace: 'traslado' }).eq('id', e2.id).select('id').single()
      debe(!errCierre, 'con la orden, el despacho cierra el traslado', `el despacho no pudo cerrar: ${errCierre?.message}`)
      const { error: errTerminada } = await paciente.c.from('emergencies').update({ notes: 'cambio' }).eq('id', e2.id).select('id').single()
      const { data: notas } = await admin.from('emergencies').select('notes').eq('id', e2.id).single()
      debe(errTerminada && notas?.notes !== 'cambio', 'el paciente no toca una emergencia terminada', 'el paciente modificó una emergencia terminada')
    } finally {
      await admin.from('emergency_transfer_orders').delete().eq('emergency_id', e2.id)
      await admin.from('emergencies').delete().eq('id', e2.id)
    }
  }

  bloque('Huecos que ya existían, cerrados')
  {
    const { data: e3 } = await admin.from('emergencies').insert({
      patient_id: paciente.id, triage_code: 'VERDE', status: 'in_transit', paid_at: new Date().toISOString(), price_at_request: 50,
      patient_latitude: -34.6, patient_longitude: -58.38, provider_id: ENTIDAD, ambulance_id: MOVIL_2, professional_id: medico.id,
      dispatched_at: new Date().toISOString(), dispatch_code: 'UTM-0216',
    }).select('id').single()
    const { data: otraEntidad } = await admin.from('emergency_providers').insert({ name: 'Entidad de prueba 213' }).select('id').single()
    let e4 = null
    try {
      for (const [quien, s] of [['el médico', medico], ['el despacho', operador]]) {
        const { error } = await s.c.from('emergencies').update({ patient_id: otroPaciente.id }).eq('id', e3.id)
        const { data: f } = await admin.from('emergencies').select('patient_id').eq('id', e3.id).single()
        debe(f.patient_id === paciente.id, `${quien} no cambia el paciente de una emergencia`, `${quien} cambió el paciente (${error?.message ?? ''})`)
      }
      const { data: f1 } = await operador.c.from('profiles').select('id').eq('id', paciente.id)
      debe(f1?.length === 1, 'el despacho lee al paciente de un traslado de su entidad', 'el despacho NO lee al paciente de su propio traslado')
      ;({ data: e4 } = await admin.from('emergencies').insert({
        patient_id: otroPaciente.id, triage_code: 'VERDE', status: 'dispatched', paid_at: new Date().toISOString(), price_at_request: 50,
        patient_latitude: -34.6, patient_longitude: -58.38, provider_id: otraEntidad.id, dispatched_at: new Date().toISOString(),
      }).select('id').single())
      const { data: f2 } = await operador.c.from('profiles').select('id, email').eq('id', otroPaciente.id)
      debe(!f2?.length, 'el despacho no lee al paciente de un traslado de otra entidad', 'el despacho lee la ficha de un paciente de otra entidad')
      // Cancelar mientras espera la ambulancia sigue andando en las dos bases
      // (después de asignada depende de la 175: va por mp-capture o directo).
      const { data: e5 } = await admin.from('emergencies').insert({
        patient_id: paciente.id, triage_code: 'VERDE', status: 'awaiting_dispatch', paid_at: new Date().toISOString(),
        price_at_request: 50, patient_latitude: -34.6, patient_longitude: -58.38,
      }).select('id').single()
      const { error: errCancel } = await paciente.c.from('emergencies').update({ status: 'cancelled' }).eq('id', e5.id).select('id').single()
      debe(!errCancel, 'el paciente sigue pudiendo cancelar mientras espera la ambulancia', `el paciente no pudo cancelar: ${errCancel?.message}`)
      await admin.from('emergencies').delete().eq('id', e5.id)
    } finally {
      if (e4) await admin.from('emergencies').delete().eq('id', e4.id)
      await admin.from('emergencies').delete().eq('id', e3.id)
      if (otraEntidad) await admin.from('emergency_providers').delete().eq('id', otraEntidad.id)
      await admin.from('ambulances').update({ status: 'disponible' }).eq('id', MOVIL_2).eq('status', 'en_servicio')
    }
  }

  bloque('Super admin: borrar sí, pero no una orden')
  {
    const sa = await comoUsuario('superadmin@healthier.app', 'superadmin')
    const { error: errBorrarConOrden } = await sa.c.from('emergencies').delete().eq('id', em.id)
    const { data: sigue } = await admin.from('emergencies').select('id').eq('id', em.id)
    debe(errBorrarConOrden && sigue?.length, 'una emergencia con orden de traslado no se borra (ni la orden)', 'se pudo borrar una emergencia con su orden de traslado')
    const { data: otra } = await admin.from('emergencies').insert({
      patient_id: paciente.id, triage_code: 'VERDE', status: 'arrived', paid_at: new Date().toISOString(), price_at_request: 50,
      patient_latitude: -34.6, patient_longitude: -58.38, provider_id: ENTIDAD, ambulance_id: MOVIL_2, professional_id: medico.id,
      dispatched_at: new Date().toISOString(), dispatch_code: 'UTM-0214',
    }).select('id').single()
    const { data: cid } = await medico.c.rpc('iniciar_atencion_emergencia', { p_emergency_id: otra.id })
    {
      const { data: estOp } = await operador.c.rpc('estado_atencion_emergencia', { p_emergency_id: otra.id })
      const { data: estOtro } = await otroPro.c.rpc('estado_atencion_emergencia', { p_emergency_id: otra.id })
      debe(estOp === 'in_progress' && estOtro === null, 'el despacho ve el estado de la atención (y un ajeno no)', `despacho: ${estOp} · ajeno: ${estOtro}`)
    }
    if (cid) {
      const { error: errMover } = await sa.c.from('consultations').update({ emergency_id: em.id }).eq('id', cid)
      const { data: c } = await admin.from('consultations').select('emergency_id').eq('id', cid).single()
      debe(errMover && c.emergency_id === otra.id, 'ni el super admin ancla o mueve una consulta a otra emergencia', 'el super admin pudo mover la consulta a otra emergencia')
    }
    const { error: errBorrar } = await sa.c.from('emergencies').delete().eq('id', otra.id)
    debe(!errBorrar, 'el super admin borra una emergencia con atención (sin orden)', `el super admin no pudo borrar: ${errBorrar?.message}`)
    if (errBorrar) await admin.from('emergencies').delete().eq('id', otra.id)
    if (cid) await admin.from('consultations').delete().eq('id', cid)
  }
} finally {
  bloque('Limpieza')
  await admin.from('emergency_transfer_orders').delete().eq('emergency_id', em.id)
  if (subidas.length) await admin.storage.from(BUCKET).remove(subidas)
  if (consultaId) await admin.from('consultations').delete().eq('id', consultaId)
  await admin.from('emergencies').delete().eq('id', em.id)
  await admin.from('ambulances').update({ status: 'disponible' }).eq('id', MOVIL_2).eq('status', 'en_servicio')
  const { data: queda } = await admin.from('emergencies').select('id').eq('id', em.id)
  queda?.length ? mal('quedó la emergencia de prueba') : ok('emergencia de prueba borrada')
}

// ── Lo que la revisión arregló en el código (que no vuelva) ─────────────────
// La app se lee de MOBILE_DIR (default: ../mobile al lado de website/).
bloque('Código: lo arreglado no vuelve')
{
  const { dirname, resolve } = await import('node:path')
  const { fileURLToPath, pathToFileURL } = await import('node:url')
  const { existsSync } = await import('node:fs')
  const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const APP = process.env.MOBILE_DIR || resolve(WEB, '..', 'mobile')
  const leer = (base, rel) => readFileSync(join(base, rel), 'utf8')
  const tiene = (base, rel, re, si, no) => {
    if (!existsSync(join(base, rel))) return mal(`no encuentro ${rel} en ${base}`)
    debe(re.test(leer(base, rel)), si, no)
  }
  const { duracionMin } = await import(pathToFileURL(join(WEB, 'src/lib/cobroEmergencia.js')).href)
  debe(duracionMin({ createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-22T10:00:00Z' }) === null,
    'sin hora de cierre la duración no se inventa con updated_at', 'la duración vuelve a salir de updated_at')
  debe(duracionMin({ createdAt: '2026-10-22T10:00:00Z', completedAt: '2026-10-22T10:38:00Z' }) === 38, 'la duración sale de completed_at', 'la duración no sale de completed_at')
  tiene(WEB, 'src/services/emergencyService.js', /update\(cambios\)\.eq\('id', emergencyId\)\.select\('id'\)\.single\(\)/,
    'web: cerrar una emergencia que no cambió filas es error', 'web: el cierre vuelve a aceptar cero filas en silencio')
  tiene(APP, 'src/services/EmergencyService.ts', /update\(cambios\)\.eq\('id', emergencyId\)\.select\('id'\)\.maybeSingle\(\);[\s\S]{0,120}if \(!data\) throw/,
    'app: cerrar una emergencia que no cambió filas es error', 'app: el cierre vuelve a aceptar cero filas en silencio')
  tiene(WEB, 'src/pages/professional/Pacientes.jsx', /getByProfessional\(profile\.id, \{ conEmergencias: true \}\)/,
    'web: Pacientes incluye a quien se atendió en una emergencia', 'web: Pacientes volvió a dejar afuera a los de emergencia')
  tiene(APP, 'app/(pro)/pacientes.tsx', /getByProfessional\(user\.id, \{ conEmergencias: true \}\)/,
    'app: Pacientes incluye a quien se atendió en una emergencia', 'app: Pacientes volvió a dejar afuera a los de emergencia')
  tiene(APP, 'app/(pro)/paciente/[id].tsx', /getByProfessional\(user\.id, \{ conEmergencias: true \}\)/,
    'app: la ficha del paciente lo encuentra aunque sólo haya sido una emergencia', 'app: la ficha vuelve a decir "No encontramos este paciente"')
  tiene(WEB, 'src/pages/dispatch/Cola.jsx', /estadoAtencion\(req\.id\)[\s\S]*?return\n[\s\S]*?capturarEmergencia\(req\.id\)/,
    'web: el despacho mira la atención ANTES de cobrar', 'web: el despacho vuelve a cobrar antes de saber si puede cerrar')
  tiene(WEB, 'src/pages/dispatch/Historial.jsx', /No estás cargado en ninguna entidad/,
    'web: Historial sin entidad no queda cargando para siempre', 'web: Historial sin entidad vuelve al spinner infinito')
  tiene(WEB, 'supabase/migrations/213_orden_de_traslado_y_historial.sql', /DISABLE TRIGGER emergencies_updated_at[\s\S]*ENABLE TRIGGER emergencies_updated_at/,
    'migración: el backfill no pisa updated_at', 'migración: el backfill vuelve a pisar updated_at')
}

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ Todo en verde')
process.exit(fallos ? 1 : 0)
