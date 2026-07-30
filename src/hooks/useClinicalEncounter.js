import { useState, useEffect, useCallback } from 'react'
import { clinicalService } from '../services/clinicalService'
import { preconsultaToText } from '../components/professional/PreconsultaSummary'

// Loads (if it already exists) and lazily creates the clinical_encounters row
// for a consultation. Shared by ConsultationDetail.jsx and VideoCall.jsx's
// ClinicalPanel — both need "get or create the encounter" before writing any
// clinical data (vitals, allergies, prescriptions, AI Scribe notes), and
// previously duplicated this get-or-create logic independently.
export function useClinicalEncounter({ consultationId, patientId, professionalId, specialty, modality, licenseType, licenseNumber, preconsulta }) {
  const [encounterId, setEncounterId] = useState(null)

  useEffect(() => {
    if (!consultationId) return
    clinicalService.getEncounterByConsultationIdSafe(consultationId)
      .then(enc => { if (enc) setEncounterId(enc.id) })
      .catch(() => {})
  }, [consultationId])

  const ensureEncounter = useCallback(async () => {
    if (encounterId) return encounterId

    // Re-consultar la base antes de crear. Decidir sólo con el estado de React
    // era suficiente mientras hubiera un único hook por pantalla, pero la
    // videollamada tiene dos consumidores (el panel clínico y el modal de cierre)
    // y cada instancia arranca con su `encounterId` en null: los dos creaban.
    // Un duplicado no degrada, ROMPE — `getEncounterByConsultationIdSafe` usa
    // `.maybeSingle()` y tira error con dos filas. La migración 076 además lo
    // hace imposible con un índice único.
    if (consultationId) {
      const existente = await clinicalService.getEncounterByConsultationIdSafe(consultationId).catch(() => null)
      if (existente) {
        setEncounterId(existente.id)
        return existente.id
      }
    }

    const enc = await clinicalService.createEncounter({
      patientId,
      professionalId,
      consultationId,
      specialty: specialty ?? 'otra',
      modality,
      licenseType: licenseType ?? 'MN',
      licenseNumber: licenseNumber ?? '0',
    })
    setEncounterId(enc.id)

    // Lo que el paciente declaró antes de entrar queda asentado como primera
    // entrada del encuentro. Vivía sólo en `consultations.preconsulta_data`, un
    // jsonb editable y fuera de la HC: el motivo de consulta es parte del acto
    // médico y la HC lo tiene que registrar de forma inalterable
    // (Ley 26.529 Art. 15). Se escribe una sola vez, al crear el encuentro.
    // Falla en silencio a propósito: no puede bloquear la carga de datos
    // clínicos que el profesional está por hacer.
    const texto = preconsultaToText(preconsulta)
    if (texto) {
      clinicalService.addEntry(enc.id, {
        patientId,
        professionalId,
        entryType: 'note',
        content: texto,
        data: { source: 'preconsulta', consultationId },
        licenseType: licenseType ?? 'MN',
        licenseNumber: licenseNumber ?? '0',
      }).catch(err => console.error('No se pudo asentar la pre-consulta en la HC:', err))
    }

    return enc.id
  }, [encounterId, patientId, professionalId, consultationId, specialty, modality, licenseType, licenseNumber, preconsulta])

  return { encounterId, ensureEncounter }
}
