import { useEffect, useState } from 'react'
import { useParams, useNavigate, Navigate, Link } from 'react-router-dom'
import { ArrowLeft, Ambulance, CircleNotch, LockSimple, SealCheck, Warning } from '@phosphor-icons/react'
import { ClinicalPanel } from './VideoCall'
import CloseConsultationModal from '../../components/CloseConsultationModal'
import { consultationsService } from '../../services/consultationsService'
import { emergencyService } from '../../services/emergencyService'
import { professionalService } from '../../services/professionalService'
import { useClinicalEncounter } from '../../hooks/useClinicalEncounter'
import { esWebViewDeLaApp } from '../../lib/enApp'

/**
 * La atención de una emergencia, en el lugar (migración 177).
 *
 * Cuando llega la ambulancia, el médico del móvil abre una consulta presencial
 * atada a la emergencia (`iniciar_atencion_emergencia`). Mateo (2026-09-28):
 * tiene que tener lo mismo que en la videollamada —historia clínica, notas,
 * recetario— y no sólo el detalle de la consulta. Así que esta pantalla es el
 * `ClinicalPanel` de la videollamada ocupando todo, sin nada de video: no hay
 * sala, ni cámara, ni "esperando al paciente", ni código de cierre — el médico
 * está al lado del paciente.
 *
 * Pensada para el teléfono: la app la abre en un WebView. Por eso al cerrar la
 * consulta no navega a ningún lado; queda en "Atención cerrada" y la app se
 * encarga de volver.
 */

const TRIAGE_ESTILO = {
  ROJO: 'bg-red-600 text-white',
  AMARILLO: 'bg-amber-400 text-zinc-900',
  VERDE: 'bg-emerald-500 text-white',
}

export default function AtencionEmergencia({ profile }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [enApp] = useState(esWebViewDeLaApp)

  const [consultation, setConsultation] = useState(null)
  const [emergencia, setEmergencia] = useState(null)
  const [error, setError] = useState(null)
  const [profProfile, setProfProfile] = useState(null)
  const [cierreAbierto, setCierreAbierto] = useState(false)
  const [preparandoCierre, setPreparandoCierre] = useState(false)

  useEffect(() => {
    let vivo = true
    consultationsService.getById(id)
      .then(cons => { if (vivo) setConsultation(cons) })
      .catch(() => { if (vivo) setError('No pudimos cargar la atención.') })
    return () => { vivo = false }
  }, [id])

  useEffect(() => {
    if (!consultation?.emergencyId) return
    emergencyService.getById(consultation.emergencyId)
      .then(setEmergencia)
      .catch(() => {})
  }, [consultation?.emergencyId])

  useEffect(() => {
    if (!profile?.id) return
    professionalService.getByUserId(profile.id).then(setProfProfile).catch(() => {})
  }, [profile?.id])

  // Mismo encuentro que usa el panel (el hook relee la base antes de crear, así
  // que dos instancias no duplican). Lo necesita el modal de cierre para
  // asentar el resumen en la historia clínica.
  const { ensureEncounter } = useClinicalEncounter({
    consultationId: consultation?.id,
    patientId: consultation?.patientId,
    professionalId: profile?.id,
    specialty: profProfile?.specialty,
    modality: consultation?.modality,
    licenseType: profProfile?.licenseType,
    licenseNumber: profProfile?.licenseNumber,
    preconsulta: consultation?.preconsultaData,
  })

  // El borrador de la consulta estructurada (`hc_draft`) se va guardando
  // mientras el médico escribe en el panel. El modal lo asienta al cerrar si
  // quedó sin asentar, así que se relee la consulta justo antes de abrirlo:
  // la copia de acá es la de cuando se abrió la pantalla.
  async function abrirCierre() {
    setPreparandoCierre(true)
    try {
      const fresca = await consultationsService.getById(id)
      setConsultation(fresca)
    } catch { /* se abre igual con la copia que hay */ }
    setPreparandoCierre(false)
    setCierreAbierto(true)
  }

  if (error) {
    return (
      <Centrado>
        <Warning className="h-10 w-10 text-danger" />
        <p className="text-base font-semibold text-text-primary">{error}</p>
        <button onClick={() => window.location.reload()} className="btn-primary px-6 py-3">Reintentar</button>
      </Centrado>
    )
  }

  if (!consultation) {
    return (
      <Centrado>
        <CircleNotch className="h-8 w-8 animate-spin text-brand" />
      </Centrado>
    )
  }

  // Una consulta común no tiene nada que hacer acá: su pantalla es el detalle.
  if (!consultation.emergencyId) {
    return <Navigate to={`/profesional/consulta/${id}`} replace />
  }

  // La RLS ya no le deja leer una consulta ajena, pero si llegara a verla (p.ej.
  // otro médico con la misma sesión abierta) no le ofrecemos escribir en ella.
  if (profile?.id && consultation.professionalId !== profile.id) {
    return (
      <Centrado>
        <LockSimple className="h-10 w-10 text-text-tertiary" />
        <p className="text-base font-semibold text-text-primary">Esta atención es de otro profesional.</p>
        <p className="text-sm text-text-secondary">Sólo la carga el médico del móvil asignado.</p>
      </Centrado>
    )
  }

  const codigo = emergencia?.dispatchCode
  const pacienteNombre = consultation.patient?.fullName ?? 'Paciente'
  const cerrada = consultation.status === 'completed'

  if (cerrada) {
    return (
      <Centrado>
        <SealCheck className="h-14 w-14 text-brand" weight="fill" />
        <div className="space-y-1">
          <p className="text-xl font-semibold text-text-primary">Atención cerrada</p>
          <p className="text-sm text-text-secondary">
            {codigo ? `Emergencia ${codigo} · ` : ''}{pacienteNombre}
          </p>
        </div>
        <p className="text-sm text-text-secondary max-w-xs">
          Quedó registrada en su historia clínica y le mandamos el resumen.
          {enApp ? ' Ya podés volver a la emergencia.' : ''}
        </p>
        {!enApp && (
          <Link to="/profesional/emergencias" className="btn-primary px-6 py-3">
            Volver a la emergencia
          </Link>
        )}
      </Centrado>
    )
  }

  return (
    <div className="h-dvh flex flex-col bg-bg-primary">
      {/* Encabezado oscuro, como el de la videollamada y el de emergencias:
          dice de un vistazo que esto es una emergencia y de quién. */}
      <header className="vc-header shrink-0 flex items-center gap-3 px-4 pb-3 bg-zinc-900 text-white">
        {enApp ? (
          // Lugar para la X nativa de la app.
          <span aria-hidden className="w-9 shrink-0" />
        ) : (
          <button
            onClick={() => navigate(-1)}
            aria-label="Volver"
            className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full text-white/60 hover:text-white"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <div className="h-9 w-9 shrink-0 rounded-full bg-danger/20 flex items-center justify-center">
          <Ambulance className="h-5 w-5 text-red-400" weight="fill" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-red-300">
            Atención de emergencia
          </p>
          <p className="text-sm font-semibold truncate">
            {codigo ? `${codigo} · ` : ''}{pacienteNombre}
          </p>
        </div>
        {emergencia?.triageCode && (
          <span className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full ${TRIAGE_ESTILO[emergencia.triageCode] ?? 'bg-white/10 text-white'}`}>
            {emergencia.triageCode}
          </span>
        )}
      </header>

      <div className="flex-1 min-h-0 vc-panel-tipografia">
        <ClinicalPanel
          consultation={consultation}
          profile={profile}
          vistaCerrar={
            <div className="rounded-lg border-2 border-brand/20 bg-bg-surface p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <LockSimple className="h-5 w-5 text-brand shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-text-primary">Cerrar la atención</p>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    Revisá que estén las notas y la receta. Al cerrar, la consulta queda
                    como registro en la historia clínica y no se puede editar más. Al
                    paciente le mandamos el resumen.
                  </p>
                </div>
              </div>
              <button
                onClick={abrirCierre}
                disabled={preparandoCierre}
                className="btn-primary w-full py-4 flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {preparandoCierre && <CircleNotch className="h-4 w-4 animate-spin" />}
                Cerrar la atención
              </button>
            </div>
          }
        />
      </div>

      <CloseConsultationModal
        open={cierreAbierto}
        onClose={() => setCierreAbierto(false)}
        consultationId={id}
        patientName={pacienteNombre}
        modality={consultation.modality}
        profile={profile}
        patientId={consultation.patientId}
        ensureEncounter={ensureEncounter}
        licenseType={profProfile?.licenseType}
        licenseNumber={profProfile?.licenseNumber}
        hcDraft={consultation.hcDraft}
        sinFactura
        onFinalized={() => {
          setCierreAbierto(false)
          setConsultation(prev => ({ ...prev, status: 'completed' }))
        }}
      />
    </div>
  )
}

function Centrado({ children }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-4 px-6 text-center bg-bg-primary">
      {children}
    </div>
  )
}
