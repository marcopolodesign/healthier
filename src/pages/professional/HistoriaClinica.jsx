import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Plus, Stethoscope, CircleNotch, Check,
  User, Pill, TestTube, HeartStraight, Syringe, CalendarBlank, FileArrowDown,
} from '@phosphor-icons/react'
import { historiaClinicaService } from '../../services/historiaClinicaService'
import { consultationsService } from '../../services/consultationsService'
import PatientConsultationList from '../../components/professional/PatientConsultationList'
import PreconsultaSummary, { hasPreconsulta } from '../../components/professional/PreconsultaSummary'
import { clinicalService } from '../../services/clinicalService'
import { profilesService } from '../../services/profilesService'
import { diagnosticReportService } from '../../services/diagnosticReportService'
import SignedDocLink from '../../components/SignedDocLink'
import { toast } from '../../components/Toast'
import { useEspecialidades } from '../../hooks/useEspecialidades'
import { rangoDe, textoRango, estadoDe, estaAnalizado } from '../../lib/biomarcadores'

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

function paramColor(status) {
  if (status === 'danger') return ALERT_COLOR
  if (status === 'warning') return WARNING_COLOR
  return SAGE
}

function LabReportCard({ report }) {
  const [open, setOpen] = useState(false)
  const date = new Date(report.reportDate + 'T12:00:00')
  const dateStr = date.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
  // `estadoDe` y no el criterio propio que vivía en este archivo: con un rango
  // abierto ("HDL ≥ 40", que llega como min 40 / max 0) la cuenta vieja daba
  // "Alerta" en rojo sobre valores perfectamente normales. El paciente veía una
  // cosa en el BioVisor y el profesional otra sobre la MISMA fila.
  const analizado = estaAnalizado(report)
  const abnormal = report.parameters.filter(p => estadoDe(p) !== 'normal')
  return (
    <div className="card p-4 space-y-3">
      <button className="w-full flex items-center justify-between gap-3 text-left" onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
            <Stethoscope size={18} className="text-brand" />
          </div>
          <div>
            {/* El tipo de estudio manda sobre la fecha, igual que del lado del
                paciente: dos hemogramas y una tiroidea se ven idénticos si sólo
                se muestra la fecha. */}
            <p className="font-semibold text-text-primary text-sm">{report.studyType || 'Análisis'}</p>
            {/* Un estudio sin analizar tiene `parameters: []`, y con el texto
                anterior se leía "0 parámetros · todos normales": exactamente lo
                contrario de lo que pasa, que es que nadie lo leyó todavía. */}
            <p className="text-xs text-text-secondary">
              {dateStr} · {analizado
                ? <>{report.parameters.length} parámetros · {abnormal.length > 0
                    ? <span className="text-amber-600">{abnormal.length} fuera de rango</span>
                    : <span className="text-green-600">todos normales</span>}</>
                : <span className="text-text-tertiary">documento sin analizar</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {abnormal.slice(0, 3).map(p => (
            <span key={p.id} className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: paramColor(estadoDe(p)) + '20', color: paramColor(estadoDe(p)) }}>
              {p.name}
            </span>
          ))}
          <Plus size={14} className={`text-text-secondary transition-transform ${open ? 'rotate-45' : ''}`} />
        </div>
      </button>
      {open && (
        <div className="pt-2 border-t border-border-default grid gap-2">
          {/* El estudio original, no sólo los valores que extrajo el BioVisor:
              sin el PDF no hay forma de contrastar un valor raro contra el
              informe real, ni de leer lo que el extractor no parsea
              (observaciones del bioquímico, método, muestra). */}
          {report.documentUrl && (
            <SignedDocLink
              bucket="patient-docs"
              url={report.documentUrl}
              className="text-xs text-brand font-medium hover:underline inline-flex items-center gap-1 mb-1"
            >
              <FileArrowDown size={14} /> Ver estudio original (PDF)
            </SignedDocLink>
          )}
          {report.parameters.map(p => {
            const st = estadoDe(p)
            const col = paramColor(st)
            const label = { normal: 'Normal', warning: 'Atención', danger: 'Alerta' }[st]
            const badge = { normal: 'bg-green-100 text-green-700', warning: 'bg-amber-100 text-amber-700', danger: 'bg-red-100 text-red-700' }[st]
            return (
              <div key={p.id} className="flex items-center gap-2 text-sm">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: col }} />
                <span className="text-text-primary flex-1 min-w-0 truncate">{p.name}</span>
                <span className="font-bold shrink-0" style={{ color: col }}>{p.value} {p.unit}</span>
                {/* Crudo se leía "(40–0)" en cada rango abierto. */}
                <span className="text-xs text-text-secondary shrink-0">({textoRango(rangoDe(p))})</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium shrink-0 ${badge}`}>{label}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function EncounterCard({ encounter, notaDeCierre }) {
  const { porSlug } = useEspecialidades()
  const [open, setOpen] = useState(true)
  const d = new Date(encounter.startedAt || encounter.createdAt)
  const dateStr = d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
  const timeStr = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  const specialty = porSlug[encounter.specialty] || encounter.specialty
  const proName = encounter.professional?.fullName || encounter.professional?.full_name

  const entries = encounter.entries ?? []
  const conditions = encounter.conditions ?? []
  const medications = encounter.medications ?? []
  const totalItems = entries.length + conditions.length + medications.length

  const rootEntries = entries.filter(e => !e.correctsEntryId)
  const addendaByParent = entries
    .filter(e => e.correctsEntryId)
    .reduce((acc, e) => {
      (acc[e.correctsEntryId] ??= []).push(e)
      return acc
    }, {})

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
          {/* Entries — addenda render nested under the entry they correct
              (clinical_entries is append-only, so a correction is always a
              new row referencing corrects_entry_id, not an edit in place) */}
          {rootEntries.map(entry => {
            const color = ENTRY_COLORS[entry.entryType] ?? SAGE
            const addenda = addendaByParent[entry.id] ?? []
            return (
              <div key={entry.id}>
                <div className="flex gap-2.5">
                  <span className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ background: color }} />
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                      {ENTRY_TYPE_LABELS[entry.entryType] ?? entry.entryType}
                    </span>
                    <p className="text-sm text-text-primary whitespace-pre-wrap mt-0.5">{entry.content}</p>
                  </div>
                </div>
                {addenda.map(addendum => (
                  <div key={addendum.id} className="flex gap-2.5 ml-6 mt-2 pl-2.5 border-l-2 border-border-default">
                    <span className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ background: ENTRY_COLORS.addendum }} />
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                        {ENTRY_TYPE_LABELS.addendum} — corrige la nota de arriba
                      </span>
                      <p className="text-sm text-text-primary whitespace-pre-wrap mt-0.5">{addendum.content}</p>
                    </div>
                  </div>
                ))}
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

          {/* Nota de cierre de la consulta, para los encuentros viejos que no la
              tienen asentada como entrada. Se marca de dónde sale para no hacerla
              pasar por un asiento firmado de la HC. */}
          {notaDeCierre && (
            <div className="flex gap-2.5">
              <span className="w-2 h-2 rounded-full shrink-0 mt-1.5 bg-text-tertiary" />
              <div className="min-w-0">
                <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                  Nota de cierre de la consulta
                </span>
                <p className="text-sm text-text-primary whitespace-pre-wrap mt-0.5">{notaDeCierre}</p>
              </div>
            </div>
          )}

          {totalItems === 0 && !notaDeCierre && (
            <p className="text-xs text-text-secondary italic">Encuentro sin registros todavía.</p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Una consulta que NO tiene encuentro clínico.
 *
 * La HC se armaba sólo con `clinical_encounters`, y el encuentro se crea recién
 * cuando alguien escribe algo clínico. Resultado: una consulta atendida y cerrada,
 * con su nota de cierre y su pre-consulta, no aparecía en la historia clínica —
 * que es exactamente la queja de Mateo al abrir esta pantalla y verla vacía.
 *
 * Estos datos viven en `consultations` (columnas editables, fuera de la HC formal).
 * Desde el 2026-07-29 las notas nuevas se asientan además como entradas firmadas,
 * pero lo anterior no se migró: esta tarjeta es la que hace visible ese historial
 * sin inventarle un encuentro retroactivo que nadie firmó.
 */
function ConsultaSinEncuentroCard({ consulta }) {
  const d = consulta.scheduledAt ? new Date(consulta.scheduledAt) : null
  const preconsulta = consulta.preconsultaData

  return (
    <div className="card p-0 overflow-hidden border-dashed">
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-bg-surface border border-border-default flex items-center justify-center shrink-0">
            <CalendarBlank size={16} className="text-text-tertiary" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-text-primary text-sm truncate">
              {consulta.modality === 'video' ? 'Videollamada' : 'Presencial'}
              {consulta.consultationType?.name ? ` · ${consulta.consultationType.name}` : ''}
            </p>
            <p className="text-xs text-text-tertiary">
              {d ? d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Sin fecha'}
              {' · '}
              <Link to={`/profesional/consulta/${consulta.id}`} className="text-brand hover:underline">
                ver consulta
              </Link>
            </p>
          </div>
        </div>
        <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide shrink-0">
          Sin registro clínico
        </span>
      </div>

      {(consulta.closingNotes || hasPreconsulta(preconsulta)) && (
        <div className="border-t border-border-default px-4 py-3 space-y-2">
          {consulta.closingNotes && (
            <div>
              <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                Nota de cierre
              </span>
              <p className="text-sm text-text-primary whitespace-pre-wrap mt-0.5">{consulta.closingNotes}</p>
            </div>
          )}
          {hasPreconsulta(preconsulta) && <PreconsultaSummary preconsulta={preconsulta} />}
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
  const [consultas, setConsultas] = useState([])
  const [loadingConsultas, setLoadingConsultas] = useState(true)
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

  // Las consultas son parte de la historia: una consulta cerrada con su nota es un
  // acto médico, tenga o no un encuentro clínico creado.
  useEffect(() => {
    if (!profile?.id || !patientId) { setLoadingConsultas(false); return }
    setLoadingConsultas(true)
    consultationsService.getByPatientForProfessional(patientId, profile.id)
      .then(setConsultas)
      .catch(() => {})
      .finally(() => setLoadingConsultas(false))
  }, [profile?.id, patientId])

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

  // Un encuentro por consulta como máximo (índice único, migración 076), así que
  // emparejar por `consultationId` es suficiente y no hace falta desambiguar.
  const timeline = (() => {
    const consultaDe = id => consultas.find(c => c.id === id)
    const conEncuentro = new Set(encounters.map(e => e.consultationId).filter(Boolean))

    const items = [
      ...encounters.map(enc => {
        const c = enc.consultationId ? consultaDe(enc.consultationId) : null
        // La nota de cierre se muestra salvo que YA esté asentada como entrada.
        // Se compara contra la entrada concreta —las cerradas desde el 2026-07-29
        // llevan `data.source = 'cierre_de_consulta'`, y para las viejas se compara
        // el contenido— y no contra "¿tiene alguna entrada?": ese atajo escondía la
        // nota de cierre en cuanto el encuentro tuviera cualquier otra cosa, como
        // la pre-consulta.
        const nota = c?.closingNotes?.trim()
        const yaAsentada = nota && (enc.entries ?? []).some(e =>
          e.data?.source === 'cierre_de_consulta' || e.content?.trim() === nota
        )
        return {
          tipo: 'encuentro',
          id: enc.id,
          fecha: new Date(enc.startedAt || enc.createdAt).getTime(),
          data: enc,
          notaDeCierre: nota && !yaAsentada ? nota : null,
        }
      }),
      ...consultas
        .filter(c => !conEncuentro.has(c.id))
        // Un turno futuro o cancelado sin nada escrito no es historia clínica: es
        // agenda. Vive en la pestaña "Turnos previos".
        .filter(c => c.closingNotes || hasPreconsulta(c.preconsultaData))
        .map(c => ({
          tipo: 'consulta',
          id: c.id,
          fecha: new Date(c.scheduledAt || c.createdAt).getTime(),
          data: c,
        })),
    ]
    return items.sort((a, b) => b.fecha - a.fecha)
  })()

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
      <div className="flex border-b border-border-default overflow-x-auto">
        {[
          { key: 'notas', label: 'Notas clínicas' },
          { key: 'turnos', label: `Turnos previos${consultas.length > 0 ? ` (${consultas.length})` : ''}` },
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

      {/* Notas tab — encuentros clínicos Y consultas sin encuentro, en una sola
          línea de tiempo ordenada por fecha. Separarlos en dos listas obligaría al
          profesional a reconstruir el orden en la cabeza. */}
      {activeTab === 'notas' && (
        <>
          {timeline.length === 0 ? (
            <div className="text-center py-16 text-text-secondary">
              <User className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Sin historia clínica</p>
              <p className="text-sm mt-1">Agregá la primera nota usando el botón de arriba.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {timeline.map(item => item.tipo === 'encuentro'
                ? <EncounterCard key={item.id} encounter={item.data} notaDeCierre={item.notaDeCierre} />
                : <ConsultaSinEncuentroCard key={item.id} consulta={item.data} />
              )}
            </div>
          )}
        </>
      )}

      {/* Turnos previos */}
      {activeTab === 'turnos' && (
        <PatientConsultationList
          consultations={consultas}
          loading={loadingConsultas}
          emptyHint="Sólo se ven los turnos que tuviste vos con este paciente."
        />
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
