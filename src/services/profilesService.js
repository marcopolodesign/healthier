import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'
// Ver la nota de la valla en `consultationsService.js`.
import { esSimulado, PACIENTE } from '../lib/simulacion'

export const profilesService = {
  async getById(id) {
    if (esSimulado(id)) return PACIENTE
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single()
    if (error) throw error
    return toCamelCase(data)
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('profiles')
      .update(toSnakeCase(updates))
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    const profile = toCamelCase(data)
    localStorage.setItem('userProfile', JSON.stringify(profile))
    return profile
  },

  /**
   * Completa DNI / sexo / fecha de nacimiento del paciente para poder emitir la
   * receta. Estaba suelta en `DatosRecetaFaltantes.jsx` como `supabase.rpc`
   * directa — contra la regla del proyecto, y salteándose la valla de la
   * simulación, que es lo que la trajo acá.
   */
  async completeRctaData({ patientId, consultationId = null, dni = null, gender = null, birthDate = null }) {
    if (esSimulado(patientId)) return
    const { error } = await supabase.rpc('complete_patient_rcta_data', {
      p_patient_id:      patientId,
      p_consultation_id: consultationId,
      p_dni:             dni,
      p_gender:          gender,
      p_birth_date:      birthDate,
    })
    if (error) throw error
  },

  async uploadAvatar(userId, file) {
    const ext = file.name.split('.').pop()
    const path = `${userId}/avatar.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true })
    if (uploadError) throw uploadError

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: urlData.publicUrl })
      .eq('id', userId)
    if (updateError) throw updateError
    return urlData.publicUrl
  },
}
