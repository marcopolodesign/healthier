import { supabase, toCamelCase } from '../lib/supabase'

/**
 * La orden de traslado de una emergencia (migración 213; Nacho, 2026-10-22):
 * la foto de la orden firmada y sellada por el médico y por la institución que
 * recibe al paciente. Exime de responsabilidad, así que:
 *   · la hora y el autor los pone la base (no el teléfono);
 *   · no se edita ni se borra: "cambiar la foto" sube otra, y vale la última;
 *   · el bucket es privado y la foto se ve con una URL firmada que dura poco.
 * La suben el médico o la tripulación mientras la emergencia está en curso; la
 * ven ellos, el despacho de la entidad y el super admin.
 */
const BUCKET = 'ordenes-traslado'
const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' }
export const TIPOS_FOTO_ORDEN = Object.keys(EXTENSION)
export const MAX_FOTO_ORDEN_BYTES = 10 * 1024 * 1024

const SELECT = 'id, emergency_id, institucion, foto_path, subida_at, subida_por, subidor:profiles!subida_por(full_name)'

export const ordenTrasladoService = {
  /** Las órdenes de la emergencia, la más nueva primero (la que vale es la primera). */
  async listar(emergencyId) {
    const { data, error } = await supabase
      .from('emergency_transfer_orders')
      .select(SELECT)
      .eq('emergency_id', emergencyId)
      .order('subida_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },

  /** Sube la foto y registra la orden. Devuelve la orden con la hora de la base. */
  async subir(emergencyId, file, institucion) {
    if (!file) throw new Error('Falta la foto de la orden.')
    if (!TIPOS_FOTO_ORDEN.includes(file.type)) throw new Error('La foto tiene que ser JPG, PNG, WEBP o HEIC.')
    if (file.size > MAX_FOTO_ORDEN_BYTES) throw new Error('La foto pesa más de 10 MB.')
    if (!institucion?.trim()) throw new Error('Falta la institución que lo recibe.')

    const path = `${emergencyId}/${Date.now()}.${EXTENSION[file.type]}`
    const { error: errSubida } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type })
    if (errSubida) throw new Error(errSubida.message || 'No pudimos subir la foto.')

    const { data, error } = await supabase
      .from('emergency_transfer_orders')
      .insert({ emergency_id: emergencyId, institucion: institucion.trim(), foto_path: path })
      .select(SELECT)
      .single()
    if (error) throw new Error(error.message || 'No pudimos guardar la orden.')
    return toCamelCase(data)
  },

  /** URL firmada para ver la foto (10 min). */
  async urlFoto(path, segundos = 600) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, segundos)
    if (error) throw new Error(error.message || 'No pudimos abrir la foto.')
    return data.signedUrl
  },
}
