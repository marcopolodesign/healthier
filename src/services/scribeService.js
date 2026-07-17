import { supabase, toCamelCase, toSnakeCase } from '../lib/supabase'
import { clinicalService } from './clinicalService'

// Keep in sync with SCRIBE_SECTIONS in supabase/functions/clinical-scribe/index.ts
export const SCRIBE_SECTION_LABELS = {
  motivo_consulta: 'Motivo de Consulta',
  edad: 'Edad',
  historia_social: 'Historia Social',
  antecedentes_medicos: 'Antecedentes Médicos',
  medicamentos_actuales: 'Medicamentos Actuales',
  alergias: 'Alergias',
  historia_familiar: 'Historia Familiar',
  consumo_alcohol: 'Consumo de Alcohol',
  consumo_tabaco: 'Consumo de Tabaco',
  sustancias_controladas: 'Sustancias Controladas',
  dispositivos_asistencia: 'Dispositivos de Asistencia',
  dieta: 'Dieta',
  actividad_fisica: 'Actividad Física',
  sueno: 'Sueño',
  historia_enfermedad_actual: 'Historia de la Enfermedad Actual',
  examen_fisico: 'Examen Físico',
}

// [label, value] pairs for every section the transcript actually filled in —
// shared by the draft-review UI (ScribeSession.jsx) and renderSummary below,
// so the two never drift on what counts as "empty".
function nonEmptySections(structuredData) {
  return Object.entries(SCRIBE_SECTION_LABELS)
    .map(([key, label]) => [label, structuredData?.[key]])
    .filter(([, value]) => value && value.trim())
}

function renderSummary(structuredData) {
  return nonEmptySections(structuredData)
    .map(([label, value]) => `${label}: ${value.trim()}`)
    .join('\n')
}

async function invokeScribe(action, params) {
  const { data, error } = await supabase.functions.invoke('clinical-scribe', {
    body: { action, ...params },
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

export const scribeService = {
  SCRIBE_SECTION_LABELS,
  renderSummary,
  nonEmptySections,

  async createSession({ encounterId, patientId, professionalId }) {
    const { data, error } = await supabase
      .from('clinical_scribe_sessions')
      .insert(toSnakeCase({ encounterId, patientId, professionalId, status: 'recording' }))
      .select()
      .single()

    if (error) throw error
    return toCamelCase(data)
  },

  async transcribeChunk(sessionId, previousTranscript, audioBase64, mimeType = 'audio/webm') {
    const { transcript: chunk } = await invokeScribe('transcribe_chunk', { audioBase64, mimeType })
    const transcript = [previousTranscript, chunk].filter(Boolean).join(' ').trim()

    const { error } = await supabase
      .from('clinical_scribe_sessions')
      .update({ transcript })
      .eq('id', sessionId)

    if (error) throw error
    return transcript
  },

  async extractNote(sessionId, transcript, specialty) {
    const { structuredData } = await invokeScribe('extract_note', { transcript, specialty })

    const { error } = await supabase
      .from('clinical_scribe_sessions')
      .update({ structured_data: structuredData, status: 'draft' })
      .eq('id', sessionId)

    if (error) throw error
    return structuredData
  },

  async voiceEdit(sessionId, structuredData, { instructionText, instructionAudioBase64, instructionMimeType }) {
    const result = await invokeScribe('voice_edit', {
      structuredData, instructionText, instructionAudioBase64, instructionMimeType,
    })

    const { error } = await supabase
      .from('clinical_scribe_sessions')
      .update({ structured_data: result.structuredData })
      .eq('id', sessionId)

    if (error) throw error
    return result.structuredData
  },

  // Commits the current draft as a single immutable clinical_entries row and
  // marks the staging session finalized. This is the ONLY point where scribe
  // output enters the official (append-only) historia clínica. Stamps a
  // provenance marker into `data` — clinical_scribe_sessions.committed_entry_id
  // already links back, but that link only survives as long as the staging
  // row does; the marker on the immutable entry itself is what actually
  // proves AI origin permanently. Additive-only, doesn't affect any UI that
  // reads structuredData by its known SCRIBE_SECTION_LABELS keys.
  async finalize(sessionId, { encounterId, patientId, professionalId, structuredData, licenseType, licenseNumber }) {
    const entry = await clinicalService.addEntry(encounterId, {
      patientId,
      professionalId,
      entryType: 'note',
      content: renderSummary(structuredData) || '(sin contenido)',
      data: { ...structuredData, _source: 'ai_scribe', _scribeSessionId: sessionId },
      licenseType,
      licenseNumber,
    })

    const { error } = await supabase
      .from('clinical_scribe_sessions')
      .update({ status: 'finalized', committed_entry_id: entry.id })
      .eq('id', sessionId)

    if (error) throw error
    return entry
  },

  async discard(sessionId) {
    const { error } = await supabase
      .from('clinical_scribe_sessions')
      .update({ status: 'discarded' })
      .eq('id', sessionId)

    if (error) throw error
  },
}
