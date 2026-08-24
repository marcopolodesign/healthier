import { CircleNotch, IdentificationCard, User, Drop, Phone, Envelope, MapPin, Heartbeat } from '@phosphor-icons/react'

/**
 * Datos de filiación del paciente — antes la sección independiente "Paciente"
 * de la planilla de la videollamada, ahora "01. Filiación" dentro de
 * `ConsultaEstructurada.jsx` (Mateo, 2026-08-24: la sección aparte se sacó,
 * este contenido se reusa tal cual como el primer bloque de la consulta
 * estructurada). Sólo lectura — se sigue editando desde el perfil del
 * paciente, no desde acá.
 */

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

export default function DatosPacienteTab({ loading, patient }) {
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
