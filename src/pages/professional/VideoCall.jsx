import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, PhoneSlash, ClipboardText, ArrowsOut, ArrowsIn,
  Plus, Check, CircleNotch, User, Microphone, MicrophoneSlash,
  Camera, CameraSlash,
} from '@phosphor-icons/react'
import DailyIframe from '@daily-co/daily-js'
import { consultationsService } from '../../services/consultationsService'
import { clinicalService } from '../../services/clinicalService'
import CloseConsultationModal from '../../components/CloseConsultationModal'
import { toast } from '../../components/Toast'

const ENTRY_TYPE_LABELS = {
  note: 'Nota',
  diagnosis: 'Diagnóstico',
  indication: 'Indicación',
  addendum: 'Addendum',
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
function ClinicalPanel({ consultation, profile }) {
  const patientId = consultation?.patientId
  const professionalId = consultation?.professionalId
  const pp = profile?.professionalProfiles?.[0]
  const licenseType = pp?.licenseType ?? 'MN'
  const licenseNumber = pp?.licenseNumber ?? '0'
  const specialty = pp?.specialty ?? 'otra'

  const [encounterId, setEncounterId] = useState(null)
  const [entries, setEntries] = useState([])
  const [loadingEntries, setLoadingEntries] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ entryType: 'note', content: '' })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!consultation?.id) return
    async function load() {
      try {
        const existing = await clinicalService.getEncounterByConsultationIdSafe(consultation.id)
        if (existing) {
          setEncounterId(existing.id)
          const detail = await clinicalService.getEncounterWithDetail(existing.id)
          setEntries(detail.entries)
        }
      } catch {
        // leave empty
      } finally {
        setLoadingEntries(false)
      }
    }
    load()
  }, [consultation?.id])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.content.trim()) return
    setSubmitting(true)
    try {
      let eid = encounterId
      if (!eid) {
        const enc = await clinicalService.createEncounter({
          patientId,
          professionalId,
          consultationId: consultation.id,
          specialty,
          modality: consultation.modality,
          licenseType,
          licenseNumber,
        })
        eid = enc.id
        setEncounterId(eid)
      }
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
        <button
          onClick={() => setShowForm(s => !s)}
          className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full bg-brand text-white hover:bg-brand/90"
        >
          <Plus className="h-3 w-3" /> Nota
        </button>
      </div>

      {showForm && (
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
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ProfessionalVideoCall({ profile }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const callRef = useRef(null)

  const [consultation, setConsultation] = useState(null)
  const [joining, setJoining] = useState(true)
  const [closeModal, setCloseModal] = useState(false)
  const [splitScreen, setSplitScreen] = useState(true)

  // Local tracks & controls
  const [camOn, setCamOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [localVideoTrack, setLocalVideoTrack] = useState(null)

  // Remote participant
  const [remote, setRemote] = useState(null) // { videoTrack, audioTrack }

  useEffect(() => {
    let destroyed = false

    async function init() {
      try {
        const [cons, { roomUrl, token }] = await Promise.all([
          consultationsService.getById(id),
          consultationsService.getDailyAccess(id),
        ])
        if (destroyed) return
        setConsultation(cons)

        // Use mock if injected by tests, otherwise real Daily.co call object
        const DailyLib = window.__DailyIframeMock ?? DailyIframe
        const call = DailyLib.createCallObject()
        callRef.current = call

        call.on('joined-meeting', () => {
          if (destroyed) return
          setJoining(false)
          consultationsService.updateStatus(id, 'in_progress').catch(() => {})
          // Seed local track state from the participants snapshot
          const local = call.participants().local
          setLocalVideoTrack(local?.tracks?.video?.persistentTrack ?? null)
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

    init()
    return () => {
      destroyed = true
      callRef.current?.leave()
      callRef.current?.destroy()
    }
  }, [id])

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
    // Show our close modal immediately — don't wait for left-meeting event
    setCloseModal(true)
    callRef.current?.leave().catch(() => {})
  }

  const handleFinalized = () => {
    callRef.current?.destroy()
    navigate('/profesional/consulta/' + id)
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

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Video area */}
        <div className={`relative bg-zinc-900 ${splitScreen ? 'flex-1' : 'w-full'}`}>

          {/* Joining overlay */}
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
            !joining && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center space-y-3">
                  <div className="w-24 h-24 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto">
                    <User className="h-12 w-12 text-white/15" />
                  </div>
                  <p className="text-white/30 text-sm">Esperando al paciente…</p>
                </div>
              </div>
            )
          )}

          {/* Remote audio (invisible) */}
          {remote?.audioTrack && <AudioPlayer track={remote.audioTrack} />}

          {/* Local camera — PiP in bottom-right corner */}
          {!joining && (
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
            <ClinicalPanel consultation={consultation} profile={profile} />
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
