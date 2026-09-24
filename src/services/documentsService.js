import { supabase, toCamelCase } from '../lib/supabase'
import { subirConProgreso } from '../lib/subidaConProgreso'
import { extraerPathDeStorage } from '../lib/storage'

const BUCKET = 'patient-docs'
/** Los links que se guardan duran un año, igual que los que guarda la app. */
const VIGENCIA_LINK_S = 60 * 60 * 24 * 365

/**
 * Documentos que el paciente sube a la Bóveda: `medical_documents`.
 *
 * ⚠️ Los análisis de SANGRE no van acá: viven en `diagnostic_reports`
 * (`diagnosticReportService`), que es lo que lee e interpreta el BioVisor.
 * Acá van los estudios por imágenes ("Análisis", con especialidad y título,
 * migración 174), los de cada mascota (`category = 'veterinaria'` + `petId`) y
 * el resto de las carpetas de la Bóveda.
 *
 * Contrato compartido con la app (mismas columnas, mismos valores):
 *   category · especialidad · titulo · pet_id · file_url (link firmado).
 *
 * Los archivos van a `<paciente>/documentos/…`: es la carpeta que el
 * profesional con consulta compartida puede leer (policy de storage de la 174).
 */
export const documentsService = {
  async upload({ patientId, file, category, especialidad = null, titulo = null, petId = null, onProgreso }) {
    const limpio = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${patientId}/documentos/${Date.now()}_${limpio}`

    await subirConProgreso(BUCKET, path, file, file.type || 'application/octet-stream',
      f => onProgreso?.(Math.round(f * 100)))

    // Bucket privado: se guarda un link firmado largo, como hace la app, para
    // que las dos puntas lo puedan abrir tal cual. La web igual lo vuelve a
    // firmar al abrirlo (`SignedDocLink`), así que el vencimiento no la afecta.
    const { data: firmado, error: errFirma } = await supabase.storage
      .from(BUCKET).createSignedUrl(path, VIGENCIA_LINK_S)
    if (errFirma) throw errFirma

    const { data, error } = await supabase
      .from('medical_documents')
      .insert({
        patient_id: patientId,
        file_name: file.name,
        file_url: firmado.signedUrl,
        file_size: file.size,
        category,
        especialidad,
        titulo: titulo?.trim() || null,
        pet_id: petId,
      })
      .select()
      .single()
    if (error) {
      await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
      throw error
    }
    return toCamelCase(data)
  },

  /**
   * Documentos de un paciente. Lo usan el paciente (los suyos) y el profesional
   * (RLS `docs_professional_select`). `petId` filtra los de una mascota;
   * `soloPersonas` deja afuera los de mascotas.
   */
  async getByPatient(patientId, { category = null, petId = null, soloPersonas = false } = {}) {
    let query = supabase
      .from('medical_documents')
      .select('*')
      .eq('patient_id', patientId)
    if (category) query = query.eq('category', category)
    if (petId) query = query.eq('pet_id', petId)
    else if (soloPersonas) query = query.is('pet_id', null)
    const { data, error } = await query.order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },

  async delete(doc) {
    const path = extraerPathDeStorage(BUCKET, doc.fileUrl)
    const { error } = await supabase.from('medical_documents').delete().eq('id', doc.id)
    if (error) throw error
    if (path) await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
  },
}

/** Lo que se muestra como nombre: el título que le puso el paciente, o el archivo. */
export function nombreDeDocumento(doc) {
  return doc?.titulo || doc?.fileName || 'Documento'
}
