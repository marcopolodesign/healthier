#!/usr/bin/env node
/**
 * Baja lógica de punta a punta, en STAGING (migración 188).
 *
 *   node scripts/verificar-baja-de-usuarios.mjs
 *
 * **Por qué existe.** Hasta el 2026-10-06 "Eliminar" en el super admin borraba
 * el perfil: el `auth.users` quedaba vivo con el mail tomado (la persona no se
 * podía volver a registrar) y las FK en CASCADE se llevaban parte de la
 * historia clínica. Este recorrido prueba que eso no vuelve:
 *
 *   1. Alta de un paciente de prueba con HC (una nota clínica del profesional
 *      demo y un documento).
 *   2. El super admin lo da de baja por `dar-de-baja-usuario` (la misma
 *      función que llama el panel).
 *   3. El perfil queda con alias, sin teléfono ni foto, `deleted_at`; el mail de
 *      `auth.users` es el alias y está baneado; no puede entrar con su mail; la
 *      HC sigue entera; un DELETE del perfil choca contra el RESTRICT.
 *   4. Se quiere registrar con el mismo mail → `consultar` dice que está dado
 *      de baja; `solicitar` manda el mail (queda en email_log).
 *   5. `confirmar` con el token del mail → entra con su mail y la contraseña
 *      nueva, el perfil vuelve como estaba y la HC sigue con el mismo id.
 *   6. Alta con un mail que ya existe → `user_already_exists` (lo que el
 *      registro traduce a "Ese mail ya está registrado").
 *
 * Al final borra todo lo que creó. Se niega a correr contra producción.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
    .split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^["']|["']$/g, '')])
)
const REF = env.HEALTHIER_STAGING_SUPABASE_REF
const URL = env.HEALTHIER_STAGING_SUPABASE_URL
if (!REF || REF === 'aixjejdoofervrkggbkd') { console.error('Sólo corre contra staging.'); process.exit(2) }

const admin = createClient(URL, env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const nuevoAnon = () => createClient(URL, env.HEALTHIER_STAGING_SUPABASE_ANON_KEY, { auth: { persistSession: false } })

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(text)
  return JSON.parse(text)
}

async function funcion(nombre, body, token) {
  const r = await fetch(`${URL}/functions/v1/${nombre}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.HEALTHIER_STAGING_SUPABASE_ANON_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return { status: r.status, json: await r.json().catch(() => null) }
}

async function sesionDe(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw error
  const anon = nuevoAnon()
  const { data: s, error: e2 } = await anon.auth.verifyOtp({ type: 'magiclink', token_hash: data.properties.hashed_token })
  if (e2) throw e2
  return s.session.access_token
}

let fallas = 0
const ok = (cond, msg) => { console.log(`${cond ? '✅' : '❌'} ${msg}`); if (!cond) fallas++ }

const ts = Date.now()
const EMAIL = `baja.e2e.${ts}@staging.healthier.app`
const PASS_VIEJA = `Vieja-${ts}`
const PASS_NUEVA = `Nueva-${ts}`
let userId = null

try {
  // 1 ─ Alta con HC
  const { data: creado, error } = await admin.auth.admin.createUser({
    email: EMAIL, password: PASS_VIEJA, email_confirm: true,
    user_metadata: { role: 'patient', first_name: 'Baja', last_name: 'Prueba', full_name: 'Baja Prueba' },
  })
  if (error) throw error
  userId = creado.user.id
  await sql(`update public.profiles set phone = '+5491100000000', avatar_url = 'https://example.test/a.png' where id = '${userId}'`)
  const [pro] = await sql(`select id from public.profiles where email = 'profesional@healthier.app'`)
  const [nota] = await sql(`insert into public.clinical_notes (patient_id, professional_id, specialty, content)
                            values ('${userId}', '${pro.id}', 'clinica', 'Nota de prueba de la baja lógica') returning id`)
  const [doc] = await sql(`insert into public.medical_documents (patient_id, file_name, file_url)
                           values ('${userId}', 'estudio.pdf', 'https://example.test/estudio.pdf') returning id`)
  console.log(`· paciente ${EMAIL} (${userId}) con nota ${nota.id} y documento ${doc.id}`)

  // 2 ─ Baja por el super admin
  const tokenSuper = await sesionDe('superadmin@healthier.app')
  const sinPermiso = await funcion('dar-de-baja-usuario', { ids: [userId] }, await sesionDe('paciente@healthier.app'))
  ok(sinPermiso.status === 403, `un paciente no puede dar de baja (HTTP ${sinPermiso.status})`)
  const baja = await funcion('dar-de-baja-usuario', { ids: [userId] }, tokenSuper)
  ok(baja.status === 200 && baja.json?.ok, `el super admin lo da de baja (HTTP ${baja.status} ${JSON.stringify(baja.json)})`)

  // 3 ─ Cómo quedó
  const [perfil] = await sql(`select email, phone, avatar_url, deleted_at, deleted_by from public.profiles where id = '${userId}'`)
  ok(perfil.email === `deleted+${userId}@deleted.healthier.app`, `perfil con el alias (${perfil.email})`)
  ok(perfil.phone === null && perfil.avatar_url === null, 'perfil sin teléfono ni foto')
  ok(perfil.deleted_at && perfil.deleted_by, 'perfil con deleted_at y deleted_by')
  const { data: { user: authUser } } = await admin.auth.admin.getUserById(userId)
  ok(authUser.email === perfil.email, `auth.users con el alias (${authUser.email})`)
  ok(authUser.banned_until && new Date(authUser.banned_until) > new Date(Date.now() + 365 * 864e5), 'auth.users baneado')
  const { error: loginErr } = await nuevoAnon().auth.signInWithPassword({ email: EMAIL, password: PASS_VIEJA })
  ok(Boolean(loginErr), `no puede entrar con su mail (${loginErr?.message})`)
  const [hc] = await sql(`select (select count(*) from public.clinical_notes where id = '${nota.id}' and patient_id = '${userId}') notas,
                                 (select count(*) from public.medical_documents where id = '${doc.id}' and patient_id = '${userId}') docs`)
  ok(Number(hc.notas) === 1 && Number(hc.docs) === 1, 'la HC sigue entera después de la baja')
  const borrar = await sql(`delete from public.profiles where id = '${userId}'`).then(() => null, e => e.message)
  ok(borrar && /foreign key|violates/i.test(borrar), 'un DELETE del perfil choca contra el RESTRICT')
  const [privada] = await sql(`select email_original from public.bajas_de_usuarios where user_id = '${userId}'`)
  ok(privada?.email_original === EMAIL, 'el mail original quedó guardado en bajas_de_usuarios')
  const { data: leidoPorCliente } = await nuevoAnon().from('bajas_de_usuarios').select('*').limit(1)
  ok(!leidoPorCliente?.length, 'bajas_de_usuarios no la lee un cliente')

  // 4 ─ Vuelve con el mismo mail
  const consulta = await funcion('reactivar-cuenta', { accion: 'consultar', email: EMAIL.toUpperCase() })
  ok(consulta.json?.dadoDeBaja === true, 'el registro detecta la cuenta dada de baja')
  const otraConsulta = await funcion('reactivar-cuenta', { accion: 'consultar', email: `nadie.${ts}@staging.healthier.app` })
  ok(otraConsulta.json?.dadoDeBaja === false, 'un mail cualquiera no figura como dado de baja')
  const pedido = await funcion('reactivar-cuenta', { accion: 'solicitar', email: EMAIL })
  const [log] = await sql(`select estado, destinatario, error from public.email_log where usuario_id = '${userId}' and tipo = 'reactivar-cuenta' order by created_at desc limit 1`)
    .catch(() => [])
  ok(log && log.destinatario === EMAIL, `el mail "Recuperá tu cuenta" va al correo original (${log?.estado ?? 'sin registro'})`)
  // El Resend de staging está en modo prueba: sólo entrega a la casilla de la
  // cuenta. Ahí lo correcto es que la función avise que no salió (502).
  const sandbox = /testing emails/i.test(log?.error ?? '')
  if (sandbox) {
    ok(pedido.status === 502 && /No pudimos mandarte el mail/.test(pedido.json?.error ?? ''),
      `Resend de staging en modo prueba → la pantalla recibe el error real (HTTP ${pedido.status})`)
  } else {
    ok(pedido.status === 200 && log?.estado === 'enviado', `pide recuperar la cuenta y el mail sale (HTTP ${pedido.status} ${JSON.stringify(pedido.json)})`)
  }

  // 5 ─ Confirma desde el link
  const [{ reactivacion_token: token }] = await sql(`select reactivacion_token from public.bajas_de_usuarios where user_id = '${userId}'`)
  const malo = await funcion('reactivar-cuenta', { accion: 'confirmar', token: 'cualquiera', password: PASS_NUEVA })
  ok(malo.status === 410, `un token inventado no sirve (HTTP ${malo.status})`)
  const conf = await funcion('reactivar-cuenta', { accion: 'confirmar', token, password: PASS_NUEVA })
  ok(conf.status === 200 && conf.json?.email === EMAIL, `recupera la cuenta (HTTP ${conf.status} ${JSON.stringify(conf.json)})`)
  const otraVez = await funcion('reactivar-cuenta', { accion: 'confirmar', token, password: PASS_NUEVA })
  ok(otraVez.status === 410, 'el link sirve una sola vez')
  const { data: login, error: e5 } = await nuevoAnon().auth.signInWithPassword({ email: EMAIL, password: PASS_NUEVA })
  ok(!e5 && login.user.id === userId, `entra con su mail y la contraseña nueva, misma cuenta (${e5?.message ?? 'ok'})`)
  const [vuelto] = await sql(`select email, phone, avatar_url, deleted_at from public.profiles where id = '${userId}'`)
  ok(vuelto.email === EMAIL && vuelto.deleted_at === null, 'perfil reactivado con su mail')
  ok(vuelto.phone === '+5491100000000' && vuelto.avatar_url === 'https://example.test/a.png', 'teléfono y foto restaurados')
  const [hc2] = await sql(`select count(*) n from public.clinical_notes where id = '${nota.id}' and patient_id = '${userId}'`)
  ok(Number(hc2.n) === 1, 'la HC sigue con el mismo paciente después de reactivar')

  // 6 ─ Alta con un mail que ya existe
  const { error: dup } = await nuevoAnon().auth.signUp({ email: EMAIL, password: 'Otra-123456' })
  ok(dup?.code === 'user_already_exists' || /already registered/i.test(dup?.message ?? ''),
    `alta con mail existente → ${dup?.code ?? dup?.message ?? 'sin error'}`)
} catch (e) {
  fallas++
  console.error('❌ el recorrido se cortó:', e.message)
} finally {
  if (userId) {
    await sql(`delete from public.clinical_notes where patient_id = '${userId}';
               delete from public.medical_documents where patient_id = '${userId}';
               delete from public.email_log where usuario_id = '${userId}';
               delete from public.bajas_de_usuarios where user_id = '${userId}';
               delete from public.profiles where id = '${userId}';`).catch(e => console.error('limpieza:', e.message))
    await admin.auth.admin.deleteUser(userId).catch(e => console.error('limpieza auth:', e.message))
    console.log('· limpiado')
  }
}

console.log(fallas ? `\n❌ ${fallas} falla(s)` : '\n✅ baja lógica OK')
process.exit(fallas ? 1 : 0)
