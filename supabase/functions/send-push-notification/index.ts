import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { construir, type Datos, type Tipo } from '../_shared/push/textos.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Busca en la base lo que el texto necesita. Cada aviso pide poco y nada, así
 * que se leen sólo las columnas que se usan.
 */
async function datosDelAviso(
  supabase: ReturnType<typeof createClient>,
  p: Record<string, unknown>,
): Promise<Datos> {
  const datos: Datos = {
    motivo: (p.motivo as string) ?? null,
    permanente: Boolean(p.permanente),
  }

  if (p.consultationId) {
    datos.consultationId = p.consultationId as string
    const { data } = await supabase
      .from('consultations')
      .select('scheduled_at, is_on_demand, daily_room_url, professional:profiles!professional_id(full_name)')
      .eq('id', p.consultationId)
      .maybeSingle()
    if (data) {
      datos.scheduledAt = data.scheduled_at
      datos.isOnDemand = Boolean(data.is_on_demand)
      datos.hasRoom = Boolean(data.daily_room_url)
      datos.professionalName = (data.professional as { full_name?: string } | null)?.full_name ?? null
      // Para el post-consulta: decir "y tu receta" sólo si de verdad hay una.
      const { data: enc } = await supabase
        .from('clinical_encounters').select('id').eq('consultation_id', p.consultationId)
      const ids = (enc ?? []).map((e: { id: string }) => e.id)
      if (ids.length) {
        const { count } = await supabase
          .from('clinical_medications').select('id', { count: 'exact', head: true })
          .in('encounter_id', ids).eq('rcta_status', 'issued')
        datos.tieneReceta = (count ?? 0) > 0
      }
    }
  }

  if (p.orderId) {
    datos.orderId = p.orderId as string
    const { data } = await supabase
      .from('medication_orders')
      .select('cancellation_reason, pharmacy:pharmacies!pharmacy_id(name)')
      .eq('id', p.orderId)
      .maybeSingle()
    if (data) {
      datos.pharmacyName = (data.pharmacy as { name?: string } | null)?.name ?? null
      datos.motivo = datos.motivo ?? data.cancellation_reason ?? null
    }
  }

  if (p.prescriptionId) {
    const { data } = await supabase
      .from('clinical_medications')
      .select('medication_name, nombre_droga')
      .eq('rcta_prescription_id', p.prescriptionId)
    datos.medicamentos = (data ?? []).map(
      (m: Record<string, string | null>) => m.medication_name || m.nombre_droga || 'Medicamento',
    )
  }

  return datos
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const payloadIn = await req.json()
    const { userId, tipo } = payloadIn as { userId?: string; tipo?: Tipo }
    if (!userId) throw new Error('userId required')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    /*
     * Dos formas de llamarla, a propósito:
     *
     *  · `{ userId, tipo, ...ids }` — la buena. El que dispara dice QUÉ pasó y
     *    el texto sale del catálogo (`_shared/push/textos.ts`), que es también
     *    el que alimenta la página donde el equipo revisa el copy. Cambiar una
     *    palabra deja de necesitar una migración.
     *  · `{ userId, title, body, url }` — la vieja. Se mantiene porque hay
     *    llamadas en vuelo de pg_net y código del front que todavía la usan;
     *    sacarla sería romperlas sin ganar nada.
     */
    let { title, body, url } = payloadIn as { title?: string; body?: string; url?: string }

    if (tipo) {
      const datos = await datosDelAviso(supabase, payloadIn)
      const aviso = construir(tipo, datos)
      if (!aviso) throw new Error(`tipo desconocido: ${tipo}`)
      title = aviso.title; body = aviso.body; url = aviso.url
    }

    if (!title) throw new Error('title required (o un `tipo` válido)')

    // Igual que `send-email`: arma el aviso con los datos reales y lo devuelve
    // sin mandarlo. Es la forma de comprobar el texto contra una consulta o un
    // pedido de verdad sin hacerle sonar el teléfono a nadie.
    if ((payloadIn as { preview?: boolean }).preview) {
      return new Response(JSON.stringify({ preview: { title, body, url } }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

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
