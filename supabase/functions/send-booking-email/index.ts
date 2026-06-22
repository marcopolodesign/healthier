/**
 * send-booking-email — Transactional email for new consultation bookings.
 *
 * Sends:
 *   • Patient → booking confirmation with scheduled date/time
 *   • Professional → new booking notification
 *
 * Activation: add RESEND_API_KEY (and optionally EMAIL_FROM) to
 * Supabase Dashboard → Settings → Edge Functions secrets.
 * If RESEND_API_KEY is absent the function returns 200 and silently skips.
 *
 * Expected body: { consultationId: string }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = Deno.env.get('EMAIL_FROM') ?? 'Healthier <consultas@healthier.app>'
const APP_URL = Deno.env.get('APP_URL') ?? 'https://gethealthier.vercel.app'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function modalityLabel(m: string) {
  return m === 'video' ? 'videoconsulta' : 'consulta presencial'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  })
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  })
  return res.ok
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Silent skip when key is not configured — lets the function be deployed early
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ skipped: true, reason: 'RESEND_API_KEY not set' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { consultationId } = await req.json()
    if (!consultationId) {
      return new Response('Missing consultationId', { status: 400, headers: corsHeaders })
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: cons, error } = await sb
      .from('consultations')
      .select(`
        id, scheduled_at, modality,
        patient:profiles!patient_id(full_name, email),
        professional:profiles!professional_id(full_name, email)
      `)
      .eq('id', consultationId)
      .single()

    if (error || !cons) {
      return new Response('Consultation not found', { status: 404, headers: corsHeaders })
    }

    const patient = cons.patient as { full_name: string; email: string } | null
    const professional = cons.professional as { full_name: string; email: string } | null
    const patientName = patient?.full_name ?? 'Paciente'
    const proName = professional?.full_name ?? 'Profesional'
    const dateStr = cons.scheduled_at ? formatDate(cons.scheduled_at) : 'a confirmar'
    const mLabel = modalityLabel(cons.modality ?? 'video')

    const results: boolean[] = []

    // ── Confirmation to patient ──────────────────────────────────────────────
    if (patient?.email) {
      const ok = await sendEmail(
        patient.email,
        `Reserva confirmada — ${mLabel} con ${proName}`,
        `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#FDFCF9">
  <div style="background:#7CB38B;height:4px;border-radius:4px;margin-bottom:32px"></div>
  <h1 style="color:#2D2A26;font-size:22px;font-weight:700;margin:0 0 8px">Reserva confirmada ✓</h1>
  <p style="color:#5A5652;font-size:15px;margin:0 0 24px">Hola <strong>${patientName}</strong>,</p>
  <div style="background:#F6F5F0;border-radius:12px;padding:20px;margin-bottom:24px">
    <p style="margin:0 0 8px;color:#2D2A26;font-weight:600">${mLabel} con ${proName}</p>
    <p style="margin:0;color:#5A5652;font-size:14px">📅 ${dateStr}</p>
  </div>
  <p style="color:#5A5652;font-size:14px;margin-bottom:24px">
    Ingresá a tu panel 5 minutos antes para unirte a la sala.
  </p>
  <a href="${APP_URL}/paciente/consultas"
     style="display:inline-block;background:#7CB38B;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:999px;font-size:14px">
    Ver mis consultas →
  </a>
  <p style="color:#A09D9A;font-size:12px;margin-top:32px">Healthier · Buenos Aires</p>
</div>
        `,
      )
      results.push(ok)
    }

    // ── Notification to professional ─────────────────────────────────────────
    if (professional?.email) {
      const ok = await sendEmail(
        professional.email,
        `Nueva reserva — ${patientName} (${dateStr})`,
        `
<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#FDFCF9">
  <div style="background:#7CB38B;height:4px;border-radius:4px;margin-bottom:32px"></div>
  <h1 style="color:#2D2A26;font-size:22px;font-weight:700;margin:0 0 8px">Nueva reserva recibida</h1>
  <p style="color:#5A5652;font-size:15px;margin:0 0 24px">Hola <strong>${proName}</strong>,</p>
  <div style="background:#F6F5F0;border-radius:12px;padding:20px;margin-bottom:24px">
    <p style="margin:0 0 8px;color:#2D2A26;font-weight:600">${patientName}</p>
    <p style="margin:0;color:#5A5652;font-size:14px">📅 ${dateStr}</p>
    <p style="margin:4px 0 0;color:#5A5652;font-size:14px;text-transform:capitalize">${mLabel}</p>
  </div>
  <a href="${APP_URL}/profesional/dashboard"
     style="display:inline-block;background:#7CB38B;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:999px;font-size:14px">
    Ver mi agenda →
  </a>
  <p style="color:#A09D9A;font-size:12px;margin-top:32px">Healthier · Buenos Aires</p>
</div>
        `,
      )
      results.push(ok)
    }

    return new Response(
      JSON.stringify({ sent: results.filter(Boolean).length }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
