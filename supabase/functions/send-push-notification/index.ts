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
    const expoErrors: string[] = []
    const entregas: Array<{ id: string; token: string }> = []
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
      const tickets: Array<{ status?: string; id?: string; message?: string; details?: { error?: string } }> = json?.data ?? []
      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i]
        if (ticket?.status === 'ok') {
          expoSent++
        } else if (ticket?.details?.error === 'DeviceNotRegistered') {
          await supabase.from('expo_push_tokens').delete().eq('token', tokens[i].token)
        } else {
          /*
           * Todo lo que no era `DeviceNotRegistered` se tiraba a la basura sin
           * decir nada. Así estuvo tapado meses un `InvalidCredentials` — "el
           * proyecto no tiene clave de APNs cargada", o sea que la app **no
           * podía mandar UNA sola push a iOS**— con la función devolviendo 200
           * y `sent: 0`. Un token viejo y "esto no funciona para nadie" no
           * pueden verse igual.
           */
          expoErrors.push(ticket?.details?.error ?? ticket?.message ?? 'error desconocido')
          console.error(`[push] expo rechazó ${tokens[i].token.slice(0, 24)}…: ${ticket?.details?.error ?? ''} ${ticket?.message ?? ''}`)
        }
        if (ticket?.status === 'ok' && ticket.id) {
          entregas.push({ id: ticket.id, token: tokens[i].token })
        }
      }
    }

    /*
     * El ticket en `ok` NO quiere decir entregado: quiere decir que Expo lo
     * aceptó. Si el token es de una instalación que ya no existe —pasa con cada
     * reinstalación, y el token cambia sin que nadie borre el viejo— APNs lo
     * acepta y lo tira, y el recibo dice `DeviceNotRegistered` un rato después.
     *
     * Sin mirar los recibos, esos tokens muertos se quedan para siempre y cada
     * envío reporta `sent: 1` sin que a nadie le llegue nada. Fue exactamente lo
     * que pasó el 2026-09-07 con la cuenta demo del profesional: un token del
     * 4 de agosto que sobrevivió a varios TestFlight.
     *
     * Va en `waitUntil` para no demorar la respuesta: al que manda la push no le
     * interesa esperar 10 s por una tarea de limpieza.
     */
    if (entregas.length) {
      const limpiar = async () => {
        await new Promise((r) => setTimeout(r, 10_000))
        try {
          const res = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: entregas.map((e) => e.id) }),
          })
          const json = await res.json().catch(() => null)
          const recibos: Record<string, { status?: string; details?: { error?: string } }> = json?.data ?? {}
          for (const { id, token } of entregas) {
            const r = recibos[id]
            if (!r || r.status === 'ok') continue
            console.error(`[push] recibo ${r.details?.error ?? r.status} para ${token.slice(0, 24)}…`)
            if (r.details?.error === 'DeviceNotRegistered') {
              await supabase.from('expo_push_tokens').delete().eq('token', token)
            }
          }
        } catch (err) {
          console.error(`[push] no se pudieron leer los recibos: ${err}`)
        }
      }
      // @ts-expect-error — EdgeRuntime existe en Deno Deploy, no en los tipos.
      if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(limpiar())
    }

    const total = (subs?.length ?? 0) + (tokens?.length ?? 0)
    if (total === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: 'no_subscriptions' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    // `errors` va en la respuesta a propósito: quien manda una push de prueba
    // tiene que ver POR QUÉ no salió, sin ir a buscar los logs de la función.
    return new Response(JSON.stringify({
      sent: webSent + expoSent, web: webSent, expo: expoSent, total,
      ...(expoErrors.length ? { errors: [...new Set(expoErrors)] } : {}),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
