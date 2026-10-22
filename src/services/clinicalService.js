import { supabase, toCamelCase, toSnakeCase, asegurarSesion } from '../lib/supabase'
import { MENSAJE_SIN_MATRICULA } from '../lib/firmaHistoriaClinica'
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

/**
 * La firma de un asiento de HC (Ley 26.529 Art. 12: matrícula de quien lo
 * hace), resuelta ACÁ al escribir y con el usuario de la SESIÓN, no con lo que
 * pase la pantalla: antes llegaba `licenseNumber` vacío (o un id nulo) y se
 * firmaba '0' (revisión pre-prod, 2026-10-17). Se lee `professional_profiles`
 * del que tiene la sesión y se memoriza unos segundos, para que un cierre que
 * escribe varias cosas seguidas no lea cuatro veces.
 * - lectura que falla → el error real
 * - sin fila → "No encontramos tu perfil profesional."
 * - fila sin matrícula (no debería: sólo atiende quien fue verificado a mano)
 *   → "Falta tu matrícula…"
 */
const MEMO_FIRMA_MS = 10_000
let memoFirma = null // { uid, at, promesa }

async function firmaDeLaSesion() {
  const session = await asegurarSesion()
  const uid = session.user.id
  if (memoFirma && memoFirma.uid === uid && Date.now() - memoFirma.at < MEMO_FIRMA_MS) return memoFirma.promesa
  const promesa = (async () => {
    const { data, error } = await supabase
      .from('professional_profiles')
      .select('specialty, license_type, license_number')
      .eq('user_id', uid)
      .maybeSingle()
    if (error) throw error
    if (!data) throw new Error('No encontramos tu perfil profesional.')
    const matricula = String(data.license_number ?? '').trim()
    if (!matricula || matricula === '0') throw new Error(MENSAJE_SIN_MATRICULA)
    return { professionalId: uid, licenseType: data.license_type ?? 'MN', licenseNumber: matricula, specialty: data.specialty ?? null }
  })()
  memoFirma = { uid, at: Date.now(), promesa }
  // Un error no queda memorizado: el próximo intento vuelve a leer.
  promesa.catch(() => { if (memoFirma?.promesa === promesa) memoFirma = null })
  return promesa
}

export const clinicalService = {

  logAccess: logClinicalAccess,

  async createEncounter({ patientId, professionalId, consultationId, specialty, chiefComplaint, modality }) {
    if (esSimulado(consultationId)) return simulacion.encuentro()
    // Sin sesión esto sale como anónimo y la RLS lo rechaza: firmaDeLaSesion
    // pasa por asegurarSesion.
    const firma = await firmaDeLaSesion()
    const payload = toSnakeCase({
      patientId,
      professionalId: firma.professionalId,
      consultationId,
      specialty: firma.specialty ?? specialty ?? 'otra',
      status: 'in_progress',
    })
    // Required NOT NULL fields not handled by toSnakeCase
    payload.professional_license_type = firma.licenseType
    payload.professional_license_number = firma.licenseNumber
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

  async addEntry(encounterId, { patientId, professionalId, entryType, content, data: entryData, correctsEntryId, icdCode }) {
    if (esSimulado(encounterId)) return simulacion.eco({ encounterId, patientId, professionalId, entryType, content, data: entryData, icdCode })
    const firma = await firmaDeLaSesion()
    const payload = toSnakeCase({
      encounterId,
      patientId,
      professionalId: firma.professionalId,
      entryType,
      content: content ?? null,
    })
    payload.professional_license_type = firma.licenseType
    payload.professional_license_number = firma.licenseNumber
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
    const firma = await firmaDeLaSesion()
    const payload = toSnakeCase({
      encounterId,
      patientId,
      professionalId: firma.professionalId,
      icd10Code: icdCode ?? null,
      icd10Display: display ?? null,
      clinicalStatus: clinicalStatus ?? 'active',
    })
    if (onsetDate !== undefined) payload.onset_date = onsetDate

    payload.professional_license_type = firma.licenseType
    payload.professional_license_number = firma.licenseNumber

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
    const firma = await firmaDeLaSesion()
    const payload = toSnakeCase({
      encounterId,
      patientId,
      professionalId: firma.professionalId,
      substance: allergen ?? null,
      category: allergyType ?? null,
      clinicalStatus: clinicalStatus ?? 'active',
      criticality: severity ?? null,
      reactionDescription: reaction ?? null,
    })

    payload.professional_license_type = firma.licenseType
    payload.professional_license_number = firma.licenseNumber

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
    const firma = await firmaDeLaSesion()
    const payload = toSnakeCase({
      encounterId,
      patientId,
      professionalId: firma.professionalId,
      loincCode: code ?? null,
      observationType: display ?? null,
      valueNumeric: typeof value === 'number' ? value : null,
      valueString: typeof value === 'string' ? value : null,
      unit: unit ?? null,
      observedAt: effectiveDate ?? new Date().toISOString(),
      status: 'final',
    })

    payload.professional_license_type = firma.licenseType
    payload.professional_license_number = firma.licenseNumber

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
    const firma = await firmaDeLaSesion()
    const dosageText = [dosage, frequency, route].filter(Boolean).join(' — ') || null
    const payload = toSnakeCase({
      encounterId,
      patientId,
      professionalId: firma.professionalId,
      medicationName: medicationName ?? null,
      dosageText,
      notes: instructions ?? null,
      status: status ?? 'active',
    })
    if (startDate !== undefined) payload.start_date = startDate
    if (endDate !== undefined) payload.end_date = endDate

    payload.professional_license_type = firma.licenseType
    payload.professional_license_number = firma.licenseNumber

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
  // Estaban sueltas en `PrescriptionCreator` y `AllergyPanel`,
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
    const firma = await firmaDeLaSesion()
    const { data, error } = await supabase
      .from('clinical_medications')
      .insert(toSnakeCase({ ...fila, professionalId: firma.professionalId, professionalLicenseType: firma.licenseType, professionalLicenseNumber: firma.licenseNumber }))
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
      // Sin las posdatadas: el mismo medicamento emitido para otra fecha.
      supabase.from('clinical_medications').select('*').eq('encounter_id', encounterId).is('posdatada_de', null).order('created_at', { ascending: true }),
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
