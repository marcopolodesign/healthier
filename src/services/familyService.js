import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

/**
 * Grupo familiar del paciente titular (tabla `family_members`, migración 068).
 * No son usuarios: no se loguean ni tienen fila en `profiles`.
 */
export const familyService = {
  async listForPatient(patientId) {
    if (!patientId) return []
    const { data, error } = await supabase
      .from('family_members')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  async create(patientId, member) {
    const { data, error } = await supabase
      .from('family_members')
      .insert(toSnakeCase({ ...member, patientId }))
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async remove(id) {
    const { error } = await supabase.from('family_members').delete().eq('id', id)
    if (error) throw error
  },
}
