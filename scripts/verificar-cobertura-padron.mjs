#!/usr/bin/env node
/**
 * Chequeo de la cobertura sugerida por DNI (listado de obras sociales del
 * Ministerio — PUCO, por el bus de la Plataforma de Interoperabilidad).
 *
 *   node scripts/verificar-cobertura-padron.mjs                    # sólo el bus
 *   node scripts/verificar-cobertura-padron.mjs --funcion staging  # + la Edge Function
 *   node scripts/verificar-cobertura-padron.mjs --funcion produccion
 *
 * 1. **El bus**, directo: login de aplicación y consulta de un DNI del equipo
 *    (Mateo, 37217936 → rnos 614081, OSDE). Falla si la credencial deja de
 *    andar o si cambia la forma de la respuesta.
 * 2. **La función** (`--funcion`): entra como paciente@healthier.app con un
 *    magic link, le pone por un momento el DNI del equipo (sin cobertura),
 *    llama a `cobertura-sugerida` y exige OSDE con el id del catálogo de ESE
 *    ambiente. Después le devuelve el DNI y la cobertura que tenía. También
 *    exige un 403 al pedir la cobertura de un perfil ajeno.
 *
 * 🔒 Sólo DNIs del equipo: es dato personal (pedido de Mateo, 2026-10-09).
 * La regla "no pisar lo que ya cargó" la controla `npm run test:cobertura`.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const env = {
  ...Object.fromEntries(
    readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
      .split('\n').map(l => l.match(/^(?:export )?([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
      .map(m => [m[1], m[2].trim().replace(/^["']|["']$/g, '')])
  ),
  ...process.env,
}

const BUS = 'https://bus.msal.gob.ar/masterfile-federacion-service/api'
const EQUIPO = { dni: '37217936', rnos: '614081', catalogo: 'OSDE' }
const REFS = { produccion: 'aixjejdoofervrkggbkd', staging: 'itjhrvlzuqvyhqtffumc' }

let fallas = 0
const ok = m => console.log(`  ✅ ${m}`)
const mal = m => { fallas++; console.log(`  ❌ ${m}`) }

async function chequearBus() {
  console.log('\nListado de obras sociales (bus del Ministerio)')
  if (!env.MSAL_NOFHIR_APP || !env.MSAL_NOFHIR_PASSWORD || !env.MSAL_FHIR_ISSUER) {
    return mal('faltan MSAL_NOFHIR_APP / MSAL_NOFHIR_PASSWORD / MSAL_FHIR_ISSUER')
  }
  const l = await fetch(`${BUS}/usuarios/aplicacion/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: env.MSAL_NOFHIR_APP, clave: env.MSAL_NOFHIR_PASSWORD, codDominio: env.MSAL_FHIR_ISSUER }),
  })
  const lb = await l.json().catch(() => null)
  if (!l.ok || !lb?.token) return mal(`login ${l.status}: ${JSON.stringify(lb)?.slice(0, 300)}`)
  ok('login: token recibido')

  const r = await fetch(`${BUS}/personas/cobertura?nroDocumento=${EQUIPO.dni}&idSexo=2`, {
    headers: { token: lb.token, codDominio: env.MSAL_FHIR_ISSUER },
  })
  const rb = await r.json().catch(() => null)
  if (!r.ok || !Array.isArray(rb)) return mal(`consulta ${r.status}: ${JSON.stringify(rb)?.slice(0, 300)}`)
  const c = rb.find(x => x.rnos === EQUIPO.rnos)
  if (!c) mal(`no vino el rnos ${EQUIPO.rnos}: ${JSON.stringify(rb).slice(0, 300)}`)
  else ok(`DNI del equipo → ${c.rnos} ${c.cobertura}`)
}

async function chequearFuncion(entorno) {
  console.log(`\nEdge Function cobertura-sugerida — ${entorno}`)
  const ref = REFS[entorno]
  if (!ref) return mal(`entorno desconocido: ${entorno}`)
  const keys = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, {
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
  })).json()
  const anon = keys.find?.(k => k.name === 'anon')?.api_key
  const service = keys.find?.(k => k.name === 'service_role')?.api_key
  if (!anon || !service) return mal('no se pudieron leer las keys del proyecto')
  const url = `https://${ref}.supabase.co`
  const adm = { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' }

  const link = await (await fetch(`${url}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: adm, body: JSON.stringify({ type: 'magiclink', email: 'paciente@healthier.app' }),
  })).json()
  const sess = await (await fetch(`${url}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token ?? link.properties?.hashed_token }),
  })).json()
  if (!sess.access_token) return mal(`no se pudo abrir la sesión del paciente: ${JSON.stringify(sess).slice(0, 200)}`)
  const yo = sess.user.id

  const campos = 'dni,coverage_type,financiador_id,insurance_name,insurance_num,cobertura_origen'
  const antes = (await (await fetch(`${url}/rest/v1/profiles?id=eq.${yo}&select=${campos}`, { headers: adm })).json())[0]
  const patch = body => fetch(`${url}/rest/v1/profiles?id=eq.${yo}`, { method: 'PATCH', headers: adm, body: JSON.stringify(body) })
  const llamar = body => fetch(`${url}/functions/v1/cobertura-sugerida`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${sess.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  try {
    await patch({ dni: EQUIPO.dni, coverage_type: null, financiador_id: null, insurance_name: null, insurance_num: null })
    const res = await llamar({})
    const body = await res.json().catch(() => null)
    if (!res.ok) mal(`cobertura-sugerida ${res.status}: ${JSON.stringify(body)}`)
    else if (body.estado !== 'encontrada' || body.sugerencia?.financiadorNombre !== EQUIPO.catalogo || !body.sugerencia?.financiadorId) {
      mal(`se esperaba ${EQUIPO.catalogo} encontrada: ${JSON.stringify(body).slice(0, 300)}`)
    } else ok(`sugiere ${body.sugerencia.financiadorNombre} (id ${body.sugerencia.financiadorId} en ${entorno})`)

    const fin = (await (await fetch(`${url}/rest/v1/profiles?id=eq.${yo}&select=${campos}`, { headers: adm })).json())[0]
    if (fin.coverage_type || fin.financiador_id) mal('la función escribió la cobertura en el perfil (sólo tiene que sugerir)')
    else ok('no escribió nada en el perfil')

    // Un perfil ajeno (el super admin) → 403.
    const otro = (await (await fetch(`${url}/rest/v1/profiles?email=eq.superadmin@healthier.app&titular_id=is.null&select=id`, { headers: adm })).json())[0]
    if (otro) {
      const r2 = await llamar({ pacienteId: otro.id })
      if (r2.status === 403) ok('un perfil ajeno da 403')
      else mal(`un perfil ajeno dio ${r2.status} (se esperaba 403)`)
    }
  } finally {
    await patch(antes)
  }
}

await chequearBus()
const i = process.argv.indexOf('--funcion')
if (i > -1) await chequearFuncion(process.argv[i + 1])

console.log(fallas ? `\n🔴 ${fallas} falla(s)` : '\n🟢 Cobertura por DNI ok')
process.exit(fallas ? 1 : 0)
