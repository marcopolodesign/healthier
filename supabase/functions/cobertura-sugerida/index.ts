// ── Cobertura sugerida por DNI — padrón PUCO del Ministerio de Salud ──────────
// Al cargar el DNI, la obra social del paciente se precarga sola: el front
// llama a esta función y, si el paciente todavía no tiene cobertura cargada,
// le propone la que figura en el padrón. El paciente la confirma o la cambia.
// Esta función NUNCA escribe en el perfil: sólo sugiere.
//
// Secrets: MSAL_NOFHIR_APP, MSAL_NOFHIR_PASSWORD (credencial "no FHIR" de la
//          Plataforma de Interoperabilidad) y MSAL_FHIR_ISSUER (el dominio,
//          https://healthier.com.ar). Para mapear al catálogo de recetas usa los
//          mismos RCTA_* que rcta-catalog.
//
// Cómo se consulta (probado contra el bus el 2026-10-09):
//   - Login: POST /masterfile-federacion-service/api/usuarios/aplicacion/login
//     { nombre, clave, codDominio } → { token }. Se cachea.
//   - Consulta: GET .../api/personas/cobertura?nroDocumento=<dni>&idSexo=<1|2>
//     con headers `token` y `codDominio` → [{ rnos, cobertura, servicio }].
//     Puede venir más de una (PAMI + una provincial). No trae plan ni afiliado.
//     El idSexo es obligatorio (3 da 400 "Sexo inválido") pero en la práctica
//     devolvió lo mismo con 1 y con 2.
//
// 🔒 Dato personal: no se recibe un DNI libre. Se recibe `pacienteId` (el propio
// usuario o un familiar suyo, ver _shared/familia.ts) y el DNI se lee del
// perfil. Además, cada usuario puede consultar como mucho LIMITE_DNIS DNIs
// distintos por día — sin eso, cambiándose el DNI una y otra vez se podría
// barrer el padrón.
//
// Request:  { pacienteId?: string }   (por defecto, el usuario logueado)
// Response: siempre 200 salvo auth. `estado`:
//   encontrada   → hay sugerencia con financiadorId del catálogo
//   sin_match    → figura en el padrón pero no está en el catálogo: se devuelve
//                  el nombre y el paciente elige
//   sin_datos    → el padrón no tiene cobertura para ese DNI
//   no_disponible→ falta config, el bus falló o se pasó el límite. El front
//                  sigue como si nada; el error real queda en los logs y en
//                  `cobertura_consultas`.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { puedeActuarComo } from '../_shared/familia.ts'
import { elegirSugerencia, type Financiador } from './match.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BUS = 'https://bus.msal.gob.ar/masterfile-federacion-service/api'
const LIMITE_DNIS = 5

let tokenCache: { token: string; exp: number } | null = null
let catalogoCache: { items: Financiador[]; exp: number } | null = null

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: { user } } = await db.auth.getUser(jwt)
  if (!user) return json({ error: 'No autenticado' }, 401)

  let body: { pacienteId?: string } = {}
  try { body = await req.json() } catch { /* body vacío = el propio usuario */ }
  const pacienteId = body.pacienteId || user.id
  if (!(await puedeActuarComo(db, user.id, pacienteId))) {
    return json({ error: 'No podés consultar la cobertura de este paciente' }, 403)
  }

  const { data: perfil } = await db.from('profiles').select('dni, gender').eq('id', pacienteId).maybeSingle()
  const dni = String(perfil?.dni ?? '').replace(/\D/g, '')
  if (dni.length < 7 || dni.length > 8) return json({ estado: 'sin_datos', motivo: 'sin_dni' })

  const dniHash = await sha256(dni)
  const registrar = (fila: Record<string, unknown>) =>
    db.from('cobertura_consultas').insert({ paciente_id: pacienteId, consultado_por: user.id, dni_hash: dniHash, ...fila })
      .then(({ error }) => { if (error) console.error('cobertura_consultas', error.message) })

  // ── Límite: DNIs distintos por usuario en las últimas 24 h ──────────────────
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const { data: previas } = await db.from('cobertura_consultas')
    .select('dni_hash').eq('consultado_por', user.id).gte('created_at', desde)
  const distintos = new Set((previas ?? []).map((p: { dni_hash: string }) => p.dni_hash))
  if (!distintos.has(dniHash) && distintos.size >= LIMITE_DNIS) {
    console.warn('cobertura-sugerida: límite de DNIs', user.id)
    await registrar({ resultado: 'limite' })
    return json({ estado: 'no_disponible' })
  }

  const APP = Deno.env.get('MSAL_NOFHIR_APP')
  const CLAVE = Deno.env.get('MSAL_NOFHIR_PASSWORD')
  const DOMINIO = Deno.env.get('MSAL_FHIR_ISSUER')
  if (!APP || !CLAVE || !DOMINIO) {
    console.error('cobertura-sugerida: faltan MSAL_NOFHIR_APP / MSAL_NOFHIR_PASSWORD / MSAL_FHIR_ISSUER')
    await registrar({ resultado: 'error', error: 'NOT_CONFIGURED' })
    return json({ estado: 'no_disponible' })
  }

  // ── Padrón ──────────────────────────────────────────────────────────────────
  let coberturas: { rnos: string; cobertura: string }[]
  try {
    coberturas = await consultarPadron(dni, perfil?.gender, { APP, CLAVE, DOMINIO })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('cobertura-sugerida: padrón', msg)
    await registrar({ resultado: 'error', error: msg.slice(0, 500) })
    return json({ estado: 'no_disponible' })
  }

  if (!coberturas.length) {
    await registrar({ resultado: 'sin_datos' })
    return json({ estado: 'sin_datos' })
  }

  // ── Mapeo al catálogo de recetas ────────────────────────────────────────────
  let catalogo: Financiador[] = []
  try {
    catalogo = await traerCatalogo()
  } catch (e) {
    // Sin catálogo igual se devuelve el nombre: el paciente elige a mano.
    console.error('cobertura-sugerida: catálogo', e instanceof Error ? e.message : e)
  }
  const { data: puente } = await db.from('cobertura_rnos').select('rnos, nombre_catalogo')
    .in('rnos', coberturas.map(c => c.rnos))

  const { sugerencia, todas } = elegirSugerencia(coberturas, catalogo, puente ?? [])
  const estado = sugerencia?.financiadorId ? 'encontrada' : 'sin_match'

  await registrar({
    resultado: estado,
    rnos: sugerencia?.rnos ?? null,
    cobertura_nombre: sugerencia?.coberturaNombre ?? null,
    financiador_id: sugerencia?.financiadorId ?? null,
    financiador_nombre: sugerencia?.financiadorNombre ?? null,
  })

  return json({ estado, sugerencia, todas })
})

// ── Bus del Ministerio ────────────────────────────────────────────────────────
type Cred = { APP: string; CLAVE: string; DOMINIO: string }

async function login(c: Cred, forzar = false): Promise<string> {
  if (!forzar && tokenCache && tokenCache.exp > Date.now()) return tokenCache.token
  const res = await fetch(`${BUS}/usuarios/aplicacion/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: c.APP, clave: c.CLAVE, codDominio: c.DOMINIO }),
    signal: AbortSignal.timeout(10_000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`login ${res.status}: ${text.slice(0, 300)}`)
  const token = JSON.parse(text)?.token
  if (!token) throw new Error(`login sin token: ${text.slice(0, 300)}`)
  // El bus no informa vencimiento: se reusa como mucho 30 min y, ante un
  // 401/403, se pide otro y se reintenta una vez.
  tokenCache = { token, exp: Date.now() + 30 * 60 * 1000 }
  return token
}

async function consultarPadron(dni: string, gender: string | null | undefined, c: Cred) {
  // idSexo es obligatorio. No hay documentación de qué número es cada sexo y el
  // padrón devolvió lo mismo con los dos, así que se prueba el más probable y,
  // si vuelve vacío, el otro.
  const g = String(gender ?? '').toLowerCase()
  const orden = g.startsWith('f') ? ['1', '2'] : ['2', '1']

  for (const idSexo of orden) {
    let token = await login(c)
    const url = `${BUS}/personas/cobertura?nroDocumento=${dni}&idSexo=${idSexo}`
    const pedir = (t: string) => fetch(url, {
      headers: { token: t, codDominio: c.DOMINIO }, signal: AbortSignal.timeout(10_000),
    })
    let res = await pedir(token)
    if (res.status === 401 || res.status === 403) {
      token = await login(c, true)
      res = await pedir(token)
    }
    const text = await res.text()
    if (res.status === 404) continue
    if (!res.ok) throw new Error(`cobertura ${res.status}: ${text.slice(0, 300)}`)
    const data = JSON.parse(text)
    const lista = (Array.isArray(data) ? data : [])
      .filter((x: { rnos?: string; cobertura?: string }) => x?.rnos || x?.cobertura)
      .map((x: { rnos?: string; cobertura?: string }) => ({ rnos: String(x.rnos ?? ''), cobertura: String(x.cobertura ?? '').trim() }))
    if (lista.length) return lista
  }
  return []
}

// ── Catálogo de financiadores de recetas (el del ambiente) ───────────────────
async function traerCatalogo(): Promise<Financiador[]> {
  if (catalogoCache && catalogoCache.exp > Date.now()) return catalogoCache.items
  const URL_ = Deno.env.get('RCTA_API_URL'), KEY = Deno.env.get('RCTA_API_KEY'), APPID = Deno.env.get('RCTA_CLIENT_APP_ID')
  if (!URL_ || !KEY || !APPID) throw new Error('RCTA no configurado')
  const res = await fetch(`${URL_}/apirecipe/GetFinanciadores?clienteAppId=${APPID}`, {
    headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`GetFinanciadores ${res.status}`)
  const d = await res.json()
  const items: Financiador[] = (d?.financiadores ?? d ?? [])
    .map((f: { idfinanciador: number; nombreComercial: string }) => ({ id: f.idfinanciador, nombre: f.nombreComercial }))
  catalogoCache = { items, exp: Date.now() + 6 * 3600 * 1000 }
  return items
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}
