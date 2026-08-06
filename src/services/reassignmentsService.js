/**
 * reassignmentsService.js — reasignar el profesional de una consulta y ver la
 * deuda/transferencia que eso genera (migración 102).
 *
 * Todas las escrituras pasan por RPCs SECURITY DEFINER (super_admin only) —
 * este service nunca escribe la tabla `consultation_reassignments` directo.
 * Ver el comentario largo de la migración 102 para el porqué del diseño
 * completo (captura contra el original, recupero automático en su próxima
 * consulta directa).
 */
import { supabase, toCamelCase } from '../lib/supabase'

export const reassignmentsService = {
  /**
   * super_admin only (enforced dentro de la RPC). Devuelve la fila de
   * `consultation_reassignments` recién creada.
   */
  async reassignConsultation(consultationId, newProfessionalId, reason) {
    const { data, error } = await supabase.rpc('reassign_consultation', {
      p_consultation_id: consultationId,
      p_new_professional_id: newProfessionalId,
      p_reason: reason || null,
    })
    if (error) throw error
    return toCamelCase(data)
  },

  /** Todas las reasignaciones — super-admin/Payments.jsx. */
  async getAll() {
    const { data, error } = await supabase
      .from('consultation_reassignments')
      .select(`
        *,
        consultation:consultations!consultation_id(id, scheduled_at, status),
        original:profiles!original_professional_id(id, full_name, email),
        covering:profiles!covering_professional_id(id, full_name, email)
      `)
      .order('created_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  /** super_admin only — marca como pagada (transferencia manual) la parte que se le debe al que atendió. */
  async markOwedPaid(reassignmentId) {
    const { error } = await supabase.rpc('mark_reassignment_owed_paid', { p_reassignment_id: reassignmentId })
    return { error }
  },

  /** Saldo pendiente de recuperar de un profesional puntual. */
  async getPendingDebt(professionalId) {
    const { data, error } = await supabase.rpc('get_professional_pending_debt', { p_professional: professionalId })
    if (error) throw error
    return Number(data) || 0
  },
}
