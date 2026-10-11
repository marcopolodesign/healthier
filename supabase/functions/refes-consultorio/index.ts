// ── Consultorio del profesional → REFES (Registro Federal de Establecimientos) ─
// Cuando el profesional carga o cambia la dirección del consultorio, se busca
// el establecimiento en REFES por el bus del Ministerio (Location/*.read). Si
// matchea uno solo, queda `verificado` y el paciente ve "Consultorio
// habilitado". Si no, queda `revisar` y lo decide el super admin en
// /super-admin/consultorios. Nunca bloquea nada. Migración 196.
//
// Request (sólo service role o admin/super admin):
//   { professionalId }              — una ficha (trigger, "Reintentar")
//   { lote: n }                     — pendientes/errores vencidos (cron)
//   { professionalId, decision: 'aprobar' | 'rechazar', nota? } — super admin
//
// 🔴 Estado al 2026-10-11: el bus autoriza el scope Location/*.read pero
// responde "No Mapping Rule matched" en /fhir/Location y /fhir/Organization:
// la credencial 3383 todavía no tiene la ruta de REFES habilitada en el
// gateway. Mientras tanto todo cae en `revisar` con REFES_SIN_ACCESO y el super
// admin decide a mano. Cuando se habilite, "Reintentar" (o el backfill) los
// vuelve a pasar por la búsqueda automática.
//
// Cómo busca (guía técnica Location REFES, OCT-2025): REFES no busca por calle,
// sólo por name / address-city / address-state / address-postalcode. Se busca
// por código postal (y provincia si se reconoce) y se compara calle + altura
// contra address.line de cada resultado.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  busFhir, BusError, credencialBus, diagnostico, quienLlama, proximoIntento,
  MAX_INTENTOS, CORS, json,
} from '../_shared/msalBus.ts'

const SYS_REFES = 'https://sisa.msal.gov.ar/REFES'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const quien = await quienLlama(db, req)
  if (!quien) return json({ error: 'Sólo Healthier puede verificar consultorios' }, 403)

  let body: { professionalId?: string; lote?: number; decision?: string; nota?: string } = {}
  try { body = await req.json() } catch { /* vacío */ }

  // ── Decisión manual del super admin ─────────────────────────────────────────
  if (body.decision) {
    if (quien.tipo !== 'admin' || !body.professionalId) return json({ error: 'Sólo el super admin decide' }, 403)
    if (!['aprobar', 'rechazar'].includes(body.decision)) return json({ error: 'decision inválida' }, 400)
    const ahora = new Date().toISOString()
    const { error } = await db.from('professional_profiles').update({
      refes_estado: body.decision === 'aprobar' ? 'aprobado_manual' : 'rechazado_manual',
      refes_revisado_por: quien.userId,
      refes_revisado_at: ahora,
      refes_actualizado_at: ahora,
      refes_proximo_intento: null,
      refes_error: body.nota ? String(body.nota).slice(0, 300) : null,
    }).eq('id', body.professionalId)
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  }

  const cred = credencialBus()
  let ids: string[] = []
  if (body.professionalId) ids = [body.professionalId]
  else {
    const n = Math.min(Math.max(Number(body.lote) || 10, 1), 30)
    const { data } = await db.from('professional_profiles').select('id')
      .in('refes_estado', ['pendiente', 'error'])
      .lt('refes_intentos', MAX_INTENTOS)
      .or(`refes_proximo_intento.is.null,refes_proximo_intento.lte.${new Date().toISOString()}`)
      .order('refes_proximo_intento', { ascending: true, nullsFirst: true })
      .limit(n)
    ids = (data ?? []).map((r: { id: string }) => r.id)
  }

  const resultados = []
  for (const [i, id] of ids.entries()) {
    if (i > 0) await new Promise(r => setTimeout(r, 400))
    resultados.push(await procesar(db, id, cred))
  }
  return json({ procesados: resultados.length, resultados })
})

async function procesar(db: any, id: string, cred: ReturnType<typeof credencialBus>) {
  const { data: pp } = await db.from('professional_profiles')
    .select('id, address, refes_intentos').eq('id', id).maybeSingle()
  if (!pp) return { id, estado: 'no_existe' }

  const guardar = (campos: Record<string, unknown>) =>
    db.from('professional_profiles').update({ refes_actualizado_at: new Date().toISOString(), ...campos }).eq('id', id)
      .then(({ error }: { error: any }) => { if (error) console.error('refes: guardar', id, error.message) })

  const dir = parsearDireccion(pp.address ?? '')
  if (!dir) {
    await guardar({ refes_estado: null, refes_proximo_intento: null })
    return { id, estado: null }
  }

  try {
    if (!cred) throw new BusError('BUS_NO_CONFIGURADO', 'Faltan MSAL_FHIR_ISSUER / MSAL_FHIR_SECRET')
    if (!dir.cp) {
      await guardar({
        refes_estado: 'revisar', refes_proximo_intento: null, refes_intentos: 0,
        refes_error: 'La dirección no tiene código postal: no se puede buscar en REFES',
        refes_raw: { direccion: dir, candidatos: [] },
      })
      return { id, estado: 'revisar', motivo: 'sin_cp' }
    }

    const q = new URLSearchParams({ 'address-postalcode': dir.cp })
    if (dir.provincia) q.set('address-state', dir.provincia)
    const r = await busFhir(cred, 'Location/*.read', `/fhir/Location?${q}`)
    if (r.status === 404 && /no se encuentra/i.test(diagnostico(r))) r.body = { resourceType: 'Bundle', entry: [] }
    else if (r.status !== 200 || r.body?.resourceType !== 'Bundle') {
      throw new BusError('REFES_BUSQUEDA', `REFES respondió ${r.status}: ${diagnostico(r)}`, r.status)
    }

    const locs = (r.body.entry ?? []).map((e: any) => e.resource).filter((l: any) => l?.resourceType === 'Location')
    const candidatos = locs.filter((l: any) => coincide(l, dir)).map(resumen)
    const raw = { direccion: dir, buscados: locs.length, candidatos: candidatos.slice(0, 10), consultado_at: new Date().toISOString() }

    if (candidatos.length === 1) {
      await guardar({
        refes_estado: 'verificado', refes_id: candidatos[0].refesId, refes_nombre: candidatos[0].nombre,
        refes_raw: raw, refes_error: null, refes_proximo_intento: null, refes_intentos: 0,
      })
      return { id, estado: 'verificado', refesId: candidatos[0].refesId }
    }
    await guardar({
      refes_estado: 'revisar', refes_raw: raw, refes_proximo_intento: null, refes_intentos: 0,
      refes_error: candidatos.length ? `Coinciden ${candidatos.length} establecimientos` : 'Ningún establecimiento de REFES en esa dirección',
    })
    return { id, estado: 'revisar', candidatos: candidatos.length }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const code = e instanceof BusError ? e.code : 'ERROR'
    console.error('refes', id, code, msg)
    // Sin ruta habilitada no tiene sentido reintentar cada 15 min: va directo a
    // revisión del super admin.
    if (code === 'BUS_SIN_RUTA') {
      await guardar({
        refes_estado: 'revisar', refes_proximo_intento: null, refes_intentos: 0,
        refes_error: 'REFES_SIN_ACCESO: el bus todavía no tiene habilitada la búsqueda de establecimientos para nuestra credencial',
        refes_raw: { direccion: dir },
      })
      return { id, estado: 'revisar', code }
    }
    const intentos = (pp.refes_intentos ?? 0) + 1
    await guardar({
      refes_estado: intentos >= MAX_INTENTOS ? 'revisar' : 'error',
      refes_intentos: intentos,
      refes_error: `${code}: ${msg}`.slice(0, 500),
      refes_proximo_intento: intentos >= MAX_INTENTOS ? null : proximoIntento(intentos),
    })
    return { id, estado: 'error', code, error: msg }
  }
}

// ── Dirección ─────────────────────────────────────────────────────────────────
// Llegan dos formatos: el que escribe el profesional ("Av. Santa Fe 1234,
// Recoleta, CABA") y el de Nominatim ("1900, Avenida Santa Fe, Barrio Norte,
// Recoleta, …, C1123AAN, Argentina").
type Dir = { calle: string; altura: string | null; cp: string | null; provincia: string | null; original: string }

export function parsearDireccion(s: string): Dir | null {
  const original = s.trim()
  if (!original) return null
  const partes = original.split(',').map(x => x.trim()).filter(Boolean)
  const cp = original.match(/\b[A-Z]?(\d{4})[A-Z]{0,3}\b/)?.[1] ?? null
  const caba = /\b(caba|c\.a\.b\.a|capital federal|ciudad aut[oó]noma de buenos aires)\b/i.test(original)
  const provincia = caba ? 'Ciudad Autónoma de Buenos Aires' : null

  let calle = '', altura: string | null = null
  if (/^\d+$/.test(partes[0] ?? '') && partes[1]) { altura = partes[0]; calle = partes[1] }
  else {
    const m = (partes[0] ?? '').match(/^(.*?)\s+(\d{1,5})\b/)
    if (m) { calle = m[1]; altura = m[2] } else calle = partes[0] ?? ''
  }
  return { calle, altura, cp, provincia, original }
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\b(av|avda|avenida|calle|pje|pasaje|bv|boulevard|bulevar|gral|general|dr|doctor)\b\.?/g, ' ')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

function coincide(l: any, d: Dir) {
  const calle = norm(d.calle)
  if (!calle) return false
  const lineas = [...(l.address?.line ?? []), l.address?.text ?? ''].map((x: string) => norm(String(x))).join(' ')
  if (!lineas.includes(calle)) return false
  return d.altura ? new RegExp(`\\b${d.altura}\\b`).test(lineas) : true
}

function resumen(l: any) {
  const refesId = l.identifier?.find((i: any) => i.system === SYS_REFES)?.value ?? l.id ?? null
  return {
    refesId,
    nombre: l.name ?? l.managingOrganization?.display ?? null,
    direccion: [...(l.address?.line ?? []), l.address?.city, l.address?.state].filter(Boolean).join(', '),
  }
}
