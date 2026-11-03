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
// La consulta y el criterio de coincidencia viven en `_shared/refeps.ts`, el
// mismo código que usa el chequeo de "completó su DNI" (`dni-completado`).
import { RefepsError, buscarPractitioner, codigoRefeps, evaluarRefeps } from '../_shared/refeps.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FUENTE = 'REFEPS — bus FHIR del Ministerio de Salud (automática)'

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
    const codigo = codigoRefeps(dni)
    let practitioner: any
    try {
      practitioner = await buscarPractitioner(codigo)
    } catch (e) {
      if (!(e instanceof RefepsError)) throw e
      console.error('REFEPS', e.code, e.httpStatus, JSON.stringify(e.detail))
      return json({ error: e.message, code: e.code, httpStatus: e.httpStatus, detail: e.detail }, 502)
    }

    const now = new Date().toISOString()
    const { estado: sisaStatus, matriculas, coincide } = evaluarRefeps(practitioner, prof.license_number)

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
          // Verificado y no activo = invisible para los pacientes (search, mapa,
          // reserva). `approve()` manual pone los dos; acá faltaba y los 13
          // verificados por REFEPS entre el 16 y el 22/10 no se podían reservar.
          is_active:           true,
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

function identificador(p: any, sufijo: string) {
  return p.identifier?.find((i: any) => i.system?.endsWith(sufijo))?.value ?? null
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
