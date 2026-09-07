import { createClient } from 'jsr:@supabase/supabase-js@2'

type Reminder = {
  window: [number, number]
  column: 'reminder_sent' | 'reminder_24h_sent'
  /** Cuál de las dos variantes del mail de recordatorio corresponde. */
  cuando: 'pronto' | 'manana'
  /** El texto de la push. Vive acá para que la diferencia entre los dos
   *  recordatorios esté declarada en un solo lugar y no también en un `if`. */
  push: (professionalName: string, timeStr: string) => { title: string; body: string }
}

const REMINDERS: Reminder[] = [
  {
    window: [23, 37], column: 'reminder_sent', cuando: 'pronto',
    push: (pro, hora) => ({
      title: 'Tu consulta comienza pronto',
      body: `Tu consulta con ${pro} es a las ${hora}. ¡Preparate!`,
    }),
  },
  {
    window: [23 * 60 + 45, 24 * 60 + 15], column: 'reminder_24h_sent', cuando: 'manana',
    push: (pro, hora) => ({
      title: 'Recordatorio de turno',
      body: `Mañana tenés una consulta con ${pro} a las ${hora}.`,
    }),
  },
]

/**
 * Manda por `send-push-notification`, NO con `web-push` directo.
 *
 * Esta función tenía su propia implementación que leía sólo
 * `push_subscriptions` — las suscripciones del navegador. Los tokens de la app
 * viven en `expo_push_tokens`, así que **ningún recordatorio llegó nunca a un
 * teléfono**: salían, no fallaban, y no le llegaban a nadie que usara la app.
 * `send-push-notification` es el único lugar que sabe mandar a los dos canales.
 */
async function sendPush(
  _supabase: unknown,
  userId: string,
  title: string,
  body: string,
  url: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ userId, title, body, url }),
    })
    return res.ok
  } catch (err) {
    console.error(`push error → ${userId}: ${err instanceof Error ? err.message : err}`)
    return false
  }
}

/**
 * El recordatorio por mail lo arma `send-email`, no esta función: así el copy y
 * el diseño viven en un solo lugar y este cron sigue siendo sólo el reloj.
 * Fire-and-forget — que Resend esté caído no puede frenar los recordatorios del
 * resto de los pacientes ni dejar sin marcar los que ya se avisaron.
 */
async function enviarMailDeRecordatorio(consultationId: string, cuando: 'pronto' | 'manana') {
  try {
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ tipo: 'recordatorio', consultationId, cuando }),
    })
    if (!res.ok) console.error(`recordatorio mail ${res.status} → ${consultationId}: ${await res.text()}`)
  } catch (err) {
    console.error(`recordatorio mail error → ${consultationId}: ${err instanceof Error ? err.message : err}`)
  }
}

Deno.serve(async (req: Request) => {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== Deno.env.get('CRON_SECRET')) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const now = new Date()
  let totalSent = 0
  let totalChecked = 0

  for (const reminder of REMINDERS) {
    const [minMin, maxMin] = reminder.window
    const windowStart = new Date(now.getTime() + minMin * 60 * 1000).toISOString()
    const windowEnd   = new Date(now.getTime() + maxMin * 60 * 1000).toISOString()

    const { data: upcoming, error } = await supabase
      .from('consultations')
      .select(`
        id,
        patient_id,
        professional_id,
        scheduled_at,
        pro_reminder_1h_sent,
        patient:profiles!patient_id ( full_name ),
        professional:profiles!professional_id ( full_name )
      `)
      .eq('status', 'confirmed')
      .eq(reminder.column, false)
      .gte('scheduled_at', windowStart)
      .lte('scheduled_at', windowEnd)

    if (error || !upcoming?.length) continue

    totalChecked += upcoming.length
    const remindedIds: string[] = []
    const proRemindedIds: string[] = []
    // Los mails no se esperan uno por uno: son N llamadas HTTP independientes y
    // serializarlas hace que el cron tarde N veces más de lo necesario. Se
    // juntan y se esperan todas juntas al final del bloque.
    const mails: Array<Promise<void>> = []

    for (const c of upcoming) {
      const professionalName = (c.professional as { full_name?: string } | null)?.full_name ?? 'tu profesional'
      const scheduledAt = new Date(c.scheduled_at as string)
      const timeStr = scheduledAt.toLocaleTimeString('es-AR', {
        hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Argentina/Buenos_Aires',
      })

      const { title, body } = reminder.push(professionalName, timeStr)

      const sent = await sendPush(supabase, c.patient_id, title, body, '/paciente/consultas')
      if (sent) totalSent++

      // El mail va SIEMPRE, haya salido la push o no. Son dos canales con
      // alcances distintos: la push depende de que el paciente haya aceptado
      // notificaciones (la mayoría no lo hizo) y de que la suscripción siga
      // viva; el mail llega igual. Mandar el mail sólo cuando la push falla
      // dejaría sin recordatorio justo al que sí las tiene activadas pero no
      // mira el teléfono.
      mails.push(enviarMailDeRecordatorio(c.id as string, reminder.cuando))

      /*
       * El profesional recibe UN solo recordatorio, el de 1 h (decisión de
       * Mateo, 2026-09-06): el de 24 h le sirve menos porque su agenda del día
       * ya la ve en la app. Marca propia — `reminder.column` ya quedó puesta
       * para el paciente y compartirla lo dejaría sin aviso.
       */
      if (reminder.column === 'reminder_sent' && c.professional_id && !c.pro_reminder_1h_sent) {
        const patientName = (c.patient as { full_name?: string } | null)?.full_name ?? 'tu paciente'
        const enviado = await sendPush(
          supabase,
          c.professional_id as string,
          'Tu consulta comienza pronto',
          `Tenés una consulta con ${patientName} a las ${timeStr}.`,
          '/profesional/agenda',
        )
        if (enviado) totalSent++
        proRemindedIds.push(c.id)
      }

      remindedIds.push(c.id)
    }

    // Se esperan igual antes de seguir: si el isolate termina con fetch en
    // vuelo, Deno los corta y el mail no sale.
    await Promise.allSettled(mails)

    if (remindedIds.length > 0) {
      await supabase
        .from('consultations')
        .update({ [reminder.column]: true })
        .in('id', remindedIds)
    }

    if (proRemindedIds.length > 0) {
      await supabase
        .from('consultations')
        .update({ pro_reminder_1h_sent: true })
        .in('id', proRemindedIds)
    }
  }

  return new Response(JSON.stringify({ sent: totalSent, checked: totalChecked }))
})
