import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'

export const clinicalService = {

  async createEncounter({ patientId, professionalId, consultationId, specialty, chiefComplaint, modality, licenseType, licenseNumber }) {
    const payload = toSnakeCase({
      patientId,
      professionalId,
      consultationId,
      specialty: specialty ?? 'otra',
      status: 'in_progress',
    })
    // Required NOT NULL fields not handled by toSnakeCase
    payload.professional_license_type = licenseType ?? 'MN'
    payload.professional_license_number = licenseNumber ?? '0'
    payload.modality = modality === 'video' ? 'telemedicina' : (modality ?? 'telemedicina')
    payload.started_at = new Date().toISOString()
    if (chiefComplaint !== undefined) payload.chief_complaint = chiefComplaint

    const { data, error } = await supabase
      .from('clinical_encounters')
      .insert(payload)
      .select()
      .single()

    if (error) throw error
    return toCamelCase(data)
  },

  // Returns existing encounter for a consultation, or null if none
  async getEncounterByConsultationIdSafe(consultationId) {
    const { data, error } = await supabase
      .from('clinical_encounters')
      .select('*')
      .eq('consultation_id', consultationId)
      .maybeSingle()

    if (error) throw error
    return data ? toCamelCase(data) : null
  },

  async finishEncounter(encounterId) {
    const { data, error } = await supabase
      .from('clinical_encounters')
      .update({ status: 'finished', finished_at: new Date().toISOString() })
      .eq('id', encounterId)
      .select()
      .single()

    if (error) throw error
    return toCamelCase(data)
  },

  async addEntry(encounterId, { patientId, professionalId, entryType, content, icdCode, licenseType, licenseNumber }) {
    const payload = toSnakeCase({
      encounterId,
      patientId,
      professionalId,
      entryType,
      content: content ?? null,
    })
    payload.professional_license_type = licenseType ?? 'MN'
    payload.professional_license_number = licenseNumber ?? '0'
    if (icdCode !== undefined) payload.icd_code = icdCode

    const { data, error } = await supabase
      .from('clinical_entries')
      .insert(payload)
      .select()
      .single()

    if (error) throw error
    return toCamelCase(data)
  },

  async addCondition(encounterId, { patientId, professionalId, icdCode, display, clinicalStatus, onsetDate }) {
    const payload = toSnakeCase({
      encounterId,
      patientId,
      professionalId,
      icd10Code: icdCode ?? null,
      icd10Display: display ?? null,
      clinicalStatus: clinicalStatus ?? 'active',
    })
    if (onsetDate !== undefined) payload.onset_date = onsetDate

    const { data, error } = await supabase
      .from('clinical_conditions')
      .insert(payload)
      .select()
      .single()

    if (error) throw error
    return toCamelCase(data)
  },

  async addAllergy(encounterId, { patientId, professionalId, allergen, allergyType, clinicalStatus, severity, reaction }) {
    const payload = toSnakeCase({
      encounterId,
      patientId,
      professionalId,
      substance: allergen ?? null,
      category: allergyType ?? null,
      clinicalStatus: clinicalStatus ?? 'active',
      criticality: severity ?? null,
      reactionDescription: reaction ?? null,
    })

    const { data, error } = await supabase
      .from('clinical_allergies')
      .insert(payload)
      .select()
      .single()

    if (error) throw error
    return toCamelCase(data)
  },

  async addObservation(encounterId, { patientId, professionalId, code, display, value, unit, effectiveDate }) {
    const payload = toSnakeCase({
      encounterId,
      patientId,
      professionalId,
      loincCode: code ?? null,
      observationType: display ?? null,
      valueNumeric: typeof value === 'number' ? value : null,
      valueString: typeof value === 'string' ? value : null,
      unit: unit ?? null,
      observedAt: effectiveDate ?? new Date().toISOString(),
      status: 'final',
    })

    const { data, error } = await supabase
      .from('clinical_observations')
      .insert(payload)
      .select()
      .single()

    if (error) throw error
    return toCamelCase(data)
  },

  async addMedication(encounterId, { patientId, professionalId, medicationName, dosage, frequency, route, instructions, status, startDate, endDate }) {
    const dosageText = [dosage, frequency, route].filter(Boolean).join(' — ') || null
    const payload = toSnakeCase({
      encounterId,
      patientId,
      professionalId,
      medicationName: medicationName ?? null,
      dosageText,
      notes: instructions ?? null,
      status: status ?? 'active',
    })
    if (startDate !== undefined) payload.start_date = startDate
    if (endDate !== undefined) payload.end_date = endDate

    const { data, error } = await supabase
      .from('clinical_medications')
      .insert(payload)
      .select()
      .single()

    if (error) throw error
    return toCamelCase(data)
  },

  async getEncounterWithDetail(encounterId) {
    const { data: encounter, error: encounterError } = await supabase
      .from('clinical_encounters')
      .select('*, patient:profiles!patient_id(id, full_name, avatar_url)')
      .eq('id', encounterId)
      .single()

    if (encounterError) throw encounterError

    const [
      { data: entries, error: entriesError },
      { data: conditions, error: conditionsError },
      { data: allergies, error: allergiesError },
      { data: observations, error: observationsError },
      { data: medications, error: medicationsError },
    ] = await Promise.all([
      supabase.from('clinical_entries').select('*').eq('encounter_id', encounterId).order('created_at', { ascending: true }),
      supabase.from('clinical_conditions').select('*').eq('encounter_id', encounterId).order('created_at', { ascending: true }),
      supabase.from('clinical_allergies').select('*').eq('encounter_id', encounterId).order('created_at', { ascending: true }),
      supabase.from('clinical_observations').select('*').eq('encounter_id', encounterId).order('observed_at', { ascending: true }),
      supabase.from('clinical_medications').select('*').eq('encounter_id', encounterId).order('created_at', { ascending: true }),
    ])

    if (entriesError) throw entriesError
    if (conditionsError) throw conditionsError
    if (allergiesError) throw allergiesError
    if (observationsError) throw observationsError
    if (medicationsError) throw medicationsError

    return {
      encounter: toCamelCase(encounter),
      entries: toCamelCase(entries ?? []),
      conditions: toCamelCase(conditions ?? []),
      allergies: toCamelCase(allergies ?? []),
      observations: toCamelCase(observations ?? []),
      medications: toCamelCase(medications ?? []),
    }
  },

  async getProfessionalEncounters(professionalId, limit = 50) {
    const { data, error } = await supabase
      .from('clinical_encounters')
      .select('*, patient:profiles!patient_id(id, full_name, avatar_url)')
      .eq('professional_id', professionalId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw error
    return toCamelCase(data ?? [])
  },

  async getEncounterByConsultationId(consultationId) {
    const { data, error } = await supabase
      .from('clinical_encounters')
      .select('*')
      .eq('consultation_id', consultationId)
      .single()

    if (error) throw error
    return toCamelCase(data)
  },
}
