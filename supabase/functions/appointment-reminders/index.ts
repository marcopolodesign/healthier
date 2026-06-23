import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

type Reminder = { window: [number, number]; column: 'reminder_sent' | 'reminder_24h_sent'; label: string }

const REMINDERS: Reminder[] = [
  { window: [23, 37],           column: 'reminder_sent',     label: 'en 30 minutos' },
  { window: [23 * 60 + 45, 24 * 60 + 15], column: 'reminder_24h_sent', label: 'mañana' },
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

    for (const c of upcoming) {
      const professionalName = (c.professional as { full_name?: string } | null)?.full_name ?? 'tu profesional'
      const scheduledAt = new Date(c.scheduled_at as string)
      const timeStr = scheduledAt.toLocaleTimeString('es-AR', {
        hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Argentina/Buenos_Aires',
      })

      let title: string, body: string
      if (reminder.column === 'reminder_sent') {
        title = 'Tu consulta comienza pronto'
        body  = `Tu consulta con ${professionalName} es a las ${timeStr}. ¡Preparate!`
      } else {
        title = 'Recordatorio de turno'
        body  = `Mañana tenés una consulta con ${professionalName} a las ${timeStr}.`
      }

      const sent = await sendPush(supabase, c.patient_id, title, body, '/paciente/consultas')
      if (sent) totalSent++
      remindedIds.push(c.id)
    }

    if (remindedIds.length > 0) {
      await supabase
        .from('consultations')
        .update({ [reminder.column]: true })
        .in('id', remindedIds)
    }
  }

  return new Response(JSON.stringify({ sent: totalSent, checked: totalChecked }))
})
