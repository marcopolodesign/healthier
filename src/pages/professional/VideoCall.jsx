import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, PhoneSlash, ClipboardText, ArrowsOut, ArrowsIn,
  Plus, Check, CircleNotch, User, Microphone, MicrophoneSlash,
  Camera, CameraSlash, Warning, Sparkle, ClockCounterClockwise,
  IdentificationCard, Drop, Phone, Envelope, MapPin, Heartbeat, Pill,
  Key, SealCheck, PaperPlaneTilt, AppleLogo, ArrowSquareOut, CaretRight,
} from '@phosphor-icons/react'
import DailyIframe from '@daily-co/daily-js'
import { supabase } from '../../lib/supabase'
import { consultationsService } from '../../services/consultationsService'
import { clinicalService } from '../../services/clinicalService'
import PreconsultaSummary, { hasPreconsulta } from '../../components/professional/PreconsultaSummary'
import GuiaClinicaConsulta from '../../components/professional/GuiaClinicaConsulta'
import { CLINICAL_GUIDE_SPECIALTIES } from '../../lib/clinicalGuideKB'
import { historiaClinicaService } from '../../services/historiaClinicaService'
import { profilesService } from '../../services/profilesService'
import { professionalService } from '../../services/professionalService'
import { useClinicalEncounter } from '../../hooks/useClinicalEncounter'
import { useEspecialidades } from '../../hooks/useEspecialidades'
import ScribeSession from '../../components/professional/ScribeSession'
import Recetario from '../../components/professional/Recetario'
import FinanciadorPicker from '../../components/FinanciadorPicker'
import { toast } from '../../components/Toast'
import { consultationEventsService, CONSULTATION_EVENTS } from '../../services/consultationEventsService'

const NO_SHOW_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Escriba con IA dentro de la videollamada: escondido a pedido de Mateo
 * (2026-07-31) — "falta probarlo bastante".
 *
 * Se apaga con un flag y no borrando el código: `ScribeSession` y todo su camino
 * (grabación, `clinical_scribe_sessions`, la Edge Function) siguen enteros, así
 * que volver a mostrarlo es poner esto en `true`. Nada de esto toca el botón
 * "Nota con IA" del detalle de consulta, que es donde se probó el flujo
 * presencial.
 */
const SCRIBE_EN_LLAMADA = false

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

// El valor guardado sigue siendo `diagnosis` — sólo cambia lo que se lee. Un
// diagnóstico asentado durante la consulta es presuntivo hasta que lo confirme
// un estudio, y llamarlo "Diagnóstico" a secas empuja a escribirlo con más
// certeza de la que hay. (Mateo, 2026-08-14)
// Los 4 tipos que se crean desde acá con un botón (ver la grilla más abajo).
// "order" NO es uno de ellos a propósito: esas entradas las genera el
// Recetario > "Recetar estudios" (EstudiosCreator) con su propio formulario
// estructurado (varios estudios + indicaciones), no esta nota libre.
const NOTE_TYPE_LABELS = {
  note: 'Nota',
  diagnosis: 'Diagnóstico presuntivo',
  indication: 'Indicación',
  addendum: 'Addendum',
}

// Todo lo que puede aparecer en la planilla de esta consulta, para leerlo con
// nombre en vez del valor crudo. Superset de NOTE_TYPE_LABELS: agrega los
// tipos que se cargan desde otro lado (las órdenes de estudios, acá arriba).
const ENTRY_TYPE_LABELS = {
  ...NOTE_TYPE_LABELS,
  order: 'Orden de estudios',
}

// Etiquetas explícitas (Mateo, 2026-08-21): las viejas ("Hoy", "Receta",
// "Datos") eran cortas pero ambiguas — "Datos" no decía datos de quién, y
// "Hoy" no decía qué se hace ahí. Ahora cada una nombra la acción o el
// contenido completo. El encabezado "Historia Clínica" que estaba arriba se
// sacó en el mismo cambio, así que las pestañas son el único rótulo del panel
// y tienen que sostenerse solas.
// Dos clases de entrada en la barra (Mateo, 2026-08-22):
//
//  · `kind: 'section'` — no cambia de vista: scrollea a su sección dentro de
//    UNA sola planilla continua (Notas → Paciente → Historia). Son lectura y
//    escritura sobre lo mismo y verlas juntas ayuda; separarlas en pestañas
//    obligaba a saltar de ida y vuelta para escribir una nota mirando la
//    historia. Es el patrón del prototipo de Nacho (índice + planilla larga).
//
//  · `kind: 'view'` — reemplaza el panel. Receta y Cierre NO entran a la
//    planilla a propósito: son flujos con pasos propios. La receta es un
//    formulario de varios campos que conviene que se quede quieto mientras se
//    completa, y el cierre tiene que estar a un gesto en plena llamada — al
//    fondo de una planilla que crece con la historia del paciente (medida: ya
//    ~6 pantallas con una historia liviana) sería el peor lugar posible.
//
// El orden de las secciones arranca en Notas y no en Paciente: es lo que más
// se usa, y ponerlo segundo obligaba a scrollear en cada apertura del panel
// para escribir. La identidad del paciente igual está arriba de todo, en la
// fila que lleva a su sección.
const PANEL_TABS = [
  { id: 'nota',     kind: 'section', label: 'Notas de Consulta', icon: ClipboardText },
  { id: 'historia', kind: 'section', label: 'Historia Clínica',  icon: ClockCounterClockwise },
  // Recetar durante la consulta y no después: el profesional está acá cuando
  // decide medicar o pedir un estudio, y mandarlo al detalle de la consulta
  // le hace perder el hilo (y al paciente, esperando del otro lado).
  // "Recetario" (Mateo, 2026-08-24) — antes decía "Generar Receta
  // Electrónica" y sólo cubría medicamentos; ahora adentro hay un selector
  // de 2 tarjetas (medicamentos / estudios), ver `Recetario.jsx`.
  { id: 'receta',   kind: 'view',    label: 'Recetario', icon: Pill },
  // Código de cierre EN la llamada, no sólo después de colgar (migración 099,
  // pedido de Mateo 2026-08-06).
  { id: 'cerrar',   kind: 'view',    label: 'Cerrar Consulta',    icon: Key },
]

// Las que el índice de arriba puede marcar. `datos` es sección (se scrollea
// hasta ella desde la fila del paciente) pero NO está en la barra: la fila del
// paciente es sticky y vive siempre a la vista, así que una entrada para
// llegar ahí no aportaba nada (Mateo, 2026-08-22).
const SECTION_IDS = PANEL_TABS.filter(t => t.kind === 'section').map(t => t.id)

// Colchón entre el tope del scroller y el encabezado de una sección. Tiene que
// ser el MISMO número que usa el scroll-spy (más abajo) y que el `scroll-mt-*`
// de cada <section> — si no, saltar desde el índice deja el título tapado (o
// el spy tarda en marcar la pestaña siguiente) porque uno mira un colchón y el
// otro, otro. Ahora que la fila del paciente y la barra de pestañas salieron
// del scroller (chrome fijo del panel, ver el JSX más abajo), el offset ya no
// tiene que compensar el alto de nada superpuesto — es sólo un margen visual
// chico. `scroll-mt-6` de Tailwind = 1.5rem = 24px.
const SECTION_SCROLL_OFFSET = 24

/** Encabezado de cada sección dentro de la planilla continua. */
function SectionHeader({ icon: Icon, label }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-4 w-4 text-brand shrink-0" />
      <h3 className="text-[11px] font-bold text-text-tertiary uppercase tracking-widest">{label}</h3>
      <span className="flex-1 h-px bg-border-default" />
    </div>
  )
}

// ── Pestaña "Hoy" para nutricionistas — sin guía clínica (esa es sólo para
// medicina_general/pediatria, ver CLINICAL_GUIDE_SPECIALTIES), acceso directo
// a NutriPlan Pro con el paciente de esta consulta precargado.
function NutriplanEnConsulta({ patientId }) {
  return (
    <div className="rounded-lg border border-border-default bg-bg-surface p-3 mb-4 flex items-start gap-3">
      <div className="h-8 w-8 rounded-full bg-brand-muted/30 flex items-center justify-center shrink-0">
        <AppleLogo className="h-4 w-4 text-brand" weight="fill" />
      </div>
      <div className="flex-1">
        <p className="text-xs font-semibold text-text-primary">NutriPlan Pro</p>
        <p className="text-[11px] text-text-secondary mt-0.5">Armá o editá el plan nutricional de este paciente.</p>
        <a
          href={`/profesional/nutriplan?patientId=${patientId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:text-brand/80"
        >
          Abrir NutriPlan <ArrowSquareOut className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  )
}

// ── Código de cierre — tab "Cerrar" dentro de la videollamada ─────────────────
function CerrarTab({
  codeVerifiedAt, codeInput, onCodeInputChange, onVerify, verifying, verifyError, attemptsLeft,
  onSolicitar, solicitando, solicitado,
}) {
  if (codeVerifiedAt) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center space-y-1">
        <SealCheck className="h-6 w-6 text-emerald-600 mx-auto" weight="fill" />
        <p className="text-sm font-semibold text-emerald-700">Código verificado</p>
        <p className="text-xs text-emerald-600">
          Al finalizar, vas a poder cerrar la consulta sin que te lo vuelva a pedir.
        </p>
      </div>
    )
  }
  const agotado = attemptsLeft === 0
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border-default bg-bg-surface p-2.5 space-y-2.5">
        <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wide">Código de cierre</p>
        <p className="text-xs text-text-secondary leading-relaxed">
          Pedíselo al paciente o tocá "Solicitar código" para que se lo pidamos por vos.
          Verificarlo ahora te ahorra tener que pedirlo de nuevo al terminar.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={codeInput}
            onChange={e => onCodeInputChange(e.target.value.replace(/\D/g, ''))}
            placeholder="0000"
            disabled={agotado}
            className="form-input text-center tracking-[0.3em] text-lg font-mono w-24 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={onVerify}
            disabled={verifying || agotado || codeInput.length !== 4}
            className="btn-primary flex-1 text-xs disabled:opacity-50"
          >
            {verifying ? 'Verificando…' : 'Verificar'}
          </button>
        </div>
        {verifyError && <p className="text-xs text-red-600">{verifyError}</p>}
        {agotado && (
          <p className="text-xs text-amber-700">
            Se agotaron los intentos. Al finalizar vas a poder cerrar igual dejando un motivo escrito.
          </p>
        )}
        <button
          type="button"
          onClick={onSolicitar}
          disabled={solicitando || agotado}
          className="btn-secondary w-full text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          <PaperPlaneTilt className="h-3.5 w-3.5" />
          {solicitando ? 'Pidiendo…' : solicitado ? 'Código pedido — esperando al paciente' : 'Solicitar código al paciente'}
        </button>
      </div>
      <p className="text-[11px] text-text-tertiary leading-relaxed px-0.5">
        Si el paciente ya no está en la llamada, vas a poder cerrar igual dejando un motivo
        escrito cuando finalices la consulta.
      </p>
    </div>
  )
}

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

/**
 * "Historia": lo que el paciente trae de ANTES — turnos previos con sus notas,
 * y sus alergias activas. Nada de lo de esta consulta.
 *
 * La pre-consulta que el paciente declaró para ESTA consulta vivía acá y se
 * movió a "Hoy" (Mateo, 2026-08-21): es el motivo por el que entró hoy, no
 * historia previa, y el profesional la necesita al lado de la guía clínica
 * cuando arranca — no escondida en otra pestaña.
 */
function HistoriaTab({ loading, encounters, allergies }) {
  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <CircleNotch className="h-5 w-5 animate-spin text-brand" />
      </div>
    )
  }
  const isFirstConsultation = encounters.length === 0
  if (isFirstConsultation && allergies.length === 0) {
    return (
      <div className="text-center py-8 text-text-secondary">
        <ClockCounterClockwise className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="text-xs">Sin historia clínica previa</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
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
function ClinicalPanel({ consultation, profile, localAudioTrack, remoteAudioTrack, codigoCierre }) {
  const patientId = consultation?.patientId
  const professionalId = consultation?.professionalId

  const [entries, setEntries] = useState([])
  const [loadingEntries, setLoadingEntries] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ entryType: 'note', content: '' })
  const [submitting, setSubmitting] = useState(false)
  const [showScribe, setShowScribe] = useState(false)
  // Qué ocupa el panel: la planilla continua (`chart`) o una de las dos vistas
  // propias. Ver PANEL_TABS.
  const [activeView, setActiveView] = useState('chart')
  // Sección visible dentro de la planilla — sólo para marcar la barra
  // (scroll-spy). No decide qué se renderiza: en `chart` se renderizan las
  // tres siempre.
  const [activeSection, setActiveSection] = useState('nota')
  const chartRef = useRef(null)
  const sectionRefs = useRef({})
  // Los 4 botones de tipo de nota, para saber cuándo se fueron de pantalla y
  // ofrecer el atajo en la fila (sticky) del paciente.
  const botonesRef = useRef(null)
  const [atajoNota, setAtajoNota] = useState(false)

  /** Click en la barra: scrollea si es sección, cambia de vista si no. */
  const irA = (tab) => {
    if (tab.kind === 'view') {
      setActiveView(tab.id)
      // Receta/Cerrar abren siempre arriba de todo — sin esto quedaban en el
      // scroll que tenía la planilla (p.ej. a mitad de la Historia Clínica).
      // rAF porque el contenido nuevo (Receta/Cerrar) todavía no montó.
      requestAnimationFrame(() => { if (chartRef.current) chartRef.current.scrollTop = 0 })
      return
    }
    setActiveSection(tab.id)
    if (activeView !== 'chart') {
      // Venimos de Receta/Cierre: hay que montar la planilla antes de poder
      // scrollear, así que el scroll va al frame siguiente.
      setActiveView('chart')
      requestAnimationFrame(() => sectionRefs.current[tab.id]?.scrollIntoView({ block: 'start' }))
      return
    }
    // Instantáneo a propósito (2026-08-24): el scroll suave programático se
    // interrumpe y queda a mitad de camino cuando algo re-renderiza durante la
    // animación (p.ej. el timer de la sala de espera) o con zoom distinto de
    // 100% — el salto quedaba "a medias" sin error. El instantáneo llega
    // siempre; la vuelta desde Receta/Cierre (arriba) ya era instantánea.
    sectionRefs.current[tab.id]?.scrollIntoView({ block: 'start' })
  }

  const [historia, setHistoria] = useState({ encounters: [], allergies: [] })
  const [loadingHistoria, setLoadingHistoria] = useState(true)
  const [patientData, setPatientData] = useState(null)
  // Perfil profesional propio: hace falta para saber si tiene matrícula y
  // domicilio, que RCTA exige para emitir. También es la ÚNICA fuente real de
  // licencia/especialidad acá — `profile` (el de sesión) nunca trae
  // `professionalProfiles` embebido, así que leer de ahí (como hacía este
  // panel antes) siempre caía en los defaults 'MN'/'0'/'otra', sin importar
  // quién estuviera atendiendo. Se vuelve a `otra` mientras carga.
  const [profProfile, setProfProfile] = useState(null)
  // Mientras esto está en `true` no se sabe todavía la matrícula/especialidad
  // real — crear el encuentro clínico en esta ventana lo deja para siempre con
  // la firma de relleno ('otra'/'MN'/'0'), porque el encuentro se crea una
  // sola vez (ver useClinicalEncounter). No bloquea escribir la nota: sólo el
  // botón "Guardar" espera, con spinner (ver el form más abajo).
  const [loadingProfProfile, setLoadingProfProfile] = useState(true)
  useEffect(() => {
    if (!profile?.id) { setLoadingProfProfile(false); return }
    setLoadingProfProfile(true)
    professionalService.getByUserId(profile.id)
      .then(setProfProfile)
      .catch(() => {})
      .finally(() => setLoadingProfProfile(false))
  }, [profile?.id])
  const licenseType = profProfile?.licenseType ?? 'MN'
  const licenseNumber = profProfile?.licenseNumber ?? '0'
  const specialty = profProfile?.specialty ?? 'otra'
  const [loadingPatientData, setLoadingPatientData] = useState(true)

  /**
   * Scroll-spy: marca en la barra la sección que se está mirando.
   *
   * Se compara contra el tope del contenedor + un margen, no contra el
   * viewport: este panel es un scroller propio (mitad de la pantalla en
   * desktop, hoja en mobile), así que `IntersectionObserver` contra el
   * viewport marcaría cualquier cosa.
   */
  useEffect(() => {
    if (activeView !== 'chart') return
    const cont = chartRef.current
    if (!cont) return
    let raf = null
    const spy = () => {
      raf = null
      const limite = cont.getBoundingClientRect().top + SECTION_SCROLL_OFFSET
      let visible = SECTION_IDS[0]
      for (const id of SECTION_IDS) {
        const el = sectionRefs.current[id]
        if (el && el.getBoundingClientRect().top <= limite) visible = id
      }
      setActiveSection(prev => (prev === visible ? prev : visible))

      // Los botones ya no son sticky: el atajo aparece cuando su bloque salió
      // por arriba. `bottom <= limite` y no `< 0` para que aparezca recién
      // cuando quedaron tapados por la propia fila del paciente.
      const bts = botonesRef.current
      const fuera = bts ? bts.getBoundingClientRect().bottom <= limite : false
      setAtajoNota(prev => (prev === fuera ? prev : fuera))
    }
    const onScroll = () => { if (raf == null) raf = requestAnimationFrame(spy) }
    cont.addEventListener('scroll', onScroll, { passive: true })
    spy()
    return () => {
      cont.removeEventListener('scroll', onScroll)
      if (raf != null) cancelAnimationFrame(raf)
    }
    // `loadingEntries`/`entries.length` entran acá porque la lista de notas
    // cambia el alto de la sección "Notas" — sin recalcular, la sección activa
    // y el atajo "Nueva nota" quedan con la geometría vieja hasta el próximo
    // scroll manual. `activeView` ya cubre "al volver de Receta/Cierre".
  }, [activeView, loadingHistoria, loadingPatientData, showForm, loadingEntries, entries.length])
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

  // Se precarga UNA sola vez por consulta y sólo cuando la consulta todavía no
  // tiene cobertura propia: si el profesional la corrige acá, un refetch de
  // `patientData` más tarde (p.ej. al completar el DNI que faltaba, desde
  // `onDatosActualizados`) no tiene que pisarle la corrección con el valor del
  // perfil de nuevo.
  const coberturaPrecargada = useRef(false)
  useEffect(() => { coberturaPrecargada.current = false }, [consultation?.id])

  useEffect(() => {
    if (!consultation?.id || coberturaPrecargada.current) return
    if (consultation.coverageType != null) {
      // La consulta ya tiene su propia cobertura cargada: esa manda.
      setCobertura({
        coverageType:    consultation.coverageType,
        financiadorId:   consultation.financiadorId ?? null,
        obraSocialName:  consultation.obraSocialName ?? '',
        affiliateNumber: consultation.affiliateNumber ?? '',
      })
      coberturaPrecargada.current = true
      return
    }
    // Todavía no hay cobertura propia de esta consulta: se espera a que
    // termine de cargar el perfil del paciente para precargar con SU
    // cobertura estable (`profiles.coverage_type`/`financiador_id`/
    // `insurance_name`/`insurance_num`, cargada en el alta). Precargar no es
    // forzar — el profesional la corrige acá libremente y "Guardar" sólo
    // escribe en `consultations`, nunca en el perfil del paciente.
    if (loadingPatientData) return
    setCobertura({
      coverageType:    patientData?.coverageType ?? null,
      financiadorId:   patientData?.financiadorId ?? null,
      obraSocialName:  patientData?.insuranceName ?? '',
      affiliateNumber: patientData?.insuranceNum ?? '',
    })
    coberturaPrecargada.current = true
  }, [consultation?.id, consultation?.coverageType, consultation?.financiadorId, consultation?.obraSocialName, consultation?.affiliateNumber, loadingPatientData, patientData])

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

  // Sólo las especialidades marcadas en el catálogo recetan (migración 116).
  // Mientras el catálogo o el perfil profesional todavía están cargando se
  // considera que NO puede — es preferible esconder la pestaña un instante de
  // más que ofrecerla (y de paso crear un encuentro clínico) a quien no puede.
  const { puedeRecetar, cargando: cargandoEspecialidades } = useEspecialidades()
  const puedeRecetarProfesional = !cargandoEspecialidades && !loadingProfProfile && puedeRecetar(specialty)

  // El encuentro clínico se crea perezosamente (al guardar la primera nota).
  // La receta también lo necesita, así que se asegura al abrir su pestaña —
  // si no, se guardaría con encounter_id en null y quedaría huérfana. Pero
  // sólo si el profesional puede recetar: si no puede, la pestaña ni se
  // ofrece (ver PANEL_TABS filtrado más abajo), y tocarla no tiene que crear
  // un clinical_encounter que no sirve para nada.
  useEffect(() => {
    if (activeView === 'receta' && !encounterId && puedeRecetarProfesional) ensureEncounter().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, encounterId, puedeRecetarProfesional])


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

  // Sólo se ofrece "Recetario" cuando el profesional puede recetar (fix del
  // punto 7). Mientras se está cargando esa respuesta,
  // `puedeRecetarProfesional` da `false`, así que la pestaña queda oculta y
  // no "parpadea" apareciendo tarde.
  const visibleTabs = PANEL_TABS.filter(tab => tab.id !== 'receta' || puedeRecetarProfesional)

  return (
    <div className="flex flex-col h-full bg-white lg:border-l border-border-default">
      {/* Paciente: chrome fijo del panel, siempre visible (Mateo, 2026-08-23).
          Antes vivía DENTRO del scroller con un `sticky -top-4` — salió de ahí
          para no depender de ese truco y quedar en su lugar natural, arriba de
          todo, junto con la barra de pestañas. La planilla (Notas → Paciente
          → Historia) scrollea por debajo de las dos. Tocarlo lleva a la
          sección "Paciente" de la planilla. */}
      <div className="shrink-0 bg-white border-b border-border-default px-3 py-2.5">
        <div className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-border-default bg-white">
          <button
            onClick={() => irA({ id: 'datos', kind: 'section' })}
            className="flex-1 min-w-0 flex items-center gap-2.5 text-left group"
          >
            <div className="h-7 w-7 rounded-full bg-brand-muted flex items-center justify-center shrink-0">
              <User className="h-3.5 w-3.5 text-brand" />
            </div>
            <span className="flex-1 min-w-0 text-sm font-semibold text-text-primary truncate group-hover:text-brand transition-colors">
              {consultation?.patient?.fullName ?? 'Paciente'}
            </span>
            <CaretRight className="h-3.5 w-3.5 text-text-tertiary shrink-0 group-hover:text-brand transition-colors" />
          </button>

          {/* Atajo que aparece SÓLO cuando los 4 botones de nota ya se fueron
              de pantalla: los botones dejaron de ser sticky, así que sin esto
              había que scrollear a mano hasta arriba para escribir. Devuelve
              al principio, que es donde vuelven a estar a la vista. Sólo en la
              planilla — en Receta/Cierre scrollear arriba no lleva a los
              botones de nota. Usa el mismo scrollIntoView del índice y no
              `chartRef.scrollTo({behavior:'smooth'})`, que resultó no
              completar en algunos entornos (verificación 2026-08-24). */}
          {atajoNota && !showForm && activeView === 'chart' && (
            <button
              onClick={() => irA({ id: 'nota', kind: 'section' })}
              className="shrink-0 flex items-center gap-1 pl-2.5 ml-0.5 border-l border-border-default text-[11px] font-semibold text-brand hover:text-brand-hover transition-colors"
            >
              <Plus className="h-3 w-3" weight="bold" /> Nueva nota
            </button>
          )}
        </div>
      </div>

      {/* El encabezado "Historia Clínica" se sacó (Mateo, 2026-08-21): repetía
          lo que ya dice una de las pestañas y le comía alto a un panel que en
          la llamada comparte pantalla con el video. Las pestañas quedan como
          único rótulo — por eso ahora nombran completo lo que hacen.

          El botón de IA, que vivía en ese encabezado, se muda acá arriba a la
          derecha de las pestañas. Hoy está apagado por flag. */}
      <div className="flex items-center shrink-0 bg-bg-surface border-b border-border-default">
        {/* Las etiquetas largas ya no entran repartiéndose el ancho: la barra
            scrollea en horizontal y cada pestaña conserva su ancho natural
            (`whitespace-nowrap` + `shrink-0`). Antes usaban `flex-1` en mobile,
            que con "Generar Receta Electrónica" partía el texto en tres
            renglones y descuadraba toda la fila. */}
        <div className="flex-1 flex gap-5 px-4 overflow-x-auto scrollbar-hide">
          {visibleTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => irA(tab)}
              className={`shrink-0 whitespace-nowrap flex items-center gap-1.5 text-xs lg:text-sm py-4 border-b-2 transition-colors ${
                (tab.kind === 'view' ? activeView === tab.id : activeView === 'chart' && activeSection === tab.id)
                  ? 'border-brand text-brand font-semibold'
                  : 'border-transparent text-text-tertiary hover:text-text-secondary'
              }`}
            >
              <tab.icon className="h-3.5 w-3.5 lg:h-4 lg:w-4 shrink-0" /> {tab.label}
            </button>
          ))}
        </div>
        {activeView === 'chart' && SCRIBE_EN_LLAMADA && (
          <button
            onClick={() => setShowScribe(s => !s)}
            className="mr-4 shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full bg-brand text-white hover:bg-brand/90"
          >
            <Sparkle weight="fill" className="h-3 w-3" /> IA
          </button>
        )}
      </div>

      {activeView === 'chart' && showScribe && (
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

      <div ref={chartRef} className="flex-1 overflow-y-auto px-3 py-4">
        {/* ── Planilla continua: Notas → Paciente → Historia ──────────────
            Las tres se renderizan SIEMPRE juntas y se navegan scrolleando;
            la barra de arriba es el índice. Ver PANEL_TABS. */}
        {activeView === 'chart' && (
          <>
            <section ref={el => { sectionRefs.current.nota = el }} className="scroll-mt-6">
              {/* Un botón por tipo en vez de un "Nueva nota" genérico + select
                  adentro del formulario (Mateo, 2026-08-21): el tipo se elige
                  ANTES de escribir, que es como se piensa la nota, y de paso
                  los 4 tipos quedan a la vista — el select los escondía.

                  Ya no son sticky (2026-08-22): ocupaban demasiado alto fijo en
                  un panel que comparte pantalla con el video. El atajo de la
                  fila del paciente cubre el caso de necesitarlos scrolleado. */}
              {!showForm && (
                <div ref={botonesRef} className="grid grid-cols-2 gap-2.5 mb-4">
                  {Object.entries(NOTE_TYPE_LABELS).map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => { setForm({ entryType: value, content: '' }); setShowForm(true) }}
                      className="flex items-center justify-center gap-1.5 py-4 px-2 rounded-2xl bg-white border border-border-default text-text-primary font-semibold text-xs hover:border-brand hover:text-brand hover:bg-brand-muted/20 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5 shrink-0" weight="bold" />
                      <span className="truncate">{label}</span>
                    </button>
                  ))}
                </div>
              )}

            {showForm && (
              <form onSubmit={handleSubmit} className="mb-4 rounded-xl border border-border-default bg-bg-subtle p-3 space-y-2">
                {/* El tipo ya se eligió con el botón — se muestra como
                    encabezado, y se puede cambiar sin perder lo escrito. */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-brand">{NOTE_TYPE_LABELS[form.entryType]}</span>
                  <select
                    className="form-select text-[11px] py-1 w-auto"
                    value={form.entryType}
                    onChange={e => setForm(f => ({ ...f, entryType: e.target.value }))}
                  >
                    {Object.entries(NOTE_TYPE_LABELS).map(([v, label]) => (
                      <option key={v} value={v}>{label}</option>
                    ))}
                  </select>
                </div>
                <textarea
                  required
                  autoFocus
                  rows={4}
                  className="form-input text-xs resize-none py-1.5"
                  placeholder={`${NOTE_TYPE_LABELS[form.entryType]}…`}
                  value={form.content}
                  onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                />
                <div className="flex justify-end gap-1.5">
                  <button type="button" onClick={() => setShowForm(false)} className="text-xs px-3 py-1.5 rounded border border-border-default text-text-secondary hover:text-text-primary">
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || loadingProfProfile}
                    title={loadingProfProfile ? 'Esperando el perfil profesional…' : undefined}
                    className="text-xs px-3 py-1.5 rounded bg-brand text-white flex items-center gap-1 disabled:opacity-60"
                  >
                    {(submitting || loadingProfProfile) ? <CircleNotch className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Guardar
                  </button>
                </div>
              </form>
            )}

            {/* 2 · Lo que declaró el paciente antes de entrar. Vivía en la
                pestaña "Historia" — es de esta consulta, no historia previa. */}
            {hasPreconsulta(consultation?.preconsultaData) && (
              <div className="mb-4">
                <PreconsultaSummary preconsulta={consultation.preconsultaData} />
              </div>
            )}

            {/* 3 · Guía clínica: sólo clínicos/pediatras recetan y examinan con
                este flujo (mismo gate que las recetas, ver
                CLINICAL_GUIDE_SPECIALTIES). Nutrición usa NutriPlan Pro en su
                lugar; el resto de las verticales (psicología, etc.) sólo
                tiene la nota libre de abajo. */}
            {CLINICAL_GUIDE_SPECIALTIES.includes(specialty) && (
              <GuiaClinicaConsulta
                entries={entries}
                preconsulta={consultation?.preconsultaData}
                patientId={patientId}
                professionalId={professionalId}
                licenseType={licenseType}
                licenseNumber={licenseNumber}
                ensureEncounter={ensureEncounter}
                onEntryAdded={entry => setEntries(prev => [...prev, entry])}
              />
            )}
            {specialty === 'nutricion' && <NutriplanEnConsulta patientId={patientId} />}
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
            </section>

            <section ref={el => { sectionRefs.current.datos = el }} className="scroll-mt-6 mt-8">
              <SectionHeader icon={IdentificationCard} label="Paciente" />
              <DatosTab loading={loadingPatientData} patient={patientData} />
            </section>

            <section ref={el => { sectionRefs.current.historia = el }} className="scroll-mt-6 mt-8 pb-4">
              <SectionHeader icon={ClockCounterClockwise} label="Historia Clínica" />
              <HistoriaTab loading={loadingHistoria} encounters={historia.encounters} allergies={historia.allergies} />
            </section>
          </>
        )}

        {activeView === 'receta' && (
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
                // Sin dato, a secas — no es lo mismo que "particular": ese es
                // un estado elegido a propósito, esto es que nadie lo cargó
                // todavía. Mostrar "particular" acá haría pensar que ya se
                // decidió sin cobertura.
                <p className="text-xs text-text-tertiary">
                  Sin definir. Cargala para que la receta salga con cobertura si corresponde.
                </p>
              )}
            </div>

            <Recetario
              patientId={consultation?.patientId ?? null}
              encounterId={encounterId}
              ensureEncounter={ensureEncounter}
              onEntryAdded={entry => setEntries(prev => [...prev, entry])}
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

        {activeView === 'cerrar' && <CerrarTab {...codigoCierre} />}
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
  const [splitScreen, setSplitScreen] = useState(true)
  const split = useVideoSplit()
  // Hoja de la HC en mobile. Arranca abajo: lo primero es ver al paciente.
  const [hojaAbierta, setHojaAbierta] = useState(false)
  const [noShowBanner, setNoShowBanner] = useState(false)

  // ── Código de cierre EN la llamada (migración 099) ───────────────────────
  const [codigoInput, setCodigoInput] = useState('')
  const [verificandoCodigo, setVerificandoCodigo] = useState(false)
  const [errorCodigo, setErrorCodigo] = useState(null)
  const [intentosRestantes, setIntentosRestantes] = useState(5)
  const [solicitandoCodigo, setSolicitandoCodigo] = useState(false)
  const [codigoSolicitado, setCodigoSolicitado] = useState(false)

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

    // El paciente compartió el código de cierre (a mano o aceptando el pedido
    // — migración 099). Se auto-verifica: no hace falta que el profesional lo
    // tipee. Listener registrado ANTES de `subscribe()`, como pide Realtime.
    ch.on('broadcast', { event: 'codigo_compartido' }, ({ payload }) => {
      if (destroyed || !payload?.code) return
      setCodigoInput(payload.code)
      verificarCodigo(payload.code)
    })

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
    // Corté la llamada → `closing` (migración 098). Es lo que le impide al
    // paciente volver a entrar a esta sala mientras cargo el cierre: hasta acá
    // la fila seguía en `in_progress`, el mismo estado que usa el paciente para
    // saber que puede "Entrar a Sala", así que podía reingresar a una llamada
    // que ya terminó. Sólo se dispara si venía de `in_progress` — si por lo que
    // sea todavía no llegó a esa altura, la transición no es válida y no hace
    // falta forzarla.
    if (consultation?.status === 'in_progress') {
      consultationsService
        .updateStatus(id, 'closing', { closingStartedAt: new Date().toISOString() })
        .catch(() => {})
    }
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

  // Verifica el código de cierre contra la base (migración 099). `codeOverride`
  // se usa cuando el código llega por el canal de tiempo real (el paciente lo
  // compartió/aceptó) — se auto-verifica sin que el profesional tenga que
  // tipear nada.
  async function verificarCodigo(codeOverride) {
    const code = codeOverride ?? codigoInput
    if (code.length !== 4) return
    setVerificandoCodigo(true)
    setErrorCodigo(null)
    try {
      const result = await consultationsService.verifyClosingCode(id, code)
      if (result.ok) {
        setConsultation(prev => prev ? { ...prev, closingCodeVerifiedAt: result.closingCodeVerifiedAt } : prev)
        setCodigoSolicitado(false)
        toast.success('Código verificado')
        consultationEventsService.log(id, CONSULTATION_EVENTS.CODE_VERIFIED, null, { id: profile?.id, role: 'professional' })
      } else {
        setIntentosRestantes(result.intentosRestantes)
        setErrorCodigo(
          result.motivo === 'intentos_agotados'
            ? 'Se agotaron los intentos.'
            : `Código incorrecto. Quedan ${result.intentosRestantes} intento(s).`
        )
        consultationEventsService.log(id, CONSULTATION_EVENTS.CODE_VERIFY_FAILED,
          { motivo: result.motivo }, { id: profile?.id, role: 'professional' })
      }
    } catch (err) {
      setErrorCodigo(err?.message ?? 'No se pudo verificar el código')
    } finally {
      setVerificandoCodigo(false)
    }
  }

  // Le pide el código al paciente por el mismo canal de presencia de la sala
  // de espera — nada de infraestructura nueva.
  async function solicitarCodigo() {
    if (!channelRef.current) return
    setSolicitandoCodigo(true)
    try {
      await channelRef.current.send({ type: 'broadcast', event: 'solicitar_codigo', payload: {} })
      setCodigoSolicitado(true)
      consultationEventsService.log(id, CONSULTATION_EVENTS.CODE_REQUESTED, null, { id: profile?.id, role: 'professional' })
    } catch {
      toast.error('No se pudo pedir el código. Probá de nuevo.')
    } finally {
      setSolicitandoCodigo(false)
    }
  }

  function handleKeepWaiting() {
    setNoShowBanner(false)
    // Reset 5-minute timer
    noShowTimerRef.current = setTimeout(() => setNoShowBanner(true), NO_SHOW_TIMEOUT_MS)
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-900">
      {/* Header — dark, Healthier-owned controls only */}
      <div className="vc-header flex items-center justify-between px-6 py-3 border-b border-white/10 bg-zinc-900 shrink-0">
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

          {/* Camera toggle — en mobile vive en la barra inferior */}
          <button
            onClick={toggleCam}
            title={camOn ? 'Apagar cámara' : 'Encender cámara'}
            className={`hidden lg:flex items-center justify-center w-9 h-9 rounded-full border transition-colors ${
              camOn
                ? 'border-white/20 text-white/70 hover:text-white hover:border-white/40'
                : 'border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20'
            }`}
          >
            {camOn ? <Camera className="h-4 w-4" /> : <CameraSlash className="h-4 w-4" />}
          </button>

          {/* Mic toggle — en mobile vive en la barra inferior */}
          <button
            onClick={toggleMic}
            title={micOn ? 'Silenciar micrófono' : 'Activar micrófono'}
            className={`hidden lg:flex items-center justify-center w-9 h-9 rounded-full border transition-colors ${
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
            className={`hidden lg:flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
              splitScreen
                ? 'border-brand/60 bg-brand/10 text-brand'
                : 'border-white/20 text-white/60 hover:text-white hover:border-white/40'
            }`}
          >
            {splitScreen ? <ArrowsIn className="h-3.5 w-3.5" /> : <ArrowsOut className="h-3.5 w-3.5" />}
            {splitScreen ? 'Ocultar historial' : 'Historia clínica'}
          </button>
          {/* Con la hoja de HC arriba los círculos del pie quedan tapados: el
              colgar reaparece acá para no tener que bajarla primero. */}
          {hojaAbierta && (
            <button
              onClick={handleLeave}
              aria-label="Finalizar la consulta"
              className="lg:hidden flex items-center justify-center w-9 h-9 rounded-full bg-danger text-white"
            >
              <PhoneSlash className="h-4 w-4" weight="fill" />
            </button>
          )}
          <button
            onClick={handleLeave}
            className="hidden lg:flex btn-danger items-center gap-2 px-4 py-2 text-sm"
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

          {/* Controles de llamada — sólo mobile. En el header quedaban chiquitos
              y lejos del pulgar; acá son los círculos de siempre (iPhone /
              WhatsApp): micrófono, cámara y colgar en rojo al centro. */}
          <div className="vc-controles lg:hidden" data-hoja={hojaAbierta ? 'true' : 'false'}>
            <button
              type="button"
              onClick={toggleMic}
              aria-label={micOn ? 'Silenciar micrófono' : 'Activar micrófono'}
              className={`vc-control-btn ${micOn ? 'vc-control-on' : 'vc-control-off'}`}
            >
              {micOn ? <Microphone className="h-6 w-6" /> : <MicrophoneSlash className="h-6 w-6" />}
            </button>

            <button
              type="button"
              onClick={handleLeave}
              aria-label="Finalizar la consulta"
              className="vc-control-btn vc-control-colgar"
            >
              <PhoneSlash className="h-7 w-7" weight="fill" />
            </button>

            <button
              type="button"
              onClick={toggleCam}
              aria-label={camOn ? 'Apagar cámara' : 'Encender cámara'}
              className={`vc-control-btn ${camOn ? 'vc-control-on' : 'vc-control-off'}`}
            >
              {camOn ? <Camera className="h-6 w-6" /> : <CameraSlash className="h-6 w-6" />}
            </button>
          </div>

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
            className="vc-panel-pane vc-panel-tipografia overflow-hidden bg-bg-primary flex flex-col"
            data-abierta={hojaAbierta ? 'true' : 'false'}
            // La hoja sube sola ante cualquier intención de usarla: tocar un
            // campo, tocar una pestaña (Hoy/Receta/Historia/Datos) o scrollear
            // el contenido. Antes sólo la abría el foco de un input y el resto
            // de los toques quedaban a medias, con la hoja tapada abajo
            // (reportado por Mateo desde el iPhone).
            onFocusCapture={() => setHojaAbierta(true)}
            onPointerDownCapture={() => setHojaAbierta(true)}
            onScrollCapture={() => setHojaAbierta(true)}
          >
            {/* Sólo en mobile: la barra que se toca para subirla o bajarla. */}
            <button
              type="button"
              onClick={() => setHojaAbierta(v => !v)}
              // El contenedor abre con onPointerDownCapture; sin frenarlo acá,
              // tocar "Bajar" abría y cerraba en el mismo gesto.
              onPointerDown={e => e.stopPropagation()}
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
                codigoCierre={{
                  codeVerifiedAt: consultation?.closingCodeVerifiedAt ?? null,
                  codeInput: codigoInput,
                  onCodeInputChange: setCodigoInput,
                  onVerify: () => verificarCodigo(),
                  verifying: verificandoCodigo,
                  verifyError: errorCodigo,
                  attemptsLeft: intentosRestantes,
                  onSolicitar: solicitarCodigo,
                  solicitando: solicitandoCodigo,
                  solicitado: codigoSolicitado,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
