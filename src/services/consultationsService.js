import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'
import { mpService } from './mpService'

/**
 * Waiting-room presence window. The patient's client heartbeats every
 * WAITING_HEARTBEAT_MS while the room is open; anything older than
 * WAITING_PRESENCE_TTL_MS is treated as "left without pressing salir"
 * (tab closed, phone locked, connection dropped).
 *
 * TTL is 3× the heartbeat so a single missed beat never flickers the
 * professional's badge off.
 */
export const WAITING_HEARTBEAT_MS = 30_000
export const WAITING_PRESENCE_TTL_MS = 90_000

/**
 * True when a patient is currently sitting in the waiting room for this
 * consultation. Shared by the professional's Agenda and Dashboard so the
 * staleness rule can never drift between the two.
 *
 * @param {{patientWaitingSince?: string|null, patientLastSeenAt?: string|null, status?: string}} c
 */
export function isPatientWaiting(c) {
  if (!c?.patientWaitingSince) return false
  // Once the call is running or over, "waiting" is no longer meaningful.
  if (c.status === 'in_progress' || c.status === 'completed' || c.status === 'cancelled') return false
  const lastSeen = c.patientLastSeenAt ?? c.patientWaitingSince
  return Date.now() - new Date(lastSeen).getTime() < WAITING_PRESENCE_TTL_MS
}

export const consultationsService = {
  /**
   * Announces/renews the patient's presence in the waiting room. Arrival and
   * heartbeat are the SAME idempotent call on purpose (migration 064): mark
   * and clear are async and can interleave on a fast remount, and a lost
   * arrival used to wedge presence off permanently because the heartbeat only
   * touched patient_last_seen_at. The RPC COALESCEs the arrival time, so the
   * next ping heals it.
   *
   * Notifies the professional only on a genuinely new arrival — the RPC
   * returns true exactly once per stay, so the 30s heartbeat stays silent.
   */
  async pingPatientWaiting(consultationId) {
    const { data: isNewArrival, error } = await supabase
      .rpc('patient_waiting_ping', { p_consultation_id: consultationId })
    if (error) throw error
    if (!isNewArrival) return

    const { data } = await supabase
      .from('consultations')
      .select('professional_id, is_on_demand')
      .eq('id', consultationId)
      .maybeSingle()
    if (!data?.professional_id) return

    // Un solo camino de notificación al profesional, con copy según el tipo.
    // On-demand solía avisar aparte (`notifyOnDemandAuthorized`) en el momento
    // de autorizar el pago — o sea antes de que el paciente contestara nada, que
    // es justo lo que dejaba al profesional esperando. Ahora el único disparador
    // es la llegada real a la sala, y la llegada solo ocurre cuando el paciente
    // toca "Iniciar consulta" después de la pre-consulta.
    const onDemand = data.is_on_demand
    supabase.functions.invoke('send-push-notification', {
      body: {
        userId: data.professional_id,
        title:  onDemand ? 'Consulta inmediata — paciente listo' : 'Tenés un paciente esperando',
        body:   onDemand
          ? 'Un paciente autorizó el pago, completó la pre-consulta y te está esperando ahora.'
          : 'Un paciente entró a la sala de espera y te está esperando.',
        url:    `/profesional/videollamada/${consultationId}`,
      },
    }).catch(() => {})
  },

  /**
   * El profesional habilita al paciente a entrar (migración 071).
   *
   * Es una acción explícita y no un efecto secundario de abrir la videollamada:
   * antes, hasta que el profesional no abría esa página no pasaba nada, y el
   * paciente esperaba sin señal. Idempotente — COALESCE conserva el primer
   * momento, así que tocar el botón dos veces no corre el reloj.
   */
  async admitPatient(consultationId) {
    const { data, error } = await supabase
      .from('consultations')
      .update({ patient_admitted_at: new Date().toISOString() })
      .eq('id', consultationId)
      .is('patient_admitted_at', null)
      .select('patient_admitted_at')
      .maybeSingle()
    if (error) throw error
    // `null` = ya estaba habilitado; no es un error.
    return data?.patient_admitted_at ?? null
  },

  /** Patient left the waiting room explicitly, or the call started. */
  async clearPatientWaiting(consultationId) {
    const { error } = await supabase
      .from('consultations')
      .update({ patient_waiting_since: null, patient_last_seen_at: null })
      .eq('id', consultationId)
    if (error) throw error
  },

  async getValidationCode(consultationId) {
    const { data, error } = await supabase
      .from('consultation_validation_codes')
      .select('code')
      .eq('consultation_id', consultationId)
      .single()
    if (error) throw error
    return data.code
  },

  // `prescriptionUrl` salió de la firma el 2026-07-29: la receta ya no es un
  // archivo que subimos, es el PDF que emite RCTA. La RPC sigue aceptando el
  // parámetro (default NULL) para no romper el contrato de la base.
  async finalize(consultationId, role, { closingNotes = null, code = null } = {}) {
    const { data, error } = await supabase.rpc('finalize_consultation', {
      p_consultation_id: consultationId,
      p_role: role,
      p_code: code || null,
      p_closing_notes: closingNotes || null,
    })
    if (error) throw error
    const result = toCamelCase(data)
    // On-demand capture hook (spec Sección D2): on-demand consultations are
    // charged with a pre-authorization hold (capture:false) at booking time —
    // the actual charge only happens here, once the consultation is truly
    // completed. This runs regardless of which side (patient or professional)
    // triggered the completing `finalize` call. Fire-and-forget: mpService
    // never throws, and the mp-capture `sweep` cron is the backstop if this
    // call is lost (tab closed, network drop, etc).
    if (result.status === 'completed' && result.isOnDemand) {
      mpService.capturePayment(consultationId).then(({ error: captureError }) => {
        if (captureError) console.error('[consultationsService] on-demand capture failed:', captureError)
      })
    }
    return result
  },


  async getDailyAccess(consultationId) {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/daily-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ consultationId }),
    })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  },


  /**
   * Blocks creating a paid booking for a professional who hasn't connected
   * Mercado Pago (spec Sección D4 — "médico sin MP conectado NO puede recibir
   * turnos"). The Edge Function (mp-payment) already refuses to charge, but
   * this stops the consultation row from being created at all so the patient
   * never lands in an unpayable pending state. professional_profiles is the
   * source of truth via the denormalized `mp_connected` column.
   */
  async _assertProfessionalAcceptsBookings(professionalId) {
    if (!professionalId) return
    const { data, error } = await supabase
      .from('professional_profiles')
      .select('mp_connected')
      .eq('user_id', professionalId)
      .maybeSingle()
    if (error) return // fail-open on read errors — server-side charge is still gated
    if (data && data.mp_connected === false) {
      throw new Error('Este profesional no puede recibir turnos en este momento porque no tiene Mercado Pago conectado.')
    }
  },

  async create(data) {
    await this._assertProfessionalAcceptsBookings(data.professionalId)
    const { data: row, error } = await supabase
      .from('consultations')
      .insert(toSnakeCase(data))
      .select()
      .single()
    if (error) throw error
    // On-demand se calla acá a propósito. La fila se crea en el instante en que
    // el paciente se compromete a pagar, así que avisar acá le mandaba al
    // profesional "Nuevo turno reservado" antes de que el paciente contestara
    // nada — y además el copy es de turno agendado, que no es lo que pasa. Para
    // on-demand el único aviso sale de pingPatientWaiting, cuando el paciente
    // toca "Iniciar consulta" después de la pre-consulta.
    if (!row.is_on_demand) {
      supabase.functions.invoke('send-booking-email', { body: { consultationId: row.id } }).catch(() => {})
      if (row.professional_id) {
        supabase.functions.invoke('send-push-notification', {
          body: {
            userId: row.professional_id,
            title:  'Nuevo turno reservado',
            body:   'Un paciente reservó un turno contigo.',
            url:    '/profesional/dashboard',
          },
        }).catch(() => {})
      }
    }
    return toCamelCase(row)
  },

  async getByPatient(patientId) {
    const { data, error } = await supabase
      .from('consultations')
      .select('*, professional:profiles!professional_id(full_name, avatar_url, professional_profiles!professional_profiles_user_id_fkey(specialty)), encounters:clinical_encounters!consultation_id(id, medications:clinical_medications(rcta_status, rcta_pdf_url, rcta_prescription_id)), payment:payments!consultation_id(id, status, refund_type, refunded_at, refund_conversion_requested_at, refund_conversion_resolved_at, mp_payment_id, refund_request_status, refund_reject_reason)')
      .eq('patient_id', patientId)
      .order('scheduled_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * Las consultas de UN paciente con ESTE profesional.
   *
   * Es lo que el profesional necesita al abrir un paciente: hasta ahora el perfil
   * mostraba datos personales y ninguna consulta, así que no había forma de ver
   * qué se hizo antes sin salir a "Historial" y buscar a mano.
   *
   * Scopeado al profesional a propósito, y además la RLS ya lo impone: una
   * consulta sólo la ven sus dos partes. Un profesional NO ve los turnos que el
   * paciente tuvo con otros.
   */
  async getByPatientForProfessional(patientId, professionalId) {
    if (!patientId || !professionalId) return []
    const { data, error } = await supabase
      .from('consultations')
      .select(`
        id, scheduled_at, started_at, completed_at, created_at, status, modality, payment_status,
        closing_notes, preconsulta_data, price_at_booking, duration_minutes, cancel_reason,
        consultation_type:consultation_types!consultation_type_id(name),
        payment:payments!consultation_id(status, gross_amount, mp_net_received_amount, net_to_professional)
      `)
      .eq('patient_id', patientId)
      .eq('professional_id', professionalId)
      .order('scheduled_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data ?? [])
  },

  async getByProfessional(professionalId) {
    const { data, error } = await supabase
      .from('consultations')
      .select('*, profiles!patient_id(full_name, avatar_url, email)')
      .eq('professional_id', professionalId)
      .order('scheduled_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('consultations')
      .select('*, patient:profiles!patient_id(id, full_name, avatar_url, email, phone, dni, gender, birth_date), professional:profiles!professional_id(full_name, avatar_url, professional_profiles!professional_profiles_user_id_fkey(specialty)), consultation_type:consultation_types!consultation_type_id(id, name, price, modality), payment:payments!consultation_id(id, mp_payment_id, method, gross_amount, credits_used, charged_amount, platform_fee, mp_fee_estimated, mp_fee_actual, net_to_professional, mp_net_received_amount, mp_money_release_date, status, refund_type, refunded_at, refund_request_status, authorized_at, captured_at, created_at)')
      .eq('id', id)
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async update(id, fields) {
    const { data, error } = await supabase
      .from('consultations')
      .update(toSnakeCase(fields))
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async startConsultation(id, code) {
    const { data, error } = await supabase.rpc('start_consultation', {
      p_consultation_id: id,
      p_code: code,
    })
    if (error) throw error
    return toCamelCase(data)
  },

  // `addOrder` / `removeOrder` eliminados el 2026-07-29 junto con la sección
  // "Órdenes y recetas": no tenía nada que ver con RCTA y no se había usado nunca
  // (0 filas en `consultation_orders`). La tabla queda por si vuelve — el lugar
  // correcto para pedidos de estudios es `POST /prescribirPractica` de RCTA.

  async updateStatus(id, status, extra = {}) {
    const { data, error } = await supabase
      .from('consultations')
      .update({ status, ...toSnakeCase(extra) })
      .eq('id', id)
      .select('*, patient:profiles!patient_id(full_name)')
      .single()
    if (error) throw error
    const result = toCamelCase(data)
    // Notify patient when professional confirms their booking
    if (status === 'confirmed' && result.patientId) {
      supabase.functions.invoke('send-push-notification', {
        body: {
          userId: result.patientId,
          title:  'Turno confirmado',
          body:   'Tu consulta fue confirmada por el profesional.',
          url:    '/paciente/consultas',
        },
      }).catch(() => {})
    }
    // Notify patient when professional joins the call (status → in_progress)
    if (status === 'in_progress' && result.patientId) {
      const consultationUrl = result.dailyRoomUrl
        ? `/paciente/videollamada/${id}`
        : `/paciente/sala-espera/${id}`
      supabase.functions.invoke('send-push-notification', {
        body: {
          userId: result.patientId,
          title:  '¡El profesional está listo!',
          body:   'Tu consulta comenzó. ¡Entrá a la sala ahora!',
          url:    consultationUrl,
        },
      }).catch(() => {})
    }
    // Notify patient when their booking is cancelled by someone else (professional or admin)
    if (status === 'cancelled' && result.patientId && extra.cancelledBy !== result.patientId) {
      supabase.functions.invoke('send-push-notification', {
        body: {
          userId: result.patientId,
          title:  'Consulta cancelada',
          body:   'Tu consulta fue cancelada. Podés reservar un nuevo turno.',
          url:    '/paciente/consultas',
        },
      }).catch(() => {})
    }
    return result
  },

  async cancel(id, cancelledBy, reason = '') {
    return this.updateStatus(id, 'cancelled', {
      cancelledAt: new Date().toISOString(),
      cancelledBy,
      cancelReason: reason || null,
    })
  },

  async getEarningsData(professionalId) {
    const { data, error } = await supabase
      .from('consultations')
      .select('id, status, payment_status, price_at_booking, modality, obra_social_name, scheduled_at, completed_at, consultation_type:consultation_types!consultation_type_id(name), profiles!patient_id(full_name, avatar_url)')
      .eq('professional_id', professionalId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  async getAll(filters = {}) {
    let query = supabase
      .from('consultations')
      .select('*, patient:profiles!patient_id(full_name, email), professional:profiles!professional_id(full_name, professional_profiles!professional_profiles_user_id_fkey(specialty))')
      .order('scheduled_at', { ascending: false })

    if (filters.status) query = query.eq('status', filters.status)

    const { data, error } = await query
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * Fetch the data needed to initiate a Mercado Pago payment for a consultation.
   * Returns: { id, priceAtBooking, professionalId, mpAccountConnected }
   *   mpAccountConnected — true when the professional has an active mp_accounts row.
   */
  async getReceiptsForPatient(patientId) {
    const { data, error } = await supabase
      .from('consultations')
      .select('id, status, payment_status, price_at_booking, modality, vertical, scheduled_at, completed_at, professional:profiles!professional_id(full_name, professional_profiles!professional_profiles_user_id_fkey(specialty))')
      .eq('patient_id', patientId)
      .not('status', 'in', '("pending","cancelled","no_show")')
      .order('scheduled_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  async getConsultationForPayment(consultationId) {
    const { data, error } = await supabase
      .from('consultations')
      .select('id, price_at_booking, professional_id, professional:profiles!professional_id(mp_accounts(id, access_token))')
      .eq('id', consultationId)
      .single()
    if (error) throw error
    const row = toCamelCase(data)
    const mpAccount = row.professional?.mpAccounts?.[0] ?? null
    return {
      id: row.id,
      priceAtBooking: row.priceAtBooking ?? null,
      professionalId: row.professionalId,
      mpAccountConnected: !!(mpAccount?.accessToken),
    }
  },
}
