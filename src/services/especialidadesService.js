import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

/**
 * Catálogo único de especialidades y sub-especialidades (migración 101).
 *
 * Reemplaza `SPECIALTY_LABELS`/`SPECIALTIES` hardcodeados en `src/lib/verticals.js`
 * y `src/lib/specialties.js` — ahora es una tabla (`specialties`) editable desde
 * /super-admin/verticales sin deployar. `parent_id` distingue especialidad de
 * primer nivel (NULL) de sub-especialidad (apunta al id del padre).
 *
 * Lectura pública por RLS (cualquier paciente ve labels de especialidad sin
 * estar logueado); escritura sólo super_admin.
 */
export const especialidadesService = {
  /** Catálogo completo, activas e inactivas, ordenado — para el admin. */
  async getAll() {
    const { data, error } = await supabase
      .from('specialties')
      .select('*')
      .order('sort_order', { ascending: true })
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },

  async create({ slug, label, verticalId = null, parentId = null, sortOrder = 0 }) {
    const { data, error } = await supabase
      .from('specialties')
      .insert(toSnakeCase({ slug, label, verticalId, parentId, active: true, sortOrder }))
      .select('*')
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  /** Patch parcial — label, verticalId, parentId, active, sortOrder. */
  async update(id, patch) {
    const { data, error } = await supabase
      .from('specialties')
      .update({ ...toSnakeCase(patch), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async setActive(id, active) {
    return this.update(id, { active })
  },

  /** Persiste un nuevo sort_order por fila — usado al reordenar en el admin. */
  async reorder(items) {
    await Promise.all(items.map(({ id, sortOrder }) => this.update(id, { sortOrder })))
  },
}
