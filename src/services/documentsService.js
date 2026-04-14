import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

export const documentsService = {
  async upload(patientId, file, description = '') {
    const path = `${patientId}/${Date.now()}_${file.name}`
    const { error: uploadError } = await supabase.storage
      .from('patient-docs')
      .upload(path, file)
    if (uploadError) throw uploadError

    const { data: urlData } = supabase.storage.from('patient-docs').getPublicUrl(path)

    const { data, error } = await supabase
      .from('medical_documents')
      .insert({
        patient_id: patientId,
        file_name: file.name,
        file_url: urlData.publicUrl,
        file_size: file.size,
        description,
      })
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async getByPatient(patientId) {
    const { data, error } = await supabase
      .from('medical_documents')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  async delete(id, fileUrl) {
    // Extract path from URL
    const path = fileUrl.split('/patient-docs/')[1]
    if (path) {
      await supabase.storage.from('patient-docs').remove([path])
    }
    const { error } = await supabase.from('medical_documents').delete().eq('id', id)
    if (error) throw error
  },
}
