import { supabase, toCamelCase } from '../lib/supabase'

/**
 * Las verticales (migración 078 + 199).
 *
 * Desde la 199 viven acá también la identidad (nombre, color de fondo, clave de
 * ícono, imagen) y se pueden CREAR desde /super-admin/verticales. La fila 'sos'
 * (migración 087) comparte la tabla con `tipo = 'servicio'`: `getAll()` la
 * devuelve igual (el panel la edita) y `useVerticales()` la filtra.
 */
const COLUMNAS = 'id, nombre, color, icon, image_url, tipo, enabled, ondemand_price, sort_order, herramienta_historia_clinica, herramienta_receta'
const BUCKET = 'verticales'

export const verticalsService = {
  /** Todas las filas, ordenadas. Lectura pública por RLS. */
  async getAll() {
    const { data, error } = await supabase
      .from('vertical_settings')
      .select(COLUMNAS)
      .order('sort_order', { ascending: true })
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },

  /**
   * Config de una sola fila por id. Usado por consumidores que no son
   * verticales clínicas (p. ej. `emergencyService.getSosSettings()`, fila
   * 'sos' de la migración 087).
   */
  async getById(id) {
    const { data, error } = await supabase
      .from('vertical_settings')
      .select(COLUMNAS)
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return data ? toCamelCase(data) : null
  },

  /**
   * Editar una vertical. super_admin únicamente — lo impone la RLS.
   * `undefined` = no tocar; `null` en precio/imagen = sacarlo.
   */
  async update(id, { enabled, ondemandPrice, nombre, color, icon, imageUrl, sortOrder, herramientaHistoriaClinica, herramientaReceta }) {
    const { data: { user } } = await supabase.auth.getUser()

    const patch = { updated_at: new Date().toISOString(), updated_by: user?.id ?? null }
    if (enabled !== undefined) patch.enabled = enabled
    if (ondemandPrice !== undefined) {
      patch.ondemand_price = ondemandPrice === null || ondemandPrice === '' ? null : Number(ondemandPrice)
    }
    if (nombre !== undefined) patch.nombre = nombre.trim()
    if (color !== undefined) patch.color = color ? color.toUpperCase() : null
    if (icon !== undefined) patch.icon = icon
    if (imageUrl !== undefined) patch.image_url = imageUrl
    if (sortOrder !== undefined) patch.sort_order = sortOrder
    if (herramientaHistoriaClinica !== undefined) patch.herramienta_historia_clinica = herramientaHistoriaClinica
    if (herramientaReceta !== undefined) patch.herramienta_receta = herramientaReceta

    const { data, error } = await supabase
      .from('vertical_settings')
      .update(patch)
      .eq('id', id)
      .select(COLUMNAS)
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  /**
   * Alta de una vertical nueva + su especialidad homónima (mismo slug que el
   * id), en UNA transacción: RPC `crear_vertical` (migración 202, sólo
   * super_admin). Sin la especialidad la vertical no aparecería en el
   * onboarding ni tendría pool (sale de `specialties.vertical_id`).
   *
   * Si el slug ya es una especialidad de OTRA vertical, la RPC corta con un
   * error que dice cuál (antes se la llevaba en silencio: crear "Cardiología"
   * le sacaba los cardiólogos a Clínica).
   *
   * Con precio > 0 se crea prendida; sin precio, apagada (el paciente la vería
   * y no la podría pagar). Lo decide la RPC.
   */
  async create({ id, nombre, color, icon, imageUrl = null, ondemandPrice = null, sortOrder, herramientaHistoriaClinica = true, herramientaReceta = true }) {
    const precio = ondemandPrice === null || ondemandPrice === '' ? null : Number(ondemandPrice)
    const { data, error } = await supabase.rpc('crear_vertical', {
      p_id: id,
      p_nombre: nombre.trim(),
      p_color: color || null,
      p_icon: icon || null,
      p_image_url: imageUrl,
      p_ondemand_price: precio,
      p_enabled: precio != null && precio > 0,
      p_sort_order: sortOrder ?? 50,
      p_historia_clinica: herramientaHistoriaClinica,
      p_receta: herramientaReceta,
    })
    if (error) throw error
    return toCamelCase(Array.isArray(data) ? data[0] : data)
  },

  /**
   * Mover una vertical un lugar (-1 arriba, +1 abajo) contra el orden actual de
   * la base — RPC `mover_vertical` (migración 202). Antes eran dos updates con
   * el `sort_order` del caché del panel y podían quedar órdenes repetidos.
   */
  async mover(id, direccion) {
    const { error } = await supabase.rpc('mover_vertical', { p_id: id, p_direccion: direccion })
    if (error) throw error
  },

  /** Sube la foto de la tarjeta al bucket público y devuelve su URL. */
  async uploadImage(verticalId, file) {
    const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase()
    const path = `${verticalId}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: '31536000',
      contentType: file.type || undefined,
      upsert: false,
    })
    if (error) throw error
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  },
}
