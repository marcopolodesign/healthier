#!/usr/bin/env node
/**
 * Chequeo de la verificación de matrícula contra REFEPS (bus FHIR del Ministerio).
 *
 *   node scripts/verificar-refeps.mjs                       # sólo el bus
 *   node scripts/verificar-refeps.mjs --funcion staging     # + la Edge Function deployada
 *   node scripts/verificar-refeps.mjs --funcion produccion
 *
 * 1. **El bus**, directo: firma la assertion, pide el token y busca a una
 *    profesional conocida (Macarena Arteaga, DNI 37754257, MN 165692, cuenta
 *    demo profesional@healthier.app en producción). Falla si la credencial deja
 *    de andar (vence el 01/10/2027), si cambia la forma de buscar
 *    (`identifier=https://sisa.msal.gov.ar/REFEPS|5410<DNI>`) o si cambia dónde
 *    viene la matrícula y su habilitación. También pide un DNI que no existe y
 *    exige un "no se encuentra" limpio, no un 500.
 * 2. **La función** (`--funcion`): entra como superadmin@healthier.app con un
 *    magic link y verifica a profesional@healthier.app con `sisa-verify`, como
 *    lo hace el botón "Verificar en REFEPS" del panel. Escribe sólo los campos
 *    sisa_* de esa cuenta demo (que ya está verificada).
 *
 * **Por qué existe.** La verificación de matrícula estuvo meses respondiendo
 * "credenciales no configuradas" sin que nadie lo notara, y el bus tiene trampas
 * que no avisan: cada assertion sirve una sola vez, buscar por DNI da 500 y el
 * sistema del identificador no es el que dice la documentación general.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHmac, randomUUID } from 'node:crypto'

const env = {
  ...Object.fromEntries(
    readFileSync(join(homedir(), 'Local', '.env'), 'utf8')
      .split('\n').map(l => l.match(/^(?:export )?([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
      .map(m => [m[1], m[2].trim().replace(/^["']|["']$/g, '')])
  ),
  ...process.env,
}

const BUS = 'https://bus.msal.gob.ar'
const CONOCIDA = { dni: '37754257', matricula: '165692', apellido: 'ARTEAGA' }
const REFS = { produccion: 'aixjejdoofervrkggbkd', staging: 'itjhrvlzuqvyhqtffumc' }

let fallas = 0
const ok = m => console.log(`  ✅ ${m}`)
const mal = m => { fallas++; console.log(`  ❌ ${m}`) }

const b64 = b => Buffer.from(b).toString('base64url')

async function token() {
  const now = Math.floor(Date.now() / 1000)
  const data = `${b64(JSON.stringify({ typ: 'JWT', alg: 'HS256' }))}.${b64(JSON.stringify({
    iss: env.MSAL_FHIR_ISSUER, iat: now, exp: now + 300, jti: randomUUID(),
    aud: 'aud', sub: 'sub', name: 'name', ident: 'ident', role: 'role',
  }))}`
  const sig = createHmac('sha256', env.MSAL_FHIR_SECRET).update(data).digest('base64url')
  const res = await fetch(`${BUS}/bus-auth/v2/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'client_credentials', scope: 'Practitioner/*.read',
      clientAssertionType: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      clientAssertion: `${data}.${sig}`,
    }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body?.accessToken) throw new Error(`auth ${res.status}: ${JSON.stringify(body)}`)
  return body.accessToken
}

async function practitioner(tok, dni) {
  const id = encodeURIComponent(`https://sisa.msal.gov.ar/REFEPS|5410${dni.padStart(8, '0')}`)
  const res = await fetch(`${BUS}/fhir/Practitioner?identifier=${id}`, {
    headers: { Authorization: `Bearer ${tok}`, Accept: 'application/fhir+json' },
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

async function chequearBus() {
  console.log('\nBus FHIR del Ministerio')
  if (!env.MSAL_FHIR_ISSUER || !env.MSAL_FHIR_SECRET) return mal('faltan MSAL_FHIR_ISSUER / MSAL_FHIR_SECRET')

  let tok
  try { tok = await token(); ok('auth: token recibido') } catch (e) { return mal(`auth: ${e.message}`) }

  const r = await practitioner(tok, CONOCIDA.dni)
  const p = r.body?.entry?.[0]?.resource
  if (r.status !== 200 || !p) return mal(`búsqueda de la profesional conocida: ${r.status} ${JSON.stringify(r.body)?.slice(0, 300)}`)
  if (p.name?.[0]?.family !== CONOCIDA.apellido) mal(`apellido inesperado: ${p.name?.[0]?.family}`)
  else ok(`encontrada: ${p.name[0].text}`)

  const q = p.qualification?.find(q => q.identifier?.[0]?.value === CONOCIDA.matricula)
  const hab = q?.extension?.find(e => e.url.endsWith('/MatriculaHabilitada'))?.valueBoolean
  const jur = q?.extension?.find(e => e.url.endsWith('/JurisdMatricula'))?.valueCoding?.display
  if (!q) mal(`la matrícula ${CONOCIDA.matricula} no aparece en qualification[].identifier`)
  else if (hab !== true) mal(`MatriculaHabilitada de ${CONOCIDA.matricula} = ${hab} (se esperaba true)`)
  else ok(`matrícula ${CONOCIDA.matricula} habilitada (${jur})`)

  const n = await practitioner(tok, '00000001')
  const diag = n.body?.issue?.[0]?.diagnostics ?? ''
  if (n.status === 404 && /no se encuentra/i.test(diag)) ok('un DNI inexistente da "no se encuentra"')
  else mal(`DNI inexistente: ${n.status} ${diag || JSON.stringify(n.body)?.slice(0, 200)}`)
}

async function chequearFuncion(entorno) {
  console.log(`\nEdge Function sisa-verify — ${entorno}`)
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
    method: 'POST', headers: adm, body: JSON.stringify({ type: 'magiclink', email: 'superadmin@healthier.app' }),
  })).json()
  const sess = await (await fetch(`${url}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token ?? link.properties?.hashed_token }),
  })).json()
  if (!sess.access_token) return mal(`no se pudo abrir la sesión del super admin: ${JSON.stringify(sess).slice(0, 200)}`)

  const user = (await (await fetch(`${url}/rest/v1/profiles?email=eq.profesional@healthier.app&select=id`, { headers: adm })).json())[0]
  const pro = user && (await (await fetch(`${url}/rest/v1/professional_profiles?user_id=eq.${user.id}&select=id`, { headers: adm })).json())[0]
  if (!pro) return mal('no está la cuenta demo profesional@healthier.app')

  const res = await fetch(`${url}/functions/v1/sisa-verify`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${sess.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ professionalId: pro.id }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) return mal(`sisa-verify ${res.status}: ${JSON.stringify(body)}`)
  ok(`sisa-verify respondió ${body.sisaStatus}${body.sisaMatricula ? ` · ${body.sisaMatricula}` : ''}`)
  // En producción la demo es Arteaga (real); en staging es un DNI inventado.
  if (entorno === 'produccion' && body.sisaStatus !== 'habilitada') mal('en producción se esperaba "habilitada"')
}

await chequearBus()
const i = process.argv.indexOf('--funcion')
if (i > -1) await chequearFuncion(process.argv[i + 1])

console.log(fallas ? `\n🔴 ${fallas} falla(s)` : '\n🟢 REFEPS ok')
process.exit(fallas ? 1 : 0)
