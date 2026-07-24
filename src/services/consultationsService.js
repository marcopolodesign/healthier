import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

export const consultationsService = {
  async getValidationCode(consultationId) {
    const { data, error } = await supabase
      .from('consultation_validation_codes')
      .select('code')
      .eq('consultation_id', consultationId)
      .single()
    if (error) throw error
    return data.code
  },

  async finalize(consultationId, role, { closingNotes = null, prescriptionUrl = null, code = null } = {}) {
    const { data, error } = await supabase.rpc('finalize_consultation', {
      p_consultation_id: consultationId,
      p_role: role,
      p_code: code || null,
      p_closing_notes: closingNotes || null,
      p_prescription_url: prescriptionUrl || null,
    })
    if (error) throw error
    return toCamelCase(data)
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
    supabase.functions.invoke('send-booking-email', { body: { consultationId: row.id } }).catch(() => {})
    // Notify professional of new booking via push
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
    return toCamelCase(row)
  },

  async getByPatient(patientId) {
    const { data, error } = await supabase
      .from('consultations')
      .select('*, professional:profiles!professional_id(full_name, avatar_url, professional_profiles!professional_profiles_user_id_fkey(specialty)), consultation_orders(*), payment:payments!consultation_id(id, status, refund_type, refunded_at, refund_conversion_requested_at, refund_conversion_resolved_at, mp_payment_id, refund_request_status, refund_reject_reason)')
      .eq('patient_id', patientId)
      .order('scheduled_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
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
      .select('*, patient:profiles!patient_id(id, full_name, avatar_url, email, phone), professional:profiles!professional_id(full_name, avatar_url, professional_profiles!professional_profiles_user_id_fkey(specialty)), consultation_type:consultation_types!consultation_type_id(id, name, price, modality), consultation_orders(*)')
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

  async addOrder(consultationId, { description, orderType, url }) {
    const { data, error } = await supabase
      .from('consultation_orders')
      .insert({ consultation_id: consultationId, description, order_type: orderType, url: url || null })
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async removeOrder(orderId) {
    const { error } = await supabase
      .from('consultation_orders')
      .delete()
      .eq('id', orderId)
    if (error) throw error
  },

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
