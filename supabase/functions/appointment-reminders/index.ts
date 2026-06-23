import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

Deno.serve(async (req: Request) => {
  // Verify this was called by our pg_cron job via the shared secret
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

  // Query confirmed consultations starting in 23–37 minutes (30-min reminder window).
  // A cron firing every 15 min guarantees each consultation is caught by exactly one run.
  const now = new Date()
  const windowStart = new Date(now.getTime() + 23 * 60 * 1000).toISOString()
  const windowEnd = new Date(now.getTime() + 37 * 60 * 1000).toISOString()

  const { data: upcoming, error } = await supabase
    .from('consultations')
    .select(`
      id,
      patient_id,
      scheduled_at,
      professional:profiles!professional_id ( full_name )
    `)
    .eq('status', 'confirmed')
    .eq('reminder_sent', false)
    .gte('scheduled_at', windowStart)
    .lte('scheduled_at', windowEnd)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  if (!upcoming?.length) {
    return new Response(JSON.stringify({ sent: 0, checked: 0 }))
  }

  let sent = 0
  const remindedIds: string[] = []

  for (const consultation of upcoming) {
    const patientId = consultation.patient_id
    const professionalName = (consultation.professional as { full_name?: string } | null)?.full_name ?? 'tu profesional'
    const scheduledAt = new Date(consultation.scheduled_at as string)
    const timeStr = scheduledAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })

    // Get push subscriptions for this patient
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', patientId)

    if (!subs?.length) {
      // No subscription but still mark as sent to avoid repeated DB lookups
      remindedIds.push(consultation.id)
      continue
    }

    const payload = JSON.stringify({
      title: 'Tu consulta comienza pronto',
      body: `Tu consulta con ${professionalName} es a las ${timeStr}. ¡Preparate!`,
      url: '/paciente/consultas',
    })

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

    const succeeded = results.filter(r => r.status === 'fulfilled').length
    if (succeeded > 0) sent++
    remindedIds.push(consultation.id)
  }

  // Mark all processed consultations as reminder_sent regardless of push outcome —
  // prevents repeated attempts for patients with no subscription.
  if (remindedIds.length > 0) {
    await supabase
      .from('consultations')
      .update({ reminder_sent: true })
      .in('id', remindedIds)
  }

  return new Response(JSON.stringify({ sent, checked: upcoming.length }))
})
