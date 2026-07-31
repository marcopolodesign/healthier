import { supabase, toCamelCase } from '../lib/supabase'

export const diagnosticReportService = {
  async getByPatient(patientId) {
    const { data, error } = await supabase
      .from('diagnostic_reports')
      .select('*')
      .eq('patient_id', patientId)
      .order('report_date', { ascending: false })
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },

  /**
   * Guarda el PDF/imagen del estudio en el bucket privado `patient-docs`.
   *
   * Va en el service y no en la pantalla porque el bucket es privado: la URL que
   * devuelve `getPublicUrl` no sirve por sí sola, hay que firmarla para verla
   * (`SignedDocLink` ya hace eso en el resto de la app). Guardar el path acá y
   * firmarlo al mostrar es el mismo patrón que usa `documentsService`.
   */
  async uploadDocumento(patientId, file) {
    const path = `${patientId}/biovisor/${Date.now()}_${file.name}`
    const { error } = await supabase.storage.from('patient-docs').upload(path, file)
    if (error) throw error
    const { data } = supabase.storage.from('patient-docs').getPublicUrl(path)
    return data.publicUrl
  },

  async create({ patientId, reportDate, parameters, documentUrl = null, studyType = null, practiceCode = null }) {
    const { data, error } = await supabase
      .from('diagnostic_reports')
      .insert({
        patient_id: patientId,
        report_date: reportDate,
        parameters,
        // El PDF original. Se guardaba `null` siempre: el BioVisor extraía los
        // valores y tiraba el archivo, así que no había forma de contrastar un
        // valor raro contra el estudio real (migración 080).
        document_url: documentUrl,
        study_type: studyType,
        practice_code: practiceCode,
      })
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async delete(id) {
    const { error } = await supabase
      .from('diagnostic_reports')
      .delete()
      .eq('id', id)
    if (error) throw error
  },
}
