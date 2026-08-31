import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

/**
 * Ids de consultas que agendó el propio profesional en esta sesión.
 *
 * `AppLayout` escucha los INSERT de `consultations` y avisa "Nueva reserva de X":
 * pensado para cuando reserva un paciente, pero saltaba también cuando el turno lo
 * creaba el profesional (reagendar, seguimiento, cola de walk-in). Se registra el
 * id ANTES del insert —generándolo en el cliente— porque el evento de Realtime
 * puede llegar antes de que resuelva la promesa del insert.
 */
const agendadasPorElProfesional = new Set()
export const fueAgendadaPorElProfesional = id => agendadasPorElProfesional.has(id)
import { mpService } from './mpService'
import { cioService } from './cioService'
// La simulación de videollamada corta acá, antes de tocar Supabase — ver
// `src/lib/simulacion.js`. `grep esSimulado src/` muestra la valla completa.
import * as simulacion from '../lib/simulacion'
import { esSimulado, CODIGO_DE_CIERRE as CODIGO_DE_CIERRE_SIMULADO } from '../lib/simulacion'

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
    if (esSimulado(consultationId)) return
    const { error } = await supabase
      .rpc('patient_waiting_ping', { p_consultation_id: consultationId })
    if (error) throw error
    // El aviso al profesional ya NO sale de acá: lo dispara un trigger sobre
    // `patient_waiting_since` (migración 091). Mandarlo desde el browser del
    // paciente significaba perderlo si cerraba la pestaña, y no existía en la
    // app mobile. Si se vuelve a agregar acá, el profesional recibe dos.
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
    if (esSimulado(consultationId)) return new Date().toISOString()
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
    if (esSimulado(consultationId)) return
    const { error } = await supabase
      .from('consultations')
      .update({ patient_waiting_since: null, patient_last_seen_at: null })
      .eq('id', consultationId)
    if (error) throw error
  },

  async getValidationCode(consultationId) {
    if (esSimulado(consultationId)) return CODIGO_DE_CIERRE_SIMULADO
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
    // Customer.io: encuesta al paciente + resumen al profesional. Fire-and-forget
    // y con su propio try/catch adentro — un evento de marketing nunca puede
    // hacer fallar el cierre de una consulta.
    if (result.status === 'completed') {
      cioService.consultationClosed(consultationId, { closedBy: role })
    }
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

  /**
   * Verifica el código de cierre que dictó/compartió el paciente (migración
   * 099). Puede llamarse EN la videollamada (status in_progress, antes de
   * colgar) o después, desde el modal de cierre (status closing) — no cierra
   * la consulta por sí sola, sólo marca `closing_code_verified_at`.
   *
   * No tira excepción en un código incorrecto (la RPC devuelve
   * `{ok:false, intentosRestantes}` a propósito — ver el comentario en la
   * migración): así el llamador puede mostrar "te quedan N intentos" sin
   * tratarlo como un error de red.
   */
  async verifyClosingCode(consultationId, code) {
    // En la práctica el código es fijo y está escrito en la guía: el punto es
    // que vea dónde se pide y qué pasa al errarle, no adivinarlo.
    if (esSimulado(consultationId)) {
      return code === CODIGO_DE_CIERRE_SIMULADO
        ? { ok: true }
        : { ok: false, intentosRestantes: 5 }
    }
    const { data, error } = await supabase.rpc('verificar_codigo_de_cierre', {
      p_consultation_id: consultationId,
      p_code: code,
    })
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * Cierre efectivo de una videoconsulta (closing/in_progress → completed).
   * Reemplaza a `finalize(..., 'professional', {code})` para video/on-demand:
   * exige `verifyClosingCode` previo O un motivo para cerrar sin código
   * (caso normal: el paciente ya se fue de la llamada). Presencial sigue
   * usando `finalize()` sin cambios.
   *
   * Mismo post-proceso que `finalize()` — Customer.io y la captura on-demand
   * no pueden perderse porque el cierre vino por este camino nuevo.
   */
  async completeClosing(consultationId, { closingNotes = null, skipCodeReason = null } = {}) {
    if (esSimulado(consultationId)) return { status: 'completed', isOnDemand: false }
    const { data, error } = await supabase.rpc('completar_cierre_de_consulta', {
      p_consultation_id: consultationId,
      p_closing_notes: closingNotes || null,
      p_motivo_sin_codigo: skipCodeReason || null,
    })
    if (error) throw error
    const result = toCamelCase(data)
    if (result.status === 'completed') {
      cioService.consultationClosed(consultationId, { closedBy: 'professional' })
      if (result.isOnDemand) {
        mpService.capturePayment(consultationId).then(({ error: captureError }) => {
          if (captureError) console.error('[consultationsService] on-demand capture failed:', captureError)
        })
      }
    }
    return result
  },

  async getDailyAccess(consultationId) {
    // La simulación nunca abre una sala real (no hay nadie del otro lado y
    // Daily se cobra por minuto): `VideoCall.jsx` usa el mock del SDK, así que
    // estos valores no se conectan a ningún lado.
    if (esSimulado(consultationId)) return { roomUrl: 'https://simulacion.invalid/sala', token: null }
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

  /**
   * @param {object} data — fila de `consultations`
   * @param {{bookedBy?: 'patient'|'professional'}} [opts]
   *   Quién agendó. Con `'professional'` el aviso va al PACIENTE: el profesional
   *   no necesita que le avisen de un turno que acaba de crear él, y el paciente
   *   sí necesita enterarse de que tiene uno. Antes se le mandaba al profesional
   *   "Un paciente reservó un turno contigo" incluso cuando lo había reservado él.
   */
  async create(data, { bookedBy = 'patient' } = {}) {
    await this._assertProfessionalAcceptsBookings(data.professionalId)

    const payload = { ...data }
    if (bookedBy === 'professional' && typeof crypto?.randomUUID === 'function') {
      payload.id = payload.id ?? crypto.randomUUID()
      agendadasPorElProfesional.add(payload.id)
    }

    const { data: row, error } = await supabase
      .from('consultations')
      .insert(toSnakeCase(payload))
      .select()
      .single()
    if (error) throw error

    // Customer.io: va SIEMPRE, también en on-demand. A diferencia del mail y
    // del push de abajo — que en on-demand se callan porque el copy es de turno
    // agendado — acá el evento es el dato crudo y la decisión de si se manda
    // algo (y con qué texto) la toma la campaña, que ya sabe distinguir por
    // `is_on_demand`.
    cioService.appointmentBooked(row, { bookedBy })

    // On-demand se calla acá a propósito. La fila se crea en el instante en que
    // el paciente se compromete a pagar, así que avisar acá le mandaba al
    // profesional "Nuevo turno reservado" antes de que el paciente contestara
    // nada — y además el copy es de turno agendado, que no es lo que pasa. Para
    // on-demand el único aviso sale de pingPatientWaiting, cuando el paciente
    // toca "Iniciar consulta" después de la pre-consulta.
    if (!row.is_on_demand) {
      supabase.functions.invoke('send-booking-email', { body: { consultationId: row.id } }).catch(() => {})

      const cuando = row.scheduled_at
        ? new Date(row.scheduled_at).toLocaleString('es-AR', {
            day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
          })
        : null

      // Sólo el aviso AL PACIENTE sale de acá. El del profesional lo dispara
      // un trigger al insertar la consulta (migración 091): desde el browser
      // se perdía si el paciente cerraba la pestaña, y una reserva hecha desde
      // la app mobile no avisaba a nadie. Si se reactiva acá, llegan dos.
      const aviso = bookedBy === 'professional'
        ? row.patient_id && {
            userId: row.patient_id,
            title:  'Te agendaron un turno',
            body:   cuando
              ? `Tu profesional agendó una consulta para el ${cuando}.`
              : 'Tu profesional agendó una consulta de seguimiento.',
            url:    '/paciente/consultas',
          }
        : null

      if (aviso) {
        supabase.functions.invoke('send-push-notification', { body: aviso }).catch(() => {})
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
    if (esSimulado(id)) return simulacion.consulta()
    const { data, error } = await supabase
      .from('consultations')
      // El patient join trae también su cobertura ESTABLE (coverage_type,
      // financiador_id, insurance_name, insurance_num — la que cargó en su
      // alta) para poder precargar la cobertura de ESTA consulta cuando
      // todavía no tiene la propia. Son columnas separadas a propósito: la de
      // la consulta es la que manda al emitir, la del perfil es sólo el punto
      // de partida.
      .select('*, patient:profiles!patient_id(id, full_name, avatar_url, email, phone, dni, gender, birth_date, coverage_type, financiador_id, insurance_name, insurance_num), professional:profiles!professional_id(full_name, avatar_url, professional_profiles!professional_profiles_user_id_fkey(specialty)), consultation_type:consultation_types!consultation_type_id(id, name, price, modality), payment:payments!consultation_id(id, mp_payment_id, method, gross_amount, credits_used, charged_amount, platform_fee, mp_fee_estimated, mp_fee_actual, net_to_professional, mp_net_received_amount, mp_money_release_date, status, refund_type, refunded_at, refund_request_status, authorized_at, captured_at, created_at)')
      .eq('id', id)
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * La consulta on-demand que el paciente tiene viva ahora mismo: creada,
   * con la plata ya retenida en la tarjeta y todavía sin empezar.
   *
   * Es lo que permite que `/paciente/ondemand` se rehidrate después de un
   * refresh en vez de devolver al paciente al checkout con la
   * pre-autorización ya hecha — que era el camino directo a autorizar dos
   * veces la misma consulta.
   *
   * `payment_status: 'in_process'` es exactamente "autorizada, sin capturar"
   * (ver `mapMpStatus` en `mp-payment`): un pago cobrado queda `paid` y uno
   * que MP todavía está revisando queda `pending_payment`, así que ninguno de
   * los dos entra acá.
   */
  async getLiveOnDemand(patientId) {
    if (!patientId) return null
    const { data, error } = await supabase
      .from('consultations')
      .select('*')
      .eq('patient_id', patientId)
      .eq('is_on_demand', true)
      .eq('payment_status', 'in_process')
      .in('status', ['pending', 'confirmed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    // Fail-open: si esta lectura falla, el paciente ve el checkout normal. Es
    // el comportamiento viejo, no algo peor.
    if (error) return null
    return data ? toCamelCase(data) : null
  },

  async update(id, fields) {
    if (esSimulado(id)) return { ...simulacion.consulta(), ...fields }
    const { data, error } = await supabase
      .from('consultations')
      .update(toSnakeCase(fields))
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * Sube (o reemplaza) la factura del profesional por esta consulta.
   * Migración 119 — el archivo va al bucket privado `professional-docs`.
   *
   * Cada subida escribe un path NUEVO (timestamp) en vez de pisar el anterior
   * con `upsert: true`: el bucket tiene policy de INSERT para el dueño pero
   * NO de UPDATE (sólo super_admin la tiene, ver migración 097), así que
   * sobrescribir el mismo path le fallaría al profesional. Reemplazar es
   * entonces "subir uno nuevo y repuntar la columna" — el archivo viejo queda
   * huérfano en el bucket, que es aceptable: tampoco hay policy de DELETE para
   * el dueño, y son PDFs chicos.
   *
   * El primer segmento del path TIENE que ser el `auth.uid()` del que escribe:
   * todas las policies de este bucket comparan contra
   * `(storage.foldername(name))[1]`.
   *
   * Se guarda el PATH, no `getPublicUrl()`: el bucket es privado y esa URL da
   * 404 (ver `lib/storage.js`). Para mostrarlo, `SignedDocLink`.
   */
  async uploadInvoice(consultationId, professionalUserId, file) {
    // `.pdf` fijo, no derivado de `file.name`: la validación de arriba ya
    // garantiza un PDF, y derivarlo del nombre rompía con un archivo llamado
    // "factura" (sin extensión) pero con el MIME correcto — pasaba la
    // validación y se guardaba como "…1755792000000.factura", que después el
    // browser no abre.
    const path = `${professionalUserId}/facturas/${consultationId}_${Date.now()}.pdf`

    const { error: uploadError } = await supabase.storage
      .from('professional-docs')
      .upload(path, file)
    if (uploadError) throw uploadError

    return this.update(consultationId, {
      invoiceUrl: path,
      invoiceUploadedAt: new Date().toISOString(),
    })
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
    if (esSimulado(id)) return { ...simulacion.consulta(), status, ...extra }
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
    // Super Admin > Consultas necesita paciente/profesional completos (con
    // email, para buscar) y el tipo de consulta si el profesional definió uno.
    // AdminConsultations (la vista de /admin) usa este mismo método y sólo lee
    // patient.fullName / professional.fullName / modality / scheduledAt / status
    // — el select ampliado es un superset, no le rompe nada.
    let query = supabase
      .from('consultations')
      .select(`
        *,
        patient:profiles!patient_id(id, full_name, email),
        professional:profiles!professional_id(id, full_name, email, professional_profiles!professional_profiles_user_id_fkey(specialty)),
        consultation_type:consultation_types!consultation_type_id(id, name)
      `)
      .order('scheduled_at', { ascending: false, nullsFirst: false })

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

  /** Borra una o más consultas — super admin. */
  async deleteMany(ids) {
    const { error } = await supabase.from('consultations').delete().in('id', ids)
    if (error) throw new Error(error.message || 'Error al eliminar')
  },
}
