import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

/**
 * "Mis direcciones" del paciente (`patient_addresses`, migración 173) — el
 * checkout de farmacia elige una y guarda una copia de texto en
 * `medication_orders.delivery_address`; no se toca esa columna acá.
 * Baja lógica vía `deleted_at`, mismo criterio que `petsService`.
 */
export const patientAddressesService = {
  /** La principal primero, después la más nueva — así `list()[0]` es siempre el default correcto. */
  async list(patientId) {
    if (!patientId) return []
    const { data, error } = await supabase
      .from('patient_addresses')
      .select('*')
      .eq('patient_id', patientId)
      .is('deleted_at', null)
      .order('principal', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  async create(patientId, address) {
    const { data, error } = await supabase
      .from('patient_addresses')
      .insert(toSnakeCase({ ...address, patientId }))
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async update(id, patch) {
    const { data, error } = await supabase
      .from('patient_addresses')
      .update(toSnakeCase(patch))
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async remove(id) {
    const { error } = await supabase
      .from('patient_addresses')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  },

  /** Marca `addressId` como principal y desmarca cualquier otra del paciente. */
  async setPrincipal(patientId, addressId) {
    const { error: unsetError } = await supabase
      .from('patient_addresses')
      .update({ principal: false })
      .eq('patient_id', patientId)
      .eq('principal', true)
    if (unsetError) throw unsetError

    const { data, error } = await supabase
      .from('patient_addresses')
      .update({ principal: true })
      .eq('id', addressId)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },
}
