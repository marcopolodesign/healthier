import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'
import { logClinicalAccess } from './clinicalService'
// Ver la nota de la valla en `consultationsService.js`.
import * as simulacion from '../lib/simulacion'
import { esSimulado } from '../lib/simulacion'

export const historiaClinicaService = {

  // Full patient timeline — pulls from new clinical schema (migration 033)
  // Returns encounters with their entries, conditions, allergies, and medications
  async getPatientTimeline(patientId) {
    if (esSimulado(patientId)) return simulacion.historia()
    const [encountersRes, entriesRes, conditionsRes, allergiesRes, medicationsRes] = await Promise.all([
      supabase
        .from('clinical_encounters')
        .select('*, professional:profiles!professional_id(full_name, avatar_url, professional_profiles!professional_profiles_user_id_fkey(specialty))')
        .eq('patient_id', patientId)
        .in('status', ['in_progress', 'finished'])
        .order('created_at', { ascending: false }),
      supabase
        .from('clinical_entries')
        .select('*')
        .eq('patient_id', patientId)
        .order('sequence_number', { ascending: true }),
      supabase
        .from('clinical_conditions')
        .select('*, professional:profiles!professional_id(full_name)')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false }),
      supabase
        .from('clinical_allergies')
        .select('*, professional:profiles!professional_id(full_name)')
        .eq('patient_id', patientId)
        .eq('clinical_status', 'active')
        .order('created_at', { ascending: false }),
      supabase
        .from('clinical_medications')
        .select('*, professional:profiles!professional_id(full_name)')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false }),
    ])

    const encounters = toCamelCase(encountersRes.data || [])
    const entries    = toCamelCase(entriesRes.data || [])
    const conditions = toCamelCase(conditionsRes.data || [])
    const allergies  = toCamelCase(allergiesRes.data || [])
    const medications = toCamelCase(medicationsRes.data || [])

    // Group entries/conditions/medications by encounterId
    const byEncounter = id => ({
      entries:     entries.filter(e => e.encounterId === id),
      conditions:  conditions.filter(c => c.encounterId === id),
      medications: medications.filter(m => m.encounterId === id),
    })

    // Asiento de auditoría (Ley 26.529 Art. 14): queda registrado quién abrió la
    // HC de este paciente y cuándo. Se asienta un renglón por encuentro leído,
    // no uno por fila — ver el comentario de `logClinicalAccess`. No se espera:
    // la HC se muestra igual aunque el asiento falle.
    encounters.forEach(enc => {
      logClinicalAccess({
        resourceType: 'encounter',
        resourceId:   enc.id,
        patientId,
        action:       'read',
      })
    })

    return {
      encounters: encounters.map(enc => ({ ...enc, ...byEncounter(enc.id) })),
      allergies, // patient-level, not per encounter
    }
  },

  /**
   * Lo que el profesional dejó asentado en UNA consulta: diagnósticos,
   * indicaciones y las notas de la evolución.
   *
   * Existe aparte de `getPatientTimeline` porque el resumen de una consulta no
   * necesita —ni debe— traerse la historia clínica entera del paciente para
   * mostrar un encuentro. Menos datos en el browser y menos asientos de
   * auditoría: acá se registra el acceso a UN encuentro, no a todos.
   *
   * Devuelve `null` cuando la consulta no tiene encuentro clínico (se cerró sin
   * que el profesional cargara nada). Quien llama decide qué decirle al
   * paciente; nunca inventar contenido.
   */
  async getEncounterByConsultation(consultationId, patientId) {
    if (!consultationId) return null
    if (esSimulado(patientId)) return null

    const { data: encounter, error } = await supabase
      .from('clinical_encounters')
      .select('*, professional:profiles!professional_id(full_name, avatar_url, professional_profiles!professional_profiles_user_id_fkey(specialty))')
      .eq('consultation_id', consultationId)
      .maybeSingle()
    if (error) throw error
    if (!encounter) return null

    const [entriesRes, conditionsRes, medicationsRes] = await Promise.all([
      supabase.from('clinical_entries').select('*')
        .eq('encounter_id', encounter.id).order('sequence_number', { ascending: true }),
      supabase.from('clinical_conditions').select('*')
        .eq('encounter_id', encounter.id).order('created_at', { ascending: false }),
      supabase.from('clinical_medications').select('*')
        .eq('encounter_id', encounter.id).order('created_at', { ascending: false }),
    ])

    // Mismo asiento que la HC completa (Ley 26.529 Art. 14). No se espera:
    // el resumen se muestra igual aunque el asiento falle.
    logClinicalAccess({
      resourceType: 'encounter',
      resourceId:   encounter.id,
      patientId:    patientId ?? encounter.patient_id,
      action:       'read',
    })

    return {
      ...toCamelCase(encounter),
      entries:     toCamelCase(entriesRes.data || []),
      conditions:  toCamelCase(conditionsRes.data || []),
      medications: toCamelCase(medicationsRes.data || []),
    }
  },

  /**
   * Las recetas electrónicas emitidas al paciente, más nuevas primero.
   *
   * Una receta agrupa uno o más medicamentos bajo el mismo
   * `rcta_prescription_id`: la fila de la base es el medicamento, no la receta.
   * Se agrupa acá —y no en cada pantalla— para que "qué es una receta emitida"
   * tenga una sola definición en el código del paciente.
   *
   * Emitida = `rcta_status === 'issued'` **y** con PDF. Sin PDF no hay nada que
   * mostrarle: un "Ver receta" que no abre nada es peor que no ofrecerlo.
   */
  async getIssuedPrescriptions(patientId) {
    if (!patientId || esSimulado(patientId)) return []
    const { data, error } = await supabase
      .from('clinical_medications')
      .select('id, medication_name, rcta_prescription_id, rcta_pdf_url, rcta_issued_at, created_at, encounter_id, professional:profiles!professional_id(full_name)')
      .eq('patient_id', patientId)
      .eq('rcta_status', 'issued')
      .not('rcta_pdf_url', 'is', null)
      .order('rcta_issued_at', { ascending: false, nullsFirst: false })
    if (error) throw error

    const porReceta = new Map()
    for (const raw of toCamelCase(data ?? [])) {
      const key = raw.rctaPrescriptionId ?? raw.id
      const existente = porReceta.get(key)
      if (existente) { existente.medicamentos.push(raw.medicationName); continue }
      porReceta.set(key, {
        id: key,
        pdfUrl: raw.rctaPdfUrl,
        emitidaEn: raw.rctaIssuedAt ?? raw.createdAt,
        profesional: raw.professional?.fullName ?? null,
        encounterId: raw.encounterId ?? null,
        medicamentos: [raw.medicationName],
      })
    }
    return Array.from(porReceta.values())
  },

  async getPatientNotes(patientId) {
    if (esSimulado(patientId)) return []
    const { data, error } = await supabase
      .from('clinical_notes')
      .select('*, professional:profiles!professional_id(full_name, avatar_url, professional_profiles!professional_profiles_user_id_fkey(specialty))')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return toCamelCase(data)
  },

  async addNote({ patientId, consultationId, specialty, noteType, title, content }) {
    if (esSimulado(patientId)) return simulacion.eco({ patientId, consultationId, specialty, noteType, title, content })
    const { data, error } = await supabase
      .from('clinical_notes')
      .insert(toSnakeCase({ patientId, consultationId, specialty, noteType, title, content }))
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async updateNote(id, { title, content, noteType }) {
    const { data, error } = await supabase
      .from('clinical_notes')
      .update(toSnakeCase({ title, content, noteType }))
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return toCamelCase(data)
  },

  async deleteNote(id) {
    const { error } = await supabase
      .from('clinical_notes')
      .delete()
      .eq('id', id)
    if (error) throw error
  },
}
