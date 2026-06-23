// TODO: HIPAA compliance for Daily.co video calls
// Before going to production with real patient data:
// 1. Sign a BAA (Business Associate Agreement) with Daily — required for HIPAA
//    See: https://www.daily.co/hipaa/
// 2. Enable Daily's HIPAA-compliant plan (not available on free tier)
// 3. Disable chat logs and recordings unless end-to-end encrypted storage is configured
// 4. Review Daily's data retention and processing policies per HIPAA §164.312
// 5. Add PHI handling disclosures to the patient consent screen (mobile/app/(auth)/consent.tsx)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DAILY_API_KEY = Deno.env.get('DAILY_API_KEY')!
const DAILY_API_BASE = 'https://api.daily.co/v1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }

    // Client scoped to caller (for identity verification)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    }

    const { consultationId } = await req.json()
    if (!consultationId) {
      return new Response(JSON.stringify({ error: 'Missing consultationId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch consultation and verify caller is a party
    const { data: consultation, error: consErr } = await supabase
      .from('consultations')
      .select('*, patient:profiles!patient_id(full_name), professional:profiles!professional_id(full_name)')
      .eq('id', consultationId)
      .single()

    if (consErr || !consultation) {
      return new Response(JSON.stringify({ error: 'Consultation not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const isPatient = consultation.patient_id === user.id
    const isProfessional = consultation.professional_id === user.id

    if (!isPatient && !isProfessional) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const userName = isPatient
      ? (consultation.patient as { full_name: string })?.full_name ?? 'Paciente'
      : (consultation.professional as { full_name: string })?.full_name ?? 'Profesional'

    // Service-role client for writes
    const serviceSupabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    let roomUrl: string = consultation.daily_room_url
    let roomName: string = consultation.daily_room_name

    // If a room URL is stored, verify it still exists in Daily.co (rooms expire)
    if (roomUrl && roomName) {
      const checkRes = await fetch(`${DAILY_API_BASE}/rooms/${roomName}`, {
        headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
      })
      if (!checkRes.ok) {
        // Room is gone — clear stored values and fall through to create a new one
        roomUrl = null as unknown as string
        roomName = null as unknown as string
      }
    }

    if (!roomUrl) {
      // Expiry: 24 hours from now (generous — rooms auto-clean after consultation ends)
      const exp = Math.floor(Date.now() / 1000) + 86400

      const roomRes = await fetch(`${DAILY_API_BASE}/rooms`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${DAILY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          privacy: 'private',
          properties: { exp, enable_chat: true, enable_screenshare: false, max_participants: 2 },
        }),
      })

      if (!roomRes.ok) {
        const txt = await roomRes.text()
        throw new Error(`Daily room creation failed: ${txt}`)
      }

      const room = await roomRes.json() as { url: string; name: string }
      roomUrl = room.url
      roomName = room.name

      await serviceSupabase
        .from('consultations')
        .update({
          daily_room_url: roomUrl,
          daily_room_name: roomName,
          ...(['confirmed', 'pending'].includes(consultation.status) ? { status: 'in_progress' } : {}),
        })
        .eq('id', consultationId)
    } else if (['confirmed', 'pending'].includes(consultation.status)) {
      await serviceSupabase
        .from('consultations')
        .update({ status: 'in_progress' })
        .eq('id', consultationId)
    }

    // Generate a participant token
    const tokenRes = await fetch(`${DAILY_API_BASE}/meeting-tokens`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DAILY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          room_name: roomName,
          user_name: userName,
          is_owner: isProfessional,
          enable_recording: false,
        },
      }),
    })

    if (!tokenRes.ok) {
      const txt = await tokenRes.text()
      throw new Error(`Daily token creation failed: ${txt}`)
    }

    const { token } = await tokenRes.json() as { token: string }

    return new Response(
      JSON.stringify({ roomUrl, token }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('daily-token error:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
