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

  bloque('Quién ve la orden')
  for (const [quien, s, debeVer] of [['el médico', medico, true], ['el despacho de la entidad', operador, true], ['el paciente', paciente, false], ['otro profesional', otroPro, false]]) {
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
      .select('id, status, completed_at, desenlace, paciente_nombre, ordenes:emergency_transfer_orders(id, institucion)')
      .eq('provider_id', ENTIDAD).in('status', ['completed', 'cancelled']).eq('id', em.id).maybeSingle()
    debe(hist?.status === 'completed', 'el operador lo ve en el historial', 'el operador NO ve el traslado terminado')
    debe(hist?.completed_at && Math.abs(Date.now() - new Date(hist.completed_at).getTime()) < 120_000,
      'completed_at = hora de la base', `completed_at = ${hist?.completed_at}`)
    debe(hist?.desenlace === 'traslado' && hist?.ordenes?.length === 1, 'con su desenlace y su orden', 'falta el desenlace o la orden en el historial')
    debe(!!hist?.paciente_nombre, `con el nombre del paciente ("${hist?.paciente_nombre}") aunque ya no lea su ficha`, 'el historial no tiene el nombre del paciente')
    const { data: ficha } = await operador.c.from('profiles').select('id').eq('id', paciente.id)
    debe(!ficha?.length, 'cerrada, el despacho ya no lee la ficha del paciente', 'el despacho sigue leyendo la ficha completa del paciente')
    const { error: errNombre } = await paciente.c.from('emergencies').update({ paciente_nombre: 'Otro' }).eq('id', em.id)
    const { data: nom } = await admin.from('emergencies').select('paciente_nombre').eq('id', em.id).single()
    debe(nom?.paciente_nombre === hist?.paciente_nombre, 'nadie pisa la copia del nombre', `la copia del nombre cambió (${errNombre?.message ?? ''})`)
    const { error: errTarde } = await medico.c.storage.from(BUCKET).upload(`${em.id}/tarde.jpg`, JPEG, { contentType: 'image/jpeg' })
    debe(errTarde, 'cerrada, ya no se suben fotos', 'se subió una foto con la emergencia cerrada')
    if (!errTarde) subidas.push(`${em.id}/tarde.jpg`)
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

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ Todo en verde')
process.exit(fallos ? 1 : 0)
