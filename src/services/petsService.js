import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

/**
 * Mascotas del paciente titular ("Amigo Peludo", tabla `pets`, migración 172).
 * Se reutilizan al reservar con la vertical veterinaria (`consultations.pet_id`)
 * en vez de tipear nombre/especie de nuevo en cada turno.
 */
export const petsService = {
  async listForOwner(ownerId) {
    if (!ownerId) return []
    const { data, error } = await supabase
      .from('pets')
      .select('*')
      .eq('owner_id', ownerId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  async create(ownerId, pet) {
    const { data, error } = await supabase
      .from('pets')
      .insert(toSnakeCase({ ...pet, ownerId }))
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async update(id, pet) {
    const { data, error } = await supabase
      .from('pets')
      .update(toSnakeCase(pet))
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  // Baja lógica — deleted_at, no DELETE real (mismo criterio que profiles).
  async remove(id) {
    const { error } = await supabase
      .from('pets')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  },

  async getById(id) {
    if (!id) return null
    const { data, error } = await supabase
      .from('pets')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return toCamelCase(data)
  },
}
