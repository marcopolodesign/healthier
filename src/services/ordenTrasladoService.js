import { supabase, toCamelCase } from '../lib/supabase'

/**
 * Los documentos de cierre de una emergencia (migración 213; Nacho y Mateo,
 * 2026-10-22): la orden de traslado (firmada y sellada por el médico y por la
 * institución que recibe) y la negativa de atención firmada (opcional, al
 * cerrar sin atención). Eximen de responsabilidad, así que:
 *   · la hora y el autor los pone la base (no el teléfono);
 *   · no se edita ni se borra: "cambiar la foto" sube otra, y vale la última;
 *   · el bucket es privado y la foto se ve con una URL firmada que dura poco.
 * Los suben el médico, la tripulación o el despacho de la entidad mientras la
 * emergencia está en curso; los ven ellos, el super admin y el paciente.
 */
const BUCKET = 'ordenes-traslado'
const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' }
export const TIPOS_FOTO_ORDEN = Object.keys(EXTENSION)
export const MAX_FOTO_ORDEN_BYTES = 10 * 1024 * 1024

export const TIPO_DOCUMENTO = { orden_traslado: 'Orden de traslado', negativa: 'Negativa de atención' }

const SELECT = 'id, emergency_id, tipo, institucion, foto_path, subida_at, subida_por, subidor:profiles!subida_por(full_name)'

/** El último de cada tipo (`{ orden_traslado, negativa }`), de una lista ya ordenada. */
export function ultimosPorTipo(lista) {
  const out = {}
  for (const d of lista ?? []) if (!out[d.tipo]) out[d.tipo] = d
  return out
}

export const ordenTrasladoService = {
  /** Los documentos de la emergencia, el más nuevo primero (de cada tipo vale el primero). */
  async listar(emergencyId) {
    const { data, error } = await supabase
      .from('emergency_transfer_orders')
      .select(SELECT)
      .eq('emergency_id', emergencyId)
      .order('subida_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },

  /**
   * Los de las emergencias del paciente (su historia clínica), agrupados por
   * emergencia: `[{ emergencia, documentos }]`, la más nueva primero.
   */
  async listarDelPaciente(patientId) {
    const { data, error } = await supabase
      .from('emergency_transfer_orders')
      .select(`${SELECT}, emergencia:emergencies!inner(id, dispatch_code, created_at, completed_at, desenlace, patient_id)`)
      .eq('emergencia.patient_id', patientId)
      .order('subida_at', { ascending: false })
    if (error) throw error
    const grupos = new Map()
    for (const d of (data ?? []).map(toCamelCase)) {
      const g = grupos.get(d.emergencyId) ?? { emergencia: d.emergencia, documentos: [] }
      g.documentos.push(d)
      grupos.set(d.emergencyId, g)
    }
    return [...grupos.values()].sort((a, b) => new Date(b.emergencia.createdAt) - new Date(a.emergencia.createdAt))
  },

  /**
   * Sube la foto y registra el documento. Devuelve la fila con la hora de la
   * base. `tipo`: 'orden_traslado' (pide institución) | 'negativa'.
   */
  async subir(emergencyId, file, { tipo = 'orden_traslado', institucion = null } = {}) {
    if (!file) throw new Error('Falta la foto.')
    if (!TIPOS_FOTO_ORDEN.includes(file.type)) throw new Error('La foto tiene que ser JPG, PNG, WEBP o HEIC.')
    if (file.size > MAX_FOTO_ORDEN_BYTES) throw new Error('La foto pesa más de 10 MB.')
    if (tipo === 'orden_traslado' && !institucion?.trim()) throw new Error('Falta la institución que lo recibe.')

    const path = `${emergencyId}/${Date.now()}.${EXTENSION[file.type]}`
    const { error: errSubida } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type })
    if (errSubida) throw new Error(errSubida.message || 'No pudimos subir la foto.')

    const { data, error } = await supabase
      .from('emergency_transfer_orders')
      .insert({ emergency_id: emergencyId, tipo, institucion: institucion?.trim() || null, foto_path: path })
      .select(SELECT)
      .single()
    if (error) throw new Error(error.message || 'No pudimos guardar el documento.')
    return toCamelCase(data)
  },

  /** URL firmada para ver la foto (10 min). */
  async urlFoto(path, segundos = 600) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, segundos)
    if (error) throw new Error(error.message || 'No pudimos abrir la foto.')
    return data.signedUrl
  },
}
