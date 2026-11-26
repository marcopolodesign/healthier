// TODO: HIPAA compliance for Daily.co video calls
// Before going to production with real patient data:
// 1. Sign a BAA (Business Associate Agreement) with Daily — required for HIPAA
//    See: https://www.daily.co/hipaa/
// 2. Enable Daily's HIPAA-compliant plan (not available on free tier)
// 3. Disable chat logs and recordings unless end-to-end encrypted storage is configured
// 4. Review Daily's data retention and processing policies per HIPAA §164.312
// 5. Add PHI handling disclosures to the patient consent screen (mobile/app/(auth)/consent.tsx)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { puedeActuarComo } from '../_shared/familia.ts'

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

    // El titular entra a la sala en nombre de un familiar sin login propio
    // (migración 181): para la videollamada, es el paciente.
    const isPatient = consultation.patient_id === user.id
      || (consultation.professional_id !== user.id && await puedeActuarComo(supabase, user.id, consultation.patient_id))
    const isProfessional = consultation.professional_id === user.id

    if (!isPatient && !isProfessional) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Gate de servidor (migración 098): mientras el profesional está cargando
    // el cierre (`status='closing'`) nadie puede volver a entrar a la sala —
    // la llamada ya terminó, y el paciente tiene que ver "Preparando tu
    // receta" en vez de reingresar. Esto es lo que hace el bloqueo real: los
    // botones de la UI se ocultan como cortesía, pero sin esto alcanzaba con
    // pegar la URL vieja o tocar "atrás" para volver a entrar.
    // Terminales (completed/cancelled/no_show/expired) también se bloquean:
    // la sala ya no tiene sentido una vez que la consulta cerró.
    const noJoinableStatuses = ['closing', 'completed', 'cancelled', 'no_show', 'expired']
    if (noJoinableStatuses.includes(consultation.status)) {
      const msg = consultation.status === 'closing'
        ? 'La consulta está cerrando — todavía no se puede reingresar.'
        : 'Esta consulta ya terminó.'
      return new Response(JSON.stringify({ error: msg, status: consultation.status }), {
        status: 409,
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
    // El nombre que estaba guardado cuando se leyó la fila. Si la sala venció,
    // el reclamo de la nueva se hace contra ESTE valor (no contra NULL): antes
    // el `.is('daily_room_name', null)` no afectaba filas con una sala vencida
    // guardada, se borraba la sala recién creada y se devolvía la vencida —
    // la consulta quedaba sin videollamada (pasó con un turno reprogramado,
    // 2026-11-26). La 255 además limpia la sala al reprogramar.
    const salaLeida: string | null = consultation.daily_room_name ?? null

    // Si hay una sala guardada, se confirma que siga existiendo en Daily.
    // SÓLO un 404 quiere decir "venció". Un 429, un 5xx o un timeout no dicen
    // nada de la sala: tomarlos como vencida haría crear otra y pisar una que
    // sigue viva, y los dos lados terminarían en salas distintas. Ante eso se
    // reintenta una vez y, si sigue, se devuelve error sin tocar la fila.
    if (roomUrl && roomName) {
      let estado = 0
      for (let intento = 0; intento < 2 && estado !== 200 && estado !== 404; intento++) {
        if (intento) await new Promise(r => setTimeout(r, 800))
        try {
          const checkRes = await fetch(`${DAILY_API_BASE}/rooms/${roomName}`, {
            headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
            signal: AbortSignal.timeout(8000),
          })
          estado = checkRes.status
          await checkRes.body?.cancel()
        } catch {
          estado = 0
        }
      }
      if (estado === 404) {
        roomUrl = null as unknown as string
        roomName = null as unknown as string
      } else if (estado !== 200) {
        return new Response(JSON.stringify({ error: 'No pudimos verificar la sala de la consulta. Probá de nuevo en unos segundos.' }), {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
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
          properties: {
            exp,
            enable_chat: true,
            enable_screenshare: false,
            max_participants: 2,
            // 🔴 Sin esto la app quedaba trabada (2026-09-09).
            //
            // `enable_prejoin_ui` es una propiedad de Daily **Prebuilt**, y los
            // dos clientes no lo usan igual:
            //   · el website carga el SDK y llama `join()` él mismo, así que
            //     esta propiedad no lo toca — entra derecho;
            //   · la app abre la URL de la sala en un WebView, o sea Prebuilt,
            //     y con el default de Daily caía en un "Are you ready to join?"
            //     en inglés, con el botón de colgar de la app encima. El
            //     paciente no encontraba el "Join" y nunca entraba: el
            //     profesional veía la sala vacía y el log del servidor decía
            //     200, porque la sala SÍ se había entregado.
            //
            // En `false` los dos entran igual. No hay pantalla intermedia que
            // mostrarle a alguien que ya tocó "Entrar a la consulta".
            enable_prejoin_ui: false,
          },
        }),
      })

      if (!roomRes.ok) {
        const txt = await roomRes.text()
        throw new Error(`Daily room creation failed: ${txt}`)
      }

      const room = await roomRes.json() as { url: string; name: string }
      roomUrl = room.url
      roomName = room.name

      // ⚠️ Toma ATÓMICA de la sala.
      //
      // Esto era leer-y-después-escribir sin ninguna guarda: si los dos lados
      // pedían la sala casi a la vez, ambos leían NULL, ambos creaban una sala
      // distinta y el segundo pisaba al primero. Cada cliente ya se había
      // quedado con la URL que recibió, así que terminaban en salas DISTINTAS:
      // cada uno se veía a sí mismo y a nadie más.
      //
      // Pasó de verdad el 2026-07-28: Daily quedó con dos salas creadas en el
      // mismo segundo (12:20:09) para la consulta fd6bcf5d, y solo una guardada.
      //
      // El reclamo condicional (contra NULL, o contra la sala vencida que se
      // leyó) hace que gane quien llegue primero. Si no afecta filas, otro ya
      // la reclamó: se borra la sala huérfana que
      // acabamos de crear y se usa la suya.
      const nuevaUrl = roomUrl
      const nuevaSala = roomName
      const reclamar = (contra: string | null) => {
        const q = serviceSupabase
          .from('consultations')
          .update({
            daily_room_url: nuevaUrl,
            daily_room_name: nuevaSala,
            ...(['confirmed', 'pending'].includes(consultation.status) ? { status: 'in_progress' } : {}),
          })
          .eq('id', consultationId)
        return (contra ? q.eq('daily_room_name', contra) : q.is('daily_room_name', null))
          .select('daily_room_url, daily_room_name')
          .maybeSingle()
      }

      // Se reclama contra lo que se leyó. Si no afecta filas, se mira qué hay
      // ahora en la fila:
      //   · otra sala distinta de la vencida → la armó otro pedido en paralelo:
      //     se borra la nuestra y se usa esa;
      //   · nada (la reprogramación la limpió entre la lectura y el reclamo) →
      //     se reintenta UNA vez contra NULL. Nunca se usan a ciegas los
      //     valores del ganador: si son NULL el token saldría sin sala.
      let contra = salaLeida
      let resuelto = false
      for (let intento = 0; intento < 2 && !resuelto; intento++) {
        const { data: claimed } = await reclamar(contra)
        if (claimed) { resuelto = true; break }

        const { data: actual } = await serviceSupabase
          .from('consultations')
          .select('daily_room_url, daily_room_name')
          .eq('id', consultationId)
          .single()

        if (actual?.daily_room_url && actual.daily_room_name && actual.daily_room_name !== salaLeida) {
          await fetch(`${DAILY_API_BASE}/rooms/${nuevaSala}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
          }).catch(() => {})
          roomUrl = actual.daily_room_url
          roomName = actual.daily_room_name
          resuelto = true
          break
        }
        contra = actual?.daily_room_name ?? null
      }

      if (!resuelto) {
        await fetch(`${DAILY_API_BASE}/rooms/${nuevaSala}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
        }).catch(() => {})
        return new Response(JSON.stringify({ error: 'No pudimos preparar la sala de la consulta. Probá de nuevo en unos segundos.' }), {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
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
