// ── Verificación de matrícula — REFEPS por el bus FHIR del Ministerio de Salud ──
// Consulta el Registro Federal de Profesionales de la Salud (REFEPS) a través de
// la Plataforma de Interoperabilidad (bus.msal.gob.ar), credencial 3383 del
// sistema 5202. Reemplaza al web service viejo de SISA (usuario/clave), que
// nunca llegó a tener credenciales.
//
// Secrets: MSAL_FHIR_ISSUER (https://healthier.com.ar, sin barra) y
//          MSAL_FHIR_SECRET (el secret de la credencial).
//
// Cómo se busca (probado contra el bus el 2026-10-08):
//   - Auth: JWT HS256 firmado con el secret → POST /bus-auth/v2/auth → accessToken.
//     🔴 Cada assertion sirve UNA vez (ClientAssertionAlreadyUsed): por eso el
//     token se cachea y cada assertion lleva jti/iat propios.
//   - Practitioner sólo acepta `identifier`, y sólo con los sistemas REFEPS
//     (`https://sisa.msal.gov.ar/REFEPS|<código>`) o CUIL. Por DNI da error.
//     El código REFEPS es "5410" + DNI a 8 dígitos (anduvo con todos los
//     profesionales de prueba, incluido un DNI de extranjero).
//   - Cada `qualification` es una matrícula: número en identifier.value,
//     jurisdicción y habilitación en las extensiones.
//
// Request body:  { professionalId: string }   — sólo admin / super_admin.
// Persiste sisa_status / sisa_matricula / sisa_raw. Si la matrícula declarada
// figura habilitada, marca is_verified (verification_source = 'sisa').
// Ante una falla del bus NO pisa el último resultado: devuelve el error real.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BUS = 'https://bus.msal.gob.ar'
const SYS_REFEPS = 'https://sisa.msal.gov.ar/REFEPS'
const EXT = 'http://fhir.msal.gob.ar/StructureDefinition/'
const FUENTE = 'REFEPS — bus FHIR del Ministerio de Salud (automática)'

// Token cacheado mientras la instancia siga viva. `expiresIn` viene sin unidad
// documentada (180000), así que se usa como mucho 30 min y, ante un 401, se
// pide otro y se reintenta una vez.
let cache: { token: string; exp: number } | null = null

class RefepsError extends Error {
  constructor(public code: string, message: string, public httpStatus?: number, public detail?: unknown) {
    super(message)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { professionalId } = await req.json()
    if (!professionalId) return json({ error: 'professionalId required' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── Sólo la administración puede verificar ────────────────────────────────
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: { user } } = await supabase.auth.getUser(jwt)
    if (!user) return json({ error: 'No autenticado' }, 401)
    const { data: caller } = await supabase.from('profiles').select('role, email').eq('id', user.id).single()
    if (!caller || !['admin', 'super_admin'].includes(caller.role)) {
      return json({ error: 'Sólo la administración puede verificar matrículas' }, 403)
    }

    const ISSUER = Deno.env.get('MSAL_FHIR_ISSUER')
    const SECRET = Deno.env.get('MSAL_FHIR_SECRET')
    if (!ISSUER || !SECRET) {
      return json({
        error: 'Credencial del bus FHIR no configurada',
        code: 'REFEPS_NOT_CONFIGURED',
        instructions: 'Cargar MSAL_FHIR_ISSUER y MSAL_FHIR_SECRET en los secrets de Supabase.',
      }, 503)
    }

    // ── Profesional + DNI ─────────────────────────────────────────────────────
    const { data: prof, error: profErr } = await supabase
      .from('professional_profiles')
      .select(`
        id, specialty, license_type, license_number, is_verified,
        profile:profiles!user_id(id, full_name, email, dni)
      `)
      .eq('id', professionalId)
      .single()

    if (profErr || !prof) return json({ error: 'Professional not found' }, 404)

    const perfil: any = prof.profile
    const dni = String(perfil?.dni ?? '').replace(/\D/g, '')
    if (dni.length < 7 || dni.length > 8) {
      return json({
        error: dni ? `DNI inválido (${perfil?.dni})` : 'DNI not set for this professional',
        code: 'MISSING_DNI',
        instructions: 'Cargá el DNI del profesional antes de consultar REFEPS.',
      }, 422)
    }

    // ── Consulta a REFEPS ─────────────────────────────────────────────────────
    const codigo = `5410${dni.padStart(8, '0')}`
    let practitioner: any
    try {
      practitioner = await buscarPractitioner(codigo, ISSUER, SECRET)
    } catch (e) {
      if (!(e instanceof RefepsError)) throw e
      console.error('REFEPS', e.code, e.httpStatus, JSON.stringify(e.detail))
      return json({ error: e.message, code: e.code, httpStatus: e.httpStatus, detail: e.detail }, 502)
    }

    const now = new Date().toISOString()
    const declarada = normalizarMatricula(prof.license_number)
    const matriculas = practitioner ? leerMatriculas(practitioner) : []
    const coincide = declarada ? matriculas.find(m => normalizarMatricula(m.matricula) === declarada) : undefined

    let sisaStatus: 'habilitada' | 'suspendida' | 'not_found' | 'no_coincide'
    if (!practitioner) sisaStatus = 'not_found'
    else if (!coincide) sisaStatus = 'no_coincide'
    else sisaStatus = coincide.habilitada && practitioner.active !== false ? 'habilitada' : 'suspendida'

    const sisaMatricula = coincide
      ? `${coincide.matricula}${coincide.jurisdiccion ? ` (${coincide.jurisdiccion})` : ''}`
      : null

    const sisaRaw = {
      fuente: FUENTE,
      consultado_por: caller.email ?? user.id,
      consultado_at: now,
      codigo_profesional: codigo,
      dni,
      matricula_declarada: prof.license_number ?? null,
      encontrado: !!practitioner,
      ...(practitioner ? {
        nombre: practitioner.name?.[0]?.text ?? null,
        cuil: identificador(practitioner, 'cuil'),
        activo: practitioner.active !== false,
        matriculas,
        practitioner,
      } : {}),
    }

    const marcarVerificado = sisaStatus === 'habilitada' && !prof.is_verified
    const { error: updErr } = await supabase
      .from('professional_profiles')
      .update({
        sisa_status:      sisaStatus,
        sisa_matricula:   sisaMatricula,
        sisa_raw:         sisaRaw,
        sisa_verified_at: now,
        ...(marcarVerificado ? {
          is_verified:         true,
          verification_source: 'sisa',
          verified_at:         now,
          verified_by:         user.id,
        } : {}),
      })
      .eq('id', professionalId)
    if (updErr) {
      console.error('sisa-verify update', updErr)
      return json({ error: `No se pudo guardar el resultado: ${updErr.message}`, code: 'DB_UPDATE_FAILED' }, 500)
    }

    return json({
      sisaStatus,
      sisaMatricula,
      isVerified: prof.is_verified || marcarVerificado,
      nombre: sisaRaw.nombre ?? null,
      matriculas,
    })

  } catch (err) {
    console.error('sisa-verify error:', err)
    return json({ error: 'Internal error', detail: String(err) }, 500)
  }
})

// ── Bus FHIR ──────────────────────────────────────────────────────────────────

async function buscarPractitioner(codigo: string, issuer: string, secret: string) {
  const url = `${BUS}/fhir/Practitioner?identifier=${encodeURIComponent(`${SYS_REFEPS}|${codigo}`)}`
  let res = await fetch(url, { headers: await headers(issuer, secret) })
  if (res.status === 401 || res.status === 403) {
    cache = null
    res = await fetch(url, { headers: await headers(issuer, secret) })
  }
  const text = await res.text()
  let body: any = null
  try { body = JSON.parse(text) } catch { /* el bus a veces responde texto plano */ }

  // "Recurso del tipo Practitioner con el código X no se encuentra." → no está en REFEPS.
  const diag = body?.issue?.map((i: any) => i.diagnostics).filter(Boolean).join(' · ') || text.slice(0, 300)
  if (res.status === 404 && /no se encuentra/i.test(diag)) return null
  if (!res.ok) throw new RefepsError('REFEPS_SEARCH_FAILED', `REFEPS respondió ${res.status}: ${diag}`, res.status, body ?? text.slice(0, 500))
  if (body?.resourceType !== 'Bundle') throw new RefepsError('REFEPS_SEARCH_FAILED', 'Respuesta inesperada de REFEPS', res.status, text.slice(0, 500))
  return body.entry?.[0]?.resource ?? null
}

async function headers(issuer: string, secret: string) {
  return {
    Accept: 'application/fhir+json',
    Authorization: `Bearer ${await accessToken(issuer, secret)}`,
  }
}

async function accessToken(issuer: string, secret: string) {
  if (cache && cache.exp > Date.now() + 30_000) return cache.token

  const now = Math.floor(Date.now() / 1000)
  const assertion = await firmarJwt({
    iss: issuer, iat: now, exp: now + 300, jti: crypto.randomUUID(),
    aud: 'aud', sub: 'sub', name: 'name', ident: 'ident', role: 'role',
  }, secret)

  const res = await fetch(`${BUS}/bus-auth/v2/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'client_credentials',
      scope: 'Practitioner/*.read',
      clientAssertionType: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      clientAssertion: assertion,
    }),
  })
  const text = await res.text()
  let body: any = null
  try { body = JSON.parse(text) } catch { /* noop */ }
  if (!res.ok || !body?.accessToken) {
    throw new RefepsError('REFEPS_AUTH_FAILED', `El bus rechazó la credencial (${res.status}): ${body?.message ?? body?.name ?? body?.error ?? text.slice(0, 200)}`, res.status, body ?? text.slice(0, 500))
  }
  const segundos = Math.min(Number(body.expiresIn) || 300, 1800)
  cache = { token: body.accessToken, exp: Date.now() + segundos * 1000 }
  return cache.token
}

async function firmarJwt(payload: Record<string, unknown>, secret: string) {
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)))
  const data = `${enc({ typ: 'JWT', alg: 'HS256' })}.${enc(payload)}`
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return `${data}.${b64url(new Uint8Array(sig))}`
}

function b64url(bytes: Uint8Array) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ── Lectura del Practitioner ──────────────────────────────────────────────────

type Matricula = {
  profesion: string | null; matricula: string | null; jurisdiccion: string | null
  habilitada: boolean; desde: string | null; emisor: string | null
}

function leerMatriculas(p: any): Matricula[] {
  return (p.qualification ?? []).map((q: any) => {
    const ext = (name: string) => q.extension?.find((e: any) => e.url === EXT + name)
    return {
      profesion:    q.code?.coding?.[0]?.display ?? q.code?.text ?? null,
      matricula:    q.identifier?.[0]?.value ?? null,
      jurisdiccion: ext('JurisdMatricula')?.valueCoding?.display ?? null,
      habilitada:   ext('MatriculaHabilitada')?.valueBoolean === true,
      desde:        q.period?.start ?? null,
      emisor:       q.issuer?.display ?? null,
    }
  })
}

function identificador(p: any, sufijo: string) {
  return p.identifier?.find((i: any) => i.system?.endsWith(sufijo))?.value ?? null
}

// "MN - 82854", "082854", "MP 14.613" → "82854" / "14613"
function normalizarMatricula(v: unknown) {
  const d = String(v ?? '').replace(/\D/g, '').replace(/^0+/, '')
  return d || null
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
