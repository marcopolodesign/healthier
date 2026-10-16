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

const normalizar = t => (t ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/**
 * La especialidad que ya existe con ese slug o ese nombre (sin tildes ni
 * mayúsculas), o null. El catálogo es chico: se trae entero y se compara acá,
 * así un nombre con comas o paréntesis no rompe el filtro de PostgREST.
 */
export async function especialidadHomonima(slug, nombre) {
  const { data, error } = await supabase.from('specialties').select('slug, label, vertical_id')
  if (error) throw error
  const n = normalizar(nombre)
  return (data ?? []).find(e => e.slug === slug || normalizar(e.label) === n) ?? null
}

export function mensajeChoque(esp, nombreVertical) {
  const donde = esp.vertical_id ?? esp.verticalId
  const en = donde ? ` (en ${nombreVertical ?? donde})` : ''
  return `Ya existe la especialidad "${esp.label}"${en}. Una vertical nueva no puede llevarse una especialidad que ya existe (se mudarían sus profesionales): elegí otro nombre.`
}

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
   * id). Sin la especialidad, la vertical no aparecería en el onboarding del
   * profesional ni tendría a quién mandarle consultas: el pool sale de
   * `specialties.vertical_id`.
   *
   * Arranca deshabilitada para el paciente salvo que venga con precio y
   * `enabled: true`.
   */
  async create({ id, nombre, color, icon, imageUrl = null, ondemandPrice = null, enabled = false, sortOrder, herramientaHistoriaClinica = true, herramientaReceta = true }) {
    // Una vertical nueva NO se lleva una especialidad que ya existe: si se
    // re-apuntara, todos los profesionales de esa especialidad se mudarían de
    // vertical sin aviso (ej. "Cardiología" sacaría a los cardiólogos de
    // Clínica). Se chequea ANTES de insertar nada, por slug y por nombre.
    const choque = await especialidadHomonima(id, nombre)
    if (choque) throw new Error(mensajeChoque(choque))

    const { data: { user } } = await supabase.auth.getUser()
    const fila = {
      id,
      nombre: nombre.trim(),
      color: color ? color.toUpperCase() : null,
      icon,
      image_url: imageUrl,
      ondemand_price: ondemandPrice === null || ondemandPrice === '' ? null : Number(ondemandPrice),
      enabled: Boolean(enabled && ondemandPrice),
      sort_order: sortOrder ?? 50,
      tipo: 'vertical',
      herramienta_historia_clinica: herramientaHistoriaClinica,
      herramienta_receta: herramientaReceta,
      updated_by: user?.id ?? null,
    }
    const { data, error } = await supabase
      .from('vertical_settings')
      .insert(fila)
      .select(COLUMNAS)
      .single()
    if (error) throw error

    const esp = await supabase.from('specialties')
      .insert({ slug: id, label: nombre.trim(), vertical_id: id, active: true, sort_order: 100 })
    if (esp.error) {
      throw new Error(`Se creó la vertical, pero no su especialidad (${esp.error.message}). Creala a mano en la pestaña Especialidades, colgada de ${nombre.trim()}.`)
    }

    return toCamelCase(data)
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
