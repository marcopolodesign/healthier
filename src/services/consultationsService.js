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


  async create(data) {
    const { data: row, error } = await supabase
      .from('consultations')
      .insert(toSnakeCase(data))
      .select()
      .single()
    if (error) throw error
    return toCamelCase(row)
  },

  async getByPatient(patientId) {
    const { data, error } = await supabase
      .from('consultations')
      .select('*, professional:profiles!professional_id(full_name, avatar_url, professional_profiles(specialty))')
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
      .select('*, patient:profiles!patient_id(full_name, avatar_url, email), professional:profiles!professional_id(full_name, avatar_url, professional_profiles(specialty, calendly_url))')
      .eq('id', id)
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async updateStatus(id, status, extra = {}) {
    const { data, error } = await supabase
      .from('consultations')
      .update({ status, ...toSnakeCase(extra) })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async cancel(id, cancelledBy, reason = '') {
    return this.updateStatus(id, 'cancelled', {
      cancelledAt: new Date().toISOString(),
      cancelledBy,
      cancelReason: reason || null,
    })
  },

  async getAll(filters = {}) {
    let query = supabase
      .from('consultations')
      .select('*, patient:profiles!patient_id(full_name, email), professional:profiles!professional_id(full_name, professional_profiles(specialty))')
      .order('scheduled_at', { ascending: false })

    if (filters.status) query = query.eq('status', filters.status)

    const { data, error } = await query
    if (error) throw error
    return toCamelCase(data)
  },
}
