import { supabase, toCamelCase } from '../lib/supabase'

export const consultationTypesService = {
  async getByProfessional(professionalUserId) {
    const { data, error } = await supabase
      .from('consultation_types')
      .select('*')
      .eq('professional_id', professionalUserId)
      .order('sort_order', { ascending: true })
    if (error) throw error
    return toCamelCase(data)
  },

  async saveTypes(professionalUserId, types) {
    const { data: existing } = await supabase
      .from('consultation_types')
      .select('id')
      .eq('professional_id', professionalUserId)

    const existingIds = (existing || []).map(t => t.id)
    const keepIds     = types.filter(t => t.id).map(t => t.id)
    const toDelete    = existingIds.filter(id => !keepIds.includes(id))

    if (toDelete.length > 0) {
      const { error } = await supabase
        .from('consultation_types')
        .delete()
        .in('id', toDelete)
      if (error) throw error
    }

    const toUpsert = types
      .filter(t => t.name?.trim())
      .map((t, i) => ({
        ...(t.id ? { id: t.id } : {}),
        professional_id: professionalUserId,
        name:       t.name.trim(),
        price:      t.price ? Number(t.price) : null,
        modality:   t.modality || null,
        is_active:  true,
        sort_order: i,
      }))

    if (toUpsert.length === 0) return []
    const { data, error } = await supabase
      .from('consultation_types')
      .upsert(toUpsert, { onConflict: 'id' })
      .select()
    if (error) throw error
    return toCamelCase(data)
  },
}
