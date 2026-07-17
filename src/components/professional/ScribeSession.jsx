import { useState, useRef, useCallback, useEffect } from 'react'
import { Microphone, Stop, Sparkle, X, PaperPlaneTilt, Check, CircleNotch, Trash } from '@phosphor-icons/react'
import { scribeService } from '../../services/scribeService'
import { toast } from '../Toast'

const WINDOW_MS = 15000        // continuous recording: transcribe in 15s windows
const VOICE_EDIT_MS = 6000     // voice-edit instruction: fixed short clip

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// Records `stream` for up to `ms`, resolving the assembled Blob once stopped
// (early or by timeout). `onRecorderReady` exposes the live MediaRecorder so
// callers that need to stop it early (the continuous recording loop) can.
function recordFor(stream, ms, onRecorderReady) {
  return new Promise(resolve => {
    const recorder = new MediaRecorder(stream)
    onRecorderReady?.(recorder)
    const chunks = []
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
    recorder.start()
    setTimeout(() => { if (recorder.state === 'recording') recorder.stop() }, ms)
  })
}

// AI Scribe — records the consultation, transcribes it in rolling windows,
// asks Gemini to structure it into a historia clínica draft, lets the
// professional review and correct it (including by voice), then commits it
// as a single immutable clinical_entries row. No raw audio is ever persisted
// — only the transcript text and the structured JSON make it past this
// component (see 052_clinical_scribe_sessions.sql).
//
// `getAudioStream` is injected by the caller so this component stays
// agnostic of where the audio comes from — a plain getUserMedia() mic for
// in-person consultations (ConsultationDetail.jsx) vs. a MediaStream built
// from Daily.co's already-live local+remote tracks during a video call
// (VideoCall.jsx's ClinicalPanel). `stopStream`, if provided, is called with
// each stream once we're done with it — ConsultationDetail's mic stream must
// be released (or the browser's recording indicator stays on), while
// VideoCall's tracks belong to the ongoing call and must NOT be stopped, so
// it passes nothing.
export default function ScribeSession({
  patientId, professionalId, specialty, licenseType, licenseNumber,
  encounterId, ensureEncounter, getAudioStream, stopStream, onFinalized, onClose,
}) {
  const [phase, setPhase] = useState('idle') // idle | recording | extracting | draft | finalizing | finalized
  const [transcript, setTranscript] = useState('')
  const [structuredData, setStructuredData] = useState(null)
  const [editInstruction, setEditInstruction] = useState('')
  const [applyingEdit, setApplyingEdit] = useState(false)
  const [recordingEdit, setRecordingEdit] = useState(false)

  const sessionIdRef = useRef(null)
  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  const transcriptRef = useRef('')
  // Tracks the currently-recording window's blob promise and the (chained,
  // ordered) chunk-processing queue separately: recordWindow() starts the
  // next window immediately without waiting on the previous chunk's
  // transcription — otherwise every ~15s window is followed by a dead gap
  // where nothing is being captured. handleStop awaits both refs instead of
  // guessing a fixed delay, so it never cuts off the last few seconds.
  const currentBlobPromiseRef = useRef(null)
  const pendingChunkRef = useRef(Promise.resolve())

  const releaseStream = useCallback(() => {
    if (streamRef.current) stopStream?.(streamRef.current)
    streamRef.current = null
  }, [stopStream])

  useEffect(() => () => releaseStream(), [releaseStream]) // release if unmounted mid-recording

  const recordWindow = useCallback(() => {
    const stream = streamRef.current
    if (!stream) return
    let thisRecorder
    const blobPromise = recordFor(stream, WINDOW_MS, recorder => {
      thisRecorder = recorder
      recorderRef.current = recorder
    })
    currentBlobPromiseRef.current = blobPromise
    blobPromise.then(blob => {
      const stillActive = recorderRef.current === thisRecorder
      if (blob.size > 500) {
        pendingChunkRef.current = pendingChunkRef.current.then(async () => {
          try {
            const audioBase64 = await blobToBase64(blob)
            const updated = await scribeService.transcribeChunk(sessionIdRef.current, transcriptRef.current, audioBase64, blob.type)
            transcriptRef.current = updated
            setTranscript(updated)
          } catch {
            // one failed chunk shouldn't kill the whole recording — keep listening
          }
        })
      }
      if (stillActive) recordWindow()
    })
  }, [])

  async function handleStart() {
    try {
      const eid = encounterId ?? await ensureEncounter()
      const session = await scribeService.createSession({ encounterId: eid, patientId, professionalId })
      sessionIdRef.current = session.id
      transcriptRef.current = ''
      setTranscript('')
      streamRef.current = await getAudioStream()
      setPhase('recording')
      recordWindow()
    } catch (err) {
      toast.error(err.message || 'No se pudo iniciar la grabación')
    }
  }

  async function handleStop() {
    const active = recorderRef.current
    recorderRef.current = null // signals recordWindow's pending .then() to stop looping
    if (active?.state === 'recording') active.stop()
    setPhase('extracting')
    if (currentBlobPromiseRef.current) await currentBlobPromiseRef.current
    await pendingChunkRef.current // waits for exactly as long as the last chunk actually takes
    releaseStream()
    try {
      const data = await scribeService.extractNote(sessionIdRef.current, transcriptRef.current, specialty)
      setStructuredData(data)
      setPhase('draft')
    } catch (err) {
      toast.error(err.message || 'No se pudo generar la historia clínica')
      setPhase('idle')
    }
  }

  async function submitTextEdit() {
    const instructionText = editInstruction.trim()
    if (!instructionText) return
    setApplyingEdit(true)
    try {
      const updated = await scribeService.voiceEdit(sessionIdRef.current, structuredData, { instructionText })
      setStructuredData(updated)
      setEditInstruction('')
    } catch (err) {
      toast.error(err.message || 'No se pudo aplicar el cambio')
    } finally {
      setApplyingEdit(false)
    }
  }

  async function handleVoiceEditRecord() {
    setRecordingEdit(true)
    let stream
    try {
      stream = await getAudioStream()
      const blob = await recordFor(stream, VOICE_EDIT_MS)
      setApplyingEdit(true)
      const audioBase64 = await blobToBase64(blob)
      const updated = await scribeService.voiceEdit(sessionIdRef.current, structuredData, {
        instructionAudioBase64: audioBase64, instructionMimeType: blob.type,
      })
      setStructuredData(updated)
    } catch (err) {
      toast.error(err.message || 'No se pudo aplicar el cambio por voz')
    } finally {
      if (stream) stopStream?.(stream)
      setRecordingEdit(false)
      setApplyingEdit(false)
    }
  }

  async function handleFinalize() {
    setPhase('finalizing')
    try {
      const eid = encounterId ?? await ensureEncounter()
      const entry = await scribeService.finalize(sessionIdRef.current, {
        encounterId: eid, patientId, professionalId, structuredData, licenseType, licenseNumber,
      })
      setPhase('finalized')
      toast.success('Historia clínica guardada')
      onFinalized?.(entry)
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar la historia clínica')
      setPhase('draft')
    }
  }

  async function handleDiscard() {
    releaseStream()
    try { await scribeService.discard(sessionIdRef.current) } catch { /* best-effort */ }
    onClose?.()
  }

  const nonEmptySections = structuredData ? scribeService.nonEmptySections(structuredData) : []

  return (
    <div className="rounded-2xl border border-border-default bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-brand-muted border-b border-border-default">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-brand flex items-center justify-center shrink-0">
            <Sparkle weight="fill" className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-text-primary">Historia Clínica IA</span>
        </div>
        {onClose && phase !== 'recording' && (
          <button onClick={handleDiscard} className="p-1 rounded-lg hover:bg-white/60 text-text-tertiary">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="p-4">
        {phase === 'idle' && (
          <div className="text-center py-4">
            <p className="text-sm text-text-secondary mb-4">
              Grabá la consulta y la IA arma la historia clínica sola. Nunca guardamos el audio — solo la transcripción y el resumen.
            </p>
            <button onClick={handleStart} className="btn-primary inline-flex items-center gap-2">
              <Microphone className="h-4 w-4" weight="fill" /> Grabar consulta
            </button>
          </div>
        )}

        {phase === 'recording' && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-danger" />
              </span>
              <span className="text-sm font-medium text-text-primary">Escuchando...</span>
            </div>
            <div className="rounded-xl bg-bg-surface border border-border-default p-3 h-32 overflow-y-auto text-sm text-text-secondary whitespace-pre-wrap leading-relaxed mb-3">
              {transcript || 'Empezá a hablar...'}
            </div>
            <button onClick={handleStop} className="btn-primary w-full inline-flex items-center justify-center gap-2">
              <Stop className="h-4 w-4" weight="fill" /> Finalizar y crear historia
            </button>
          </div>
        )}

        {phase === 'extracting' && (
          <div className="flex flex-col items-center py-8 gap-3">
            <CircleNotch className="h-6 w-6 animate-spin text-brand" />
            <p className="text-sm text-text-secondary">Generando historia clínica...</p>
          </div>
        )}

        {phase === 'draft' && structuredData && (
          <div>
            <div className="space-y-3 max-h-72 overflow-y-auto mb-4">
              {nonEmptySections.length === 0 && (
                <p className="text-sm text-text-tertiary text-center py-4">No se detectó información estructurable en la transcripción.</p>
              )}
              {nonEmptySections.map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-0.5">{label}</p>
                  <p className="text-sm text-text-primary leading-relaxed">{value}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-2 items-center mb-3">
              <input
                type="text"
                value={editInstruction}
                onChange={e => setEditInstruction(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitTextEdit() }}
                placeholder="Habla o escribí lo que querés que cambie..."
                disabled={applyingEdit || recordingEdit}
                className="form-input text-sm flex-1"
              />
              <button
                onClick={handleVoiceEditRecord}
                disabled={applyingEdit || recordingEdit}
                title="Grabar instrucción por voz"
                className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${recordingEdit ? 'bg-danger text-white' : 'bg-bg-surface border border-border-default text-text-secondary hover:bg-bg-surface-hover'}`}
              >
                {recordingEdit ? <CircleNotch className="h-4 w-4 animate-spin" /> : <Microphone className="h-4 w-4" />}
              </button>
              <button
                onClick={submitTextEdit}
                disabled={applyingEdit || recordingEdit || !editInstruction.trim()}
                className="btn-primary h-9 w-9 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-40"
              >
                {applyingEdit ? <CircleNotch className="h-4 w-4 animate-spin" /> : <PaperPlaneTilt weight="fill" className="h-4 w-4" />}
              </button>
            </div>

            <div className="flex gap-2">
              <button onClick={handleDiscard} className="btn-secondary flex-1 inline-flex items-center justify-center gap-1.5">
                <Trash className="h-4 w-4" /> Descartar
              </button>
              <button onClick={handleFinalize} className="btn-primary flex-1 inline-flex items-center justify-center gap-1.5">
                <Check className="h-4 w-4" /> Confirmar y guardar
              </button>
            </div>
          </div>
        )}

        {phase === 'finalizing' && (
          <div className="flex flex-col items-center py-8 gap-3">
            <CircleNotch className="h-6 w-6 animate-spin text-brand" />
            <p className="text-sm text-text-secondary">Guardando en la historia clínica...</p>
          </div>
        )}

        {phase === 'finalized' && (
          <div className="flex flex-col items-center py-8 gap-3 text-center">
            <div className="h-10 w-10 rounded-full bg-brand flex items-center justify-center">
              <Check className="h-5 w-5 text-white" weight="bold" />
            </div>
            <p className="text-sm text-text-primary font-medium">Guardado en la historia clínica</p>
            {onClose && (
              <button onClick={onClose} className="btn-secondary mt-1">Cerrar</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
