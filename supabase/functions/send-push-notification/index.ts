import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { userId, title, body, url } = await req.json()
    if (!userId || !title) throw new Error('userId and title required')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // ── Web push (VAPID) — suscripciones del website ──
    const { data: subs, error: subsErr } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', userId)
    if (subsErr) throw subsErr

    let webSent = 0
    if (subs?.length) {
      webpush.setVapidDetails(
        Deno.env.get('VAPID_SUBJECT')!,
        Deno.env.get('VAPID_PUBLIC_KEY')!,
        Deno.env.get('VAPID_PRIVATE_KEY')!
      )
      const payload = JSON.stringify({ title, body: body ?? '', url: url ?? '/' })
      const results = await Promise.allSettled(
        subs.map(async (sub: { endpoint: string; p256dh: string; auth: string }) => {
          try {
            await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
          } catch (err: unknown) {
            const status = (err as { statusCode?: number })?.statusCode
            if (status === 410 || status === 404) {
              await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
            }
            throw err
          }
        })
      )
      webSent = results.filter(r => r.status === 'fulfilled').length
    }

    // ── Expo push — tokens de la app mobile ──
    const { data: tokens, error: tokErr } = await supabase
      .from('expo_push_tokens')
      .select('token')
      .eq('user_id', userId)
    if (tokErr) throw tokErr

    let expoSent = 0
    if (tokens?.length) {
      const messages = tokens.map((t: { token: string }) => ({
        to: t.token,
        title,
        body: body ?? '',
        data: { url: url ?? '/' },
        sound: 'default',
      }))
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      })
      const json = await res.json().catch(() => null)
      const tickets: Array<{ status?: string; details?: { error?: string } }> = json?.data ?? []
      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i]
        if (ticket?.status === 'ok') {
          expoSent++
        } else if (ticket?.details?.error === 'DeviceNotRegistered') {
          await supabase.from('expo_push_tokens').delete().eq('token', tokens[i].token)
        }
      }
    }

    const total = (subs?.length ?? 0) + (tokens?.length ?? 0)
    if (total === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: 'no_subscriptions' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    return new Response(JSON.stringify({ sent: webSent + expoSent, web: webSent, expo: expoSent, total }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
