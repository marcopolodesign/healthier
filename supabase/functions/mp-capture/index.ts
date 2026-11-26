/**
 * mp-capture — On-demand pre-authorization lifecycle (capture / cancel-auth / sweep)
 *
 * Companion to mp-payment's `authorizeOnly` flow (SECCIÓN C1): a consultation
 * paid with `authorizeOnly: true` reserves the amount on the patient's credit
 * card (`payments.status = 'authorized'`) without charging it. This function
 * resolves that reservation one of two ways:
 *   - `capture`     — the consultation happened → charge the reserved amount.
 *   - `cancel-auth` — the consultation was abandoned/timed out → release the
 *                     reservation, nothing is charged.
 *
 * POST /mp-capture  { action, ...params }
 *
 * action: "capture"     body: { consultationId }
 *   Caller = the professional who owns the consultation, or admin/super_admin.
 *   Finds the consultation's `authorized` (or already `approved`, for
 *   idempotency) payment → PUT /v1/payments/{mp_payment_id} { capture: true }
 *   using the seller's own OAuth token (ensureFreshMpToken) + an
 *   X-Idempotency-Key → payments.status='approved' + captured_at,
 *   consultations.payment_status='paid' + paid_at. Already approved → 200
 *   with `alreadyCaptured: true`, no MP call.
 *
 * action: "cancel-auth" body: { consultationId }
 *   Caller = the patient or professional who owns the consultation, or
 *   admin/super_admin. Same idea but PUT { status: "cancelled" } →
 *   payments.status='cancelled' + auth_cancelled_at, consultations.status=
 *   'cancelled' + payment_status='pending_payment'. Already cancelled → 200
 *   with `alreadyCancelled: true`, no MP call.
 *
 * action: "capture-emergency"     body: { emergencyId }  — traslado hecho, se cobra
 * action: "cancel-auth-emergency" body: { emergencyId }  — cancelado, se libera
 *   Sin reserva para cobrar (S.O.S. bonificado, o sin preautorización por lo
 *   que sea) ninguna de las dos falla: capture contesta `sinPago: true` para
 *   que el front muestre el cartel y pida el mensaje de cierre; cancel
 *   contesta OK, no hay nada que liberar.
 * action: "cerrar-sin-pago"       body: { emergencyId, nota } — registra el
 *   cierre sin cobro (quién, cuándo, mensaje). Sólo si NO hay una reserva
 *   autorizada: con plata reservada, la emergencia se cobra, no se cierra así.
 * action: "cancel-emergency"      body: { emergencyId }  — el paciente cancela;
 *   sin móvil se libera ({cobrado:false}), con móvil asignado se cobra igual
 *   ({cobrado:true, monto}). arrived/completed/cancelled → 409.
 * action: "capture-pharmacy-order" body: { orderId } — Solicitar receta / Ya tengo
 *                                 receta (migración 254): la receta quedó resuelta, se
 *                                 COBRA la retención del pedido de farmacia. Lo llama el
 *                                 médico de Healthier asignado, la farmacia, un admin o el
 *                                 servidor. Re-valida todo del lado del servidor.
 * action: "cancel-pharmacy-order" body: { orderId, motivo } — se LIBERA la retención y el
 *                                 pedido se cancela (no se cobra). Lo llama el médico
 *                                 asignado, la farmacia, un admin, el paciente mientras
 *                                 nadie tomó el pedido, o el servidor. Idempotente.
 * action: "sweep" (no body)
 *   Internal-only — header `x-cron-secret` === MP_CRON_SECRET or
 *   MP_WEBHOOK_SECRET, or `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`
 *   (same auth pattern as mp-refresh-tokens). Scans every `authorized`
 *   payment and:
 *     (a) cancels stuck authorizations — the consultation is_on_demand,
 *         created more than 10 minutes ago, and never reached
 *         in_progress/completed (the professional never connected or the
 *         patient never entered the call);
 *     (b) captures orphaned authorizations — the consultation reached
 *         completed but nothing (or a failed client-side call) ever
 *         triggered `capture` — this is the backstop for D2.
 *   Meant to run on a 5-minute pg_cron schedule (registered by the
 *   orchestrator, not this function — see repo precedent in
 *   mp-refresh-tokens for why the cron.schedule() call itself isn't
 *   committed in a migration).
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { puedeActuarComo } from "../_shared/familia.ts";
import { ensureFreshMpToken, PAYMENT_REFRESH_MARGIN_MS, type MpAccountRow } from "../_shared/mpRefresh.ts";
import { ensureFreshPharmacyMpToken } from "../_shared/pharmacyMpRefresh.ts";

const MP_API_BASE = "https://api.mercadopago.com/v1";

// On-demand timeout — default cutoff when the consultation carries no explicit
// deadline (`ondemand_wait_until`): rows created before that column existed, or
// an authorization whose deadline never llegó a escribirse.
const AUTH_TIMEOUT_MS = 10 * 60 * 1000;

// Colchón sobre el vencimiento que pidió el paciente. El barrido corre cada 5
// minutos y la pantalla le pregunta "¿necesitás más tiempo?" justo al vencer:
// sin este margen, el cron podía soltarle la reserva mientras estaba leyendo la
// pregunta.
const SWEEP_GRACE_MS = 2 * 60 * 1000;

// Tope duro de retención, pase lo que pase con los "necesito más tiempo": la
// plata del paciente no queda tomada indefinidamente porque dejó la pestaña
// abierta. La pantalla corta antes (20 minutos), esto es el respaldo.
const MAX_HOLD_MS = 30 * 60 * 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const MP_WEBHOOK_SECRET = Deno.env.get("MP_WEBHOOK_SECRET")!;
const MP_CRON_SECRET = Deno.env.get("MP_CRON_SECRET");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * ¿La llamada viene del servidor (service role)? Igualdad con el secret o, si la
 * key que usa quien llama (vault de la base, scripts) tiene otro formato, el rol
 * `service_role` del JWT — que el gateway ya verificó (verify_jwt = true).
 */
function esLlamadaDeServicio(authHeader: string | null): boolean {
  if (!authHeader) return false;
  if (authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) return true;
  try {
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    const claims = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return claims?.role === "service_role";
  } catch {
    return false;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface PaymentRow {
  id: string;
  mp_payment_id: string | null;
  professional_id: string;
  patient_id: string;
  status: string;
}

interface ConsultationRow {
  id: string;
  patient_id: string;
  professional_id: string;
  status: string;
  payment_status: string;
  is_on_demand: boolean;
}

/** Loads the seller's (professional's) fresh MP access token, or an error string. */
async function getSellerAccessToken(
  supabase: SupabaseClient,
  professionalId: string
): Promise<{ accessToken: string; error: null } | { accessToken: null; error: string }> {
  const { data: mpAccount, error: mpAccErr } = await supabase
    .from("mp_accounts")
    .select("professional_id, access_token, refresh_token, expires_at, active")
    .eq("professional_id", professionalId)
    .eq("active", true)
    .single();

  if (mpAccErr || !mpAccount) {
    return { accessToken: null, error: "Professional's MercadoPago account not found or inactive" };
  }

  const refreshResult = await ensureFreshMpToken(supabase, mpAccount as MpAccountRow, PAYMENT_REFRESH_MARGIN_MS);
  if (refreshResult.invalidGrant) {
    return { accessToken: null, error: "MercadoPago connection expired — professional must reconnect" };
  }
  return { accessToken: refreshResult.accessToken, error: null };
}

/** Captures an authorized pre-auth payment (charges the reserved amount). Idempotent. */
async function captureAuthorizedPayment(
  supabase: SupabaseClient,
  payment: PaymentRow,
  consultationId: string
): Promise<{ status: number; data: unknown; error: string | null }> {
  if (payment.status === "approved") {
    return { status: 200, data: { captured: true, alreadyCaptured: true }, error: null };
  }
  if (payment.status !== "authorized") {
    return { status: 409, data: null, error: `Payment is not authorized (status=${payment.status})` };
  }
  if (!payment.mp_payment_id) {
    return { status: 422, data: null, error: "Payment has no mp_payment_id" };
  }

  const { accessToken, error: tokenError } = await getSellerAccessToken(supabase, payment.professional_id);
  if (!accessToken) return { status: 422, data: null, error: tokenError };

  const idempotencyKey = await sha256Hex(`capture:${payment.id}:${payment.mp_payment_id}`);

  const mpRes = await fetch(`${MP_API_BASE}/payments/${payment.mp_payment_id}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ capture: true }),
  });

  const mpData = await mpRes.json().catch(() => ({} as Record<string, unknown>));

  if (!mpRes.ok) {
    console.error("mp-capture: MP capture error:", JSON.stringify(mpData));
    return {
      status: 502,
      data: null,
      error: (mpData as { message?: string })?.message ?? "MercadoPago capture failed",
    };
  }

  const now = new Date().toISOString();

  // La respuesta del capture ES el objeto payment completo, con las comisiones
  // reales adentro. Antes se descartaba y sólo se escribía status + captured_at,
  // así que `mp_fee_actual` quedaba en NULL salvo que llegara un webhook después
  // — y para un pre-auth capturado desde acá normalmente no llega. Resultado
  // medido en el pago 170000525607: la base decía comisión 79,90 y neto 780
  // cuando MP cobró 41 y acreditó 818,90.
  const { error: paymentUpdateErr } = await supabase
    .from("payments")
    .update({ status: "approved", captured_at: now, ...reconciledFromMp(mpData) })
    .eq("id", payment.id);
  if (paymentUpdateErr) console.error("mp-capture: payments update error:", paymentUpdateErr.message);

  const { error: consUpdateErr } = await supabase
    .from("consultations")
    .update({ payment_status: "paid", paid_at: now })
    .eq("id", consultationId);
  if (consUpdateErr) console.error("mp-capture: consultations update error:", consUpdateErr.message);

  return { status: 200, data: { captured: true }, error: null };
}

/** Cancels (releases) an authorized pre-auth payment. Idempotent. */
async function cancelAuthorizedPayment(
  supabase: SupabaseClient,
  payment: PaymentRow,
  consultationId: string
): Promise<{ status: number; data: unknown; error: string | null }> {
  if (payment.status === "cancelled") {
    return { status: 200, data: { cancelled: true, alreadyCancelled: true }, error: null };
  }
  if (payment.status !== "authorized") {
    return { status: 409, data: null, error: `Payment is not authorized (status=${payment.status})` };
  }
  if (!payment.mp_payment_id) {
    return { status: 422, data: null, error: "Payment has no mp_payment_id" };
  }

  const { accessToken, error: tokenError } = await getSellerAccessToken(supabase, payment.professional_id);
  if (!accessToken) return { status: 422, data: null, error: tokenError };

  const idempotencyKey = await sha256Hex(`cancel-auth:${payment.id}:${payment.mp_payment_id}`);

  const mpRes = await fetch(`${MP_API_BASE}/payments/${payment.mp_payment_id}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ status: "cancelled" }),
  });

  const mpData = await mpRes.json().catch(() => ({} as Record<string, unknown>));

  if (!mpRes.ok) {
    console.error("mp-capture: MP cancel-auth error:", JSON.stringify(mpData));
    return {
      status: 502,
      data: null,
      error: (mpData as { message?: string })?.message ?? "MercadoPago authorization cancel failed",
    };
  }

  const now = new Date().toISOString();

  const { error: paymentUpdateErr } = await supabase
    .from("payments")
    .update({ status: "cancelled", auth_cancelled_at: now })
    .eq("id", payment.id);
  if (paymentUpdateErr) console.error("mp-capture: payments update error:", paymentUpdateErr.message);

  const { error: consUpdateErr } = await supabase
    .from("consultations")
    .update({ status: "cancelled", payment_status: "pending_payment" })
    .eq("id", consultationId);
  if (consUpdateErr) console.error("mp-capture: consultations update error:", consUpdateErr.message);

  return { status: 200, data: { cancelled: true }, error: null };
}

/**
 * Captura o libera la preautorización de una EMERGENCIA.
 *
 * Un solo helper para los dos casos porque, salvo el verbo, es el mismo
 * pedido a MP. La diferencia real con el de consultas es el token: la
 * emergencia la cobró la plataforma (mp-payment, rama `emergencyId`), no la
 * cuenta vinculada de un profesional, así que acá NO se llama a
 * getSellerAccessToken — con el token del profesional MP contesta 404 y la
 * reserva se queda colgada en la tarjeta del paciente hasta que vence sola.
 */
async function resolverPreautorizacionDeEmergencia(
  supabase: SupabaseClient,
  payment: PaymentRow,
  emergencyId: string,
  accion: "capture" | "cancel"
): Promise<{ status: number; data: unknown; error: string | null }> {
  const estadoFinal = accion === "capture" ? "approved" : "cancelled";
  if (payment.status === estadoFinal) {
    return { status: 200, data: { yaResuelta: true, accion }, error: null };
  }
  if (payment.status !== "authorized") {
    return { status: 409, data: null, error: `Payment is not authorized (status=${payment.status})` };
  }
  if (!payment.mp_payment_id) {
    return { status: 422, data: null, error: "Payment has no mp_payment_id" };
  }

  const platformToken = Deno.env.get("MP_IS_PROD") === "true"
    ? Deno.env.get("MP_ACCESS_TOKEN_PROD")!
    : Deno.env.get("MP_ACCESS_TOKEN_SANDBOX")!;

  const idempotencyKey = await sha256Hex(`emergency-${accion}:${payment.id}:${payment.mp_payment_id}`);

  const mpRes = await fetch(`${MP_API_BASE}/payments/${payment.mp_payment_id}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${platformToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(accion === "capture" ? { capture: true } : { status: "cancelled" }),
  });

  const mpData = await mpRes.json().catch(() => ({} as Record<string, unknown>));

  if (!mpRes.ok) {
    console.error(`mp-capture (emergency ${accion}): MP error:`, JSON.stringify(mpData));
    return {
      status: 502,
      data: null,
      error: (mpData as { message?: string })?.message ?? "MercadoPago request failed",
    };
  }

  const now = new Date().toISOString();
  const patch = accion === "capture"
    ? { status: "approved", captured_at: now, ...reconciledFromMp(mpData) }
    : { status: "cancelled", auth_cancelled_at: now };

  const { error: payErr } = await supabase.from("payments").update(patch).eq("id", payment.id);
  if (payErr) console.error("mp-capture (emergency): payments update error:", payErr.message);

  // La emergencia NO se toca acá: el estado del traslado lo mueve quien lo
  // vive (la tripulación marca llegó/terminó, el paciente cancela). Escribirlo
  // también desde el cobro es la forma de que los dos se contradigan.
  if (accion === "cancel") {
    const { error: emErr } = await supabase
      .from("emergencies")
      .update({ paid_at: null })
      .eq("id", emergencyId);
    if (emErr) console.error("mp-capture (emergency): emergencies update error:", emErr.message);
  }

  return { status: 200, data: accion === "capture" ? { captured: true } : { cancelled: true }, error: null };
}

const EMERGENCIA_SIN_MOVIL = ["pending", "awaiting_dispatch"];
const EMERGENCIA_CON_MOVIL = ["dispatched", "in_transit"];

/**
 * Cancela una emergencia y decide qué pasa con la reserva según el estado que
 * tenga la base EN ESE MOMENTO:
 *   - sin móvil (pending / awaiting_dispatch) → se libera, no se cobra.
 *   - con móvil (dispatched / in_transit)      → se captura y después se cancela.
 *   - arrived / completed / cancelled          → 409.
 *
 * `esperado` ("sin_movil" | "con_movil") es lo que el paciente vio cuando
 * confirmó. Si la base ya está en el otro lado (p. ej. le asignaron un móvil
 * mientras leía "no se te cobra nada"), contesta 409 sin tocar nada: nunca se
 * cobra algo que el paciente no aceptó. Sin `esperado` (app vieja) no se
 * chequea. Un S.O.S. bonificado no tiene nada que cobrar: tampoco se chequea.
 *
 * Sin carreras con el despacho: cada rama cambia el estado con un UPDATE
 * condicional (`.in("status", …)`). Si el operador asignó un móvil entre la
 * lectura y la escritura, el UPDATE no toca nada y se vuelve a decidir con el
 * estado nuevo — gana lo que diga la base.
 *
 * El orden de cada rama es a propósito:
 *   - Sin móvil: primero se cancela, después se libera. Al revés, un despacho
 *     que entra en el medio deja una ambulancia en camino sin reserva.
 *   - Con móvil: primero se captura, después se cancela. Si la captura falla,
 *     la emergencia sigue activa y se devuelve el error.
 *
 * Cualquier error de lectura o escritura de la base corta con 500: un error
 * no se confunde con "no hay reserva" ni con "cambió el estado".
 */
async function cancelarEmergencia(
  supabase: SupabaseClient,
  emergencyId: string,
  userId: string,
  isAdmin: boolean,
  esperado?: string
): Promise<{ status: number; data: unknown; error: string | null }> {
  const errorBase = (donde: string, e: { message: string }) => {
    console.error(`mp-capture (cancel-emergency) ${donde}:`, e.message);
    return { status: 500, data: null, error: "No pudimos cancelar la emergencia. Probá de nuevo." };
  };

  for (let intento = 0; intento < 3; intento++) {
    const { data: emergencia, error: eErr } = await supabase
      .from("emergencies")
      .select("id, patient_id, status, price_at_request, bonificada")
      .eq("id", emergencyId)
      .maybeSingle();
    if (eErr) return errorBase("leer la emergencia", eErr);
    if (!emergencia) return { status: 404, data: null, error: "No encontramos la emergencia." };
    if (emergencia.patient_id !== userId && !isAdmin) {
      return { status: 403, data: null, error: "Esta emergencia no es tuya." };
    }

    const estado = emergencia.status as string;
    const lado = EMERGENCIA_SIN_MOVIL.includes(estado) ? "sin_movil"
      : EMERGENCIA_CON_MOVIL.includes(estado) ? "con_movil" : null;
    if (esperado && lado && esperado !== lado && emergencia.bonificada !== true) {
      return {
        status: 409,
        data: { estado },
        error: lado === "con_movil"
          ? "Mientras confirmabas se asignó una ambulancia: si cancelás ahora se cobra el servicio. Revisalo y volvé a confirmar."
          : "La emergencia cambió de estado. Revisala y volvé a confirmar.",
      };
    }

    if (lado === "sin_movil") {
      const { data: cancelada, error: uErr } = await supabase
        .from("emergencies")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancellation_charged: false })
        .eq("id", emergencyId)
        .in("status", EMERGENCIA_SIN_MOVIL)
        .select("id")
        .maybeSingle();
      if (uErr) return errorBase("cancelar sin móvil", uErr);
      if (!cancelada) continue; // el despacho se movió en el medio: se relee

      const { data: payment, error: pErr } = await supabase
        .from("payments")
        .select("*")
        .eq("emergency_id", emergencyId)
        .eq("status", "authorized")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pErr) {
        // Ya está cancelada y sin cargo: lo que no se pudo leer es la reserva,
        // que vence sola. Queda en el log.
        console.error("mp-capture (cancel-emergency): no se pudo leer la reserva para liberarla:", pErr.message);
      } else if (payment) {
        // Si MP falla, la cancelación igual vale: la reserva vence sola y queda
        // en el log para mirarla. No se le cobra nada al paciente.
        const liberada = await resolverPreautorizacionDeEmergencia(
          supabase, payment as PaymentRow, emergencyId, "cancel"
        );
        if (liberada.error) {
          console.error("mp-capture (cancel-emergency): no se pudo liberar la reserva:", liberada.error);
        }
      }
      return { status: 200, data: { cobrado: false }, error: null };
    }

    if (lado === "con_movil") {
      const { data: payment, error: pErr } = await supabase
        .from("payments")
        .select("*")
        .eq("emergency_id", emergencyId)
        .in("status", ["authorized", "approved"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pErr) return errorBase("leer la reserva", pErr);

      let monto: number | null = null;
      if (payment) {
        const capturada = await resolverPreautorizacionDeEmergencia(
          supabase, payment as PaymentRow, emergencyId, "capture"
        );
        if (capturada.error) {
          return { status: capturada.status, data: null, error: capturada.error };
        }
        const p = payment as Record<string, unknown>;
        monto = Number(p.charged_amount ?? p.gross_amount ?? emergencia.price_at_request ?? 0) || null;
      } else {
        // Despachada sin reserva: S.O.S. bonificado (migración 210, `paid_at`
        // sin MP) o un caso raro. No hay nada que cobrar: se cancela igual sin
        // cargo; si no era bonificada, queda en el log para mirarla.
        if (emergencia.bonificada !== true) {
          console.error(`mp-capture (cancel-emergency): ${emergencyId} despachada sin pago autorizado`);
        }
      }

      const cobrada = Boolean(payment);
      const { data: cancelada, error: uErr } = await supabase
        .from("emergencies")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancellation_charged: cobrada })
        .eq("id", emergencyId)
        .in("status", EMERGENCIA_CON_MOVIL)
        .select("id")
        .maybeSingle();
      if (uErr) {
        // Puede que ya se haya capturado: queda en el log con el id para
        // revisarlo a mano. La emergencia sigue como estaba.
        console.error(`mp-capture (cancel-emergency): ${emergencyId} capturada=${cobrada} pero no se pudo cancelar:`, uErr.message);
        return { status: 500, data: null, error: "No pudimos cancelar la emergencia. Llamá a despacho." };
      }
      if (!cancelada) {
        // Otro movió el estado mientras se capturaba. Se dice lo que pasó de
        // verdad, y si la canceló el despacho, la marca de cobro refleja la
        // captura que ya se hizo.
        const { data: ahora, error: aErr } = await supabase
          .from("emergencies").select("status").eq("id", emergencyId).maybeSingle();
        if (aErr) {
          console.error(`mp-capture (cancel-emergency): ${emergencyId} capturada=${cobrada}, no se pudo releer el estado:`, aErr.message);
          return { status: 500, data: null, error: "No pudimos cancelar la emergencia. Llamá a despacho." };
        }
        if (ahora?.status === "cancelled") {
          if (cobrada) {
            const { error: mErr } = await supabase
              .from("emergencies").update({ cancellation_charged: true }).eq("id", emergencyId);
            if (mErr) {
              console.error(`mp-capture (cancel-emergency): ${emergencyId} capturada=true, cancelada por el despacho, no se pudo marcar cobrada:`, mErr.message);
              return { status: 500, data: null, error: "Se cobró el servicio pero no pudimos registrarlo. Llamá a despacho." };
            }
          }
          return { status: 200, data: cobrada ? { cobrado: true, monto } : { cobrado: false }, error: null };
        }
        return {
          status: 409,
          data: null,
          error: ahora?.status === "completed"
            ? "La emergencia ya terminó."
            : "La ambulancia ya llegó: la emergencia no se puede cancelar.",
        };
      }
      return cobrada
        ? { status: 200, data: { cobrado: true, monto }, error: null }
        : { status: 200, data: { cobrado: false }, error: null };
    }

    const motivo = estado === "cancelled"
      ? "La emergencia ya estaba cancelada."
      : estado === "completed"
        ? "La emergencia ya terminó."
        : "La ambulancia ya llegó: la emergencia no se puede cancelar.";
    return { status: 409, data: null, error: motivo };
  }
  return { status: 409, data: null, error: "La emergencia cambió de estado. Intentá de nuevo." };
}

interface PedidoRetenido {
  id: string;
  patient_id: string;
  pharmacy_id: string;
  payment_status: string;
  status: string;
  receta_estado: string | null;
  receta_medico_id: string | null;
}

type ResultadoFarmacia = { status: number; data: unknown; error: string | null; code?: string };

const MOTIVO_VENCIDA = "La receta no se resolvió a tiempo. Liberamos la retención y no se te cobró.";
/** MP vence la pre-autorización a los ~7 días: se libera a los 5, con margen. */
const RETENCION_FARMACIA_MAX_DIAS = 5;

async function cargarPedidoRetenido(supabase: SupabaseClient, orderId: string): Promise<PedidoRetenido | null> {
  const { data } = await supabase
    .from("medication_orders")
    .select("id, patient_id, pharmacy_id, payment_status, status, receta_estado, receta_medico_id")
    .eq("id", orderId)
    .maybeSingle();
  return (data as PedidoRetenido | null) ?? null;
}

/** El token con el que se CREÓ la retención: la cuenta de Mercado Pago de la farmacia. */
async function tokenDeLaFarmacia(
  supabase: SupabaseClient,
  pharmacyId: string
): Promise<{ accessToken: string; error: null } | { accessToken: null; error: string }> {
  const { data: cuenta } = await supabase
    .from("pharmacy_mp_accounts")
    .select("pharmacy_id, mp_user_id, access_token, refresh_token, expires_at, active")
    .eq("pharmacy_id", pharmacyId)
    .maybeSingle();
  if (!cuenta) return { accessToken: null, error: "La cuenta de Mercado Pago de la farmacia no está conectada" };
  const r = await ensureFreshPharmacyMpToken(supabase, cuenta, PAYMENT_REFRESH_MARGIN_MS);
  if (r.invalidGrant) {
    return { accessToken: null, error: "La conexión de Mercado Pago de la farmacia venció — tiene que reconectarla" };
  }
  return { accessToken: r.accessToken, error: null };
}

async function pagoDelPedido(supabase: SupabaseClient, orderId: string) {
  const { data } = await supabase
    .from("payments")
    .select("id, mp_payment_id, status")
    .eq("order_id", orderId)
    .in("status", ["authorized", "approved", "cancelled"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { id: string; mp_payment_id: string | null; status: string } | null;
}

/** Cobra la retención de un pedido de farmacia. Idempotente. */
async function cobrarPedidoDeFarmacia(supabase: SupabaseClient, orderId: string): Promise<ResultadoFarmacia> {
  const pedido = await cargarPedidoRetenido(supabase, orderId);
  if (!pedido) return { status: 404, data: null, error: "Order not found" };
  if (pedido.payment_status === "pagado") {
    return { status: 200, data: { captured: true, alreadyCaptured: true }, error: null };
  }
  if (pedido.payment_status !== "autorizado") {
    return { status: 409, data: null, error: `Order is not retained (payment_status=${pedido.payment_status})` };
  }
  if (pedido.status === "cancelado" || pedido.receta_estado === "rechazada") {
    return { status: 409, data: null, error: "El pedido está cancelado: no se cobra." };
  }

  // La receta se valida ACÁ, del lado del servidor, con lo que hay en la base
  // en este momento (la receta pudo vencer o usarse en otro pedido).
  const { data: faltan, error: atarErr } = await supabase.rpc("farmacia_atar_items_solicitados", { p_order: orderId });
  if (atarErr) {
    console.error("mp-capture (farmacia): atar items error:", atarErr.message);
    return { status: 503, data: null, error: "No pudimos validar las recetas del pedido. Probá de nuevo." };
  }
  const { data: sinResolver, error: valErr } = await supabase.rpc("farmacia_items_receta_sin_resolver", { p_order: orderId });
  const { data: sinReceta, error: val2Err } = await supabase.rpc("farmacia_items_sin_receta", { p_order: orderId });
  if (valErr || val2Err) {
    console.error("mp-capture (farmacia): validación error:", (valErr ?? val2Err)?.message);
    return { status: 503, data: null, error: "No pudimos validar las recetas del pedido. Probá de nuevo." };
  }
  if ((faltan as number) > 0 || (sinResolver ?? []).length > 0 || (sinReceta ?? []).length > 0) {
    return {
      status: 422,
      code: "RECETA_NO_RESUELTA",
      data: { pendientes: [...(sinResolver ?? []), ...(sinReceta ?? [])] },
      error: "Todavía falta resolver la receta de algún medicamento: no se cobra.",
    };
  }

  const pago = await pagoDelPedido(supabase, orderId);
  if (!pago || pago.status === "cancelled") {
    return { status: 422, data: null, error: "No authorized payment found for this order" };
  }

  const ahora = new Date().toISOString();
  if (pago.status === "authorized") {
    if (!pago.mp_payment_id) return { status: 422, data: null, error: "Payment has no mp_payment_id" };
    const t = await tokenDeLaFarmacia(supabase, pedido.pharmacy_id);
    if (!t.accessToken) return { status: 422, data: null, error: t.error };

    const idempotencyKey = await sha256Hex(`pharmacy-capture:${pago.id}:${pago.mp_payment_id}`);
    const mpRes = await fetch(`${MP_API_BASE}/payments/${pago.mp_payment_id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${t.accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ capture: true }),
    });
    const mpData = await mpRes.json().catch(() => ({} as Record<string, unknown>));
    if (!mpRes.ok) {
      console.error("mp-capture (farmacia capture): MP error:", JSON.stringify(mpData));
      return { status: 502, data: null, error: (mpData as { message?: string })?.message ?? "MercadoPago capture failed" };
    }
    const { error: payErr } = await supabase
      .from("payments")
      .update({ status: "approved", captured_at: ahora, ...reconciledFromMp(mpData) })
      .eq("id", pago.id);
    if (payErr) console.error("mp-capture (farmacia): payments update error:", payErr.message);
  }

  const { error: ordErr } = await supabase
    .from("medication_orders")
    .update({ payment_status: "pagado", receta_estado: "resuelta", receta_resuelta_at: ahora })
    .eq("id", orderId);
  if (ordErr) {
    console.error("mp-capture (farmacia): medication_orders update error:", ordErr.message);
    return { status: 500, data: null, error: "Se cobró pero no pudimos actualizar el pedido" };
  }
  return { status: 200, data: { captured: true }, error: null };
}

/** Libera la retención de un pedido de farmacia y lo cancela. Idempotente. */
async function liberarPedidoDeFarmacia(
  supabase: SupabaseClient,
  orderId: string,
  motivo: string | null
): Promise<ResultadoFarmacia> {
  const pedido = await cargarPedidoRetenido(supabase, orderId);
  if (!pedido) return { status: 404, data: null, error: "Order not found" };
  if (pedido.payment_status === "pagado") {
    return { status: 409, data: null, error: "El pedido ya está cobrado: no se puede liberar." };
  }
  if (pedido.status === "cancelado" && pedido.payment_status !== "autorizado") {
    return { status: 200, data: { cancelled: true, alreadyCancelled: true }, error: null };
  }
  if (pedido.payment_status !== "autorizado") {
    return { status: 409, data: null, error: `Order is not retained (payment_status=${pedido.payment_status})` };
  }

  const pago = await pagoDelPedido(supabase, orderId);
  const ahora = new Date().toISOString();

  if (pago?.status === "approved") {
    return { status: 409, data: null, error: "El pago ya se capturó: hay que reembolsarlo, no liberarlo." };
  }
  if (pago?.status === "authorized") {
    if (!pago.mp_payment_id) return { status: 422, data: null, error: "Payment has no mp_payment_id" };
    const t = await tokenDeLaFarmacia(supabase, pedido.pharmacy_id);
    if (!t.accessToken) return { status: 422, data: null, error: t.error };

    const idempotencyKey = await sha256Hex(`pharmacy-cancel:${pago.id}:${pago.mp_payment_id}`);
    const mpRes = await fetch(`${MP_API_BASE}/payments/${pago.mp_payment_id}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${t.accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ status: "cancelled" }),
    });
    const mpData = await mpRes.json().catch(() => ({} as Record<string, unknown>));
    if (!mpRes.ok) {
      console.error("mp-capture (farmacia cancel): MP error:", JSON.stringify(mpData));
      return { status: 502, data: null, error: (mpData as { message?: string })?.message ?? "MercadoPago authorization cancel failed" };
    }
    const { error: payErr } = await supabase
      .from("payments")
      .update({ status: "cancelled", auth_cancelled_at: ahora })
      .eq("id", pago.id);
    if (payErr) console.error("mp-capture (farmacia): payments update error:", payErr.message);
  }

  const texto = (motivo ?? "").trim() || "No corresponde recetar este medicamento. No se te cobró nada.";
  const { error: ordErr } = await supabase
    .from("medication_orders")
    .update({
      payment_status: "no_pagado",
      status: "cancelado",
      cancellation_reason: texto,
      receta_estado: "rechazada",
      receta_motivo_rechazo: texto,
    })
    .eq("id", orderId);
  if (ordErr) {
    console.error("mp-capture (farmacia): medication_orders update error:", ordErr.message);
    return { status: 500, data: null, error: "Se liberó la retención pero no pudimos actualizar el pedido" };
  }
  return { status: 200, data: { cancelled: true }, error: null };
}

/**
 * Barrido: retenciones de farmacia que pasaron de los 5 días sin resolverse
 * (MP vence la pre-autorización sola a los ~7) y las que ya fueron rechazadas
 * pero cuya liberación no llegó a salir (la llamada del trigger se perdió).
 */
async function sweepFarmacia(supabase: SupabaseClient) {
  const out = { scanned: 0, released: 0, failed: 0 };
  const limite = new Date(Date.now() - RETENCION_FARMACIA_MAX_DIAS * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from("medication_orders")
    .select("id, receta_estado, receta_motivo_rechazo, autorizado_at")
    .eq("payment_status", "autorizado")
    .or(`receta_estado.eq.rechazada,autorizado_at.lt.${limite}`);
  if (error) {
    console.error("mp-capture: sweep de farmacia no pudo leer las retenciones:", error.message);
    return out;
  }
  for (const row of (rows ?? []) as Array<{ id: string; receta_estado: string | null; receta_motivo_rechazo: string | null }>) {
    out.scanned++;
    try {
      const r = await liberarPedidoDeFarmacia(
        supabase, row.id, row.receta_estado === "rechazada" ? row.receta_motivo_rechazo : MOTIVO_VENCIDA
      );
      if (r.error) { out.failed++; console.error(`mp-capture: sweep farmacia ${row.id} falló:`, r.error); }
      else out.released++;
    } catch (err) {
      out.failed++;
      console.error(`mp-capture: sweep farmacia ${row.id} lanzó:`, err);
    }
  }
  return out;
}

interface SweepConsultationJoin {
  id: string;
  status: string;
  is_on_demand: boolean;
  created_at: string;
  ondemand_wait_until: string | null;
}

interface SweepPaymentRow extends PaymentRow {
  consultation_id: string;
  consultation: SweepConsultationJoin | SweepConsultationJoin[] | null;
}

function joinedConsultation(row: SweepPaymentRow): SweepConsultationJoin | null {
  if (!row.consultation) return null;
  return Array.isArray(row.consultation) ? row.consultation[0] ?? null : row.consultation;
}

/**
 * Hasta cuándo hay que dejar viva esta pre-autorización.
 *
 * El paciente puede haber pedido más tiempo desde la pantalla de espera
 * (`ondemand_wait_until`); sin eso vale el default histórico de 10 minutos. En
 * los dos casos se suma el colchón del cron y se capea con el tope duro, para
 * que ni el servidor cancele antes que la pantalla ni una pestaña olvidada
 * retenga plata para siempre.
 */
function holdDeadlineMs(consultation: SweepConsultationJoin): number {
  const createdMs = new Date(consultation.created_at).getTime();
  const pedido = consultation.ondemand_wait_until
    ? new Date(consultation.ondemand_wait_until).getTime()
    : createdMs + AUTH_TIMEOUT_MS;
  const conColchon = pedido + SWEEP_GRACE_MS;
  return Math.min(conColchon, createdMs + MAX_HOLD_MS);
}

async function runSweep(supabase: SupabaseClient) {
  const ahora = Date.now();

  const { data: authorizedPayments, error: fetchErr } = await supabase
    .from("payments")
    .select(
      "id, mp_payment_id, professional_id, patient_id, status, consultation_id, consultation:consultations!consultation_id(id, status, is_on_demand, created_at, ondemand_wait_until)"
    )
    .eq("status", "authorized");

  if (fetchErr) {
    console.error("mp-capture: sweep failed to fetch authorized payments:", fetchErr.message);
    return jsonResponse({ data: null, error: "Failed to fetch authorized payments" }, 500);
  }

  const rows = (authorizedPayments ?? []) as SweepPaymentRow[];

  const results = {
    scanned: rows.length,
    cancelled: 0,
    cancelFailed: 0,
    captured: 0,
    captureFailed: 0,
    skipped: 0,
  };

  for (const row of rows) {
    const consultation = joinedConsultation(row);
    if (!consultation) {
      results.skipped++;
      continue;
    }

    const payment: PaymentRow = {
      id: row.id,
      mp_payment_id: row.mp_payment_id,
      professional_id: row.professional_id,
      patient_id: row.patient_id,
      status: row.status,
    };

    // (a) Stuck on-demand authorizations — timed out without ever starting the call.
    // `closing` (migración 098: el profesional cortó la llamada y está cargando
    // el cierre) tiene que quedar afuera de "stuck" igual que in_progress —
    // sin esto, apenas el hold deadline vencía (normal: el cierre pasa minutos
    // después de que arrancó la llamada) el sweep cancelaba la pre-autorización
    // de una consulta que en realidad SÍ se prestó y está por cobrarse.
    const isStuck =
      consultation.is_on_demand &&
      ahora > holdDeadlineMs(consultation) &&
      !["in_progress", "closing", "completed"].includes(consultation.status);

    // (b) Orphaned authorizations whose consultation already completed —
    //     backstop for a client-side capture call that never fired (D2).
    const isOrphanedComplete = consultation.status === "completed";

    if (isStuck) {
      try {
        const result = await cancelAuthorizedPayment(supabase, payment, consultation.id);
        if (result.error) {
          results.cancelFailed++;
          console.error(`mp-capture: sweep cancel-auth failed for payment ${payment.id}:`, result.error);
        } else {
          results.cancelled++;
        }
      } catch (err) {
        results.cancelFailed++;
        console.error(`mp-capture: sweep cancel-auth threw for payment ${payment.id}:`, err);
      }
      continue;
    }

    if (isOrphanedComplete) {
      try {
        const result = await captureAuthorizedPayment(supabase, payment, consultation.id);
        if (result.error) {
          results.captureFailed++;
          console.error(`mp-capture: sweep capture failed for payment ${payment.id}:`, result.error);
        } else {
          results.captured++;
        }
      } catch (err) {
        results.captureFailed++;
        console.error(`mp-capture: sweep capture threw for payment ${payment.id}:`, err);
      }
      continue;
    }

    results.skipped++;
  }

  const farmacia = await sweepFarmacia(supabase);
  console.log("mp-capture: sweep complete", JSON.stringify({ ...results, farmacia }));
  return jsonResponse({ data: { ...results, farmacia }, error: null });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ data: null, error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = (body as { action?: string }).action;

    const serviceSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      SUPABASE_SERVICE_ROLE_KEY
    );

    // ────────────────────────────────────────────────────────────────────────
    // action: sweep — internal-only, no user JWT
    // ────────────────────────────────────────────────────────────────────────
    if (action === "sweep") {
      const cronSecret = req.headers.get("x-cron-secret");
      const authHeader = req.headers.get("Authorization");
      const isWebhookSecretValid = Boolean(MP_WEBHOOK_SECRET) && cronSecret === MP_WEBHOOK_SECRET;
      const isCronSecretValid = Boolean(MP_CRON_SECRET) && cronSecret === MP_CRON_SECRET;
      const isServiceRoleAuth = authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;

      if (!isWebhookSecretValid && !isCronSecretValid && !isServiceRoleAuth) {
        return jsonResponse({ data: null, error: "Unauthorized" }, 401);
      }

      return await runSweep(serviceSupabase);
    }

    // ────────────────────────────────────────────────────────────────────────
    // ────────────────────────────────────────────────────────────────────────
    // Farmacia (254): capture-pharmacy-order / cancel-pharmacy-order.
    // Las llama el servidor (la base, al rechazar o aprobar), o un usuario con
    // permiso sobre ESE pedido. Se autoriza acá, nunca en el front.
    // ────────────────────────────────────────────────────────────────────────
    if (action === "capture-pharmacy-order" || action === "cancel-pharmacy-order") {
      const { orderId, motivo } = body as { orderId?: string; motivo?: string };
      if (!orderId) return jsonResponse({ data: null, error: "Missing orderId" }, 400);

      const cronSecret = req.headers.get("x-cron-secret");
      let autorizado = esLlamadaDeServicio(req.headers.get("Authorization"))
        || (Boolean(MP_CRON_SECRET) && cronSecret === MP_CRON_SECRET)
        || (Boolean(MP_WEBHOOK_SECRET) && cronSecret === MP_WEBHOOK_SECRET);

      if (!autorizado) {
        const authH = req.headers.get("Authorization");
        if (!authH) return jsonResponse({ data: null, error: "Unauthorized" }, 401);
        const { data: { user: u }, error: uErr } = await createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authH } } }
        ).auth.getUser();
        if (uErr || !u) return jsonResponse({ data: null, error: "Unauthorized" }, 401);

        const pedido = await cargarPedidoRetenido(serviceSupabase, orderId);
        if (!pedido) return jsonResponse({ data: null, error: "Order not found" }, 404);

        const { data: perfil } = await serviceSupabase.from("profiles").select("role").eq("id", u.id).single();
        const rol = perfil?.role ?? "patient";
        const esAdmin = rol === "admin" || rol === "super_admin";
        const esFarmacia = rol === "pharmacy_admin" || rol === "pharmacy_operator";
        // El médico de Healthier ASIGNADO a este pedido (y que sigue marcado como tal).
        let esMedicoAsignado = false;
        if (pedido.receta_medico_id === u.id) {
          const { data: ok } = await serviceSupabase.rpc("es_medico_healthier", { p_user: u.id });
          esMedicoAsignado = ok === true;
        }
        // El paciente puede soltar su propia retención mientras nadie tomó el pedido.
        const esPacienteSinTomar = action === "cancel-pharmacy-order"
          && pedido.patient_id === u.id && pedido.receta_estado === "pendiente";

        autorizado = esAdmin || esFarmacia || esMedicoAsignado || esPacienteSinTomar;
        if (!autorizado) return jsonResponse({ data: null, error: "Forbidden" }, 403);
      }

      const r = action === "capture-pharmacy-order"
        ? await cobrarPedidoDeFarmacia(serviceSupabase, orderId)
        : await liberarPedidoDeFarmacia(serviceSupabase, orderId, motivo ?? null);
      return jsonResponse({ data: r.data, error: r.error, ...(r.code ? { code: r.code } : {}) }, r.status);
    }

    // ────────────────────────────────────────────────────────────────────────
    // All other actions require an authenticated Supabase user.
    // ────────────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ data: null, error: "Unauthorized" }, 401);

    const authedSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authErr } = await authedSupabase.auth.getUser();
    if (authErr || !user) return jsonResponse({ data: null, error: "Unauthorized" }, 401);

    const { data: callerProfile } = await serviceSupabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    const callerRole = callerProfile?.role ?? "patient";
    const isAdmin = callerRole === "admin" || callerRole === "super_admin";

    // ────────────────────────────────────────────────────────────────────────
    // action: capture — professional owner, or admin/super_admin
    // ────────────────────────────────────────────────────────────────────────
    if (action === "capture") {
      const { consultationId } = body as { consultationId?: string };
      if (!consultationId) return jsonResponse({ data: null, error: "Missing consultationId" }, 400);

      const { data: consultation, error: consErr } = await serviceSupabase
        .from("consultations")
        .select("id, patient_id, professional_id, status, payment_status, is_on_demand")
        .eq("id", consultationId)
        .single();
      if (consErr || !consultation) return jsonResponse({ data: null, error: "Consultation not found" }, 404);

      const c = consultation as ConsultationRow;
      // El paciente dueño también puede disparar la captura: finalize() se
      // ejecuta desde ambos lados de la videollamada, y que el paciente
      // confirme el cobro de su propia consulta completada es seguro.
      const isCaptureOwner = c.professional_id === user.id || await puedeActuarComo(serviceSupabase, user.id, c.patient_id);
      if (!isCaptureOwner && !isAdmin) {
        return jsonResponse({ data: null, error: "Forbidden" }, 403);
      }

      const { data: payment, error: paymentErr } = await serviceSupabase
        .from("payments")
        .select("id, mp_payment_id, professional_id, patient_id, status")
        .eq("consultation_id", consultationId)
        .in("status", ["authorized", "approved"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (paymentErr || !payment) {
        return jsonResponse({ data: null, error: "No authorized payment found for this consultation" }, 422);
      }

      const result = await captureAuthorizedPayment(serviceSupabase, payment as PaymentRow, consultationId);
      return jsonResponse({ data: result.data, error: result.error }, result.status);
    }

    // ────────────────────────────────────────────────────────────────────────
    // action: cancel-auth — patient or professional owner, or admin/super_admin
    // ────────────────────────────────────────────────────────────────────────
    if (action === "cancel-auth") {
      const { consultationId } = body as { consultationId?: string };
      if (!consultationId) return jsonResponse({ data: null, error: "Missing consultationId" }, 400);

      const { data: consultation, error: consErr } = await serviceSupabase
        .from("consultations")
        .select("id, patient_id, professional_id, status, payment_status, is_on_demand")
        .eq("id", consultationId)
        .single();
      if (consErr || !consultation) return jsonResponse({ data: null, error: "Consultation not found" }, 404);

      const c = consultation as ConsultationRow;
      // El titular cancela por su familiar (migración 181).
      const isOwner = c.professional_id === user.id || await puedeActuarComo(serviceSupabase, user.id, c.patient_id);
      if (!isOwner && !isAdmin) {
        return jsonResponse({ data: null, error: "Forbidden" }, 403);
      }

      const { data: payment, error: paymentErr } = await serviceSupabase
        .from("payments")
        .select("id, mp_payment_id, professional_id, patient_id, status")
        .eq("consultation_id", consultationId)
        .in("status", ["authorized", "cancelled"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (paymentErr || !payment) {
        return jsonResponse({ data: null, error: "No authorized payment found for this consultation" }, 422);
      }

      const result = await cancelAuthorizedPayment(serviceSupabase, payment as PaymentRow, consultationId);
      return jsonResponse({ data: result.data, error: result.error }, result.status);
    }

    // ────────────────────────────────────────────────────────────────────────
    // action: capture-emergency / cancel-auth-emergency
    //
    // Capturar = el traslado se hizo. Liberar = se canceló y no se cobra.
    // Quién puede: el paciente dueño (cancelar), la entidad que despacha, y
    // admin/super_admin. La tripulación no: cerrar el traslado y decidir que
    // se cobra son dos cosas distintas, y la segunda es del despacho.
    // ────────────────────────────────────────────────────────────────────────
    if (action === "capture-emergency" || action === "cancel-auth-emergency") {
      const { emergencyId } = body as { emergencyId?: string };
      if (!emergencyId) return jsonResponse({ data: null, error: "Missing emergencyId" }, 400);

      const { data: emergencia } = await serviceSupabase
        .from("emergencies")
        // `*` y no la lista: si la migración 210 no está, falta `bonificada` y
        // una lista explícita haría fallar TODA captura de S.O.S.
        .select("*")
        .eq("id", emergencyId)
        .single();
      if (!emergencia) return jsonResponse({ data: null, error: "Emergency not found" }, 404);

      const esDespacho = callerRole === "emergency_admin" || callerRole === "emergency_operator";
      const esPaciente = emergencia.patient_id === user.id;
      const puede = isAdmin || esDespacho || (esPaciente && action === "cancel-auth-emergency");
      if (!puede) return jsonResponse({ data: null, error: "Forbidden" }, 403);
      // Migración 175: con la ambulancia asignada, cancelar se cobra. El
      // paciente no puede liberar la reserva por esta vía mientras hay un móvil
      // asignado (ni después de una cancelación cobrada): su camino es
      // `cancel-emergency`, que decide con el estado de la base.
      // Y liberar sin cancelar tampoco: con la emergencia viva, un despacho que
      // entra en el medio dejaría una ambulancia en camino sin reserva. El
      // paciente sólo libera la reserva de una emergencia ya cancelada sin
      // cargo (la vía vieja de la app: UPDATE a cancelled + esto).
      if (!isAdmin && !esDespacho) {
        const liberable = emergencia.status === "cancelled" && emergencia.cancellation_charged !== true;
        if (!liberable) {
          return jsonResponse({ data: null, error: "Para cancelar usá Cancelar pedido: la reserva se libera sola si corresponde." }, 409);
        }
      }

      const { data: payment } = await serviceSupabase
        .from("payments")
        .select("*")
        .eq("emergency_id", emergencyId)
        // También las ya resueltas: una emergencia ya cobrada (o liberada) no
        // es "sin pago" — `resolverPreautorizacionDeEmergencia` contesta
        // `yaResuelta` y el despacho cierra normal.
        .in("status", ["authorized", "approved", "cancelled"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      // Sin reserva para cobrar (bonificada, o nunca se preautorizó): antes
      // contestaba 404 "No authorized payment" y la emergencia no se podía
      // cerrar (Mateo, 2026-10-22). Ahora se dice cuál es el caso y Mercado
      // Pago no se toca. Para cerrar, el front pide un mensaje y llama a
      // `cerrar-sin-pago`, que lo registra.
      if (!payment) {
        return jsonResponse({
          data: { sinPago: true, bonificada: emergencia.bonificada === true },
          error: null,
        });
      }

      const result = await resolverPreautorizacionDeEmergencia(
        serviceSupabase,
        payment as PaymentRow,
        emergencyId,
        action === "capture-emergency" ? "capture" : "cancel"
      );
      return jsonResponse({ data: result.data, error: result.error }, result.status);
    }

    // ────────────────────────────────────────────────────────────────────────
    // action: cerrar-sin-pago — la emergencia no tiene reserva para cobrar
    //
    // Deja asentado quién la cerró así, cuándo y su mensaje (lo ve el super
    // admin). El estado del traslado lo sigue moviendo quien lo cierra, igual
    // que con el cobro. Pueden: el despacho de la entidad de la emergencia, el
    // médico y la tripulación del móvil asignado, y admin/super_admin. Con una
    // reserva autorizada se
    // niega: esa emergencia se cobra, no se cierra sin pago.
    // ────────────────────────────────────────────────────────────────────────
    if (action === "cerrar-sin-pago") {
      const { emergencyId, nota } = body as { emergencyId?: string; nota?: unknown };
      if (!emergencyId) return jsonResponse({ data: null, error: "Missing emergencyId" }, 400);
      const mensaje = typeof nota === "string" ? nota.trim().slice(0, 1000) : "";
      if (!mensaje) return jsonResponse({ data: null, error: "Dejá un mensaje para cerrar la emergencia sin cobro." }, 422);

      const { data: emergencia } = await serviceSupabase
        .from("emergencies")
        .select("*")
        .eq("id", emergencyId)
        .single();
      if (!emergencia) return jsonResponse({ data: null, error: "Emergency not found" }, 404);

      let puede = isAdmin || emergencia.professional_id === user.id;
      if (!puede && (callerRole === "emergency_admin" || callerRole === "emergency_operator")) {
        // Sólo el despacho de la entidad de ESTA emergencia (sin entidad, nadie).
        if (emergencia.provider_id) {
          const { data: staff } = await serviceSupabase
            .from("emergency_provider_staff")
            .select("provider_id")
            .eq("profile_id", user.id)
            .eq("provider_id", emergencia.provider_id)
            .eq("active", true)
            .limit(1)
            .maybeSingle();
          puede = !!staff;
        }
      }
      if (!puede && emergencia.ambulance_id) {
        const { data: tripulante } = await serviceSupabase
          .from("ambulance_crew")
          .select("profile_id")
          .eq("ambulance_id", emergencia.ambulance_id)
          .eq("profile_id", user.id)
          .eq("active", true)
          .limit(1)
          .maybeSingle();
        puede = !!tripulante;
      }
      if (!puede) return jsonResponse({ data: null, error: "Forbidden" }, 403);

      if (!["dispatched", "in_transit", "arrived", "completed"].includes(emergencia.status)) {
        return jsonResponse({ data: null, error: "La emergencia no está en curso." }, 409);
      }
      // Ya registrado (p. ej. un reintento tras fallar el cierre): no se pisa
      // quién la cerró ni su mensaje.
      if (emergencia.cierre_sin_pago_at) {
        return jsonResponse({ data: { registrado: true, yaEstaba: true, bonificada: emergencia.bonificada === true }, error: null });
      }

      const { data: reserva } = await serviceSupabase
        .from("payments")
        .select("id")
        .eq("emergency_id", emergencyId)
        .in("status", ["authorized", "approved"])
        .limit(1)
        .maybeSingle();
      if (reserva) {
        return jsonResponse({ data: null, error: "Esta emergencia tiene un pago reservado o cobrado: no se cierra sin cobro." }, 409);
      }

      const { error: updErr } = await serviceSupabase
        .from("emergencies")
        .update({ cierre_sin_pago: mensaje, cierre_sin_pago_por: user.id, cierre_sin_pago_at: new Date().toISOString() })
        .eq("id", emergencyId);
      if (updErr) {
        console.error("mp-capture (cerrar-sin-pago): update error:", updErr.message);
        return jsonResponse({ data: null, error: "No pudimos registrar el cierre. Probá de nuevo." }, 500);
      }
      return jsonResponse({ data: { registrado: true, bonificada: emergencia.bonificada === true }, error: null });
    }

    // ────────────────────────────────────────────────────────────────────────
    // action: cancel-emergency — el paciente cancela su S.O.S
    //
    // Regla de Mateo (2026-09-25): con la ambulancia ya asignada se puede
    // cancelar, pero se cobra igual. La decisión la toma el servidor leyendo el
    // estado de la base, no el cliente: web y app llaman a esto y muestran lo
    // que vuelve (`cobrado`). La migración 175 cierra el UPDATE directo del
    // paciente sobre una emergencia despachada, así que no hay otra vía.
    // ────────────────────────────────────────────────────────────────────────
    if (action === "cancel-emergency") {
      const { emergencyId, esperado } = body as { emergencyId?: string; esperado?: string };
      if (!emergencyId) return jsonResponse({ data: null, error: "Missing emergencyId" }, 400);
      const result = await cancelarEmergencia(
        serviceSupabase, emergencyId, user.id, isAdmin,
        esperado === "sin_movil" || esperado === "con_movil" ? esperado : undefined
      );
      return jsonResponse({ data: result.data, error: result.error }, result.status);
    }

    return jsonResponse({ data: null, error: `Unknown action: ${action ?? "(none)"}` }, 400);
  } catch (err) {
    console.error("mp-capture error:", err);
    return jsonResponse({ data: null, error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});

// ─── Reconciliación con lo que MP informa ────────────────────────────────────
// Se toma sólo lo que viene: si MP no manda un campo, no se pisa lo que haya en
// la base con null. `net_to_professional` NO se toca — es el 78% contractual, y
// `mp_net_received_amount` es la realidad; conviven a propósito para poder ver la
// diferencia en vez de perderla.
// deno-lint-ignore no-explicit-any
function reconciledFromMp(mpData: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!mpData || typeof mpData !== "object") return out;

  const feeDetails = Array.isArray(mpData.fee_details) ? mpData.fee_details : [];
  // deno-lint-ignore no-explicit-any
  const mpFee = feeDetails.find((f: any) => f?.type === "mercadopago_fee")?.amount;
  if (typeof mpFee === "number") out.mp_fee_actual = mpFee;

  const net = mpData.transaction_details?.net_received_amount;
  if (typeof net === "number") out.mp_net_received_amount = net;

  if (typeof mpData.money_release_date === "string") {
    out.mp_money_release_date = mpData.money_release_date;
  }
  if (typeof mpData.status_detail === "string") {
    out.status_detail = mpData.status_detail;
  }
  return out;
}
