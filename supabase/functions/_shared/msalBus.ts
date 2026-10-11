// ── Cliente del bus FHIR del Ministerio de Salud (bus.msal.gob.ar) ────────────
// Credencial 3383 del sistema 5202 (Plataforma de Interoperabilidad). Lo usan
// `federador-paciente` (Patient) y `refes-consultorio` (Location/Organization).
// `sisa-verify` (REFEPS, Practitioner) tiene una copia propia de este código de
// antes de que existiera este módulo: se puede pasar a usar éste sin cambios
// (`busFhir('Practitioner/*.read', '/fhir/Practitioner?…')`).
//
// Secrets: MSAL_FHIR_ISSUER (https://healthier.com.ar, sin barra) y
//          MSAL_FHIR_SECRET. Opcional MSAL_BUS_URL (default el de producción;
//          el de QA, bus-test.msal.gob.ar, estaba caído el 2026-10-11).
//
// Lo que se aprendió probando (2026-10-11):
//   - Un token por scope. "Patient/*.read Patient/*.write" (o con coma) da
//     401 InvalidScope. Por eso el caché es por scope.
//   - Cada assertion sirve UNA vez (ClientAssertionAlreadyUsed): jti propio.
//   - "No Mapping Rule matched" (404, texto plano) = el gateway no tiene ruta
//     para ese path con esta credencial. No es "no encontrado": es BusSinRuta.
//   - El Federador vive en /masterfile-federacion-service/fhir/Patient, no en
//     /fhir/Patient como dice la guía.
// ─────────────────────────────────────────────────────────────────────────────

export const BUS_DEFAULT = 'https://bus.msal.gob.ar'

export class BusError extends Error {
  constructor(public code: string, message: string, public httpStatus?: number, public detail?: unknown) {
    super(message)
  }
}

type Cred = { issuer: string; secret: string; base: string }

const caches = new Map<string, { token: string; exp: number }>()

export function credencialBus(): Cred | null {
  const issuer = Deno.env.get('MSAL_FHIR_ISSUER')
  const secret = Deno.env.get('MSAL_FHIR_SECRET')
  if (!issuer || !secret) return null
  return { issuer, secret, base: (Deno.env.get('MSAL_BUS_URL') || BUS_DEFAULT).replace(/\/$/, '') }
}

/**
 * Llama al bus con un token del scope pedido. Reintenta una vez ante 401/403
 * (token vencido). Devuelve { status, body, headers }; no tira por status HTTP
 * (cada servicio decide qué es "no encontrado"), salvo:
 *   - BUS_AUTH_FAILED   el bus rechazó la credencial
 *   - BUS_SIN_RUTA      "No Mapping Rule matched"
 *   - BUS_RED           no hubo respuesta (timeout, DNS, caído)
 */
export async function busFhir(
  cred: Cred,
  scope: string,
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
) {
  const url = `${cred.base}${path}`
  const hacer = async () => {
    const headers: Record<string, string> = {
      Accept: 'application/fhir+json',
      Authorization: `Bearer ${await accessToken(cred, scope)}`,
    }
    if (init.body !== undefined) headers['Content-Type'] = 'application/fhir+json'
    return await fetchConTimeout(url, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    }, init.timeoutMs ?? 20_000)
  }

  let res = await hacer()
  if (res.status === 401 || res.status === 403) {
    caches.delete(scope)
    res = await hacer()
  }
  const text = await res.text()
  let body: any = null
  try { body = JSON.parse(text) } catch { /* a veces texto plano */ }

  if (res.status === 404 && /No Mapping Rule matched/i.test(text)) {
    throw new BusError('BUS_SIN_RUTA', `El bus no tiene habilitado ${path.split('?')[0]} para esta credencial`, 404, text.slice(0, 200))
  }
  return { status: res.status, body, text, headers: res.headers }
}

/** Texto de los OperationOutcome, para loguear el error real. */
export function diagnostico(r: { body: any; text: string }) {
  return r.body?.issue?.map((i: any) => i.diagnostics).filter(Boolean).join(' · ') || r.text.slice(0, 300)
}

async function fetchConTimeout(url: string, init: RequestInit, ms: number) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (e) {
    throw new BusError('BUS_RED', `Sin respuesta del bus (${e instanceof Error ? e.message : e})`)
  } finally {
    clearTimeout(t)
  }
}

async function accessToken(cred: Cred, scope: string) {
  const c = caches.get(scope)
  if (c && c.exp > Date.now() + 30_000) return c.token

  const now = Math.floor(Date.now() / 1000)
  const assertion = await firmarJwt({
    iss: cred.issuer, iat: now, exp: now + 300, jti: crypto.randomUUID(),
    aud: 'aud', sub: 'sub', name: 'name', ident: 'ident', role: 'role',
  }, cred.secret)

  const res = await fetchConTimeout(`${cred.base}/bus-auth/v2/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'client_credentials',
      scope,
      clientAssertionType: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      clientAssertion: assertion,
    }),
  }, 15_000)
  const text = await res.text()
  let body: any = null
  try { body = JSON.parse(text) } catch { /* noop */ }
  if (!res.ok || !body?.accessToken) {
    throw new BusError('BUS_AUTH_FAILED', `El bus rechazó la credencial para ${scope} (${res.status}): ${body?.message ?? body?.name ?? text.slice(0, 200)}`, res.status, body ?? text.slice(0, 300))
  }
  // `expiresIn` viene sin unidad documentada: se usa como mucho 30 min.
  const segundos = Math.min(Number(body.expiresIn) || 300, 1800)
  caches.set(scope, { token: body.accessToken, exp: Date.now() + segundos * 1000 })
  return body.accessToken as string
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

// ── Quién llama ───────────────────────────────────────────────────────────────
// Las dos funciones las llama la base (pg_net con la service key) o el super
// admin desde su panel ("Reintentar" / "Aprobar"). Nadie más.
export async function quienLlama(db: any, req: Request): Promise<{ tipo: 'servicio' } | { tipo: 'admin'; userId: string } | null> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  if (jwt === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return { tipo: 'servicio' }
  // verify_jwt ya validó la firma: alcanza con leer el rol.
  try {
    const claims = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (claims.role === 'service_role') return { tipo: 'servicio' }
  } catch { /* no es un JWT */ }
  const { data: { user } } = await db.auth.getUser(jwt)
  if (!user) return null
  const { data: p } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle()
  return p && ['admin', 'super_admin'].includes(p.role) ? { tipo: 'admin', userId: user.id } : null
}

/** Backoff de los reintentos: 15 min, 30, 1 h, 2 h… tope 8 intentos. */
export const MAX_INTENTOS = 8
export function proximoIntento(intentos: number) {
  return new Date(Date.now() + 15 * 60_000 * 2 ** Math.max(0, intentos - 1)).toISOString()
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
