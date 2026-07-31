import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, PhoneSlash, ClipboardText, ArrowsOut, ArrowsIn,
  Plus, Check, CircleNotch, User, Microphone, MicrophoneSlash,
  Camera, CameraSlash, Warning, Sparkle, ClockCounterClockwise,
  IdentificationCard, Drop, Phone, Envelope, MapPin, Heartbeat, Pill,
} from '@phosphor-icons/react'
import DailyIframe from '@daily-co/daily-js'
import { supabase } from '../../lib/supabase'
import { consultationsService } from '../../services/consultationsService'
import { clinicalService } from '../../services/clinicalService'
import PreconsultaSummary, { hasPreconsulta } from '../../components/professional/PreconsultaSummary'
import { historiaClinicaService } from '../../services/historiaClinicaService'
import { profilesService } from '../../services/profilesService'
import { professionalService } from '../../services/professionalService'
import { useClinicalEncounter } from '../../hooks/useClinicalEncounter'
import CloseConsultationModal from '../../components/CloseConsultationModal'
import ScribeSession from '../../components/professional/ScribeSession'
import PrescriptionCreator from '../../components/professional/PrescriptionCreator'
import FinanciadorPicker from '../../components/professional/FinanciadorPicker'
import { toast } from '../../components/Toast'
import { consultationEventsService, CONSULTATION_EVENTS } from '../../services/consultationEventsService'

const NO_SHOW_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

// ── Split ajustable de la videollamada ───────────────────────────────────────
const SPLIT_STORAGE_KEY = 'healthier:vc-video-width'
const SPLIT_DEFAULT_PCT = 50
// Mínimos en px, no en porcentaje: en un monitor de 2560 un 25% es enorme y en
// uno de 1280 es inusable. Lo que importa es que el panel clínico siga siendo
// legible (tiene formularios adentro) y que el video no quede en miniatura.
const MIN_VIDEO_PX = 360
const MIN_PANEL_PX = 340

const clampPct = (px, total) => {
  const min = MIN_VIDEO_PX
  const max = Math.max(min, total - MIN_PANEL_PX)
  return (Math.min(Math.max(px, min), max) / total) * 100
}

/**
 * Ancho del video como porcentaje, arrastrable y recordado entre sesiones.
 *
 * El default pasó a 50/50 (antes el panel era `w-80` fijo y el video se quedaba
 * con todo el resto, así que en un monitor grande la historia clínica quedaba
 * como una columnita). Pedido de Mateo, 2026-07-31.
 *
 * El valor se escribe como custom property en `:root` en vez de como estilo
 * inline: el proyecto prohíbe `style={{}}`, y las clases de Tailwind no pueden
 * expresar un ancho continuo que sale de un arrastre.
 */
function useVideoSplit() {
  const containerRef = useRef(null)
  const [pct, setPct] = useState(() => {
    if (typeof window === 'undefined') return SPLIT_DEFAULT_PCT
    const guardado = Number(window.localStorage.getItem(SPLIT_STORAGE_KEY))
    return Number.isFinite(guardado) && guardado >= 15 && guardado <= 85
      ? guardado
      : SPLIT_DEFAULT_PCT
  })

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--vc-video-w', `${pct}%`)
    // Se limpia al salir de la pantalla: es una variable global y no tiene por
    // qué sobrevivir a la videollamada.
    return () => root.style.removeProperty('--vc-video-w')
  }, [pct])

  // Un porcentaje guardado en un monitor grande puede dejar al panel por debajo
  // del mínimo usable en uno chico (75% de 2560 está bien; de 1024 deja 256px de
  // panel). Se reclampea contra el ancho real, al montar y en cada resize.
  useEffect(() => {
    const reclampear = () => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect?.width) return
      setPct(actual => clampPct(rect.width * (actual / 100), rect.width))
    }
    reclampear()
    window.addEventListener('resize', reclampear)
    return () => window.removeEventListener('resize', reclampear)
  }, [])

  const persistir = valor => {
    try { window.localStorage.setItem(SPLIT_STORAGE_KEY, String(Math.round(valor))) }
    catch { /* modo incógnito o storage lleno: el split sigue andando, sólo no se recuerda */ }
  }

  const onPointerDown = e => {
    const el = containerRef.current
    if (!el) return
    e.preventDefault()
    const rect = el.getBoundingClientRect()
    document.body.classList.add('vc-resizing')

    let ultimo = pct
    const mover = ev => {
      ultimo = clampPct(ev.clientX - rect.left, rect.width)
      setPct(ultimo)
    }
    const soltar = () => {
      window.removeEventListener('pointermove', mover)
      document.body.classList.remove('vc-resizing')
      // Se persiste al soltar y no en cada movimiento: escribir en localStorage
      // 60 veces por segundo no aporta nada.
      persistir(ultimo)
    }
    window.addEventListener('pointermove', mover)
    window.addEventListener('pointerup', soltar, { once: true })
  }

  // Con el teclado también, que es lo que hace usable un separador para alguien
  // que no puede arrastrar con precisión.
  const onKeyDown = e => {
    const paso = e.key === 'ArrowLeft' ? -2 : e.key === 'ArrowRight' ? 2 : 0
    if (!paso) return
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const siguiente = clampPct(rect.width * ((pct + paso) / 100), rect.width)
    setPct(siguiente)
    persistir(siguiente)
  }

  const reset = () => { setPct(SPLIT_DEFAULT_PCT); persistir(SPLIT_DEFAULT_PCT) }

  return { containerRef, pct, onPointerDown, onKeyDown, reset }
}

const ENTRY_TYPE_LABELS = {
  note: 'Nota',
  diagnosis: 'Diagnóstico',
  indication: 'Indicación',
  addendum: 'Addendum',
}

const PANEL_TABS = [
  { id: 'nota', label: 'Hoy', icon: ClipboardText },
  // Generar la receta durante la consulta y no después: el profesional está
  // acá cuando decide medicar, y mandarlo al detalle de la consulta le hace
  // perder el hilo (y al paciente, esperando del otro lado).
  { id: 'receta', label: 'Receta', icon: Pill },
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

function HistoriaTab({ loading, encounters, allergies, preconsulta }) {
  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <CircleNotch className="h-5 w-5 animate-spin text-brand" />
      </div>
    )
  }
  const isFirstConsultation = encounters.length === 0
  const showPreconsulta = hasPreconsulta(preconsulta)
  if (isFirstConsultation && allergies.length === 0 && !showPreconsulta) {
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
      {showPreconsulta && <PreconsultaSummary preconsulta={preconsulta} />}
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
  // Perfil profesional propio: hace falta para saber si tiene matrícula y
  // domicilio, que RCTA exige para emitir.
  const [profProfile, setProfProfile] = useState(null)
  useEffect(() => {
    if (!profile?.id) return
    professionalService.getByUserId(profile.id).then(setProfProfile).catch(() => {})
  }, [profile?.id])
  const [loadingPatientData, setLoadingPatientData] = useState(true)
  // La cobertura se editaba SOLO en el detalle de la consulta, así que desde la
  // videollamada era imposible elegir el financiador del catálogo — y sin él la
  // receta no se puede emitir con cobertura. Se mantiene una copia local para no
  // depender de que el padre refetchee la consulta en medio de la llamada.
  const [cobertura, setCobertura] = useState({
    coverageType:    consultation?.coverageType ?? null,
    financiadorId:   consultation?.financiadorId ?? null,
    obraSocialName:  consultation?.obraSocialName ?? '',
    affiliateNumber: consultation?.affiliateNumber ?? '',
  })
  const [editandoCobertura, setEditandoCobertura] = useState(false)
  const [guardandoCobertura, setGuardandoCobertura] = useState(false)

  useEffect(() => {
    if (!consultation?.id) return
    setCobertura({
      coverageType:    consultation.coverageType ?? null,
      financiadorId:   consultation.financiadorId ?? null,
      obraSocialName:  consultation.obraSocialName ?? '',
      affiliateNumber: consultation.affiliateNumber ?? '',
    })
  }, [consultation?.id])

  async function guardarCobertura() {
    setGuardandoCobertura(true)
    try {
      const esParticular = cobertura.coverageType === 'particular'
      await consultationsService.update(consultation.id, {
        coverageType:    cobertura.coverageType,
        financiadorId:   esParticular ? null : cobertura.financiadorId,
        obraSocialName:  esParticular ? null : (cobertura.obraSocialName?.trim() || null),
        affiliateNumber: esParticular ? null : (cobertura.affiliateNumber?.trim() || null),
      })
      setEditandoCobertura(false)
      toast.success('Cobertura actualizada')
    } catch {
      toast.error('Error al guardar la cobertura')
    } finally {
      setGuardandoCobertura(false)
    }
  }

  const { encounterId, ensureEncounter } = useClinicalEncounter({
    consultationId: consultation?.id,
    patientId, professionalId, specialty,
    modality: consultation?.modality,
    licenseType, licenseNumber,
    preconsulta: consultation?.preconsultaData,
  })

  // El encuentro clínico se crea perezosamente (al guardar la primera nota).
  // La receta también lo necesita, así que se asegura al abrir su pestaña —
  // si no, se guardaría con encounter_id en null y quedaría huérfana.
  useEffect(() => {
    if (activeTab === 'receta' && !encounterId) ensureEncounter().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, encounterId])


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
    <div className="flex flex-col h-full bg-white lg:border-l border-border-default">
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

        {activeTab === 'receta' && (
          <div className="space-y-3">
            {/* Cobertura, editable acá mismo: es lo que decide si la receta sale con
                obra social o como particular, y hasta ahora sólo se podía tocar
                fuera de la llamada. */}
            <div className="rounded-lg border border-border-default bg-bg-surface p-2.5">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wide">
                  Cobertura
                </p>
                {!editandoCobertura && (
                  <button
                    type="button"
                    onClick={() => setEditandoCobertura(true)}
                    className="text-[11px] font-semibold text-brand underline"
                  >
                    {cobertura.coverageType ? 'Cambiar' : 'Cargar'}
                  </button>
                )}
              </div>

              {editandoCobertura ? (
                <div className="space-y-2">
                  <FinanciadorPicker
                    coverageType={cobertura.coverageType}
                    financiadorId={cobertura.financiadorId}
                    financiadorName={cobertura.obraSocialName}
                    affiliateNumber={cobertura.affiliateNumber}
                    onChange={v => setCobertura({
                      coverageType:    v.coverageType,
                      financiadorId:   v.financiadorId,
                      obraSocialName:  v.financiadorName,
                      affiliateNumber: v.affiliateNumber,
                    })}
                  />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setEditandoCobertura(false)}
                      className="btn-secondary flex-1 py-1.5 text-xs">Cancelar</button>
                    <button type="button" onClick={guardarCobertura} disabled={guardandoCobertura}
                      className="btn-primary flex-1 py-1.5 text-xs">
                      {guardandoCobertura ? 'Guardando…' : 'Guardar'}
                    </button>
                  </div>
                </div>
              ) : cobertura.coverageType === 'particular' ? (
                <p className="text-xs text-text-primary">Particular — sin cobertura</p>
              ) : cobertura.obraSocialName ? (
                <p className="text-xs text-text-primary">
                  {cobertura.obraSocialName}
                  {cobertura.affiliateNumber && (
                    <span className="text-text-tertiary"> · afiliado {cobertura.affiliateNumber}</span>
                  )}
                  {!cobertura.financiadorId && (
                    <span className="block text-[10px] text-amber-700 font-medium mt-0.5">
                      Falta elegirla del catálogo para poder emitir.
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-xs text-text-tertiary">
                  Sin definir — la receta sale como particular.
                </p>
              )}
            </div>

            <PrescriptionCreator
              patientId={consultation?.patientId ?? null}
              encounterId={encounterId}
              ensureEncounter={ensureEncounter}
              professionalId={profile?.id ?? null}
              profile={profile}
              profProfile={profProfile}
              paciente={patientData}
              consultationId={consultation?.id ?? null}
              onDatosActualizados={() => {
                if (patientId) profilesService.getById(patientId).then(setPatientData).catch(() => {})
                if (profile?.id) professionalService.getByUserId(profile.id).then(setProfProfile).catch(() => {})
              }}
              cobertura={cobertura.financiadorId ? {
                idFinanciador: cobertura.financiadorId,
                afiliado: cobertura.affiliateNumber,
              } : null}
            />
          </div>
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
  // Distingue "colgué yo" de "se cayó la llamada".
  const hangingUpRef = useRef(false)
  // Habilitación explícita del paciente (migración 071). El botón vivía SÓLO en el
  // dashboard, así que un profesional que entraba directo a la videollamada —que es
  // a donde lleva la notificación de on-demand— se quedaba sin ninguna forma de
  // dejar entrar al paciente: él adentro, el paciente en la sala de espera con el
  // botón gris, y nada en pantalla para destrabarlo. Pasó en vivo el 2026-07-30.
  const [admitting, setAdmitting] = useState(false)

  const [consultation, setConsultation] = useState(null)
  // El modal de cierre necesita el encuentro clínico y la matrícula para asentar
  // la nota en la HC, y vive en ESTE componente, no en `ClinicalPanel` — que es
  // donde estaba el hook. Al pasarle `ensureEncounter` sin tenerlo en scope, la
  // pantalla entera crasheaba con "ensureEncounter is not defined" (el build no lo
  // detecta: es una referencia libre válida para el bundler). Ahora tiene su propia
  // instancia del hook, que es segura porque `ensureEncounter` re-consulta la base
  // antes de crear y hay un índice único por consulta (migración 076).
  const [ownProfProfile, setOwnProfProfile] = useState(null)
  useEffect(() => {
    if (!profile?.id) return
    professionalService.getByUserId(profile.id).then(setOwnProfProfile).catch(() => {})
  }, [profile?.id])

  const { ensureEncounter: ensureEncounterForClose } = useClinicalEncounter({
    consultationId: consultation?.id,
    patientId: consultation?.patientId,
    professionalId: profile?.id,
    specialty: ownProfProfile?.specialty,
    modality: consultation?.modality,
    licenseType: ownProfProfile?.licenseType,
    licenseNumber: ownProfProfile?.licenseNumber,
    preconsulta: consultation?.preconsultaData,
  })

  /**
   * Compuerta para ENTRAR a Daily. Late una sola vez y no vuelve atrás.
   *
   * `bothReady` es presencia EN VIVO, y se estaba usando además para decidir si
   * quedarse en la llamada: cualquier bajón momentáneo de la presencia del otro
   * lado desmontaba el efecto y ejecutaba `call.leave()`. Y los bajones son
   * rutina — el paciente pasa de la sala de espera a la videollamada, que son dos
   * suscripciones distintas al mismo canal, así que entre el `untrack` de una y el
   * `track` de la otra el profesional lo ve irse. Resultado: la llamada se caía
   * justo cuando el paciente llegaba, y volvía sola sólo si la presencia se
   * recuperaba a tiempo. De ahí el "no cargó el video, tuve que refrescar".
   *
   * Quién está en la sala lo sabe Daily (`participant-joined`/`participant-left`),
   * no el canal de presencia.
   */
  const [joinGate, setJoinGate] = useState(false)
  // joining: actively connecting to Daily.co (after bothReady)
  const [joining, setJoining] = useState(false)
  const [closeModal, setCloseModal] = useState(false)
  const [splitScreen, setSplitScreen] = useState(true)
  const split = useVideoSplit()
  // Hoja de la HC en mobile. Arranca abajo: lo primero es ver al paciente.
  const [hojaAbierta, setHojaAbierta] = useState(false)
  const [noShowBanner, setNoShowBanner] = useState(false)

  // Local tracks & controls
  const [camOn, setCamOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [localVideoTrack, setLocalVideoTrack] = useState(null)
  const [localAudioTrack, setLocalAudioTrack] = useState(null)

  // Remote participant
  const [remote, setRemote] = useState(null)

  // La bitácora existe justamente para diagnosticar una videollamada que salió
  // mal, pero `call_page_opened`, `call_left` y `call_error` estaban definidos y
  // nunca se escribían: al revisar la prueba del 2026-07-30 el log podía decir que
  // los dos entraron, y nada sobre por qué no se veía.
  useEffect(() => {
    if (!id) return
    consultationEventsService.log(id, CONSULTATION_EVENTS.CALL_PAGE_OPENED, null, { role: 'professional' })
  }, [id])

  // ── Step 1: Load consultation ───────────────────────────────────────────────
  useEffect(() => {
    consultationsService.getById(id)
      .then(cons => setConsultation(cons))
      .catch(() => {
        toast.error('No se pudo cargar la consulta')
        navigate('/profesional/dashboard')
      })
  }, [id])

  const admitPatient = async () => {
    if (admitting) return
    setAdmitting(true)
    try {
      await consultationsService.admitPatient(id)
      consultationEventsService.log(id, CONSULTATION_EVENTS.PRO_ADMITTED_PATIENT, null,
        { id: profile?.id, role: 'professional' })
      setConsultation(prev => prev ? { ...prev, patientAdmittedAt: new Date().toISOString() } : prev)
      toast.success('Paciente habilitado')
    } catch {
      toast.error('No pudimos habilitar al paciente. Probá de nuevo.')
    } finally {
      setAdmitting(false)
    }
  }

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
      if (hasPatient) {
        // Llegó el paciente: se cancela el no-show y se abre la compuerta. Sólo
        // interesa la PRIMERA vez que aparece; que después la presencia parpadee
        // ya no cambia nada.
        clearTimeout(noShowTimerRef.current)
        setNoShowBanner(false)
        setJoinGate(true)
      }
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
    if (!joinGate) return
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
          consultationEventsService.log(id, CONSULTATION_EVENTS.CALL_JOINED, null, { role: 'professional' })
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
          consultationEventsService.log(id, CONSULTATION_EVENTS.CALL_PARTICIPANT_JOINED,
            { participant_id: participant?.session_id, owner: participant?.owner, user_name: participant?.user_name },
            { role: 'professional' })
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
          consultationEventsService.log(id, CONSULTATION_EVENTS.CALL_LEFT,
            { intencional: hangingUpRef.current }, { role: 'professional' })
          // Sólo abrir "Finalizar consulta" si colgamos a propósito. Si la llamada
          // se cayó sola, el modal de cierre aparecía encima como si el profesional
          // hubiera terminado la consulta.
          // El cierre se hace en el detalle de la consulta; acá sólo se asienta.
        })

        call.on('error', ({ errorMsg }) => {
          consultationEventsService.log(id, CONSULTATION_EVENTS.CALL_ERROR,
            { error: errorMsg ?? 'desconocido' }, { role: 'professional' })
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
  }, [joinGate])

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
    // Colgar ya no abre el modal de cierre encima del video. Lleva al detalle de la
    // consulta, que es la pantalla intermedia: ahí se revisa y completa todo
    // (receta, alergias, notas) y recién después se cierra, que es lo que congela
    // la consulta. Pedido de Mateo (2026-07-30): "más control".
    hangingUpRef.current = true
    callRef.current?.leave().catch(() => {})
    callRef.current?.destroy()
    navigate(`/profesional/consulta/${id}`)
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
      <div ref={split.containerRef} className="flex-1 relative flex flex-col lg:flex-row overflow-hidden">
        {/* Video area */}
        <div className={`relative bg-zinc-900 ${splitScreen ? 'vc-video-pane' : 'w-full'}`}>

          {/* Sala de espera — hasta que entramos a la llamada. Antes miraba
              `bothReady` (presencia en vivo), así que un bajón de presencia tapaba
              con "esperando al paciente" una videollamada que seguía andando.
              Una vez adentro, quién está en la sala lo dice `remote`. */}
          {!joinGate && !joining && (
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

                {/* El paciente ya está en la sala de espera pero todavía no lo
                    habilitaron: sin esto había que salir al dashboard a buscar el
                    botón, con el paciente esperando. */}
                {/* La condición NO exige que el paciente ya figure esperando:
                    `patientWaitingSince` se lee una sola vez al montar, así que un
                    paciente que llega después dejaría el botón oculto justo cuando
                    hace falta. Habilitar de más no rompe nada — es decir "lo
                    atiendo ahora" — y no habilitar deja a los dos trabados. */}
                {consultation && !consultation.patientAdmittedAt && (
                  <div className="space-y-2">
                    <p className="text-white/70 text-sm">
                      {consultation.patientWaitingSince
                        ? 'El paciente está en la sala de espera.'
                        : 'El paciente todavía no puede entrar.'}
                    </p>
                    <button
                      onClick={admitPatient}
                      disabled={admitting}
                      className="btn-primary px-6 py-2.5 text-sm disabled:opacity-60"
                    >
                      {admitting ? 'Habilitando…' : 'Ingresar paciente'}
                    </button>
                    <p className="text-white/25 text-xs">
                      Hasta que lo habilites, su botón para entrar está deshabilitado.
                    </p>
                  </div>
                )}
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
            joinGate && !joining && (
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
          {joinGate && !joining && (
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

        {/* Borde arrastrable. Sólo desktop (la utility se apaga debajo de `lg`) y
            sólo con el panel abierto: sin panel no hay nada que redimensionar. */}
        {splitScreen && consultation && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Ajustar el ancho del video"
            aria-valuenow={Math.round(split.pct)}
            aria-valuemin={15}
            aria-valuemax={85}
            tabIndex={0}
            onPointerDown={split.onPointerDown}
            onKeyDown={split.onKeyDown}
            onDoubleClick={split.reset}
            title="Arrastrá para ajustar. Doble clic vuelve a 50/50."
            className="vc-resize-handle group"
          >
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10 group-hover:bg-brand/70 group-focus:bg-brand transition-colors" />
            <span className="absolute top-1/2 left-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/20 group-hover:bg-brand transition-colors" />
          </div>
        )}

        {/* Historia Clínica panel — en desktop es una columna; en mobile, una hoja
            inferior que asoma y sube al tocarla. */}
        {splitScreen && consultation && (
          <div
            className="vc-panel-pane overflow-hidden bg-bg-primary flex flex-col"
            data-abierta={hojaAbierta ? 'true' : 'false'}
            // Tocar cualquier campo de la HC la abre: si el profesional va a
            // escribir, ya decidió que quiere la hoja arriba.
            onFocusCapture={() => setHojaAbierta(true)}
          >
            {/* Sólo en mobile: la barra que se toca para subirla o bajarla. */}
            <button
              type="button"
              onClick={() => setHojaAbierta(v => !v)}
              aria-expanded={hojaAbierta}
              aria-label={hojaAbierta ? 'Bajar la historia clínica' : 'Subir la historia clínica'}
              className="lg:hidden w-full flex flex-col items-center gap-1 pt-2 pb-1 shrink-0"
            >
              <span className="h-1 w-10 rounded-full bg-text-tertiary/40" />
              <span className="text-[11px] font-semibold text-text-tertiary">
                {hojaAbierta ? 'Bajar' : 'Historia clínica'}
              </span>
            </button>

            {/* `min-h-0` para que el `h-full` de adentro no desborde la hoja al
                sumarle la barra de agarre. */}
            <div className="flex-1 min-h-0">
              <ClinicalPanel
                consultation={consultation}
                profile={profile}
                localAudioTrack={localAudioTrack}
                remoteAudioTrack={remote?.audioTrack}
              />
            </div>
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
          patientId={consultation.patientId}
          ensureEncounter={ensureEncounterForClose}
          licenseType={ownProfProfile?.licenseType}
          licenseNumber={ownProfProfile?.licenseNumber}
          onFinalized={handleFinalized}
        />
      )}
    </div>
  )
}
