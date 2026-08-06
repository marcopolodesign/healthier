import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

/**
 * Presencia on-demand del profesional. Late cada ON_DEMAND_HEARTBEAT_MS mientras
 * tiene el panel abierto; más viejo que el TTL se considera que cerró o perdió
 * conexión. TTL = 3× el latido para que un latido perdido no lo saque de la
 * lista (mismo criterio que la presencia del paciente en la sala).
 */
export const ON_DEMAND_HEARTBEAT_MS = 30_000
/**
 * Cuánto vale "estoy disponible" desde la última vez que el profesional lo
 * declaró. Era 90 segundos, atado a tener la pestaña abierta y visible.
 *
 * Decisión de Mateo (2026-07-31): **no** debe implicar tener la app abierta.
 * Exigirle a un médico dejar una pestaña visible para existir en el pool es un
 * impuesto de atención que nadie paga — y el resultado real es un pool vacío, no
 * un pool más confiable. Lo que dice "estoy" es haber prendido el switch hace
 * poco; lo que dice "no estoy" es no contestar, y para eso está la ventana corta
 * de la consulta y el failover al siguiente.
 */
export const ON_DEMAND_PRESENCE_TTL_MS = 60 * 60 * 1000

export const professionalService = {
  async getByUserId(userId) {
    const { data, error } = await supabase
      .from('professional_profiles')
      .select('*, profiles!user_id(*)')
      .eq('user_id', userId)
      // `maybeSingle` y no `single`: "todavía no tiene ficha profesional" es un
      // estado normal — es el de cualquier profesional recién registrado, y el
      // que hace que el Dashboard muestre "Completá tu perfil". Con `single()`
      // PostgREST responde **406** cuando no hay fila, así que cada alta nueva
      // ensuciaba la consola con un error de red que no era un error.
      .maybeSingle()
    if (error) return null
    return toCamelCase(data)
  },

  async upsert(userId, profileData) {
    // `profiles` is a read-only join added by getByUserId()'s `select('*, profiles!user_id(*)')` —
    // callers often spread the whole record back in (e.g. Configuracion.jsx's saveTarifas/saveCuenta),
    // and sending it here 400s the whole upsert since it isn't a real column.
    const { profiles, ...rest } = profileData
    const payload = { ...toSnakeCase(rest), user_id: userId }
    const { data, error } = await supabase
      .from('professional_profiles')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async uploadDocument(userId, file, bucket, fileName) {
    const ext = file.name.split('.').pop()
    const path = `${userId}/${fileName}.${ext}`
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, file, { upsert: true })
    if (error) throw error
    const { data } = supabase.storage.from(bucket).getPublicUrl(path)
    return data.publicUrl
  },

  async getDashboardPool() {
    const { data, error } = await supabase
      .from('professional_profiles')
      .select('*, profiles!user_id(full_name, avatar_url, email)')
      .eq('is_verified', true)
      .eq('is_active', true)
      .order('average_rating', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  async search(filters = {}) {
    let query = supabase
      .from('professional_profiles')
      .select('*, profiles!user_id(full_name, avatar_url, email)')
      .eq('is_verified', true)
      .eq('is_active', true)

    if (filters.specialty) {
      query = query.eq('specialty', filters.specialty)
    }
    if (filters.onDemand) {
      query = query.eq('is_on_demand', true)
    }
    // La presencia (migración 066) dejó de ser un FILTRO cuando el despacho pasó
    // a ser por pedido y aceptación (migración 067): exigir pestaña abierta para
    // aparecer es un impuesto de atención inviable, y en web no se puede latir
    // con el browser cerrado. Ahora es solo una señal: sirve para ordenar a quién
    // mostrarle primero y para prometerle al paciente una espera realista, no
    // para decidir quién entra al pool.
    if (filters.onlyLive) {
      query = query.gte('on_demand_last_seen_at', new Date(Date.now() - ON_DEMAND_PRESENCE_TTL_MS).toISOString())
    }
    if (filters.minRating) {
      query = query.gte('average_rating', filters.minRating)
    }

    const { data, error } = await query.order('average_rating', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * Profesionales que el paciente puede contratar de verdad: verificados, activos
   * y **con Mercado Pago conectado**.
   *
   * Va por RPC (migración 079) y no por `search()` por dos razones que se
   * probaron contra la base, no se supusieron:
   *
   *  - El `ilike` de PostgREST no distingue mayúsculas pero **sí acentos**:
   *    "marquez" no encontraba a "Márquez" y "nicolas" no encontraba a
   *    "Nicolás". Con apellidos argentinos eso rompe la búsqueda justo en los
   *    casos más comunes, y en silencio. La función usa `unaccent`.
   *  - El filtro de MP tiene que ser del lado del servidor: hay 15 profesionales
   *    verificados y sólo 6 cobrables. Traer los 15 para descartar 9 en el
   *    browser es mandar datos de gente que el paciente no puede contratar.
   *
   * @param {{texto?: string, especialidades?: string[]}} opciones
   */
  async buscarCobrables({ texto = '', especialidades = null } = {}) {
    const { data, error } = await supabase.rpc('buscar_profesionales_cobrables', {
      p_texto: texto?.trim() || null,
      p_especialidades: especialidades?.length ? especialidades : null,
    })
    if (error) throw error
    return toCamelCase(data ?? [])
  },

  /** Marca/renueva la disponibilidad on-demand del profesional autenticado. */
  async pingOnline() {
    const { data, error } = await supabase.rpc('professional_online_ping')
    if (error) throw error
    return data === true
  },

  /** Apaga la disponibilidad explícitamente (cerró el panel o apagó on-demand). */
  async goOffline() {
    const { error } = await supabase.rpc('professional_offline')
    if (error) throw error
  },

  async getPublicProfile(professionalId) {
    const { data, error } = await supabase
      .from('professional_profiles')
      .select('*, profiles!user_id(full_name, avatar_url, email)')
      .eq('id', professionalId)
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async setVerified(userId, isVerified, isActive = true) {
    const { error } = await supabase
      .from('professional_profiles')
      .update({ is_verified: isVerified, is_active: isActive })
      .eq('user_id', userId)
    if (error) throw error
  },

  async reject(userId, reason = '') {
    const { error } = await supabase
      .from('professional_profiles')
      .update({
        is_verified: false,
        is_active: false,
        rejection_reason: reason || null,
        rejected_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
    if (error) throw error
  },

  async getPendingVerification() {
    const { data, error } = await supabase
      .from('professional_profiles')
      .select('*, profiles!user_id(full_name, email, avatar_url, dni)')
      .eq('is_verified', false)
      .is('rejected_at', null)
      .order('created_at', { ascending: true })
    if (error) throw error
    return toCamelCase(data)
  },

  // ── Verificación del super admin (2026-08-06) ──────────────────────────
  //
  // `reject()` de arriba queda como está — lo sigue usando admin/Professionals.jsx
  // sin distinguir revisión de rechazo permanente. Estos tres métodos son los
  // que usa super-admin/Profesionales.jsx: cada uno deja constancia en
  // `professional_verification_log` (migración 097) de qué admin decidió, así
  // que la escritura en `professional_profiles` y el registro de auditoría van
  // siempre juntos — nunca uno sin el otro.

  async _logVerificationReview(professionalProfileId, reviewedBy, action, reason) {
    const { error } = await supabase
      .from('professional_verification_log')
      .insert({
        professional_profile_id: professionalProfileId,
        reviewed_by: reviewedBy,
        action,
        reason: reason || null,
      })
    // Un fallo al loguear no puede tirar abajo la decisión de verificación ya
    // guardada — se reporta a consola para no perderlo en silencio.
    if (error) console.error('No se pudo registrar la auditoría de verificación:', error)
  },

  /** Aprobar manualmente. Limpia cualquier rechazo previo (incluido uno
   *  permanente) — si no, `rejection_type='permanente'` seguiría bloqueando
   *  al profesional en el trigger de la 097 aun después de aprobado. */
  async approve(professionalProfileId, reviewedBy) {
    const { error } = await supabase
      .from('professional_profiles')
      .update({
        is_verified: true,
        is_active: true,
        verification_source: 'manual',
        verified_at: new Date().toISOString(),
        verified_by: reviewedBy,
        rejection_reason: null,
        rejected_at: null,
        rejection_type: null,
      })
      .eq('id', professionalProfileId)
    if (error) throw error
    await this._logVerificationReview(professionalProfileId, reviewedBy, 'approved', null)
  },

  /** "Necesita revisión" — el profesional ve el motivo y puede corregir y
   *  reenviar desde onboarding (Onboarding.jsx limpia estos mismos campos al
   *  reenviar). */
  async requestRevision(professionalProfileId, reviewedBy, reason) {
    const { error } = await supabase
      .from('professional_profiles')
      .update({
        is_verified: false,
        is_active: false,
        rejection_reason: reason,
        rejected_at: new Date().toISOString(),
        rejection_type: 'revision',
      })
      .eq('id', professionalProfileId)
    if (error) throw error
    await this._logVerificationReview(professionalProfileId, reviewedBy, 'needs_revision', reason)
  },

  /** Rechazo permanente — el profesional ve el motivo pero no puede reenviar
   *  (bloqueado por el trigger `professional_profiles_bloquear_rechazo_permanente`,
   *  migración 097, no sólo por la UI). */
  async rejectPermanently(professionalProfileId, reviewedBy, reason) {
    const { error } = await supabase
      .from('professional_profiles')
      .update({
        is_verified: false,
        is_active: false,
        rejection_reason: reason,
        rejected_at: new Date().toISOString(),
        rejection_type: 'permanente',
      })
      .eq('id', professionalProfileId)
    if (error) throw error
    await this._logVerificationReview(professionalProfileId, reviewedBy, 'rejected_permanent', reason)
  },

  /** Historial de revisiones de un profesional, más reciente primero — para
   *  el panel de super admin ("quién revisó y cuándo"). */
  async getVerificationHistory(professionalProfileId) {
    const { data, error } = await supabase
      .from('professional_verification_log')
      .select('*, reviewer:profiles!reviewed_by(full_name, email)')
      .eq('professional_profile_id', professionalProfileId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },
}
