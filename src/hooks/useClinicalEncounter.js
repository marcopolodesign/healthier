import { useState, useEffect, useCallback } from 'react'
import { clinicalService } from '../services/clinicalService'

// Loads (if it already exists) and lazily creates the clinical_encounters row
// for a consultation. Shared by ConsultationDetail.jsx and VideoCall.jsx's
// ClinicalPanel — both need "get or create the encounter" before writing any
// clinical data (vitals, allergies, prescriptions, AI Scribe notes), and
// previously duplicated this get-or-create logic independently.
export function useClinicalEncounter({ consultationId, patientId, professionalId, specialty, modality, licenseType, licenseNumber }) {
  const [encounterId, setEncounterId] = useState(null)

  useEffect(() => {
    if (!consultationId) return
    clinicalService.getEncounterByConsultationIdSafe(consultationId)
      .then(enc => { if (enc) setEncounterId(enc.id) })
      .catch(() => {})
  }, [consultationId])

  const ensureEncounter = useCallback(async () => {
    if (encounterId) return encounterId
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
    return enc.id
  }, [encounterId, patientId, professionalId, consultationId, specialty, modality, licenseType, licenseNumber])

  return { encounterId, ensureEncounter }
}
