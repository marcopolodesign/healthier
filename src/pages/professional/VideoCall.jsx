import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, PhoneSlash, ClipboardText, ArrowsOut, ArrowsIn,
  Plus, Check, CircleNotch, User, Microphone, MicrophoneSlash,
  Camera, CameraSlash, Warning, Sparkle, ClockCounterClockwise,
  IdentificationCard, Drop, Phone, Envelope, MapPin, Heartbeat,
} from '@phosphor-icons/react'
import DailyIframe from '@daily-co/daily-js'
import { supabase } from '../../lib/supabase'
import { consultationsService } from '../../services/consultationsService'
import { clinicalService } from '../../services/clinicalService'
import { historiaClinicaService } from '../../services/historiaClinicaService'
import { profilesService } from '../../services/profilesService'
import { useClinicalEncounter } from '../../hooks/useClinicalEncounter'
import CloseConsultationModal from '../../components/CloseConsultationModal'
import ScribeSession from '../../components/professional/ScribeSession'
import { toast } from '../../components/Toast'

const NO_SHOW_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

const ENTRY_TYPE_LABELS = {
  note: 'Nota',
  diagnosis: 'Diagnóstico',
  indication: 'Indicación',
  addendum: 'Addendum',
}

const PANEL_TABS = [
  { id: 'nota', label: 'Hoy', icon: ClipboardText },
  { id: 'historia', label: 'Historia', icon: ClockCounterClockwise },
  { id: 'datos', label: 'Datos', icon: IdentificationCard },
]

const BLOOD_TYPE_COLORS = {
  'O+': 'bg-red-50 text-red-700 border-red-200',
  'O-': 'bg-red-50 text-red-700 border-red-200',
  'A+': 'bg-blue-50 text-blue-700 border-blue-200',
  'A-': 'bg-blue-50 text-blue-700 border-blue-200',
  'B+': 'bg-purple-50 text-purple-700 border-purple-200',
  'B-': 'bg-purple-50 text-purple-700 border-purple-200',
  'AB+': 'bg-amber-50 text-amber-700 border-amber-200',
  'AB-': 'bg-amber-50 text-amber-700 border-amber-200',
}

// Pre-consulta keys the patient fills in PreconsultaForm before joining.
// Kept as the fallback render for v1 payloads (three free-text fields) — v2 is
// structured and renders through PreconsultaStructured below.
const PRECONSULTA_QUESTIONS = [
  { key: 'mainComplaint',       label: 'Motivo principal' },
  { key: 'symptoms',            label: 'Síntomas' },
  { key: 'currentMedications',  label: 'Medicación actual' },
]

// ── v2 — síntoma codificado en ICD-10 + respuestas de calificación ───────────
//
// El payload se escribe en snake_case, pero `consultationsService.getById` pasa
// la fila entera por `toCamelCase`, que también recorre el jsonb — así que acá
// las keys llegan en camelCase. Se aceptan las dos formas porque el mismo
// componente puede recibir datos que no pasaron por esa conversión (Realtime,
// una lectura directa), y leer solo una dejaba las preguntas en blanco.
function PreconsultaStructured({ preconsulta }) {
  const s = preconsulta.symptom ?? {}
  const answers = Array.isArray(preconsulta.answers) ? preconsulta.answers : []
  const med = preconsulta.medication ?? {}
  const code = s.icd10Code ?? s.icd10_code
  const freeText = s.freeText ?? s.free_text

  return (
    <div className="rounded-lg border border-brand/20 bg-brand-muted/20 p-2.5 space-y-2">
      <p className="text-[10px] font-bold text-brand uppercase tracking-wide">Pre-consulta del paciente</p>

      <div className="flex items-start gap-2">
        <p className="text-sm font-bold text-text-primary leading-tight flex-1">
          {s.label ?? 'Motivo no especificado'}
        </p>
        {code
          ? <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white border border-brand/30 text-brand shrink-0">{code}</span>
          : <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-amber-300 text-amber-700 shrink-0">sin codificar</span>}
      </div>
      {freeText && <p className="text-xs text-text-primary leading-relaxed">{freeText}</p>}

      <div className="space-y-1.5">
        {answers.map((a, i) => {
          const qid = a.questionId ?? a.question_id ?? i
          const qlabel = a.questionLabel ?? a.question_label
          const redFlag = a.redFlag ?? a.red_flag
          return (
            <div key={qid} className="flex items-start gap-1.5">
              {redFlag && <Warning className="h-3 w-3 text-red-600 mt-0.5 shrink-0" weight="fill" />}
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">{qlabel}</p>
                <p className={`text-xs leading-relaxed ${redFlag ? 'text-red-700 font-semibold' : 'text-text-primary'}`}>
                  {(a.labels ?? []).join(' · ')}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      <div>
        <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Medicación actual</p>
        <p className="text-xs text-text-primary leading-relaxed">
          {med.taking ? (med.detail || 'Sí, sin detalle') : 'No toma medicación'}
        </p>
      </div>
    </div>
  )
}

// ── Intake del paciente — v2 estructurado, con fallback a los v1 de texto ────
function PreconsultaSummary({ preconsulta }) {
  if (preconsulta?.version === 2) return <PreconsultaStructured preconsulta={preconsulta} />

  const answered = PRECONSULTA_QUESTIONS.filter(q => preconsulta[q.key])
  if (answered.length === 0) return null
  return (
    <div className="rounded-lg border border-brand/20 bg-brand-muted/20 p-2.5 space-y-2">
      <p className="text-[10px] font-bold text-brand uppercase tracking-wide">Pre-consulta del paciente</p>
      {answered.map(q => (
        <div key={q.key}>
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">{q.label}</p>
          <p className="text-xs text-text-primary whitespace-pre-wrap leading-relaxed">{preconsulta[q.key]}</p>
        </div>
      ))}
    </div>
  )
}

// ── Full clinical history tab — every past encounter for this patient ─────────
function HistoriaTab({ loading, encounters, allergies, preconsulta }) {
  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <CircleNotch className="h-5 w-5 animate-spin text-brand" />
      </div>
    )
  }
  const isFirstConsultation = encounters.length === 0
  // v2 siempre trae `symptom`; los v1 solo tienen los 3 campos de texto.
  const hasPreconsulta = Boolean(
    preconsulta && (preconsulta.symptom || PRECONSULTA_QUESTIONS.some(q => preconsulta[q.key]))
  )
  if (isFirstConsultation && allergies.length === 0 && !hasPreconsulta) {
    return (
      <div className="text-center py-8 text-text-secondary">
        <ClockCounterClockwise className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="text-xs">Sin historia clínica previa</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {/* Ya no se limita a la primera consulta: desde que la sala de espera la
          exige, toda consulta trae pre-consulta y el profesional la necesita
          para saber a qué viene el paciente esta vez, no solo la primera. */}
      {hasPreconsulta && <PreconsultaSummary preconsulta={preconsulta} />}
      {allergies.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2.5">
          <p className="text-[10px] font-bold text-red-700 uppercase tracking-wide mb-1.5">Alergias activas</p>
          <div className="flex flex-wrap gap-1">
            {allergies.map(a => (
              <span key={a.id} className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-red-200 text-red-700">
                {a.substance}
              </span>
            ))}
          </div>
        </div>
      )}
      {encounters.map(enc => (
        <div key={enc.id} className="rounded-lg border border-border-default bg-bg-surface p-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide shrink-0">
              {new Date(enc.createdAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <span className="text-[10px] text-text-tertiary truncate">{enc.professional?.fullName}</span>
          </div>
          {enc.chiefComplaint && (
            <p className="text-xs font-medium text-text-primary">{enc.chiefComplaint}</p>
          )}
          {enc.entries?.map(entry => (
            <p key={entry.id} className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed">
              <span className="font-semibold text-brand">{ENTRY_TYPE_LABELS[entry.entryType] ?? entry.entryType}: </span>
              {entry.content}
            </p>
          ))}
          {(enc.conditions?.length > 0 || enc.medications?.length > 0) && (
            <div className="flex flex-wrap gap-1 pt-1">
              {enc.conditions?.map(c => (
                <span key={c.id} className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  {c.icd10Display || c.icd10Code}
                </span>
              ))}
              {enc.medications?.map(m => (
                <span key={m.id} className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  {m.medicationName}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Basic patient data tab — profile, contact, emergency contact ──────────────
function DatosTab({ loading, patient }) {
  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <CircleNotch className="h-5 w-5 animate-spin text-brand" />
      </div>
    )
  }
  if (!patient) {
    return (
      <div className="text-center py-8 text-text-secondary">
        <IdentificationCard className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="text-xs">No se pudo cargar el perfil</p>
      </div>
    )
  }
  const bloodTypeClass = BLOOD_TYPE_COLORS[patient.bloodType] ?? 'bg-bg-surface text-text-primary border-border-default'
  const age = patient.birthDate
    ? Math.floor((Date.now() - new Date(patient.birthDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-brand-muted flex items-center justify-center shrink-0 overflow-hidden">
          {patient.avatarUrl
            ? <img src={patient.avatarUrl} alt={patient.fullName} className="w-full h-full object-cover" />
            : <User className="h-5 w-5 text-brand" />
          }
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">{patient.fullName || '—'}</p>
          <p className="text-[11px] text-text-secondary">{age != null ? `${age} años` : '—'}</p>
        </div>
      </div>

      {patient.bloodType && (
        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border w-fit ${bloodTypeClass}`}>
          <Drop className="h-3 w-3" /> Grupo {patient.bloodType}
        </span>
      )}

      <div className="rounded-lg border border-border-default bg-bg-surface p-2.5 space-y-1.5">
        <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wide">Contacto</p>
        {patient.phone && (
          <p className="flex items-center gap-1.5 text-xs text-text-secondary"><Phone className="h-3 w-3 shrink-0" /> {patient.phone}</p>
        )}
        {patient.email && (
          <p className="flex items-center gap-1.5 text-xs text-text-secondary"><Envelope className="h-3 w-3 shrink-0" /> {patient.email}</p>
        )}
        {patient.address && (
          <p className="flex items-center gap-1.5 text-xs text-text-secondary"><MapPin className="h-3 w-3 shrink-0" /> {patient.address}</p>
        )}
      </div>

      {(patient.dni || patient.insuranceName) && (
        <div className="rounded-lg border border-border-default bg-bg-surface p-2.5 space-y-1.5">
          <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wide flex items-center gap-1">
            <Heartbeat className="h-3 w-3" /> Perfil clínico
          </p>
          {patient.dni && <p className="text-xs text-text-secondary">DNI: {patient.dni}</p>}
          {patient.insuranceName && (
            <p className="text-xs text-text-secondary">
              {patient.insuranceName}{patient.insuranceNum ? ` · N° ${patient.insuranceNum}` : ''}
            </p>
          )}
        </div>
      )}

      {(patient.emergencyName || patient.emergencyPhone) && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 space-y-1.5">
          <p className="text-[10px] font-bold text-red-700 uppercase tracking-wide">Contacto de emergencia</p>
          {patient.emergencyName && <p className="text-xs text-red-700">{patient.emergencyName}{patient.emergencyRel ? ` (${patient.emergencyRel})` : ''}</p>}
          {patient.emergencyPhone && <p className="text-xs text-red-700">{patient.emergencyPhone}</p>}
        </div>
      )}
    </div>
  )
}

// ── Audio-only element for remote participant ─────────────────────────────────
function AudioPlayer({ track }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && track) ref.current.srcObject = new MediaStream([track])
  }, [track])
  return <audio ref={ref} autoPlay playsInline />
}

// ── Video tile: attaches a MediaStreamTrack to a <video> element ──────────────
function VideoTile({ track, muted = false, mirror = false, className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current) return
    ref.current.srcObject = track ? new MediaStream([track]) : null
  }, [track])
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={`${mirror ? '[transform:scaleX(-1)]' : ''} ${className}`}
    />
  )
}

// ── Clinical notes panel (unchanged) ─────────────────────────────────────────
function ClinicalPanel({ consultation, profile, localAudioTrack, remoteAudioTrack }) {
  const patientId = consultation?.patientId
  const professionalId = consultation?.professionalId
  const pp = profile?.professionalProfiles?.[0]
  const licenseType = pp?.licenseType ?? 'MN'
  const licenseNumber = pp?.licenseNumber ?? '0'
  const specialty = pp?.specialty ?? 'otra'

  const [entries, setEntries] = useState([])
  const [loadingEntries, setLoadingEntries] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ entryType: 'note', content: '' })
  const [submitting, setSubmitting] = useState(false)
  const [showScribe, setShowScribe] = useState(false)
  const [activeTab, setActiveTab] = useState('nota')
  const [historia, setHistoria] = useState({ encounters: [], allergies: [] })
  const [loadingHistoria, setLoadingHistoria] = useState(true)
  const [patientData, setPatientData] = useState(null)
  const [loadingPatientData, setLoadingPatientData] = useState(true)

  const { encounterId, ensureEncounter } = useClinicalEncounter({
    consultationId: consultation?.id,
    patientId, professionalId, specialty,
    modality: consultation?.modality,
    licenseType, licenseNumber,
  })

  // Combines Daily.co's already-live local mic + remote participant audio
  // tracks into one MediaStream — no separate getUserMedia() call needed,
  // ScribeSession stays agnostic of where the stream comes from.
  const getAudioStream = useCallback(async () => {
    const tracks = [localAudioTrack, remoteAudioTrack].filter(Boolean)
    if (tracks.length === 0) throw new Error('No hay audio disponible en la llamada todavía')
    return new MediaStream(tracks)
  }, [localAudioTrack, remoteAudioTrack])

  useEffect(() => {
    if (!consultation?.id) return
    setLoadingEntries(true)
    clinicalService.getEncounterByConsultationIdSafe(consultation.id)
      .then(existing => existing ? clinicalService.getEncounterWithDetail(existing.id) : null)
      .then(detail => { if (detail) setEntries(detail.entries) })
      .catch(() => { /* leave empty */ })
      .finally(() => setLoadingEntries(false))
  }, [consultation?.id])

  // Full history + basic patient data — loaded once so both new tabs are ready
  // by the time the professional switches to them, no extra click-to-load lag.
  useEffect(() => {
    if (!patientId) return
    setLoadingHistoria(true)
    historiaClinicaService.getPatientTimeline(patientId)
      .then(setHistoria)
      .catch(() => { /* leave empty */ })
      .finally(() => setLoadingHistoria(false))

    setLoadingPatientData(true)
    profilesService.getById(patientId)
      .then(setPatientData)
      .catch(() => { /* leave empty */ })
      .finally(() => setLoadingPatientData(false))
  }, [patientId])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.content.trim()) return
    setSubmitting(true)
    try {
      const eid = await ensureEncounter()
      const entry = await clinicalService.addEntry(eid, {
        patientId,
        professionalId,
        entryType: form.entryType,
        content: form.content,
        licenseType,
        licenseNumber,
      })
      setEntries(prev => [...prev, entry])
      setForm(f => ({ ...f, content: '' }))
      setShowForm(false)
      toast.success('Nota guardada en la HC')
    } catch {
      toast.error('Error al guardar nota')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-white border-l border-border-default">
      <div className="px-4 py-3 border-b border-border-default flex items-center justify-between shrink-0 bg-bg-surface">
        <div className="flex items-center gap-2">
          <ClipboardText className="h-4 w-4 text-brand" />
          <span className="font-semibold text-sm text-text-primary">Historia Clínica</span>
        </div>
        {activeTab === 'nota' && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowScribe(s => !s)}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full bg-brand text-white hover:bg-brand/90"
            >
              <Sparkle weight="fill" className="h-3 w-3" /> IA
            </button>
            <button
              onClick={() => setShowForm(s => !s)}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full border border-border-default text-text-secondary hover:bg-bg-surface-hover"
            >
              <Plus className="h-3 w-3" /> Nota
            </button>
          </div>
        )}
      </div>

      <div className="flex border-b border-border-default shrink-0 bg-bg-surface">
        {PANEL_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1 text-xs py-2 border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-brand text-brand font-semibold'
                : 'border-transparent text-text-tertiary hover:text-text-secondary'
            }`}
          >
            <tab.icon className="h-3.5 w-3.5" /> {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'nota' && showScribe && (
        <div className="p-3 border-b border-border-default shrink-0">
          <ScribeSession
            patientId={patientId}
            professionalId={professionalId}
            specialty={specialty}
            licenseType={licenseType}
            licenseNumber={licenseNumber}
            encounterId={encounterId}
            ensureEncounter={ensureEncounter}
            getAudioStream={getAudioStream}
            onFinalized={entry => setEntries(prev => [...prev, entry])}
            onClose={() => setShowScribe(false)}
          />
        </div>
      )}

      {activeTab === 'nota' && showForm && (
        <form onSubmit={handleSubmit} className="p-3 border-b border-border-default space-y-2 shrink-0 bg-bg-subtle">
          <select
            className="form-select text-xs py-1 w-full"
            value={form.entryType}
            onChange={e => setForm(f => ({ ...f, entryType: e.target.value }))}
          >
            {Object.entries(ENTRY_TYPE_LABELS).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
          <textarea
            required
            rows={3}
            className="form-input text-xs resize-none py-1.5"
            placeholder="Nota clínica..."
            value={form.content}
            onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
          />
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setShowForm(false)} className="text-xs px-3 py-1.5 rounded border border-border-default text-text-secondary hover:text-text-primary">
              Cancelar
            </button>
            <button type="submit" disabled={submitting} className="text-xs px-3 py-1.5 rounded bg-brand text-white flex items-center gap-1">
              {submitting ? <CircleNotch className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Guardar
            </button>
          </div>
        </form>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {activeTab === 'nota' && (
          <>
            {loadingEntries && (
              <div className="flex justify-center py-8">
                <CircleNotch className="h-5 w-5 animate-spin text-brand" />
              </div>
            )}
            {!loadingEntries && entries.length === 0 && (
              <div className="text-center py-8 text-text-secondary">
                <ClipboardText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs">Sin notas clínicas</p>
                <p className="text-xs opacity-60">Agregá la primera con el botón de arriba</p>
              </div>
            )}
            {entries.length > 0 && (
              <ol className="relative">
                <span className="absolute left-[5px] top-2 bottom-2 w-px bg-border-default" />
                {entries.map((entry, i) => {
                  const date = new Date(entry.createdAt)
                  const dateLabel = date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })
                  const timeLabel = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
                  return (
                    <li key={entry.id} className={`relative pl-5 ${i < entries.length - 1 ? 'pb-4' : ''}`}>
                      <span className="absolute left-0 top-1.5 w-[11px] h-[11px] rounded-full border-2 border-white bg-brand ring-1 ring-border-default" />
                      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1.5">
                        {dateLabel} · {timeLabel}
                      </p>
                      <div className="rounded-lg border border-border-default bg-bg-surface p-2.5 space-y-1.5">
                        <span className="text-xs font-semibold text-brand">{ENTRY_TYPE_LABELS[entry.entryType] ?? entry.entryType}</span>
                        <p className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed">{entry.content}</p>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </>
        )}

        {activeTab === 'historia' && (
          <HistoriaTab loading={loadingHistoria} encounters={historia.encounters} allergies={historia.allergies} preconsulta={consultation?.preconsultaData} />
        )}

        {activeTab === 'datos' && (
          <DatosTab loading={loadingPatientData} patient={patientData} />
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ProfessionalVideoCall({ profile }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const callRef = useRef(null)
  const channelRef = useRef(null)
  const noShowTimerRef = useRef(null)

  const [consultation, setConsultation] = useState(null)
  // bothReady: both professional + patient are in the presence waiting room
  const [bothReady, setBothReady] = useState(false)
  // joining: actively connecting to Daily.co (after bothReady)
  const [joining, setJoining] = useState(false)
  const [closeModal, setCloseModal] = useState(false)
  const [splitScreen, setSplitScreen] = useState(true)
  const [noShowBanner, setNoShowBanner] = useState(false)

  // Local tracks & controls
  const [camOn, setCamOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [localVideoTrack, setLocalVideoTrack] = useState(null)
  const [localAudioTrack, setLocalAudioTrack] = useState(null)

  // Remote participant
  const [remote, setRemote] = useState(null)

  // ── Step 1: Load consultation ───────────────────────────────────────────────
  useEffect(() => {
    consultationsService.getById(id)
      .then(cons => setConsultation(cons))
      .catch(() => {
        toast.error('No se pudo cargar la consulta')
        navigate('/profesional/dashboard')
      })
  }, [id])

  // ── Step 2: Presence waiting room ──────────────────────────────────────────
  useEffect(() => {
    if (!id) return
    let destroyed = false

    const ch = supabase.channel(`consultation-waiting-${id}`)
    channelRef.current = ch

    ch.on('presence', { event: 'sync' }, () => {
      if (destroyed) return
      const state = ch.presenceState()
      const roles = Object.values(state).flat().map(p => p.role)
      const hasPatient = roles.includes('patient')
      setBothReady(prev => {
        if (!prev && hasPatient) {
          // Patient just arrived — cancel no-show timer
          clearTimeout(noShowTimerRef.current)
          setNoShowBanner(false)
        }
        return hasPatient
      })
    })

    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED' && !destroyed) {
        await ch.track({ role: 'professional' })
        // Start 5-minute no-show countdown
        noShowTimerRef.current = setTimeout(() => {
          if (!destroyed) setNoShowBanner(true)
        }, NO_SHOW_TIMEOUT_MS)
      }
    })

    return () => {
      destroyed = true
      clearTimeout(noShowTimerRef.current)
      ch.untrack().catch(() => {})
      supabase.removeChannel(ch)
      channelRef.current = null
    }
  }, [id])

  // ── Step 3: Join Daily.co when both are ready ───────────────────────────────
  useEffect(() => {
    if (!bothReady) return
    let destroyed = false
    setJoining(true)

    async function joinDaily() {
      try {
        const { roomUrl, token } = await consultationsService.getDailyAccess(id)
        if (destroyed) return

        const DailyLib = window.__DailyIframeMock ?? DailyIframe
        const call = DailyLib.createCallObject()
        callRef.current = call

        call.on('joined-meeting', () => {
          if (destroyed) return
          setJoining(false)
          consultationsService.updateStatus(id, 'in_progress').catch(() => {})
          const local = call.participants().local
          setLocalVideoTrack(local?.tracks?.video?.persistentTrack ?? null)
          setLocalAudioTrack(local?.tracks?.audio?.persistentTrack ?? null)
          setCamOn(local?.tracks?.video?.state === 'playable')
          setMicOn(local?.tracks?.audio?.state !== 'off')
        })

        call.on('participant-joined', ({ participant }) => {
          if (destroyed || participant.local) return
          setRemote({
            videoTrack: participant.tracks?.video?.persistentTrack ?? null,
            audioTrack: participant.tracks?.audio?.persistentTrack ?? null,
          })
        })

        call.on('participant-updated', ({ participant }) => {
          if (destroyed) return
          if (participant.local) {
            setLocalVideoTrack(participant.tracks?.video?.persistentTrack ?? null)
            setLocalAudioTrack(participant.tracks?.audio?.persistentTrack ?? null)
            setCamOn(participant.tracks?.video?.state === 'playable')
            setMicOn(participant.tracks?.audio?.state !== 'off')
          } else {
            setRemote({
              videoTrack: participant.tracks?.video?.persistentTrack ?? null,
              audioTrack: participant.tracks?.audio?.persistentTrack ?? null,
            })
          }
        })

        call.on('participant-left', ({ participant }) => {
          if (!participant.local && !destroyed) setRemote(null)
        })

        call.on('left-meeting', () => {
          if (!destroyed) setCloseModal(true)
        })

        call.on('error', ({ errorMsg }) => {
          toast.error(`Error en la videollamada: ${errorMsg ?? 'desconocido'}`)
          if (!destroyed) setJoining(false)
        })

        await call.join({ url: roomUrl, token })
      } catch {
        if (!destroyed) {
          toast.error('No se pudo iniciar la videollamada')
          navigate('/profesional/dashboard')
        }
      }
    }

    joinDaily()
    return () => {
      destroyed = true
      callRef.current?.leave()
      callRef.current?.destroy()
    }
  }, [bothReady])

  async function toggleCam() {
    const next = !camOn
    setCamOn(next)
    try { await callRef.current?.setLocalVideo(next) }
    catch { setCamOn(!next) }
  }

  async function toggleMic() {
    const next = !micOn
    setMicOn(next)
    try { await callRef.current?.setLocalAudio(next) }
    catch { setMicOn(!next) }
  }

  function handleLeave() {
    setCloseModal(true)
    callRef.current?.leave().catch(() => {})
  }

  const handleFinalized = () => {
    callRef.current?.destroy()
    navigate('/profesional/consulta/' + id)
  }

  async function handleNoShow() {
    try {
      await consultationsService.updateStatus(id, 'no_show')
    } catch {
      // non-blocking
    }
    navigate('/profesional/dashboard')
  }

  function handleKeepWaiting() {
    setNoShowBanner(false)
    // Reset 5-minute timer
    noShowTimerRef.current = setTimeout(() => setNoShowBanner(true), NO_SHOW_TIMEOUT_MS)
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-900">
      {/* Header — dark, Healthier-owned controls only */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-zinc-900 shrink-0">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-white/50 hover:text-white transition-colors">
          <ArrowLeft className="h-4 w-4" /> Volver
        </button>

        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-white">
            {consultation?.patient?.fullName ?? 'Videoconsulta'}
          </span>
          {consultation?.patientId && (
            <Link
              to={`/profesional/paciente/${consultation.patientId}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-white/20 text-white/50 hover:text-white hover:border-white/40 transition-colors"
            >
              <User className="h-3 w-3" /> Perfil
            </Link>
          )}

          {/* Camera toggle */}
          <button
            onClick={toggleCam}
            title={camOn ? 'Apagar cámara' : 'Encender cámara'}
            className={`flex items-center justify-center w-9 h-9 rounded-full border transition-colors ${
              camOn
                ? 'border-white/20 text-white/70 hover:text-white hover:border-white/40'
                : 'border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20'
            }`}
          >
            {camOn ? <Camera className="h-4 w-4" /> : <CameraSlash className="h-4 w-4" />}
          </button>

          {/* Mic toggle */}
          <button
            onClick={toggleMic}
            title={micOn ? 'Silenciar micrófono' : 'Activar micrófono'}
            className={`flex items-center justify-center w-9 h-9 rounded-full border transition-colors ${
              micOn
                ? 'border-white/20 text-white/70 hover:text-white hover:border-white/40'
                : 'border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20'
            }`}
          >
            {micOn ? <Microphone className="h-4 w-4" /> : <MicrophoneSlash className="h-4 w-4" />}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setSplitScreen(s => !s)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
              splitScreen
                ? 'border-brand/60 bg-brand/10 text-brand'
                : 'border-white/20 text-white/60 hover:text-white hover:border-white/40'
            }`}
          >
            {splitScreen ? <ArrowsIn className="h-3.5 w-3.5" /> : <ArrowsOut className="h-3.5 w-3.5" />}
            {splitScreen ? 'Ocultar historial' : 'Historia clínica'}
          </button>
          <button
            onClick={handleLeave}
            className="btn-danger flex items-center gap-2 px-4 py-2 text-sm"
          >
            <PhoneSlash className="h-4 w-4" />
            Finalizar
          </button>
        </div>
      </div>

      {/* No-show banner */}
      {noShowBanner && (
        <div className="shrink-0 flex items-center justify-between gap-4 px-6 py-3 bg-amber-900/60 border-b border-amber-700/40">
          <div className="flex items-center gap-2 text-amber-200 text-sm">
            <Warning className="h-4 w-4 shrink-0" />
            <span>El paciente no se unió a la consulta.</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleKeepWaiting}
              className="text-xs px-3 py-1.5 rounded-full border border-amber-600/60 text-amber-300 hover:bg-amber-800/40 transition-colors"
            >
              Seguir esperando
            </button>
            <button
              onClick={handleNoShow}
              className="text-xs px-3 py-1.5 rounded-full bg-amber-600 hover:bg-amber-500 text-white font-medium transition-colors"
            >
              Marcar como ausente
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Video area */}
        <div className={`relative bg-zinc-900 ${splitScreen ? 'flex-1' : 'w-full'}`}>

          {/* Waiting room — patient hasn't joined the presence channel yet */}
          {!bothReady && !joining && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900 z-10">
              <div className="text-center space-y-4">
                <div className="w-24 h-24 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto relative">
                  <User className="h-12 w-12 text-white/15" />
                  <span className="absolute inset-0 rounded-full border-2 border-brand/30 animate-ping" />
                </div>
                <div className="space-y-1">
                  <p className="text-white/50 text-sm">Esperando al paciente…</p>
                  <p className="text-white/20 text-xs">El paciente recibirá una notificación</p>
                </div>
              </div>
            </div>
          )}

          {/* Connecting to Daily.co — after both are in presence channel */}
          {joining && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900 z-10">
              <div className="text-center space-y-3">
                <div className="h-10 w-10 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-sm text-white/40">Conectando sala…</p>
              </div>
            </div>
          )}

          {/* Remote video — fills the entire area */}
          {remote?.videoTrack ? (
            <VideoTile
              track={remote.videoTrack}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            bothReady && !joining && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center space-y-3">
                  <div className="w-24 h-24 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto">
                    <User className="h-12 w-12 text-white/15" />
                  </div>
                  <p className="text-white/30 text-sm">Paciente conectado, esperando video…</p>
                </div>
              </div>
            )
          )}

          {/* Remote audio (invisible) */}
          {remote?.audioTrack && <AudioPlayer track={remote.audioTrack} />}

          {/* Local camera — PiP in bottom-right corner (shown once in call) */}
          {bothReady && !joining && (
            <div className="absolute bottom-4 right-4 w-40 h-28 rounded-xl overflow-hidden border border-white/10 shadow-2xl bg-zinc-800 z-10">
              {camOn && localVideoTrack ? (
                <VideoTile
                  track={localVideoTrack}
                  muted
                  mirror
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <CameraSlash className="h-6 w-6 text-white/20" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Historia Clínica panel */}
        {splitScreen && consultation && (
          <div className="w-80 shrink-0 overflow-hidden">
            <ClinicalPanel
              consultation={consultation}
              profile={profile}
              localAudioTrack={localAudioTrack}
              remoteAudioTrack={remote?.audioTrack}
            />
          </div>
        )}
      </div>

      {consultation && (
        <CloseConsultationModal
          open={closeModal}
          onClose={() => setCloseModal(false)}
          consultationId={id}
          patientName={consultation.patient?.fullName}
          profile={profile}
          onFinalized={handleFinalized}
        />
      )}
    </div>
  )
}
