import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

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

async function sendPush(
  supabase: ReturnType<typeof createClient>,
  patientId: string,
  title: string,
  body: string,
  url: string,
): Promise<boolean> {
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', patientId)

  if (!subs?.length) return false

  const payload = JSON.stringify({ title, body, url })
  const results = await Promise.allSettled(
    subs.map(async (sub: { endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode
        if (status === 410 || status === 404) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        }
        throw err
      }
    })
  )
  return results.some(r => r.status === 'fulfilled')
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

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!,
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!
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
        scheduled_at,
        professional:profiles!professional_id ( full_name )
      `)
      .eq('status', 'confirmed')
      .eq(reminder.column, false)
      .gte('scheduled_at', windowStart)
      .lte('scheduled_at', windowEnd)

    if (error || !upcoming?.length) continue

    totalChecked += upcoming.length
    const remindedIds: string[] = []
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
  }

  return new Response(JSON.stringify({ sent: totalSent, checked: totalChecked }))
})
