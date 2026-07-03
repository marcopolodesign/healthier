// ── RCTA Issue — Innovamed QBI2 API scaffold ──────────────────────────────────
// Issues a digital prescription (receta electrónica) via the Innovamed QBI2 API.
// Requires institutional credentials: RCTA_API_URL + RCTA_API_KEY
// Apply for access: https://innovamed.com.ar/rcta-institucional
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
        patient:profiles!patient_id(id, full_name, dni, date_of_birth, phone),
        professional:profiles!professional_id(
          id, full_name,
          professional_profiles(specialty, license_type, license_number)
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

    if (!RCTA_API_URL || !RCTA_API_KEY) {
      // Credentials not yet configured — return structured error so UI can show correct message
      await supabase
        .from('clinical_medications')
        .update({ rcta_status: 'error' })
        .eq('id', medicationId)

      return json({
        error: 'RCTA credentials not configured',
        code: 'RCTA_NOT_CONFIGURED',
        instructions: 'Solicitar acceso institucional en innovamed.com.ar/rcta-institucional y configurar RCTA_API_URL + RCTA_API_KEY en Supabase secrets.',
      }, 503)
    }

    // ── Build QBI2 request payload ────────────────────────────────────────────
    // QBI2 API shape (based on RCTA institutional integration docs)
    // Adjust field names once official docs received from Innovamed
    const prof = med.professional?.professional_profiles?.[0] ?? {}
    const payload = {
      prescriber: {
        name:           med.professional?.full_name ?? '',
        licenseType:    med.professional_license_type ?? prof.license_type ?? 'MN',
        licenseNumber:  med.professional_license_number ?? prof.license_number ?? '',
        specialty:      prof.specialty ?? '',
      },
      patient: {
        name:        med.patient?.full_name ?? '',
        dni:         med.patient?.dni ?? '',
        dateOfBirth: med.patient?.date_of_birth ?? null,
        phone:       med.patient?.phone ?? null,
      },
      medication: {
        name:           med.medication_name,
        snomedCode:     med.snomed_code ?? null,
        presentation:   med.presentation ?? null,
        concentration:  med.concentration ?? null,
        route:          med.route ?? null,
        frequency:      med.frequency ?? null,
        durationDays:   med.duration_days ?? null,
        quantity:       med.quantity ?? null,
        isChronic:      med.is_chronic ?? false,
        instructions:   med.notes ?? null,
      },
      diagnosis: {
        cie10Code:    med.cie10_code ?? null,
        cie10Display: med.cie10_display ?? null,
      },
      priority: med.priority ?? 'routine',
    }

    // ── Call QBI2 API ─────────────────────────────────────────────────────────
    const rctaRes = await fetch(`${RCTA_API_URL}/prescriptions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RCTA_API_KEY}`,
        'X-Institution-Id': Deno.env.get('RCTA_INSTITUTION_ID') ?? '',
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
    // QBI2 returns: { prescriptionId, pdfUrl, issuedAt }
    // Adjust field names once docs received
    const prescriptionId = rctaData.prescriptionId ?? rctaData.id ?? rctaData.rcta_id
    const pdfUrl         = rctaData.pdfUrl ?? rctaData.pdf_url ?? rctaData.url
    const issuedAt       = rctaData.issuedAt ?? rctaData.issued_at ?? new Date().toISOString()

    // ── Persist result ────────────────────────────────────────────────────────
    await supabase
      .from('clinical_medications')
      .update({
        rcta_prescription_id: prescriptionId,
        rcta_pdf_url:         pdfUrl ?? null,
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
