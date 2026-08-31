import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'
// Ver la nota de la valla en `consultationsService.js`.
import * as simulacion from '../lib/simulacion'
import { esSimulado } from '../lib/simulacion'

/**
 * Rastro de auditoría de la historia clínica.
 *
 * Ley 26.529 Art. 14 (asiento de quién accede a la HC) + Ley 25.326: los datos
 * de salud son datos sensibles (Art. 7) y exigen medidas de seguridad y
 * trazabilidad (Art. 9). La tabla `clinical_access_log` existía desde la
 * migración 033 pero nadie la escribía — el rastro era una promesa vacía.
 *
 * Reglas:
 *  - NUNCA puede hacer fallar la operación clínica. Si el log falla, se avisa
 *    por consola y la escritura sigue: perder un asiento de auditoría es malo,
 *    perder una nota clínica en el medio de una consulta es peor.
 *  - Las lecturas se asientan a nivel encuentro, no fila por fila. Un timeline
 *    de un paciente con años de historia generaría cientos de filas por pantalla
 *    y el asiento útil es "fulano abrió la HC de mengano", no cada renglón.
 *  - `ip_address` queda en null: el browser no la conoce. Si hace falta para una
 *    auditoría formal hay que mover el asiento a una Edge Function.
 */
export async function logClinicalAccess({ resourceType, resourceId, patientId, action }) {
  if (!resourceId || !patientId) return
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const accessedBy = session?.user?.id
    if (!accessedBy) return

    const { error } = await supabase.from('clinical_access_log').insert({
      accessed_by:   accessedBy,
      resource_type: resourceType,
      resource_id:   resourceId,
      patient_id:    patientId,
      action,
      user_agent:    typeof navigator !== 'undefined' ? navigator.userAgent?.slice(0, 500) ?? null : null,
    })
    if (error) console.warn('clinical_access_log:', error.message)
  } catch (err) {
    console.warn('clinical_access_log:', err)
  }
}

export const clinicalService = {

  logAccess: logClinicalAccess,

  async createEncounter({ patientId, professionalId, consultationId, specialty, chiefComplaint, modality, licenseType, licenseNumber }) {
    if (esSimulado(consultationId)) return simulacion.encuentro()
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
    await logClinicalAccess({ resourceType: 'encounter', resourceId: data.id, patientId: data.patient_id, action: 'create' })
    return toCamelCase(data)
  },

  // Returns existing encounter for a consultation, or null if none
  async getEncounterByConsultationIdSafe(consultationId) {
    if (esSimulado(consultationId)) return simulacion.encuentro()
    const { data, error } = await supabase
      .from('clinical_encounters')
      .select('*')
      .eq('consultation_id', consultationId)
      .maybeSingle()

    if (error) throw error
    return data ? toCamelCase(data) : null
  },

  async finishEncounter(encounterId) {
    if (esSimulado(encounterId)) return simulacion.encuentro()
    const { data, error } = await supabase
      .from('clinical_encounters')
      .update({ status: 'finished', finished_at: new Date().toISOString() })
      .eq('id', encounterId)
      .select()
      .single()

    if (error) throw error
    await logClinicalAccess({ resourceType: 'encounter', resourceId: data.id, patientId: data.patient_id, action: 'update_status' })
    return toCamelCase(data)
  },

  async addEntry(encounterId, { patientId, professionalId, entryType, content, data: entryData, correctsEntryId, icdCode, licenseType, licenseNumber }) {
    if (esSimulado(encounterId)) return simulacion.eco({ encounterId, patientId, professionalId, entryType, content, data: entryData, icdCode })
    const payload = toSnakeCase({
      encounterId,
      patientId,
      professionalId,
      entryType,
      content: content ?? null,
    })
    payload.professional_license_type = licenseType ?? 'MN'
    payload.professional_license_number = licenseNumber ?? '0'
    if (entryData !== undefined) payload.data = entryData
    if (correctsEntryId !== undefined) payload.corrects_entry_id = correctsEntryId
    if (icdCode !== undefined) payload.icd_code = icdCode

    const { data, error } = await supabase
      .from('clinical_entries')
      .insert(payload)
      .select()
      .single()

    if (error) throw error
    await logClinicalAccess({ resourceType: 'entry', resourceId: data.id, patientId: data.patient_id, action: 'create' })
    return toCamelCase(data)
  },

  async addCondition(encounterId, { patientId, professionalId, icdCode, display, clinicalStatus, onsetDate }) {
    if (esSimulado(encounterId)) return simulacion.eco({ encounterId, patientId, professionalId, icdCode, display, clinicalStatus, onsetDate })
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
    await logClinicalAccess({ resourceType: 'condition', resourceId: data.id, patientId: data.patient_id, action: 'create' })
    return toCamelCase(data)
  },

  async addAllergy(encounterId, { patientId, professionalId, allergen, allergyType, clinicalStatus, severity, reaction }) {
    if (esSimulado(encounterId)) return simulacion.eco({ encounterId, patientId, professionalId, allergen, allergyType, clinicalStatus, severity, reaction })
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
    await logClinicalAccess({ resourceType: 'allergy', resourceId: data.id, patientId: data.patient_id, action: 'create' })
    return toCamelCase(data)
  },

  async addObservation(encounterId, { patientId, professionalId, code, display, value, unit, effectiveDate }) {
    if (esSimulado(encounterId)) return simulacion.eco({ encounterId, patientId, professionalId, code, display, value, unit, effectiveDate })
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
    await logClinicalAccess({ resourceType: 'observation', resourceId: data.id, patientId: data.patient_id, action: 'create' })
    return toCamelCase(data)
  },

  async addMedication(encounterId, { patientId, professionalId, medicationName, dosage, frequency, route, instructions, status, startDate, endDate }) {
    if (esSimulado(encounterId)) return simulacion.eco({ encounterId, patientId, professionalId, medicationName, dosage, frequency, route, instructions, status, startDate, endDate })
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
    await logClinicalAccess({ resourceType: 'medication', resourceId: data.id, patientId: data.patient_id, action: 'create' })
    return toCamelCase(data)
  },

// ── Lecturas y escrituras que antes hacían los componentes contra Supabase ──
  // Estaban sueltas en `PrescriptionCreator`, `VitalsPanel` y `AllergyPanel`,
  // contra la regla del proyecto ("todas las llamadas a la base pasan por
  // `src/services/`"). Se movieron acá al construir la simulación de
  // videollamada: la valla de `esSimulado` vive en los servicios, así que una
  // consulta directa desde un componente se la salteaba — y una de ellas era el
  // INSERT de la receta, o sea que la práctica habría escrito medicación real
  // en la historia clínica de una paciente que no existe.

  /** Recetas cargadas en un encuentro, más nueva primero. */
  async getMedicationsByEncounter(encounterId) {
    if (esSimulado(encounterId)) return simulacion.recetasDePractica()
    if (!encounterId) return []
    const { data, error } = await supabase
      .from('clinical_medications')
      .select('*')
      .eq('encounter_id', encounterId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data ?? []
  },

  /** Signos vitales de un encuentro, en orden cronológico. */
  async getObservationsByEncounter(encounterId) {
    if (esSimulado(encounterId)) return simulacion.observacionesDePractica()
    if (!encounterId) return []
    const { data, error } = await supabase
      .from('clinical_observations')
      .select('*')
      .eq('encounter_id', encounterId)
      .order('observed_at', { ascending: true })
    if (error) throw error
    return data ?? []
  },

  /** Alergias del paciente (a nivel paciente, no de un encuentro). */
  async getAllergiesByPatient(patientId) {
    if (esSimulado(patientId)) return simulacion.historia().allergies
    if (!patientId) return []
    const { data, error } = await supabase
      .from('clinical_allergies')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data ?? []
  },

  /**
   * La medicación de una receta electrónica. Es más ancha que `addMedication`
   * —lleva los campos del vademécum de Innovamed (`reg_no`, `presentacion`,
   * `nombre_droga`) que `rcta-issue` necesita— así que va aparte en vez de
   * ensanchar aquella firma para todos sus llamadores.
   */
  async createPrescriptionMedication(fila) {
    if (esSimulado(fila.encounterId)) return simulacion.guardarRecetaDePractica(fila)
    const { data, error } = await supabase
      .from('clinical_medications')
      .insert(toSnakeCase(fila))
      .select()
      .single()
    if (error) throw error
    return data
  },

  async getEncounterWithDetail(encounterId) {
    if (esSimulado(encounterId)) return simulacion.encuentro()
    const { data: encounter, error: encounterError } = await supabase
      .from('clinical_encounters')
      .select('*, patient:profiles!patient_id(id, full_name, avatar_url)')
      .eq('id', encounterId)
      .single()

    if (encounterError) throw encounterError

    await logClinicalAccess({
      resourceType: 'encounter',
      resourceId:   encounter.id,
      patientId:    encounter.patient_id,
      action:       'read',
    })

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

  /**
   * Las recetas electrónicas efectivamente emitidas para una consulta.
   *
   * Una receta puede llevar varios medicamentos, así que las filas se agrupan por
   * `rcta_prescription_id`: lo que el paciente recibe es UN documento, no uno por
   * medicamento. Devuelve `[]` si la consulta todavía no tiene encuentro clínico
   * o si nada se emitió.
   */
  async getIssuedRecetasByConsultation(consultationId) {
    if (esSimulado(consultationId)) return []
    if (!consultationId) return []

    const { data: enc, error: encError } = await supabase
      .from('clinical_encounters')
      .select('id')
      .eq('consultation_id', consultationId)
      .maybeSingle()
    if (encError || !enc) return []

    const { data, error } = await supabase
      .from('clinical_medications')
      .select('id, medication_name, rcta_prescription_id, rcta_pdf_url, rcta_issued_at')
      .eq('encounter_id', enc.id)
      .eq('rcta_status', 'issued')
      .order('rcta_issued_at', { ascending: false })
    if (error) return []

    const porReceta = new Map()
    for (const m of data ?? []) {
      const key = m.rcta_prescription_id ?? m.id
      if (!porReceta.has(key)) {
        porReceta.set(key, {
          prescriptionId: m.rcta_prescription_id ?? '—',
          pdfUrl:         m.rcta_pdf_url,
          issuedAt:       m.rcta_issued_at,
          medications:    [],
        })
      }
      porReceta.get(key).medications.push(m.medication_name)
    }
    return [...porReceta.values()]
  },

  async getEncounterByConsultationId(consultationId) {
    if (esSimulado(consultationId)) return simulacion.encuentro()
    const { data, error } = await supabase
      .from('clinical_encounters')
      .select('*')
      .eq('consultation_id', consultationId)
      .single()

    if (error) throw error
    return toCamelCase(data)
  },
}
