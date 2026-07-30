import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, User, Heartbeat, Phone,
  Drop, ShieldCheck, ClipboardText, CircleNotch,
  CalendarPlus, UserPlus, Trash, Clock, CalendarBlank,
} from '@phosphor-icons/react'
import { profilesService } from '../../services/profilesService'
import { consultationsService } from '../../services/consultationsService'
import PatientConsultationList from '../../components/professional/PatientConsultationList'
import { followupsService } from '../../services/followupsService'
import { professionalService } from '../../services/professionalService'
import { toast } from '../../components/Toast'

function InfoRow({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-bold text-text-tertiary uppercase tracking-widest">{label}</span>
      <span className="text-sm font-medium text-text-primary">{value || '—'}</span>
    </div>
  )
}

function Section({ icon: Icon, title, iconColor = 'text-brand', bgColor = 'bg-brand-muted', children }) {
  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${bgColor}`}>
          <Icon className={`h-4 w-4 ${iconColor}`} />
        </div>
        <h2 className="font-semibold text-text-primary">{title}</h2>
      </div>
      {children}
    </div>
  )
}

const BLOOD_TYPE_COLORS = {
  'O+':  'bg-red-50 text-red-700 border-red-200',
  'O-':  'bg-red-50 text-red-700 border-red-200',
  'A+':  'bg-blue-50 text-blue-700 border-blue-200',
  'A-':  'bg-blue-50 text-blue-700 border-blue-200',
  'B+':  'bg-purple-50 text-purple-700 border-purple-200',
  'B-':  'bg-purple-50 text-purple-700 border-purple-200',
  'AB+': 'bg-amber-50 text-amber-700 border-amber-200',
  'AB-': 'bg-amber-50 text-amber-700 border-amber-200',
}

export default function ProfessionalPatientProfile({ profile }) {
  const { patientId } = useParams()
  const navigate = useNavigate()
  const [patient, setPatient] = useState(null)
  const [loading, setLoading] = useState(true)

  // ── Seguimiento (follow-up + cross-recommend) ──────────────────────────
  const [consultas, setConsultas] = useState([])
  const [loadingConsultas, setLoadingConsultas] = useState(true)

  const [followups, setFollowups] = useState([])
  const [otherPros, setOtherPros] = useState([])
  const [followUpDate, setFollowUpDate] = useState('')
  // Modalidad del turno de seguimiento. Arranca en la de la última consulta con
  // este paciente: si lo venís atendiendo por video, lo más probable es que el
  // control también sea por video.
  const [followUpModality, setFollowUpModality] = useState('video')
  const [followUpNote, setFollowUpNote] = useState('')
  const [recommendedProId, setRecommendedProId] = useState('')
  const [savingFollowup, setSavingFollowup] = useState(false)

  useEffect(() => {
    profilesService.getById(patientId)
      .then(setPatient)
      .catch(() => toast.error('Error al cargar el perfil del paciente'))
      .finally(() => setLoading(false))
  }, [patientId])

  useEffect(() => {
    if (!profile?.id || !patientId) { setLoadingConsultas(false); return }
    setLoadingConsultas(true)
    consultationsService.getByPatientForProfessional(patientId, profile.id)
      .then(cs => {
        setConsultas(cs)
        if (cs[0]?.modality) setFollowUpModality(cs[0].modality)
      })
      .catch(() => {})
      .finally(() => setLoadingConsultas(false))
  }, [profile?.id, patientId])

  useEffect(() => {
    if (!profile?.id || !patientId) return
    followupsService.getByPatient(profile.id, patientId)
      .then(setFollowups)
      .catch(() => {})
    professionalService.search({})
      .then(pros => setOtherPros(pros.filter(p => p.userId !== profile.id)))
      .catch(() => {})
  }, [profile?.id, patientId])

  const saveFollowup = async () => {
    if (!followUpDate && !recommendedProId) {
      toast.error('Elegí una fecha de seguimiento o un profesional para recomendar')
      return
    }
    setSavingFollowup(true)
    try {
      // Con fecha, el seguimiento AGENDA EL TURNO — mismo mecanismo que "Agendar
      // próxima consulta" en el detalle de la consulta (decisión de Mateo,
      // 2026-07-30). Antes sólo escribía una fila que no veía nadie: ni el
      // paciente (la RLS es sólo del profesional), ni un cron, ni la agenda.
      let consulta = null
      if (followUpDate) {
        consulta = await consultationsService.create({
          patientId,
          professionalId: profile.id,
          scheduledAt: new Date(followUpDate).toISOString(),
          modality: followUpModality,
          status: 'confirmed',
        }, { bookedBy: 'professional' })
      }

      const created = await followupsService.create({
        professionalId: profile.id,
        patientId,
        // Se guarda sólo la fecha: la hora exacta vive en la consulta.
        followUpDate: followUpDate ? followUpDate.slice(0, 10) : null,
        note: followUpNote,
        recommendedProfessionalId: recommendedProId || null,
        consultationId: consulta?.id ?? null,
      })

      setFollowups(prev => [{ ...created, consultation: consulta }, ...prev])
      if (consulta) setConsultas(prev => [consulta, ...prev])
      setFollowUpDate('')
      setFollowUpNote('')
      setRecommendedProId('')
      toast.success(consulta ? 'Turno de control agendado' : 'Recomendación guardada')
    } catch (err) {
      toast.error(err?.message ?? 'Error al guardar el seguimiento')
    } finally {
      setSavingFollowup(false)
    }
  }

  const deleteFollowup = async id => {
    try {
      await followupsService.delete(id)
      setFollowups(prev => prev.filter(f => f.id !== id))
    } catch {
      toast.error('Error al eliminar')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <CircleNotch className="h-6 w-6 animate-spin text-brand" />
      </div>
    )
  }

  if (!patient) {
    return (
      <div className="text-center py-20 text-text-secondary">
        Perfil no encontrado
      </div>
    )
  }

  const bloodTypeClass = BLOOD_TYPE_COLORS[patient.bloodType] ?? 'bg-bg-surface text-text-primary border-border-default'

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto pb-12">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-text-secondary hover:text-brand">
        <ArrowLeft className="h-4 w-4" /> Volver
      </button>

      {/* ── Header ── */}
      <div className="card flex items-center gap-5">
        <div className="w-16 h-16 rounded-full bg-brand-muted flex items-center justify-center shrink-0 overflow-hidden">
          {patient.avatarUrl
            ? <img src={patient.avatarUrl} alt={patient.fullName} className="w-full h-full object-cover" />
            : <User className="h-7 w-7 text-brand" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-text-primary truncate">{patient.fullName || '—'}</h1>
          <p className="text-sm text-text-secondary">{patient.email}</p>
          {patient.bloodType && (
            <span className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${bloodTypeClass}`}>
              <Drop className="h-3 w-3" />
              {patient.bloodType}
            </span>
          )}
        </div>
      </div>

      {/* ── Información básica ── */}
      {/* El DNI vive acá y no en "perfil clínico": es el dato de identidad con el
          que se emite la receta, no un dato clínico. */}
      <Section icon={User} title="Información básica">
        <div className="grid grid-cols-2 gap-4">
          <InfoRow label="DNI" value={patient.dni} />
          <InfoRow label="Teléfono" value={patient.phone} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <InfoRow label="Email" value={patient.email} />
          <InfoRow
            label="Fecha de nacimiento"
            value={patient.birthDate
              ? new Date(patient.birthDate + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
              : null}
          />
        </div>
        <InfoRow label="Domicilio" value={patient.address} />

        {/* Contacto de emergencia: sólo si existe. Antes tenía tarjeta propia y
            estaba vacío en 26 de 29 pacientes, así que ocupaba una pantalla entera
            para decir "no hay". El dato igual importa —Healthier hace visitas
            presenciales y urgencias— así que se conserva, pero no reserva espacio
            cuando no está. */}
        {(patient.emergencyName || patient.emergencyPhone) && (
          <div className="pt-3 border-t border-border-default">
            <div className="flex items-center gap-1.5 mb-2">
              <Phone className="h-3.5 w-3.5 text-red-500" />
              <span className="text-[11px] font-bold text-red-600 uppercase tracking-widest">
                Contacto de emergencia
              </span>
            </div>
            <p className="text-sm text-text-primary">
              {patient.emergencyName || '—'}
              {patient.emergencyRel && (
                <span className="text-text-secondary"> ({patient.emergencyRel})</span>
              )}
              {patient.emergencyPhone && (
                <span className="text-text-secondary"> · {patient.emergencyPhone}</span>
              )}
            </p>
          </div>
        )}
      </Section>

      {/* ── Cobertura médica ── */}
      {/* Se llamaba "Obra social" y era un renglón dentro de "perfil clínico".
          Es el mismo concepto que el resto de la app llama cobertura médica —
          incluye prepagas y particular, no sólo obras sociales. */}
      <Section icon={ShieldCheck} title="Cobertura médica">
        {patient.insuranceName ? (
          <div className="grid grid-cols-2 gap-4">
            <InfoRow label="Financiador" value={patient.insuranceName} />
            <InfoRow label="N° de afiliado" value={patient.insuranceNum} />
          </div>
        ) : (
          <p className="text-sm text-text-secondary">
            Sin cobertura cargada en el perfil.
          </p>
        )}
        {/* Aclaración que evita un error caro: la cobertura que viaja en la receta
            es la de CADA consulta, elegida del catálogo de Innovamed. Esta es la
            que el paciente guardó en su perfil y sirve como referencia. */}
        <p className="text-[11px] text-text-tertiary">
          La cobertura que se usa para emitir una receta se confirma en cada consulta,
          eligiéndola del catálogo de Innovamed.
        </p>
      </Section>

      {/* ── Perfil clínico ── */}
      <Section icon={Heartbeat} title="Perfil clínico">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-bold text-text-tertiary uppercase tracking-widest">Grupo sanguíneo</span>
          {patient.bloodType
            ? <span className={`mt-0.5 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border w-fit ${bloodTypeClass}`}>
                <Drop className="h-3 w-3" />
                {patient.bloodType}
              </span>
            : <span className="text-sm font-medium text-text-primary">—</span>
          }
        </div>
      </Section>

      {/* ── Turnos con este paciente ── */}
      {/* Faltaba por completo: se entraba a un paciente y no había forma de ver qué
          se hizo antes sin salir a "Historial" y buscarlo a mano. */}
      <Section icon={CalendarBlank} title={`Turnos${consultas.length ? ` (${consultas.length})` : ''}`}>
        <PatientConsultationList
          consultations={consultas}
          loading={loadingConsultas}
          emptyHint="Sólo se ven los turnos que tuviste vos con este paciente."
        />
      </Section>

      {/* ── Seguimiento — programar follow-up y/o recomendar otro profesional ── */}
      <Section icon={CalendarPlus} title="Seguimiento" iconColor="text-brand-tertiary" bgColor="bg-brand-tertiary/10">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[11px] font-bold text-text-tertiary uppercase tracking-widest block mb-1">
              Próximo control
            </label>
            {/* Fecha Y HORA: esto agenda un turno real, y un turno sin hora no
                existe. Antes era sólo `date` porque no agendaba nada. */}
            <input
              type="datetime-local"
              value={followUpDate}
              onChange={e => setFollowUpDate(e.target.value)}
              className="form-input text-sm"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-text-tertiary uppercase tracking-widest block mb-1">
              Modalidad
            </label>
            <select
              value={followUpModality}
              onChange={e => setFollowUpModality(e.target.value)}
              className="form-select text-sm"
            >
              <option value="video">Videollamada</option>
              <option value="presencial">Presencial</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-[11px] font-bold text-text-tertiary uppercase tracking-widest block mb-1">
            Recomendar profesional
          </label>
          <select
            value={recommendedProId}
            onChange={e => setRecommendedProId(e.target.value)}
            className="form-select text-sm"
          >
            <option value="">Ninguno</option>
            {otherPros.map(p => (
              <option key={p.userId} value={p.userId}>
                {p.profiles?.fullName || 'Profesional'}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] font-bold text-text-tertiary uppercase tracking-widest block mb-1">
            Nota <span className="normal-case font-normal text-text-tertiary">(opcional)</span>
          </label>
          <textarea
            value={followUpNote}
            onChange={e => setFollowUpNote(e.target.value)}
            rows={2}
            placeholder="Ej: Volvemos en 15 días a revisar análisis de sangre"
            className="form-textarea text-sm"
          />
        </div>
        <button
          onClick={saveFollowup}
          disabled={savingFollowup}
          className="btn-primary w-full py-2.5 flex items-center justify-center gap-2"
        >
          <CalendarPlus className="h-4 w-4" />
          {savingFollowup
            ? 'Guardando…'
            : followUpDate ? 'Agendar control' : 'Guardar recomendación'}
        </button>

        {/* Decir qué va a pasar antes de que pase: el botón crea un turno real y
            le avisa al paciente. */}
        <p className="text-[11px] text-text-tertiary">
          {followUpDate
            ? 'Se agenda el turno y le llega un aviso al paciente.'
            : 'Elegí fecha y hora para agendar el control, o sólo recomendá un profesional.'}
        </p>

        {followups.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-border-default">
            {followups.map(f => (
              <div key={f.id} className="flex items-start gap-3 py-1.5">
                <div className="flex-1 min-w-0">
                  {f.followUpDate && (
                    <p className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                      <Clock className="h-3.5 w-3.5 text-brand-tertiary shrink-0" />
                      Control: {new Date(f.followUpDate + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}
                      {f.consultation
                        ? <Link to={`/profesional/consulta/${f.consultation.id}`} className="text-brand text-xs font-semibold hover:underline">
                            ver turno
                          </Link>
                        // Los seguimientos anteriores al 2026-07-30 nunca agendaron
                        // nada: se dice, en vez de dejar creer que hay un turno.
                        : <span className="text-[11px] text-text-tertiary font-normal">(sin turno agendado)</span>}
                    </p>
                  )}
                  {f.recommendedProfessional && (
                    <p className="flex items-center gap-1.5 text-sm text-text-secondary mt-0.5">
                      <UserPlus className="h-3.5 w-3.5 text-brand-tertiary shrink-0" />
                      Recomendado: {f.recommendedProfessional.fullName}
                    </p>
                  )}
                  {f.note && <p className="text-xs text-text-tertiary mt-0.5">{f.note}</p>}
                </div>
                <button onClick={() => deleteFollowup(f.id)} className="p-1 text-text-muted hover:text-danger transition-colors shrink-0">
                  <Trash className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Historia clínica link ── */}
      <Link
        to={`/profesional/historia-clinica/${patientId}`}
        className="btn-secondary w-full py-3 flex items-center justify-center gap-2"
      >
        <ClipboardText className="h-5 w-5" />
        Ver historia clínica
      </Link>
    </div>
  )
}
