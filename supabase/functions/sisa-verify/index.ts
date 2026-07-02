// ── SISA Verify — Ministerio de Salud Argentina ────────────────────────────────
// Verifica matrícula de un profesional contra el padrón SISA (RNPdS).
//
// Requiere credenciales institucionales del Ministerio de Salud:
//   SISA_USER — usuario institucional
//   SISA_PASS — contraseña institucional
//
// Solicitar acceso: sisa@msal.gov.ar
//
// Request body:  { professionalId: string }
// On success: actualiza professional_profiles con sisa_status, sisa_matricula, sisa_raw
//             Si estado = "Habilitado" → is_verified = true
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SISA_ENDPOINT = 'https://sisa.msal.gov.ar/sisa/services/rest/profesional/obtener'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { professionalId } = await req.json()
    if (!professionalId) return json({ error: 'professionalId required' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── Check credentials ─────────────────────────────────────────────────────
    const SISA_USER = Deno.env.get('SISA_USER')
    const SISA_PASS = Deno.env.get('SISA_PASS')

    if (!SISA_USER || !SISA_PASS) {
      return json({
        error: 'SISA credentials not configured',
        code: 'SISA_NOT_CONFIGURED',
        instructions: 'Solicitar acceso institucional en sisa@msal.gov.ar y configurar SISA_USER + SISA_PASS en Supabase secrets.',
      }, 503)
    }

    // ── Load professional + DNI ───────────────────────────────────────────────
    const { data: prof, error: profErr } = await supabase
      .from('professional_profiles')
      .select(`
        id, specialty, license_type, license_number, is_verified,
        profile:profiles!user_id(id, full_name, email, dni)
      `)
      .eq('id', professionalId)
      .single()

    if (profErr || !prof) return json({ error: 'Professional not found' }, 404)

    const dni = prof.profile?.dni
    if (!dni) {
      return json({
        error: 'DNI not set for this professional',
        code: 'MISSING_DNI',
        instructions: 'Ingresá el DNI del profesional antes de consultar SISA.',
      }, 422)
    }

    // ── Call SISA API ─────────────────────────────────────────────────────────
    const url = new URL(SISA_ENDPOINT)
    url.searchParams.set('usuario', SISA_USER)
    url.searchParams.set('clave', SISA_PASS)
    url.searchParams.set('nrodoc', dni)

    let sisaData: any = null
    let sisaStatus: string = 'error'
    let sisaMatricula: string | null = null
    let isVerified = prof.is_verified

    const sisaRes = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
    })

    if (!sisaRes.ok) {
      console.error('SISA API error:', sisaRes.status, await sisaRes.text())
      await supabase
        .from('professional_profiles')
        .update({ sisa_status: 'error', sisa_raw: { httpStatus: sisaRes.status }, sisa_verified_at: new Date().toISOString() })
        .eq('id', professionalId)
      return json({ error: 'SISA API error', httpStatus: sisaRes.status }, 502)
    }

    sisaData = await sisaRes.json()

    // ── Parse SISA response ───────────────────────────────────────────────────
    // SISA returns a list of "profesionales" objects. We take the first match.
    // Known fields: nombre, apellido, nroDoc, estadoMatricula, especialidad,
    //               jurisdiccion, tipoMatricula, nroMatricula
    const profesionales = sisaData?.profesionales ?? sisaData?.resultado?.profesionales ?? []
    const match = Array.isArray(profesionales) ? profesionales[0] : null

    if (!match) {
      sisaStatus = 'not_found'
    } else {
      const estado = (match.estadoMatricula ?? match.estado ?? '').toLowerCase()
      sisaStatus = estado.includes('habilit') ? 'habilitada'
        : estado.includes('suspend') ? 'suspendida'
        : 'not_found'

      const tipoMat = match.tipoMatricula ?? match.tipo ?? ''
      const nroMat = match.nroMatricula ?? match.numero ?? ''
      sisaMatricula = [tipoMat, nroMat].filter(Boolean).join(' ') || null

      // Auto-approve if habilitada
      if (sisaStatus === 'habilitada') isVerified = true
    }

    // ── Persist result ────────────────────────────────────────────────────────
    const now = new Date().toISOString()
    await supabase
      .from('professional_profiles')
      .update({
        sisa_status:         sisaStatus,
        sisa_matricula:      sisaMatricula,
        sisa_raw:            sisaData,
        sisa_verified_at:    now,
        ...(isVerified && !prof.is_verified ? {
          is_verified:         true,
          verification_source: 'sisa',
          verified_at:         now,
        } : {}),
      })
      .eq('id', professionalId)

    return json({
      sisaStatus,
      sisaMatricula,
      isVerified,
      profesional: match ?? null,
    })

  } catch (err) {
    console.error('sisa-verify error:', err)
    return json({ error: 'Internal error', detail: String(err) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
