/**
 * Cambiar el correo de acceso, con DOS códigos: uno al correo actual y otro al
 * nuevo. Los dos hacen falta (migración 156).
 *
 * ── Por qué no se usa el flujo de Supabase ──────────────────────────────────
 * `auth.updateUser({ email })` manda un **link** al correo nuevo y listo. Eso
 * verifica que la dirección nueva existe, pero no prueba que quien pide el
 * cambio sea el dueño de la cuenta — que es justo el agujero que hay que tapar:
 * un profesional verificado que le pasa su cuenta a otro para que atienda con
 * su matrícula. El código al correo **actual** es el que prueba eso.
 *
 * ── Lo que esta función NO hace ─────────────────────────────────────────────
 * No toca el estado de verificación del profesional. Mientras el cambio no se
 * verifique, **no pasa nada**: sigue atendiendo con su correo de siempre
 * (decisión de Mateo, 2026-09-11). El pedido simplemente vence a los 30 min.
 *
 * Acciones: `solicitar` · `verificar` · `estado` · `cancelar`.
 */
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const MAX_INTENTOS = 5

/** 6 dígitos. Se dicta y se tipea; lo que lo hace seguro es que son dos y vencen. */
function codigo() {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
}

/** El pedido vivo del usuario, si lo hay. */
async function pedidoVivo(admin: SupabaseClient, userId: string) {
  const { data } = await admin
    .from('email_change_requests')
    .select('*')
    .eq('user_id', userId)
    .is('applied_at', null)
    .is('cancelled_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const anon = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    )
    const { data: { user }, error: authErr } = await anon.auth.getUser()
    if (authErr || !user) return json({ error: 'No autenticado' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.json().catch(() => ({}))
    const accion = body.accion as string | undefined

    // ── estado ──────────────────────────────────────────────────────────────
    // Devuelve el pedido SIN los códigos: la pantalla necesita saber a qué
    // dirección va, cuándo vence y cuántos intentos quedan, nada más.
    if (accion === 'estado') {
      const req0 = await pedidoVivo(admin, user.id)
      return json({
        pendiente: Boolean(req0),
        nuevoEmail: req0?.new_email ?? null,
        venceEn: req0?.expires_at ?? null,
        intentosRestantes: req0 ? Math.max(0, MAX_INTENTOS - req0.attempts) : null,
      })
    }

    // ── cancelar ────────────────────────────────────────────────────────────
    if (accion === 'cancelar') {
      await admin.from('email_change_requests')
        .update({ cancelled_at: new Date().toISOString() })
        .eq('user_id', user.id).is('applied_at', null).is('cancelled_at', null)
      return json({ ok: true })
    }

    // ── solicitar ───────────────────────────────────────────────────────────
    if (accion === 'solicitar') {
      const nuevo = String(body.nuevoEmail ?? '').trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nuevo)) {
        return json({ error: 'Ese correo no parece válido.' }, 400)
      }
      if (nuevo === (user.email ?? '').toLowerCase()) {
        return json({ error: 'Ese ya es tu correo actual.' }, 400)
      }
      // ¿Está tomado? Se mira `profiles`, que es lo que podemos consultar sin
      // recorrer todo auth. Si se escapa alguno, el update de abajo falla y el
      // mensaje se muestra igual.
      const { data: tomado } = await admin
        .from('profiles').select('id').ilike('email', nuevo).maybeSingle()
      if (tomado) return json({ error: 'Ya hay una cuenta con ese correo.' }, 409)

      // Un pedido a la vez: el anterior se cancela, así los códigos viejos
      // dejan de servir apenas se pide uno nuevo.
      await admin.from('email_change_requests')
        .update({ cancelled_at: new Date().toISOString() })
        .eq('user_id', user.id).is('applied_at', null).is('cancelled_at', null)

      const { data: creado, error } = await admin
        .from('email_change_requests')
        .insert({
          user_id: user.id,
          new_email: nuevo,
          code_current: codigo(),
          code_new: codigo(),
        })
        .select('id, new_email, expires_at')
        .single()
      if (error) return json({ error: error.message }, 500)

      // Los dos mails los manda el trigger de la migración 156, no esta
      // función: así el disparo no depende de desde dónde se haya pedido.
      return json({ ok: true, nuevoEmail: creado.new_email, venceEn: creado.expires_at })
    }

    // ── verificar ───────────────────────────────────────────────────────────
    if (accion === 'verificar') {
      const codActual = String(body.codigoActual ?? '').trim()
      const codNuevo  = String(body.codigoNuevo ?? '').trim()

      const req0 = await pedidoVivo(admin, user.id)
      if (!req0) return json({ ok: false, motivo: 'sin_pedido' })
      if (req0.attempts >= MAX_INTENTOS) {
        return json({ ok: false, motivo: 'demasiados_intentos', intentosRestantes: 0 })
      }

      if (req0.code_current !== codActual || req0.code_new !== codNuevo) {
        const { data: act } = await admin
          .from('email_change_requests')
          .update({ attempts: req0.attempts + 1 })
          .eq('id', req0.id)
          .select('attempts')
          .single()
        return json({
          ok: false,
          motivo: 'codigo_incorrecto',
          intentosRestantes: Math.max(0, MAX_INTENTOS - (act?.attempts ?? MAX_INTENTOS)),
        })
      }

      // Los dos coinciden. `email_confirm: true` porque la dirección nueva ya
      // quedó probada con su propio código — mandarle encima el link de
      // confirmación de Supabase sería pedir lo mismo dos veces.
      const { error: upErr } = await admin.auth.admin.updateUserById(user.id, {
        email: req0.new_email,
        email_confirm: true,
      })
      if (upErr) return json({ ok: false, motivo: 'no_se_pudo', detalle: upErr.message }, 500)

      // `profiles.email` es la copia que leen las pantallas y los mails: si no
      // se actualiza, el profesional entra con el correo nuevo y sigue
      // recibiendo todo en el viejo.
      await admin.from('profiles').update({ email: req0.new_email }).eq('id', user.id)
      await admin.from('email_change_requests')
        .update({ applied_at: new Date().toISOString() })
        .eq('id', req0.id)

      return json({ ok: true, email: req0.new_email })
    }

    return json({ error: `Acción desconocida: ${accion}` }, 400)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error(`cambio-de-correo: ${msg}`)
    return json({ error: msg }, 500)
  }
})
