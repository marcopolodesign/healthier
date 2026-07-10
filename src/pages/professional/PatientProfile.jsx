import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, User, Heartbeat, Phone, Envelope, MapPin,
  Drop, ShieldCheck, ClipboardText, CircleNotch,
  CalendarPlus, UserPlus, Trash, Clock,
} from '@phosphor-icons/react'
import { profilesService } from '../../services/profilesService'
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
  'O Positivo': 'bg-red-50 text-red-700 border-red-200',
  'O Negativo': 'bg-red-50 text-red-700 border-red-200',
  'A Positivo': 'bg-blue-50 text-blue-700 border-blue-200',
  'A Negativo': 'bg-blue-50 text-blue-700 border-blue-200',
  'B Positivo': 'bg-purple-50 text-purple-700 border-purple-200',
  'B Negativo': 'bg-purple-50 text-purple-700 border-purple-200',
  'AB Positivo': 'bg-amber-50 text-amber-700 border-amber-200',
  'AB Negativo': 'bg-amber-50 text-amber-700 border-amber-200',
}

export default function ProfessionalPatientProfile({ profile }) {
  const { patientId } = useParams()
  const navigate = useNavigate()
  const [patient, setPatient] = useState(null)
  const [loading, setLoading] = useState(true)

  // ── Seguimiento (follow-up + cross-recommend) ──────────────────────────
  const [followups, setFollowups] = useState([])
  const [otherPros, setOtherPros] = useState([])
  const [followUpDate, setFollowUpDate] = useState('')
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
      const created = await followupsService.create({
        professionalId: profile.id,
        patientId,
        followUpDate: followUpDate || null,
        note: followUpNote,
        recommendedProfessionalId: recommendedProId || null,
      })
      setFollowups(prev => [created, ...prev])
      setFollowUpDate('')
      setFollowUpNote('')
      setRecommendedProId('')
      toast.success('Seguimiento guardado')
    } catch {
      toast.error('Error al guardar el seguimiento')
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
      <Section icon={User} title="Información básica">
        <div className="grid grid-cols-2 gap-4">
          <InfoRow label="Teléfono" value={patient.phone} />
          <InfoRow label="Email" value={patient.email} />
        </div>
        <InfoRow label="Domicilio" value={patient.address} />
      </Section>

      {/* ── Perfil clínico ── */}
      <Section icon={Heartbeat} title="Perfil clínico">
        <div className="grid grid-cols-2 gap-4">
          <InfoRow label="DNI" value={patient.dni} />
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
        </div>
        <div className="grid grid-cols-2 gap-4">
          <InfoRow label="Obra social" value={patient.insuranceName} />
          <InfoRow label="N° afiliado" value={patient.insuranceNum} />
        </div>
      </Section>

      {/* ── Contacto de emergencia ── */}
      <Section
        icon={Phone}
        title="Contacto de emergencia"
        iconColor="text-red-500"
        bgColor="bg-red-50"
      >
        {patient.emergencyName || patient.emergencyPhone ? (
          <div className="space-y-4">
            <InfoRow label="Nombre" value={patient.emergencyName} />
            <div className="grid grid-cols-2 gap-4">
              <InfoRow label="Teléfono" value={patient.emergencyPhone} />
              <InfoRow label="Vínculo" value={patient.emergencyRel} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-secondary">Sin contacto de emergencia registrado.</p>
        )}
      </Section>

      {/* ── Seguimiento — programar follow-up y/o recomendar otro profesional ── */}
      <Section icon={CalendarPlus} title="Seguimiento" iconColor="text-brand-tertiary" bgColor="bg-brand-tertiary/10">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[11px] font-bold text-text-tertiary uppercase tracking-widest block mb-1">
              Próximo control
            </label>
            <input
              type="date"
              value={followUpDate}
              onChange={e => setFollowUpDate(e.target.value)}
              className="form-input text-sm"
            />
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
          {savingFollowup ? 'Guardando...' : 'Guardar seguimiento'}
        </button>

        {followups.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-border-default">
            {followups.map(f => (
              <div key={f.id} className="flex items-start gap-3 py-1.5">
                <div className="flex-1 min-w-0">
                  {f.followUpDate && (
                    <p className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                      <Clock className="h-3.5 w-3.5 text-brand-tertiary shrink-0" />
                      Control: {new Date(f.followUpDate + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}
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
