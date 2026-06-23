import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, Lock, Globe,
  User, Stethoscope, CircleNotch, Trash, PencilSimple, Check, X, Clock,
} from '@phosphor-icons/react'
import { historiaClinicaService } from '../../services/historiaClinicaService'
import { profilesService } from '../../services/profilesService'
import { diagnosticReportService } from '../../services/diagnosticReportService'
import { toast } from '../../components/Toast'
import { SPECIALTIES, SPECIALTY_COLORS } from '../../lib/specialties'

const SAGE = '#7CB38B'
const WARNING_COLOR = '#E4A853'
const ALERT_COLOR = '#D9534F'

function paramStatus(value, min, max) {
  if (value >= min && value <= max) return 'normal'
  const range = max - min
  const margin = range * 0.25
  return (value < min - margin || value > max + margin) ? 'danger' : 'warning'
}

function paramColor(status) {
  if (status === 'danger') return ALERT_COLOR
  if (status === 'warning') return WARNING_COLOR
  return SAGE
}

function LabReportCard({ report }) {
  const [open, setOpen] = useState(false)
  const date = new Date(report.reportDate + 'T12:00:00')
  const dateStr = date.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
  const abnormal = report.parameters.filter(p => paramStatus(p.value, p.min, p.max) !== 'normal')
  return (
    <div className="card p-4 space-y-3">
      <button className="w-full flex items-center justify-between gap-3 text-left" onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
            <Stethoscope size={18} className="text-brand" />
          </div>
          <div>
            <p className="font-semibold text-text-primary text-sm">{dateStr}</p>
            <p className="text-xs text-text-secondary">{report.parameters.length} parámetros · {abnormal.length > 0 ? <span className="text-amber-600">{abnormal.length} fuera de rango</span> : <span className="text-green-600">todos normales</span>}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {abnormal.slice(0, 3).map(p => (
            <span key={p.id} className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: paramColor(paramStatus(p.value, p.min, p.max)) + '20', color: paramColor(paramStatus(p.value, p.min, p.max)) }}>
              {p.name}
            </span>
          ))}
          <Plus size={14} className={`text-text-secondary transition-transform ${open ? 'rotate-45' : ''}`} />
        </div>
      </button>
      {open && (
        <div className="pt-2 border-t border-border-default grid gap-2">
          {report.parameters.map(p => {
            const st = paramStatus(p.value, p.min, p.max)
            const col = paramColor(st)
            const label = { normal: 'Normal', warning: 'Atención', danger: 'Alerta' }[st]
            const badge = { normal: 'bg-green-100 text-green-700', warning: 'bg-amber-100 text-amber-700', danger: 'bg-red-100 text-red-700' }[st]
            return (
              <div key={p.id} className="flex items-center gap-2 text-sm">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: col }} />
                <span className="text-text-primary flex-1 min-w-0 truncate">{p.name}</span>
                <span className="font-bold shrink-0" style={{ color: col }}>{p.value} {p.unit}</span>
                <span className="text-xs text-text-secondary shrink-0">({p.min}–{p.max})</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 ${badge}`}>{label}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const MONTHS_ES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
]
const MONTHS_LONG = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function dateKey(isoString) {
  const d = new Date(isoString)
  return `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function NoteItem({ note, currentUserId, onDelete, onUpdate, isLast }) {
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(note.content)
  const [editType, setEditType] = useState(note.noteType)
  const [saving, setSaving] = useState(false)
  const isOwner = note.professionalId === currentUserId
  const color = SPECIALTY_COLORS[note.specialty] ?? '#95A5A6'
  const date = new Date(note.createdAt)
  const time = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })

  async function saveEdit() {
    setSaving(true)
    try {
      const updated = await historiaClinicaService.updateNote(note.id, {
        content: editContent,
        noteType: editType,
      })
      onUpdate(updated)
      setEditing(false)
      toast.success('Nota actualizada')
    } catch {
      toast.error('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className={`relative pl-6 ${isLast ? '' : 'pb-5'}`}>
      {/* Dot on the spine */}
      <span
        className="absolute left-0 top-2 w-3 h-3 rounded-full border-2 border-white ring-1 ring-border-default z-10"
        style={{ background: color }}
      />

      {/* Time badge */}
      <div className="flex items-center gap-1.5 mb-2">
        <Clock className="h-3 w-3 text-text-tertiary" />
        <span className="text-[11px] font-semibold text-text-tertiary tracking-wide">{time}</span>
        {note.professional?.fullName && (
          <>
            <span className="text-text-tertiary text-[11px]">·</span>
            <span className="text-[11px] text-text-tertiary">{note.professional.fullName}</span>
          </>
        )}
      </div>

      {/* Card */}
      <div className="rounded-xl border border-border-default bg-bg-surface p-3.5 space-y-2.5">
        {/* Card header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
            <span className="text-xs font-semibold text-text-primary truncate">{note.specialty}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {editing ? (
              <select
                value={editType}
                onChange={e => setEditType(e.target.value)}
                className="text-xs border border-border-default rounded px-1 py-0.5 bg-bg-surface text-text-primary"
              >
                <option value="internal">Interna</option>
                <option value="external">Externa</option>
              </select>
            ) : (
              <span className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium
                ${note.noteType === 'external'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-amber-100 text-amber-700'}`}
              >
                {note.noteType === 'external'
                  ? <><Globe className="h-3 w-3" />Externa</>
                  : <><Lock className="h-3 w-3" />Interna</>}
              </span>
            )}
            {isOwner && !editing && (
              <>
                <button onClick={() => setEditing(true)}
                  className="p-1 rounded hover:bg-bg-muted text-text-secondary hover:text-brand">
                  <PencilSimple className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => onDelete(note.id)}
                  className="p-1 rounded hover:bg-bg-muted text-text-secondary hover:text-red-500">
                  <Trash className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            {editing && (
              <>
                <button onClick={saveEdit} disabled={saving}
                  className="p-1 rounded hover:bg-bg-muted text-green-600">
                  {saving ? <CircleNotch className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </button>
                <button onClick={() => { setEditing(false); setEditContent(note.content) }}
                  className="p-1 rounded hover:bg-bg-muted text-red-500">
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {note.title && !editing && (
          <p className="text-sm font-semibold text-text-primary">{note.title}</p>
        )}

        {editing ? (
          <textarea
            value={editContent}
            onChange={e => setEditContent(e.target.value)}
            rows={4}
            className="form-input w-full text-sm resize-none"
          />
        ) : (
          <p className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">{note.content}</p>
        )}
      </div>
    </li>
  )
}

function DateGroup({ dateStr, notes, currentUserId, onDelete, onUpdate }) {
  const d = new Date(notes[0].createdAt)
  const day = d.getDate()
  const month = MONTHS_ES[d.getMonth()]
  const monthLong = MONTHS_LONG[d.getMonth()]
  const year = d.getFullYear()
  const isCurrentYear = year === new Date().getFullYear()
  const color = SPECIALTY_COLORS[notes[0].specialty] ?? '#95A5A6'

  return (
    <div className="flex gap-4">
      {/* Date column */}
      <div className="flex flex-col items-center shrink-0 w-12 pt-1">
        <span className="text-3xl font-bold text-text-primary leading-none">{day}</span>
        <span className="text-xs font-medium text-text-secondary capitalize mt-0.5">{month}</span>
        {!isCurrentYear && (
          <span className="text-[10px] text-text-tertiary mt-0.5">{year}</span>
        )}
        {/* Vertical connector */}
        <div className="mt-3 flex-1 w-px bg-border-default min-h-4" />
      </div>

      {/* Notes timeline */}
      <div className="flex-1 pb-6">
        <ol className="relative">
          {/* Vertical spine */}
          <span className="absolute left-[5px] top-2 bottom-4 w-px bg-border-default" />
          {notes.map((note, i) => (
            <NoteItem
              key={note.id}
              note={note}
              currentUserId={currentUserId}
              onDelete={onDelete}
              onUpdate={onUpdate}
              isLast={i === notes.length - 1}
            />
          ))}
        </ol>
      </div>
    </div>
  )
}

export default function HistoriaClinica({ profile }) {
  const { patientId } = useParams()
  const navigate = useNavigate()
  const [patient, setPatient] = useState(null)
  const [notes, setNotes] = useState([])
  const [labReports, setLabReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('notas')
  const [filter, setFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    specialty: profile?.professionalProfiles?.[0]?.specialty ?? SPECIALTIES[0],
    noteType: 'internal',
    title: '',
    content: '',
  })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    Promise.all([
      profilesService.getById(patientId),
      historiaClinicaService.getPatientNotes(patientId),
      diagnosticReportService.getByPatient(patientId),
    ])
      .then(([p, n, labs]) => { setPatient(p); setNotes(n); setLabReports(labs) })
      .catch(() => toast.error('Error al cargar la historia clínica'))
      .finally(() => setLoading(false))
  }, [patientId])

  const filtered = useMemo(
    () => notes.filter(n => filter === 'all' || n.noteType === filter),
    [notes, filter]
  )

  // Group by calendar day, newest day first
  const groupedByDate = useMemo(() => {
    const map = {}
    filtered.forEach(note => {
      const key = dateKey(note.createdAt)
      map[key] = map[key] ? [...map[key], note] : [note]
    })
    // Sort keys desc (newest first); notes within each day are already sorted by service
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a))
  }, [filtered])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.content.trim()) return
    setSubmitting(true)
    try {
      const note = await historiaClinicaService.addNote({
        patientId,
        specialty: form.specialty,
        noteType: form.noteType,
        title: form.title || null,
        content: form.content,
      })
      setNotes(prev => [note, ...prev])
      setForm(f => ({ ...f, title: '', content: '' }))
      setShowForm(false)
      toast.success('Nota agregada')
    } catch {
      toast.error('Error al guardar la nota')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id) {
    try {
      await historiaClinicaService.deleteNote(id)
      setNotes(prev => prev.filter(n => n.id !== id))
      toast.success('Nota eliminada')
    } catch {
      toast.error('Error al eliminar')
    }
  }

  function handleUpdate(updated) {
    setNotes(prev => prev.map(n => n.id === updated.id ? { ...n, ...updated } : n))
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <CircleNotch className="h-8 w-8 animate-spin text-brand" />
    </div>
  )

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
      {/* Back */}
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-text-secondary hover:text-brand">
        <ArrowLeft className="h-4 w-4" /> Volver
      </button>

      {/* Page header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Historia Clínica</h1>
          {patient && (
            <div className="flex items-center gap-2 mt-1">
              <div className="w-6 h-6 rounded-full bg-brand-muted flex items-center justify-center">
                <span className="text-brand text-xs font-bold">{patient.fullName?.[0]}</span>
              </div>
              <p className="text-text-secondary text-sm">{patient.fullName}</p>
            </div>
          )}
        </div>
        {activeTab === 'notas' && (
          <button
            onClick={() => setShowForm(s => !s)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Nueva nota
          </button>
        )}
      </div>

      {/* Section tabs */}
      <div className="flex border-b border-border-default">
        {[
          { key: 'notas', label: 'Notas clínicas' },
          { key: 'laboratorio', label: `Laboratorio${labReports.length > 0 ? ` (${labReports.length})` : ''}` },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === key ? 'border-brand text-brand' : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* New note form — notas tab only */}
      {activeTab === 'notas' && showForm && (
        <form onSubmit={handleSubmit} className="card p-5 space-y-4 border-brand/30">
          <h2 className="font-semibold text-text-primary flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-brand" />
            Agregar nota clínica
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Especialidad</label>
              <select
                className="form-select"
                value={form.specialty}
                onChange={e => setForm(f => ({ ...f, specialty: e.target.value }))}
              >
                {SPECIALTIES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Visibilidad</label>
              <select
                className="form-select"
                value={form.noteType}
                onChange={e => setForm(f => ({ ...f, noteType: e.target.value }))}
              >
                <option value="internal">Interna (solo profesionales)</option>
                <option value="external">Externa (visible al paciente)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="form-label">Título (opcional)</label>
            <input
              type="text"
              className="form-input"
              placeholder="Ej: Control de presión arterial"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            />
          </div>
          <div>
            <label className="form-label">Nota *</label>
            <textarea
              className="form-input resize-none"
              rows={4}
              required
              placeholder="Escribí tu nota clínica aquí..."
              value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
              Cancelar
            </button>
            <button type="submit" disabled={submitting} className="btn-primary flex items-center gap-2">
              {submitting ? <CircleNotch className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Guardar nota
            </button>
          </div>
        </form>
      )}

      {/* Notas tab */}
      {activeTab === 'notas' && (
        <>
          {/* Filter tabs */}
          <div className="flex gap-2">
            {[
              { key: 'all', label: 'Todas' },
              { key: 'internal', label: 'Internas' },
              { key: 'external', label: 'Externas' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors
                  ${filter === key
                    ? 'bg-brand text-white'
                    : 'bg-bg-muted text-text-secondary hover:text-text-primary'}`}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto text-xs text-text-secondary self-center">
              {filtered.length} nota{filtered.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Timeline */}
          {groupedByDate.length === 0 ? (
            <div className="text-center py-16 text-text-secondary">
              <User className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Sin notas clínicas</p>
              <p className="text-sm mt-1">Agregá la primera nota usando el botón de arriba.</p>
            </div>
          ) : (
            <div>
              {groupedByDate.map(([key, dayNotes]) => (
                <DateGroup
                  key={key}
                  dateStr={key}
                  notes={dayNotes}
                  currentUserId={profile?.id}
                  onDelete={handleDelete}
                  onUpdate={handleUpdate}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Laboratorio tab */}
      {activeTab === 'laboratorio' && (
        <div className="space-y-3">
          {labReports.length === 0 ? (
            <div className="text-center py-16 text-text-secondary">
              <Stethoscope className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Sin análisis de laboratorio</p>
              <p className="text-sm mt-1">El paciente aún no ha subido reportes de laboratorio.</p>
            </div>
          ) : (
            labReports.map(r => <LabReportCard key={r.id} report={r} />)
          )}
        </div>
      )}
    </div>
  )
}
