/**
 * ondemand-despacho — Teleclínica por despacho (migración 191, Mateo 2026-10-07)
 *
 * El orden para el paciente es: PAGAR → "buscando un médico" → "te atiende X".
 *
 *   action: "pedir"     (paciente) body: { vertical, paraId?, pago? }
 *     Valida que haya alguien elegible, guarda el token de la tarjeta (cifrado,
 *     en una tabla que ningún cliente lee) y crea el pedido sin médico. El
 *     trigger de la base les manda el aviso a todos los elegibles. Todavía NO
 *     se reserva nada en la tarjeta.
 *   action: "cancelar"  (paciente) body: { requestId }
 *     Sólo mientras nadie aceptó. Borra el token: no se cobró nada.
 *   action: "extender"  (paciente) body: { requestId }
 *     "Seguir buscando": corre el vencimiento hasta un techo de 20 minutos.
 *   action: "aceptar"   (profesional) body: { requestId }
 *     Toma atómica (`accept_ondemand_request`) y, si la gana, crea la
 *     pre-autorización (capture:false) contra la cuenta de Mercado Pago de ESE
 *     profesional usando el token guardado — llamando a mp-payment en nombre del
 *     paciente. Si la tarjeta se rechaza, la consulta queda tomada y se le pide
 *     otra tarjeta al paciente (lo paga desde su pantalla con mp-payment, como
 *     cualquier reintento) y se le avisa al profesional.
 *
 * Por qué el cobro se hace al aceptar y no al pagar: la pre-autorización se
 * crea con el token OAuth del VENDEDOR (split de Mercado Pago), y antes de que
 * alguien acepte no se sabe quién es. El token de la tarjeta dura 7 días y es de
 * un solo uso, así que alcanza de sobra para los minutos de búsqueda.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encryptToken, decryptToken } from '../_shared/tokenCrypto.ts'
import { puedeActuarComo } from '../_shared/familia.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

/** Cuánto suena un pedido antes de vencer. Mismo número que la espera vieja. */
const BUSQUEDA_MS = 4 * 60 * 1000
/** Techo de "seguir buscando", desde que se pidió. */
const BUSQUEDA_MAX_MS = 20 * 60 * 1000
/** Mismo criterio que ON_DEMAND_PRESENCE_TTL_MS. */
const PRESENCIA_MS = 60 * 60 * 1000
/**
 * Quién puede pedir una consulta inmediata bonificada desde el interruptor del
 * checkout (para recorrer el flujo sin pagar). Se decide ACÁ, con el mail del
 * JWT: el front sólo muestra el interruptor, y si otra cuenta manda
 * `bonificar: true` se ignora. Pedido de Mateo, 2026-10-09.
 */
const BONIFICAR_ALLOWLIST = ['mateoaldao@gmail.com']

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

interface Pago {
  cardToken: string
  paymentMethodId: string
  savedCardId?: string | null
  payerEmail?: string | null
  payerDocType?: string | null
  payerDocNumber?: string | null
  deviceId?: string | null
}

// deno-lint-ignore no-explicit-any
type Db = any

async function especialidadesDe(db: Db, vertical: string): Promise<string[]> {
  const { data } = await db
    .from('specialties')
    .select('slug')
    .eq('vertical_id', vertical)
    .is('parent_id', null)
  return (data ?? []).map((e: { slug: string }) => e.slug)
}

async function cuantosElegibles(db: Db, especialidades: string[], excluir: string): Promise<number> {
  const { count } = await db
    .from('professional_profiles')
    .select('user_id', { count: 'exact', head: true })
    .in('specialty', especialidades)
    .eq('is_on_demand', true)
    .eq('is_verified', true)
    .eq('is_active', true)
    .eq('mp_connected', true)
    .gte('on_demand_last_seen_at', new Date(Date.now() - PRESENCIA_MS).toISOString())
    .neq('user_id', excluir)
  return count ?? 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ data: null, error: 'Unauthorized' }, 401)

    const userDb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await userDb.auth.getUser()
    if (!user) return json({ data: null, error: 'Unauthorized' }, 401)

    const db = createClient(SUPABASE_URL, SERVICE_KEY)
    const body = await req.json().catch(() => ({}))
    const action = body.action as string

    // ── pedir ────────────────────────────────────────────────────────────────
    if (action === 'pedir') {
      const vertical = String(body.vertical ?? '')
      const paraId: string | null = body.paraId || null
      const pago: Pago | null = body.pago ?? null

      if (paraId && !(await puedeActuarComo(db, user.id, paraId))) {
        return json({ data: null, error: 'No podés pedir una consulta para esa persona.' }, 403)
      }

      // Un pedido vivo por paciente: un doble toque o un refresh no puede
      // sonarles dos veces a los médicos ni dejar dos tokens guardados.
      const { data: vivo } = await db
        .from('ondemand_requests')
        .select('id')
        .eq('patient_id', user.id)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .maybeSingle()
      if (vivo) return json({ data: { requestId: vivo.id, yaExistia: true }, error: null })

      const [{ data: ajuste }, { data: perfil }, especialidades] = await Promise.all([
        db.from('vertical_settings').select('enabled, ondemand_price').eq('id', vertical).maybeSingle(),
        db.from('profiles').select('payment_exempt, email').eq('id', user.id).maybeSingle(),
        especialidadesDe(db, vertical),
      ])
      if (!ajuste?.enabled || !ajuste?.ondemand_price || !especialidades.length) {
        return json({ data: null, error: 'Esta especialidad no tiene consulta inmediata por ahora.' }, 422)
      }

      const puedeBonificar = BONIFICAR_ALLOWLIST.includes(String(user.email ?? '').trim().toLowerCase())
      const exento = Boolean(perfil?.payment_exempt) || (body.bonificar === true && puedeBonificar)
      if (!exento) {
        if (!pago?.cardToken || !pago?.paymentMethodId) {
          return json({ data: null, error: 'Falta la tarjeta.' }, 422)
        }
        const metodo = pago.paymentMethodId.toLowerCase()
        if (metodo.startsWith('deb') || metodo === 'account_money') {
          return json({ data: null, error: 'La consulta inmediata se paga con tarjeta de crédito.' }, 422)
        }
        if (pago.savedCardId) {
          const { data: suya } = await db.from('payment_methods').select('id')
            .eq('id', pago.savedCardId).eq('user_id', user.id).maybeSingle()
          if (!suya) return json({ data: null, error: 'No encontramos la tarjeta guardada.' }, 422)
        }
      }

      // Si no hay nadie, se corta ANTES de guardar nada: no tiene sentido
      // hacerle esperar 4 minutos a un pedido que no le va a sonar a nadie.
      if ((await cuantosElegibles(db, especialidades, user.id)) === 0) {
        return json({ data: { sinProfesionales: true }, error: null })
      }

      const { data: pedido, error: insErr } = await db
        .from('ondemand_requests')
        .insert({
          patient_id: user.id,
          para_id: paraId && paraId !== user.id ? paraId : null,
          vertical,
          specialty: especialidades[0],
          especialidades,
          price_at_request: ajuste.ondemand_price,
          payment_method_id: pago?.savedCardId ?? null,
          estado_pago: exento ? 'sin_pago' : 'pendiente',
          expires_at: new Date(Date.now() + BUSQUEDA_MS).toISOString(),
        })
        .select('id, expires_at, avisados')
        .single()
      if (insErr || !pedido) {
        console.error('ondemand-despacho: no se pudo crear el pedido:', insErr?.message)
        return json({ data: null, error: 'No pudimos iniciar la búsqueda. Probá de nuevo.' }, 500)
      }

      if (!exento && pago) {
        const { error: cobroErr } = await db.from('ondemand_request_cobros').insert({
          request_id: pedido.id,
          payer_id: user.id,
          card_token: await encryptToken(pago.cardToken),
          payment_method_id: pago.paymentMethodId,
          saved_card_id: pago.savedCardId ?? null,
          payer_email: pago.payerEmail ?? perfil?.email ?? user.email ?? null,
          payer_doc_type: pago.payerDocType ?? null,
          payer_doc_number: pago.payerDocNumber ?? null,
          device_id: pago.deviceId ?? null,
        })
        if (cobroErr) {
          // Sin el token nadie podría cobrar al aceptar: el pedido no puede sonar.
          await db.from('ondemand_requests').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', pedido.id)
          console.error('ondemand-despacho: no se pudo guardar el token:', cobroErr.message)
          return json({ data: null, error: 'No pudimos guardar el pago. Probá de nuevo.' }, 500)
        }
      }

      return json({ data: { requestId: pedido.id, expiresAt: pedido.expires_at }, error: null })
    }

    // ── cancelar / extender (paciente) ───────────────────────────────────────
    if (action === 'cancelar' || action === 'extender') {
      const { data: pedido } = await db.from('ondemand_requests')
        .select('id, patient_id, status, created_at').eq('id', body.requestId).maybeSingle()
      if (!pedido || pedido.patient_id !== user.id) return json({ data: null, error: 'Pedido no encontrado' }, 404)

      if (action === 'cancelar') {
        // Condicional al estado: si justo lo aceptaron, no se pisa. El paciente
        // ve "te atiende X" y desde ahí puede cancelar la consulta (libera la
        // reserva con mp-capture, como siempre).
        const { data: hecho } = await db.from('ondemand_requests')
          .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
          .eq('id', pedido.id).eq('status', 'pending')
          .select('id').maybeSingle()
        await db.from('ondemand_request_cobros').delete().eq('request_id', pedido.id)
        return json({ data: { cancelado: Boolean(hecho) }, error: null })
      }

      const techo = new Date(pedido.created_at).getTime() + BUSQUEDA_MAX_MS
      const nuevo = Math.min(Date.now() + BUSQUEDA_MS, techo)
      if (nuevo <= Date.now()) return json({ data: null, error: 'Ya buscamos todo el tiempo que podíamos.' }, 409)
      // Un pedido recién vencido (el cron corre cada minuto) también se puede
      // revivir mientras no lo haya tomado nadie.
      const { data: hecho } = await db.from('ondemand_requests')
        .update({ status: 'pending', expires_at: new Date(nuevo).toISOString() })
        .eq('id', pedido.id).in('status', ['pending', 'expired'])
        .select('id, expires_at').maybeSingle()
      if (!hecho) return json({ data: null, error: 'El pedido ya no está activo.' }, 409)
      const { count } = await db.from('ondemand_request_cobros').select('request_id', { count: 'exact', head: true }).eq('request_id', pedido.id)
      return json({ data: { expiresAt: hecho.expires_at, sinToken: count === 0 }, error: null })
    }

    // ── aceptar (profesional) ────────────────────────────────────────────────
    if (action === 'aceptar') {
      // La toma corre con la sesión del profesional: `auth.uid()` adentro del
      // RPC es él, y ahí está toda la validación de elegibilidad.
      const { data: consultationId, error: rpcErr } = await userDb.rpc('accept_ondemand_request', { p_request_id: body.requestId })
      if (rpcErr) return json({ data: null, error: rpcErr.message }, 403)
      if (!consultationId) return json({ data: { tomada: false }, error: null })

      const { data: pedido } = await db.from('ondemand_requests')
        .select('id, patient_id, vertical, estado_pago').eq('id', body.requestId).single()

      if (pedido.estado_pago === 'sin_pago') {
        await db.from('consultations').update({ payment_status: 'exempt', status: 'confirmed' }).eq('id', consultationId)
        return json({ data: { tomada: true, consultationId, pago: 'sin_pago' }, error: null })
      }

      const { data: cobro } = await db.from('ondemand_request_cobros').select('*').eq('request_id', pedido.id).maybeSingle()
      let estado: 'autorizado' | 'rechazado' = 'rechazado'
      let detalle: string | null = null

      if (!cobro) {
        detalle = 'sin_token'
      } else {
        // El token es de un solo uso: se borra ANTES de usarlo, salga como salga.
        await db.from('ondemand_request_cobros').delete().eq('request_id', pedido.id)
        const res = await fetch(`${SUPABASE_URL}/functions/v1/mp-payment`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actuarComo: cobro.payer_id,
            consultationId,
            cardToken: await decryptToken(cobro.card_token),
            paymentMethodId: cobro.payment_method_id,
            savedCardId: cobro.saved_card_id ?? undefined,
            payerEmail: cobro.payer_email ?? undefined,
            payerDocType: cobro.payer_doc_type ?? undefined,
            payerDocNumber: cobro.payer_doc_number ?? undefined,
            deviceId: cobro.device_id ?? undefined,
            useCredits: false,
            authorizeOnly: true,
            description: `Consulta inmediata — Tele-${pedido.vertical}`,
          }),
        })
        const r = await res.json().catch(() => ({}))
        if (r?.data?.status === 'authorized' || r?.data?.status === 'approved') {
          estado = 'autorizado'
        } else {
          detalle = r?.data?.statusDetail ?? r?.error ?? `http_${res.status}`
        }
      }

      await db.from('ondemand_requests').update({ estado_pago: estado, pago_detalle: detalle }).eq('id', pedido.id)

      if (estado === 'rechazado') {
        // Al profesional: ya aceptó, que no se quede esperando sin saber por qué.
        await db.rpc('enviar_push', {
          p_user_id: user.id,
          p_titulo: 'Esperando el pago del paciente',
          p_cuerpo: 'Su tarjeta fue rechazada y le pedimos otra. Te avisamos cuando esté listo.',
          p_url: '/profesional/dashboard',
        })
        await db.rpc('enviar_push', {
          p_user_id: pedido.patient_id,
          p_titulo: 'Tu tarjeta fue rechazada',
          p_cuerpo: 'Ya hay un profesional esperándote. Elegí otra tarjeta para seguir.',
          p_url: `/paciente/ondemand/${pedido.vertical}`,
        })
      }

      return json({ data: { tomada: true, consultationId, pago: estado, detalle }, error: null })
    }

    return json({ data: null, error: `Acción desconocida: ${action}` }, 400)
  } catch (err) {
    console.error('ondemand-despacho error:', err)
    return json({ data: null, error: err instanceof Error ? err.message : 'Error interno' }, 500)
  }
})
