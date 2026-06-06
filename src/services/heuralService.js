// ─── Heural EHR API Client ────────────────────────────────────────────────────
// Base URL  : VITE_HEURAL_API_URL (default: https://uat.heural.com/api)
// Auth      : Bearer JWT via VITE_HEURAL_TOKEN + x-institution-id header (REQUIRED)
//             FHIR reads use header "jwt: <token>" instead of Authorization
// GraphQL   : POST /graphql
// SNOMED    : GET /hermes/v1/snomed/search?s=<term>&maxHits=N  (Bearer + x-institution-id)
//
// ⚠️  CRITICAL: every GraphQL request MUST include "x-institution-id" header or
//     the server returns UNAUTHORIZED regardless of JWT role.
//
// Schema notes (verified against UAT 2026-06-02):
//   - SnomedCode scalar: pass as plain string conceptId e.g. "387207008"
//   - AllergyIntolerance id field: allergyIntoleranceId
//   - MedicationRequest id field: medicationRequestId
//   - Observation id field: observationId
//   - ObservationInput value format: { quantity: { value: N, unit: "str" } }
//   - PatientPreconsultaInput: only "reason" confirmed so far
//   - confirmAppointmentAttendance returns Date scalar (not object)
//   - cancelPatientAppointment returns Boolean (not object)
//
// All exported functions return { data, error } — never throw.
// On 401, token is refreshed once and the request is retried automatically.
// ─────────────────────────────────────────────────────────────────────────────

// ── Runtime config ────────────────────────────────────────────────────────────
function getConfig() {
  const runtime = typeof window !== 'undefined' && window.__HEURAL__
  return {
    apiUrl: (runtime?.apiUrl ?? import.meta.env.VITE_HEURAL_API_URL ?? 'https://uat.heural.com/api').replace(/\/$/, ''),
    token: runtime?.token ?? import.meta.env.VITE_HEURAL_TOKEN ?? '',
    refreshToken: runtime?.refreshToken ?? import.meta.env.VITE_HEURAL_REFRESH_TOKEN ?? '',
    institutionId: runtime?.institutionId ?? import.meta.env.VITE_HEURAL_INSTITUTION_ID ?? '',
  }
}

// In-memory token store (survives within a page session; reset on reload)
let _token = null
let _refreshToken = null

function token() {
  return _token ?? getConfig().token
}

function refreshTokenValue() {
  return _refreshToken ?? getConfig().refreshToken
}

function institutionId() {
  return getConfig().institutionId
}

// ── String escaping for inline GraphQL values ─────────────────────────────────
// Safely embed user-provided strings into query bodies (prevents GraphQL injection)
function esc(val) {
  if (val == null) return 'null'
  return JSON.stringify(String(val))
}

// ── Token refresh ─────────────────────────────────────────────────────────────
async function refreshToken() {
  const { apiUrl } = getConfig()
  const rt = refreshTokenValue()
  if (!rt) return false
  try {
    const res = await fetch(`${apiUrl}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    })
    if (!res.ok) return false
    const json = await res.json()
    const newToken = json?.token ?? json?.accessToken ?? json?.access_token
    const newRefresh = json?.refreshToken ?? json?.refresh_token
    if (newToken) {
      _token = newToken
      if (newRefresh) _refreshToken = newRefresh
      if (typeof window !== 'undefined' && window.__HEURAL__) {
        window.__HEURAL__.token = newToken
        if (newRefresh) window.__HEURAL__.refreshToken = newRefresh
      }
      return true
    }
    return false
  } catch {
    return false
  }
}

// ── Core fetch with auto-refresh ──────────────────────────────────────────────
async function apiFetch(path, options = {}, isRetry = false) {
  const { apiUrl } = getConfig()
  const url = `${apiUrl}${path}`
  const headers = { ...(options.headers ?? {}) }

  const isFhir = path.startsWith('/fhir')
  if (isFhir) {
    headers['jwt'] = token()
  } else {
    headers['Authorization'] = `Bearer ${token()}`
    // x-institution-id is required for all non-FHIR endpoints
    if (!headers['x-institution-id']) {
      headers['x-institution-id'] = institutionId()
    }
  }

  const res = await fetch(url, { ...options, headers })

  if (res.status === 401 && !isRetry) {
    const refreshed = await refreshToken()
    if (refreshed) return apiFetch(path, options, true)
  }

  return res
}

// ── GraphQL caller ────────────────────────────────────────────────────────────
// Uses raw query strings (not $variables) because the server's custom scalar
// validators (SnomedCode, enum literals) behave differently with variable types.
async function gql(query) {
  try {
    const res = await apiFetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })

    if (!res.ok) {
      const text = await res.text()
      return { data: null, error: `HTTP ${res.status}: ${text}` }
    }

    const json = await res.json()

    if (json?.errors?.length) {
      const msg = json.errors.map(e => e.message).join(' | ')
      return { data: null, error: msg }
    }

    return { data: json.data ?? null, error: null }
  } catch (err) {
    return { data: null, error: err?.message ?? 'Network error' }
  }
}

// Keep backward-compatible alias
const graphqlRequest = (query) => gql(query)

// ═════════════════════════════════════════════════════════════════════════════
// ALLERGIES
// ═════════════════════════════════════════════════════════════════════════════

export async function getAllergies(patientHeuralId, encounterId = null) {
  const encounterFilter = encounterId ? `, encounterId: "${encounterId}"` : ''
  const { data, error } = await gql(`
    query {
      allergyIntolerances(
        patientId: "${patientHeuralId}"
        institutionId: "${institutionId()}"
        ${encounterFilter}
      ) {
        allergyIntoleranceId
        code
        category
        criticality
        clinicalStatus
        verificationStatus
        recordedDate
      }
    }
  `)
  return { data: data?.allergyIntolerances ?? null, error }
}

export async function saveAllergy(input) {
  const {
    patientHeuralId,
    encounterId,
    code,
    category = 'MEDICATION',
    criticality = 'LOW',
    clinicalStatus = 'ACTIVE',
    verificationStatus = 'CONFIRMED',
    intoleranceType = 'ALLERGY',
  } = input

  const encounterPart = encounterId ? `, encounterId: "${encounterId}"` : ''
  const categoryArr = Array.isArray(category) ? category.join(', ') : category

  const { data, error } = await gql(`
    mutation {
      saveAllergyIntolerance(input: {
        patientId: "${patientHeuralId}"
        institutionId: "${institutionId()}"
        ${encounterPart}
        intoleranceType: ${intoleranceType}
        category: [${categoryArr}]
        criticality: ${criticality}
        clinicalStatus: ${clinicalStatus}
        verificationStatus: ${verificationStatus}
        code: "${code}"
      }) {
        allergyIntoleranceId
        code
        category
        criticality
        clinicalStatus
      }
    }
  `)
  return { data: data?.saveAllergyIntolerance ?? null, error }
}

// ═════════════════════════════════════════════════════════════════════════════
// OBSERVATIONS / VITALS
// ═════════════════════════════════════════════════════════════════════════════

export async function getObservations(patientHeuralId, encounterId = null) {
  const encounterFilter = encounterId ? `, encounterId: "${encounterId}"` : ''
  const { data, error } = await gql(`
    query {
      observations(
        userId: "${patientHeuralId}"
        institutionId: "${institutionId()}"
        ${encounterFilter}
      ) {
        observationId
        category
        heuralCode
        effectiveFrom
        effectiveUntil
      }
    }
  `)
  return { data: data?.observations ?? null, error }
}

// heuralCode: HEART_RATE | BLOOD_PRESSURE | SPO2 | WEIGHT | HEIGHT | TEMPERATURE
// value: numeric value, unit: e.g. "bpm", "mmHg", "kg", "cm", "°C", "%"
export async function createVital(patientHeuralId, encounterId, heuralCode, value, unit) {
  const { data, error } = await gql(`
    mutation {
      createObservation(input: {
        subjectId: "${patientHeuralId}"
        institutionId: "${institutionId()}"
        encounterId: "${encounterId}"
        category: VITAL_SIGNS
        heuralCode: ${heuralCode}
        valueClass: quantity
        value: { quantity: { value: ${Number(value)}, unit: ${esc(unit)} } }
      }) {
        observationId
        category
        heuralCode
      }
    }
  `)
  return { data: data?.createObservation ?? null, error }
}

// ═════════════════════════════════════════════════════════════════════════════
// PRE-CONSULTA
// ═════════════════════════════════════════════════════════════════════════════

// formData: { reason } — only "reason" confirmed by schema on 2026-06-02
// Add more fields here as Heural documents/confirms them
export async function submitPreconsulta(appointmentHeuralId, formData) {
  const { reason } = formData
  const { data, error } = await gql(`
    mutation {
      submitPatientPreconsultaV2(
        appointmentId: "${appointmentHeuralId}"
        input: { reason: ${esc(reason)} }
      ) {
        appointmentId
      }
    }
  `)
  return { data: data?.submitPatientPreconsultaV2 ?? null, error }
}

export async function getPreconsulta(encounterId, patientHeuralId) {
  const { data, error } = await gql(`
    query {
      encounterPreconsulta(
        encounterId: "${encounterId}"
        patientId: "${patientHeuralId}"
      ) {
        appointmentId
      }
    }
  `)
  return { data: data?.encounterPreconsulta ?? null, error }
}

// ═════════════════════════════════════════════════════════════════════════════
// PRESCRIPTIONS / MEDICATIONS
// ═════════════════════════════════════════════════════════════════════════════

// Returns [{ conceptId, display }]
export async function searchMedication(term, maxHits = 10) {
  try {
    const res = await apiFetch(`/hermes/v1/snomed/search?s=${encodeURIComponent(term)}&maxHits=${maxHits}`)
    if (!res.ok) {
      const text = await res.text()
      return { data: null, error: `HTTP ${res.status}: ${text}` }
    }
    const json = await res.json()
    const items = Array.isArray(json) ? json : json?.items ?? json?.results ?? []
    const data = items.map(item => ({
      conceptId: String(item.conceptId ?? item.id),
      display: item.preferredTerm ?? item.term ?? item.display,
    }))
    return { data, error: null }
  } catch (err) {
    return { data: null, error: err?.message ?? 'Network error' }
  }
}

// input: { patientHeuralId, encounterId, medicationConceptId, dosageText, priority? }
// medicationConceptId: string from searchMedication result (e.g. "387207008")
export async function createPrescription(input) {
  const {
    patientHeuralId,
    encounterId,
    medicationConceptId,
    dosageText,
    priority = 'ROUTINE',
  } = input

  const dosagePart = dosageText
    ? `, dosageInstruction: [{ text: ${esc(dosageText)} }]`
    : ''

  const { data, error } = await gql(`
    mutation {
      createMedicationRequest(input: {
        status: ACTIVE
        intent: ORDER
        medication: "${medicationConceptId}"
        subjectId: "${patientHeuralId}"
        encounterId: "${encounterId}"
        institutionId: "${institutionId()}"
        priority: ${priority}
        ${dosagePart}
      }) {
        medicationRequestId
        status
      }
    }
  `)
  return { data: data?.createMedicationRequest ?? null, error }
}

export async function sendPrescriptionWhatsApp(prescriptionId, phoneNumber) {
  const { data, error } = await gql(`
    mutation {
      sharePrescriptionByWhatsApp(input: {
        prescriptionId: "${prescriptionId}"
        prescriptionType: MEDICATION
        phoneNumber: ${esc(phoneNumber)}
      }) {
        success
      }
    }
  `)
  return { data: data?.sharePrescriptionByWhatsApp ?? null, error }
}

export async function sendPrescriptionEmail(prescriptionId) {
  const { data, error } = await gql(`
    mutation {
      sharePrescriptionByEmail(input: {
        prescriptionId: "${prescriptionId}"
        prescriptionType: MEDICATION
      }) {
        success
        prescriptionName
      }
    }
  `)
  return { data: data?.sharePrescriptionByEmail ?? null, error }
}

export async function getMedicationRequests(patientHeuralId, encounterId = null) {
  const encounterFilter = encounterId ? `, encounterId: "${encounterId}"` : ''
  const { data, error } = await gql(`
    query {
      medicationRequests(
        patientId: "${patientHeuralId}"
        institutionId: "${institutionId()}"
        ${encounterFilter}
      ) {
        medicationRequestId
        status
        medication
      }
    }
  `)
  return { data: data?.medicationRequests ?? null, error }
}

// ═════════════════════════════════════════════════════════════════════════════
// APPOINTMENT ACTIONS (patient-facing)
// ═════════════════════════════════════════════════════════════════════════════

// Returns Date scalar on success, null if appointment not found/wrong status
export async function confirmAppointment(appointmentHeuralId) {
  const { data, error } = await gql(`
    mutation {
      confirmAppointmentAttendance(appointmentId: "${appointmentHeuralId}")
    }
  `)
  return { data: data?.confirmAppointmentAttendance ?? null, error }
}

// Returns Boolean on success
export async function cancelAppointment(appointmentHeuralId, reason = '') {
  const { data, error } = await gql(`
    mutation {
      cancelPatientAppointment(
        appointmentId: "${appointmentHeuralId}"
        reason: ${esc(reason)}
      )
    }
  `)
  return { data: data?.cancelPatientAppointment ?? null, error }
}

// ═════════════════════════════════════════════════════════════════════════════
// FHIR (read-only — uses "jwt" header instead of Authorization)
// ═════════════════════════════════════════════════════════════════════════════

export async function getPatientSummary(patientHeuralId) {
  try {
    const res = await apiFetch(`/fhir/Patient/${patientHeuralId}/$summary`)
    if (!res.ok) {
      const text = await res.text()
      return { data: null, error: `HTTP ${res.status}: ${text}` }
    }
    const json = await res.json()
    return { data: json, error: null }
  } catch (err) {
    return { data: null, error: err?.message ?? 'Network error' }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Named object export
// ═════════════════════════════════════════════════════════════════════════════
export const heuralService = {
  getAllergies,
  saveAllergy,
  getObservations,
  createVital,
  submitPreconsulta,
  getPreconsulta,
  searchMedication,
  createPrescription,
  getMedicationRequests,
  sendPrescriptionWhatsApp,
  sendPrescriptionEmail,
  confirmAppointment,
  cancelAppointment,
  getPatientSummary,
  refreshToken,
  graphqlRequest,
}
