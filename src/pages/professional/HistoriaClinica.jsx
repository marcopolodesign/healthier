import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Plus, Stethoscope, CircleNotch, Check,
  User, Pill, TestTube, HeartStraight, Syringe,
} from '@phosphor-icons/react'
import { historiaClinicaService } from '../../services/historiaClinicaService'
import { clinicalService } from '../../services/clinicalService'
import { profilesService } from '../../services/profilesService'
import { diagnosticReportService } from '../../services/diagnosticReportService'
import { toast } from '../../components/Toast'
import { SPECIALTY_LABELS } from '../../lib/verticals'

const SAGE = '#7CB38B'
const WARNING_COLOR = '#E4A853'
const ALERT_COLOR = '#D9534F'

const ENTRY_TYPE_LABELS = {
  note:             'Nota',
  diagnosis:        'Diagnóstico',
  indication:       'Indicación',
  prescription_ref: 'Receta',
  addendum:         'Addendum',
}

const ENTRY_COLORS = {
  note:             SAGE,
  diagnosis:        '#9B8EC4',
  indication:       '#E8927C',
  prescription_ref: '#5B8DB8',
  addendum:         '#95A5A6',
}

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

function EncounterCard({ encounter }) {
  const [open, setOpen] = useState(true)
  const d = new Date(encounter.startedAt || encounter.createdAt)
  const dateStr = d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
  const timeStr = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  const specialty = SPECIALTY_LABELS[encounter.specialty] || encounter.specialty
  const proName = encounter.professional?.fullName || encounter.professional?.full_name

  const entries = encounter.entries ?? []
  const conditions = encounter.conditions ?? []
  const medications = encounter.medications ?? []
  const totalItems = entries.length + conditions.length + medications.length

  return (
    <div className="card p-0 overflow-hidden">
      {/* Encounter header */}
      <button
        className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-bg-surface/50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
            <Stethoscope size={16} className="text-brand" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-text-primary text-sm truncate">{specialty}</p>
            <p className="text-xs text-text-tertiary">{dateStr} · {timeStr}{proName ? ` · ${proName}` : ''}</p>
          </div>
        </div>
        <span className="text-xs text-text-secondary shrink-0">
          {totalItems} registro{totalItems !== 1 ? 's' : ''}
        </span>
      </button>

      {open && (
        <div className="border-t border-border-default px-4 py-3 space-y-3">
          {/* Entries */}
          {entries.map(entry => {
            const color = ENTRY_COLORS[entry.entryType] ?? SAGE
            return (
              <div key={entry.id} className="flex gap-2.5">
                <span className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ background: color }} />
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                    {ENTRY_TYPE_LABELS[entry.entryType] ?? entry.entryType}
                  </span>
                  <p className="text-sm text-text-primary whitespace-pre-wrap mt-0.5">{entry.content}</p>
                </div>
              </div>
            )
          })}

          {/* Conditions */}
          {conditions.map(c => (
            <div key={c.id} className="flex gap-2.5 items-start">
              <HeartStraight size={14} className="text-lavender shrink-0 mt-1" />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Diagnóstico</span>
                <p className="text-sm text-text-primary mt-0.5">{c.icd10Display || c.icd10Code}</p>
              </div>
            </div>
          ))}

          {/* Medications */}
          {medications.map(m => (
            <div key={m.id} className="flex gap-2.5 items-start">
              <Pill size={14} className="text-coral shrink-0 mt-1" />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Medicación</span>
                <p className="text-sm text-text-primary mt-0.5">{m.medicationName}{m.dosageText ? ` — ${m.dosageText}` : ''}</p>
              </div>
            </div>
          ))}

          {totalItems === 0 && (
            <p className="text-xs text-text-secondary italic">Encuentro sin registros todavía.</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function HistoriaClinica({ profile }) {
  const { patientId } = useParams()
  const navigate = useNavigate()

  const [patient, setPatient] = useState(null)
  const [encounters, setEncounters] = useState([])
  const [allergies, setAllergies] = useState([])
  const [labReports, setLabReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('notas')

  const [showForm, setShowForm] = useState(false)
  const [encounterId, setEncounterId] = useState(null)
  const [form, setForm] = useState({ entryType: 'note', content: '' })
  const [submitting, setSubmitting] = useState(false)

  const pp = profile?.professionalProfiles?.[0]
  const licenseType = pp?.licenseType ?? 'MN'
  const licenseNumber = pp?.licenseNumber ?? '0'
  const specialty = pp?.specialty ?? 'otra'

  useEffect(() => {
    Promise.all([
      profilesService.getById(patientId),
      historiaClinicaService.getPatientTimeline(patientId),
      diagnosticReportService.getByPatient(patientId),
    ])
      .then(([p, timeline, labs]) => {
        setPatient(p)
        setEncounters(timeline.encounters)
        setAllergies(timeline.allergies)
        setLabReports(labs)
      })
      .catch(() => toast.error('Error al cargar la historia clínica'))
      .finally(() => setLoading(false))
  }, [patientId])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.content.trim()) return
    setSubmitting(true)
    try {
      let eid = encounterId
      if (!eid) {
        const enc = await clinicalService.createEncounter({
          patientId,
          professionalId: profile.id,
          specialty,
          modality: 'presencial',
          licenseType,
          licenseNumber,
        })
        eid = enc.id
        setEncounterId(eid)
        setEncounters(prev => [{ ...enc, entries: [], conditions: [], medications: [] }, ...prev])
      }
      const entry = await clinicalService.addEntry(eid, {
        patientId,
        professionalId: profile.id,
        entryType: form.entryType,
        content: form.content,
        licenseType,
        licenseNumber,
      })
      setEncounters(prev => prev.map(enc =>
        enc.id === eid ? { ...enc, entries: [...(enc.entries ?? []), entry] } : enc
      ))
      setForm(f => ({ ...f, content: '' }))
      setShowForm(false)
      toast.success('Nota guardada en la HC')
    } catch {
      toast.error('Error al guardar')
    } finally {
      setSubmitting(false)
    }
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
          <button onClick={() => setShowForm(s => !s)} className="btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" /> Nueva nota
          </button>
        )}
      </div>

      {/* Allergies strip */}
      {allergies.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Syringe size={14} className="text-red-500 shrink-0" />
          <span className="text-xs font-semibold text-red-600 uppercase tracking-wide">Alergias:</span>
          {allergies.map((a, i) => (
            <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-100">
              {a.substance}
            </span>
          ))}
        </div>
      )}

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

      {/* New note form */}
      {activeTab === 'notas' && showForm && (
        <form onSubmit={handleSubmit} className="card p-5 space-y-4 border-brand/30">
          <h2 className="font-semibold text-text-primary flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-brand" /> Agregar nota clínica
          </h2>
          <div>
            <label className="form-label">Tipo</label>
            <select
              className="form-select"
              value={form.entryType}
              onChange={e => setForm(f => ({ ...f, entryType: e.target.value }))}
            >
              {Object.entries(ENTRY_TYPE_LABELS).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Contenido *</label>
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
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={submitting} className="btn-primary flex items-center gap-2">
              {submitting ? <CircleNotch className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Guardar
            </button>
          </div>
        </form>
      )}

      {/* Notas tab */}
      {activeTab === 'notas' && (
        <>
          {encounters.length === 0 ? (
            <div className="text-center py-16 text-text-secondary">
              <User className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Sin notas clínicas</p>
              <p className="text-sm mt-1">Agregá la primera nota usando el botón de arriba.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {encounters.map(enc => (
                <EncounterCard key={enc.id} encounter={enc} />
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
              <TestTube className="h-12 w-12 mx-auto mb-3 opacity-30" />
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
