// ── RCTA Issue — Innovamed QBI2 "Receta" API ──────────────────────────────────
// Issues a digital prescription (receta electrónica) via POST /apirecipe/Receta.
// Requires institutional credentials: RCTA_API_URL + RCTA_API_KEY + RCTA_CLIENT_APP_ID
// Full API reference: website/docs/rcta-integration.md
// Apply for production access: https://innovamed.com.ar/rcta-institucional
// Pricing: ~$50.000 ARS/mes por médico (institucional)
//
// Request body:
//   medicationId  – UUID of clinical_medications record
//
// On success: updates clinical_medications.rcta_prescription_id + rcta_pdf_url + rcta_status + rcta_issued_at
// On error: sets rcta_status = 'error'
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { medicationId } = await req.json()
    if (!medicationId) return json({ error: 'medicationId required' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── Load medication + patient + professional ──────────────────────────────
    const { data: med, error: medErr } = await supabase
      .from('clinical_medications')
      .select(`
        *,
        patient:profiles!patient_id(id, full_name, dni, gender, birth_date, phone),
        professional:profiles!professional_id(
          id, full_name, dni, gender, birth_date, phone,
          professional_profiles!professional_profiles_user_id_fkey(specialty, license_type, license_number, address)
        )
      `)
      .eq('id', medicationId)
      .single()

    if (medErr || !med) return json({ error: 'Medication not found' }, 404)
    if (med.rcta_status === 'issued') return json({ error: 'Already issued' }, 409)

    // ── Mark as pending ───────────────────────────────────────────────────────
    await supabase
      .from('clinical_medications')
      .update({ rcta_status: 'pending' })
      .eq('id', medicationId)

    // ── Check credentials ─────────────────────────────────────────────────────
    const RCTA_API_URL = Deno.env.get('RCTA_API_URL')
    const RCTA_API_KEY = Deno.env.get('RCTA_API_KEY')
    const RCTA_CLIENT_APP_ID = Deno.env.get('RCTA_CLIENT_APP_ID')

    if (!RCTA_API_URL || !RCTA_API_KEY || !RCTA_CLIENT_APP_ID) {
      // Credentials not yet configured — return structured error so UI can show correct message
      await supabase
        .from('clinical_medications')
        .update({ rcta_status: 'error' })
        .eq('id', medicationId)

      return json({
        error: 'RCTA credentials not configured',
        code: 'RCTA_NOT_CONFIGURED',
        instructions: 'Solicitar acceso institucional en innovamed.com.ar/rcta-institucional y configurar RCTA_API_URL + RCTA_API_KEY + RCTA_CLIENT_APP_ID en Supabase secrets.',
      }, 503)
    }

    // ── Build QBI2 "Receta" request payload ───────────────────────────────────
    // Real contract: POST /apirecipe/Receta — see website/docs/rcta-integration.md
    const prof = med.professional?.professional_profiles ?? {}
    const { nombre: pacienteNombre, apellido: pacienteApellido } = splitName(med.patient?.full_name)
    const { nombre: medicoNombre, apellido: medicoApellido } = splitName(med.professional?.full_name)
    const nombreConsultorio = medicoApellido ? `Consultorio Dr. ${medicoApellido}` : null

    const payload = {
      clienteAppId: Number(RCTA_CLIENT_APP_ID),
      diagnostico: med.cie10_display ?? med.cie10_code ?? null,
      medicamentos: [{
        nombreProducto: med.medication_name,
        nombreDroga: med.medication_name,
        presentacion: [med.presentation, med.concentration].filter(Boolean).join(' ') || null,
        cantidad: parseInt(String(med.quantity ?? '').replace(/\D/g, ''), 10) || 1,
        permiteSustitucion: null,
        tratamiento: med.is_chronic ? 1 : 0,
        diagnostico: med.cie10_display ?? null,
        codigoDiagnostico: med.cie10_code ?? null,
        posologia: [med.dosage_text, med.frequency].filter(Boolean).join(' — ') || null,
        observaciones: med.notes ?? null,
      }],
      paciente: {
        nombre: pacienteNombre,
        apellido: pacienteApellido,
        tipoDoc: 'DNI',
        nroDoc: med.patient?.dni ?? '',
        sexo: mapSexo(med.patient?.gender),
        fechaNacimiento: med.patient?.birth_date ?? null,
        telefono: med.patient?.phone ?? null,
      },
      medico: {
        nombre: medicoNombre,
        apellido: medicoApellido,
        tipoDoc: 'DNI',
        nroDoc: med.professional?.dni ?? '',
        especialidad: prof.specialty ?? '',
        sexo: mapSexo(med.professional?.gender),
        fechaNacimiento: med.professional?.birth_date ?? null,
        telefono: med.professional?.phone ?? null,
        matricula: {
          tipo: med.professional_license_type ?? prof.license_type ?? 'MN',
          numero: med.professional_license_number ?? prof.license_number ?? '',
          especialidad: prof.specialty ?? '',
        },
        lugarAtencion: prof.address ?? null,
      },
      indicaciones: med.notes ?? null,
      // QBI248 ("DEBE INFORMAR EL DOMICILIO DONDE SE REALIZÓ LA ATENCIÓN") requires the
      // consultation address — sent on every plausible field since Innovamed's swagger
      // doesn't document which one is actually checked.
      direccionConsultorio: prof.address ?? null,
      nombreConsultorio: nombreConsultorio,
      lugarAtencion: prof.address ? {
        nombreConsultorio,
        domicilio: { ...parseAddress(prof.address), direccion: prof.address },
      } : undefined,
    }

    // ── Call QBI2 API ─────────────────────────────────────────────────────────
    const rctaRes = await fetch(`${RCTA_API_URL}/apirecipe/Receta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RCTA_API_KEY}`,
      },
      body: JSON.stringify(payload),
    })

    if (!rctaRes.ok) {
      const errBody = await rctaRes.text()
      console.error('RCTA API error:', rctaRes.status, errBody)
      await supabase
        .from('clinical_medications')
        .update({ rcta_status: 'error' })
        .eq('id', medicationId)
      return json({ error: 'RCTA API error', status: rctaRes.status, detail: errBody }, 502)
    }

    const rctaData = await rctaRes.json()
    // RecetaPdfResponse: { recetas: [{ idReceta, s3Link, fecha, verificador }], errores: [...] }
    if (rctaData.errores?.length) {
      console.error('RCTA API returned errores:', rctaData.errores)
      await supabase
        .from('clinical_medications')
        .update({ rcta_status: 'error' })
        .eq('id', medicationId)
      return json({ error: 'RCTA API error', detail: rctaData.errores }, 502)
    }

    const receta = rctaData.recetas?.[0]
    if (!receta) {
      await supabase
        .from('clinical_medications')
        .update({ rcta_status: 'error' })
        .eq('id', medicationId)
      return json({ error: 'RCTA API returned no receta', detail: rctaData }, 502)
    }

    const prescriptionId = receta.idReceta ?? receta.id
    const pdfUrl = receta.s3Link ?? null
    const issuedAt = receta.fecha ?? new Date().toISOString()

    // ── Persist result ────────────────────────────────────────────────────────
    await supabase
      .from('clinical_medications')
      .update({
        rcta_prescription_id: prescriptionId,
        rcta_pdf_url:         pdfUrl,
        rcta_status:          'issued',
        rcta_issued_at:       issuedAt,
      })
      .eq('id', medicationId)

    return json({ prescriptionId, pdfUrl, issuedAt })

  } catch (err) {
    console.error('rcta-issue error:', err)
    return json({ error: 'Internal error', detail: String(err) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// RCTA wants separate nombre/apellido — Healthier only stores full_name.
// Best-effort split: last word = apellido, everything before it = nombre.
function splitName(fullName: string | null | undefined) {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { nombre: '', apellido: '' }
  if (parts.length === 1) return { nombre: parts[0], apellido: '' }
  return { nombre: parts.slice(0, -1).join(' '), apellido: parts[parts.length - 1] }
}

// profiles.gender uses Spanish values; RCTA wants F/M/X.
function mapSexo(gender: string | null | undefined): 'F' | 'M' | 'X' {
  if (gender === 'femenino') return 'F'
  if (gender === 'masculino') return 'M'
  return 'X'
}

// professional_profiles.address is one free-text string (e.g. "Av. Santa Fe 1900, Recoleta, Buenos Aires").
// RCTA's DomicilioDto wants calle/numero/localidad/provincia split out — best-effort parse.
function parseAddress(address: string) {
  const [streetPart, localidad, provincia] = address.split(',').map(s => s.trim())
  const match = streetPart?.match(/^(.*\S)\s+(\d+)$/)
  return {
    calle: match ? match[1] : streetPart ?? null,
    numero: match ? match[2] : null,
    localidad: localidad ?? null,
    provincia: provincia ?? null,
    pais: 'Argentina',
  }
}
