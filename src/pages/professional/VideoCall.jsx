import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, PhoneSlash, ClipboardText, ArrowsOut, ArrowsIn, Plus, Check, CircleNotch, User } from '@phosphor-icons/react';
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
      {/* Panel header */}
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

      {/* Quick note form */}
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

      {/* Entries timeline */}
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
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-brand">{ENTRY_TYPE_LABELS[entry.entryType] ?? entry.entryType}</span>
                    </div>
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

export default function ProfessionalVideoCall({ profile }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const containerRef = useRef(null)
  const callFrameRef = useRef(null)
  const [consultation, setConsultation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [closeModal, setCloseModal] = useState(false)
  const [splitScreen, setSplitScreen] = useState(true)

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

        const DailyLib = window.__DailyIframeMock ?? DailyIframe
        const callFrame = DailyLib.createFrame(containerRef.current, {
          iframeStyle: { width: '100%', height: '100%', border: 'none', borderRadius: '12px' },
          showLeaveButton: false,
          showFullscreenButton: true,
          lang: 'es',
        })
        callFrameRef.current = callFrame
        callFrame.on('joined-meeting', () => {
          if (!destroyed) consultationsService.updateStatus(id, 'in_progress').catch(() => {})
        })
        callFrame.on('left-meeting', () => { if (!destroyed) setCloseModal(true) })
        callFrame.on('error', e => {
          toast.error(`Error en la videollamada: ${e.errorMsg}`)
          if (!destroyed) setLoading(false)
        })
        callFrame.on('loading', () => { if (!destroyed) setLoading(false) })
        callFrame.join({ url: roomUrl, token }).catch(() => {
          if (!destroyed) {
            toast.error('No se pudo iniciar la videollamada')
            navigate('/profesional/dashboard')
          }
        })
      } catch {
        if (!destroyed) {
          toast.error('No se pudo iniciar la videollamada')
          setLoading(false)
          navigate('/profesional/dashboard')
        }
      }
    }

    init()
    return () => {
      destroyed = true
      callFrameRef.current?.destroy()
    }
  }, [id])

  const handleFinalized = () => {
    callFrameRef.current?.destroy()
    navigate('/profesional/consulta/' + id)
  }

  return (
    <div className="flex flex-col h-screen bg-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border-default bg-bg-surface shrink-0">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-text-secondary hover:text-brand">
          <ArrowLeft className="h-4 w-4" /> Volver
        </button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">
            {consultation?.patient?.fullName ?? 'Videoconsulta'}
          </span>
          {consultation?.patientId && (
            <Link
              to={`/profesional/paciente/${consultation.patientId}`}
              target="_blank"
              rel="noreferrer"
              title="Ver perfil del paciente"
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-border-default text-text-secondary hover:text-brand hover:border-brand transition-colors"
            >
              <User className="h-3 w-3" /> Perfil
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSplitScreen(s => !s)}
            title={splitScreen ? 'Pantalla completa' : 'Ver historia clínica'}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
              splitScreen
                ? 'border-brand bg-brand text-white'
                : 'border-border-default text-text-secondary hover:text-brand hover:border-brand'
            }`}
          >
            {splitScreen ? <ArrowsIn className="h-3.5 w-3.5" /> : <ArrowsOut className="h-3.5 w-3.5" />}
            {splitScreen ? 'Ocultar historial' : 'Historia clínica'}
          </button>
          <button
            onClick={() => setCloseModal(true)}
            className="btn-danger flex items-center gap-2 px-4 py-2 text-sm"
          >
            <PhoneSlash className="h-4 w-4" />
            Finalizar
          </button>
        </div>
      </div>

      {/* Split layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* VideoCamera */}
        <div className={`relative transition-all duration-300 ${splitScreen ? 'flex-1' : 'w-full'}`}>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-bg-primary z-10">
              <div className="text-center space-y-3">
                <div className="h-10 w-10 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-sm text-text-secondary">Conectando sala…</p>
              </div>
            </div>
          )}
          <div ref={containerRef} className="w-full h-full" />
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
