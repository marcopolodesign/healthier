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

  async create({ patientId, reportDate, parameters, documentUrl = null }) {
    const { data, error } = await supabase
      .from('diagnostic_reports')
      .insert({
        patient_id: patientId,
        report_date: reportDate,
        parameters,
        document_url: documentUrl,
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
