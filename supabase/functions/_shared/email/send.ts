/**
 * El único lugar del repo que le habla a Resend.
 *
 * Dos cosas importan acá y las dos salieron de que un circuito estuviera roto
 * sin que nadie se enterara:
 *
 *  1. **El motivo real del rechazo se loguea siempre.** Un `from` con el
 *     dominio sin verificar (el 403 más común de Resend) produce el mismo
 *     resultado visible que "no hay clave": un mail que no llega y cero rastro.
 *  2. **Cada envío deja una fila en `email_log`**, con el id de Resend o el
 *     error. Es lo que hace que el super admin pueda ver que los mails están
 *     saliendo — o que dejaron de salir — sin leer los logs de Supabase.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
// `healthier.app` NO es un dominio de Healthier: el default viejo mandaba desde
// un dominio ajeno y Resend lo rechazaba siempre. El propio es healthier.com.ar.
const FROM = Deno.env.get('EMAIL_FROM') ?? 'Healthier <consultas@healthier.com.ar>'

export const hayClave = () => Boolean(RESEND_API_KEY)

export type Envio = {
  to: string | null | undefined
  subject: string
  html: string
}

/** Qué originó el mail — para poder mirarlo después desde la consulta o el pedido. */
export type Contexto = {
  tipo: string
  usuarioId?: string | null
  consultationId?: string | null
  orderId?: string | null
}

export async function enviar(sb: SupabaseClient, ctx: Contexto, { to, subject, html }: Envio): Promise<boolean> {
  if (!to) return false

  if (!RESEND_API_KEY) {
    console.warn(`mail: sin RESEND_API_KEY — no se envió "${subject}" a ${to}`)
    await registrar(sb, ctx, to, subject, 'error', null, 'RESEND_API_KEY no configurada')
    return false
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    })

    if (!res.ok) {
      const detalle = await res.text()
      console.error(`resend ${res.status} → ${to} (from: ${FROM}): ${detalle}`)
      await registrar(sb, ctx, to, subject, 'error', null, `${res.status} ${detalle}`.slice(0, 500))
      return false
    }

    const { id } = await res.json().catch(() => ({ id: null })) as { id: string | null }
    await registrar(sb, ctx, to, subject, 'enviado', id, null)
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`resend network error → ${to}: ${msg}`)
    await registrar(sb, ctx, to, subject, 'error', null, msg.slice(0, 500))
    return false
  }
}

/** Manda varios y devuelve cuántos salieron. Nunca tira: un mail no rompe un flujo. */
export async function enviarTodos(sb: SupabaseClient, ctx: Contexto, envios: Envio[]): Promise<number> {
  const res = await Promise.all(envios.map(e => enviar(sb, ctx, e)))
  return res.filter(Boolean).length
}

// El registro no puede tumbar el envío: si falla el insert, se avisa y se sigue.
async function registrar(
  sb: SupabaseClient, ctx: Contexto,
  destinatario: string, asunto: string,
  estado: 'enviado' | 'error', resendId: string | null, error: string | null,
) {
  const { error: err } = await sb.from('email_log').insert({
    tipo: ctx.tipo,
    destinatario,
    asunto,
    estado,
    resend_id: resendId,
    error,
    usuario_id: ctx.usuarioId ?? null,
    consultation_id: ctx.consultationId ?? null,
    order_id: ctx.orderId ?? null,
  })
  if (err) console.error(`email_log insert: ${err.message}`)
}
