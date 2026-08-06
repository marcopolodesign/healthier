import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, FileText, VideoCamera, ClipboardText, User,
  Clock, CalendarPlus, Key, ShieldCheck, Tag, PencilSimple, Check, X,
  FirstAidKit, Pill, Sparkle, Info, FilePdf, LockSimple,
} from '@phosphor-icons/react'
import InfoTooltip from '../../components/common/InfoTooltip'
import { consultationsService } from '../../services/consultationsService'
import { professionalService } from '../../services/professionalService'
import { useClinicalEncounter } from '../../hooks/useClinicalEncounter'
import { clinicalService } from '../../services/clinicalService'
import StatusBadge from '../../components/StatusBadge'
import CloseConsultationModal from '../../components/CloseConsultationModal'
import Modal from '../../components/Modal'
import AllergyPanel from '../../components/professional/AllergyPanel'
import PreconsultaSummary, { hasPreconsulta } from '../../components/professional/PreconsultaSummary'
import ConsultationPaymentCard from '../../components/professional/ConsultationPaymentCard'
import FinanciadorPicker from '../../components/FinanciadorPicker'
import PrescriptionCreator from '../../components/professional/PrescriptionCreator'
import ScribeSession from '../../components/professional/ScribeSession'
import { toast } from '../../components/Toast'

export default function ConsultationDetail({ profile }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [consultation, setConsultation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [closeModal, setCloseModal] = useState(false)

  const [enterCode, setEnterCode] = useState('')
  const [entering, setEntering] = useState(false)

  const [reagendarOpen, setReagendarOpen] = useState(false)
  const [reagendarDate, setReagendarDate] = useState('')
  const [savingReagendar, setSavingReagendar] = useState(false)

  const [editingCoverage, setEditingCoverage] = useState(false)
  const [coverageForm, setCoverageForm] = useState({ coverageType: null, financiadorId: null, obraSocialName: '', affiliateNumber: '' })
  const [savingCoverage, setSavingCoverage] = useState(false)

  const [profProfile, setProfProfile] = useState(null)
  const [showScribe, setShowScribe] = useState(false)
  const [recetas, setRecetas] = useState([])

  useEffect(() => {
    if (!profile?.id) return
    professionalService.getByUserId(profile.id).then(setProfProfile).catch(() => {})
  }, [profile?.id])

  const load = useCallback(() => {
    setLoading(true)
    consultationsService.getById(id)
      .then(setConsultation)
      .catch(() => toast.error('Error al cargar la consulta'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!consultation) return
    // La cobertura de la consulta manda si ya se cargó. Si todavía no —
    // consulta nueva, nunca tocada— se precarga con la cobertura ESTABLE del
    // paciente (la que cargó en su alta): `profiles.coverage_type` /
    // `financiador_id` / `insurance_name` / `insurance_num`. Precargar no es
    // forzar: el profesional edita libre acá y "Guardar" sólo escribe en
    // `consultations`, nunca en el perfil del paciente.
    const tieneCoberturaPropia = consultation.coverageType != null
    setCoverageForm(tieneCoberturaPropia
      ? {
          coverageType:    consultation.coverageType,
          financiadorId:   consultation.financiadorId ?? null,
          obraSocialName:  consultation.obraSocialName || '',
          affiliateNumber: consultation.affiliateNumber || '',
        }
      : {
          coverageType:    consultation.patient?.coverageType ?? null,
          financiadorId:   consultation.patient?.financiadorId ?? null,
          obraSocialName:  consultation.patient?.insuranceName || '',
          affiliateNumber: consultation.patient?.insuranceNum || '',
        }
    )
  }, [consultation?.id])

  const { encounterId: clinicalEncounterId, ensureEncounter } = useClinicalEncounter({
    consultationId: consultation?.id,
    patientId: consultation?.patientId,
    professionalId: profile.id,
    specialty: profProfile?.specialty,
    modality: consultation?.modality,
    licenseType: profProfile?.licenseType,
    licenseNumber: profProfile?.licenseNumber,
    preconsulta: consultation?.preconsultaData,
  })

  // Las recetas emitidas se recargan cuando cambia el encuentro: se emiten desde
  // el propio panel de "Recetas digitales" de esta pantalla, así que la tarjeta de
  // arriba tiene que reflejarlo sin recargar la página.
  useEffect(() => {
    if (!consultation?.id) return
    clinicalService.getIssuedRecetasByConsultation(consultation.id)
      .then(setRecetas)
      .catch(() => {})
  }, [consultation?.id, clinicalEncounterId])

  const saveCoverage = async () => {
    setSavingCoverage(true)
    try {
      const esParticular = coverageForm.coverageType === 'particular'
      const updated = await consultationsService.update(id, {
        coverageType:    coverageForm.coverageType,
        // Particular limpia los dos: la constraint de la base lo exige y
        // dejarlos sería un dato contradictorio.
        financiadorId:   esParticular ? null : coverageForm.financiadorId,
        obraSocialName:  esParticular ? null : (coverageForm.obraSocialName.trim() || null),
        affiliateNumber: esParticular ? null : (coverageForm.affiliateNumber.trim() || null),
      })
      setConsultation(prev => ({ ...prev, ...updated }))
      setEditingCoverage(false)
      toast.success('Cobertura actualizada')
    } catch {
      toast.error('Error al guardar')
    } finally {
      setSavingCoverage(false)
    }
  }

  const handleEnter = async () => {
    if (enterCode.length !== 4) { toast.warning('Ingresá el código de 4 dígitos'); return }
    setEntering(true)
    try {
      const updated = await consultationsService.startConsultation(id, enterCode)
      setConsultation(prev => ({ ...prev, ...updated }))
      toast.success('Consulta iniciada')
    } catch (err) {
      const msg = err?.message ?? ''
      if (msg.includes('Código inválido')) toast.error('Código inválido. Verificá con el paciente.')
      else toast.error('Error al ingresar a la consulta')
    } finally {
      setEntering(false)
    }
  }

  const handleReagendar = async () => {
    if (!reagendarDate) { toast.warning('Seleccioná fecha y hora'); return }
    setSavingReagendar(true)
    try {
      const created = await consultationsService.create({
        patientId: consultation.patientId,
        professionalId: profile.id,
        scheduledAt: new Date(reagendarDate).toISOString(),
        modality: consultation.modality,
        status: 'confirmed',
      }, { bookedBy: 'professional' })
      toast.success('Nueva consulta agendada')
      setReagendarOpen(false)
      navigate(`/profesional/consulta/${created.id}`)
    } catch {
      toast.error('Error al agendar la consulta')
    } finally {
      setSavingReagendar(false)
    }
  }

  if (loading) return <div className="h-96 bg-bg-surface rounded-xl animate-pulse" />
  if (!consultation) return <div className="text-center py-20 text-text-secondary">Consulta no encontrada</div>

  const patientName = consultation.patient?.fullName
  const isPresencial = consultation.modality === 'presencial'
  const isVideo = consultation.modality === 'video'
  const isPending = ['pending', 'confirmed'].includes(consultation.status)
  const isInProgress = consultation.status === 'in_progress'
  // El profesional cortó la llamada y está cargando el cierre (migración 098).
  // NO es `bloqueada`: es justo la pantalla desde la que se termina de cerrar
  // — si se tratara como congelada, el propio botón "Cerrar consulta" (y la
  // receta/alergias que hacen falta para cerrar bien) desaparecerían.
  const isClosing = consultation.status === 'closing'
  const isCompleted = consultation.status === 'completed'
  const isCancelled = consultation.status === 'cancelled'
  // 'expired' (nadie usó el turno) y 'no_show' (una parte esperó, la otra no
  // vino) los escribe el cron al vencer scheduled_at — son terminales igual
  // que completed/cancelled (ver docs/estados-consulta.md).
  const isExpired = consultation.status === 'expired'
  const isNoShow = consultation.status === 'no_show'
  /**
   * Consulta congelada. Cerrar es el punto sin retorno: desde ahí no se edita la
   * cobertura, no se cargan alergias ni medicaciones y no se emiten recetas.
   * Pedido de Mateo (2026-07-30): esta pantalla es el paso intermedio entre la
   * videollamada y el cierre, y el cierre "imprime".
   */
  const bloqueada = isCompleted || isCancelled || isExpired || isNoShow
  const showCloseButton = isVideo
    ? ['confirmed', 'in_progress', 'pending', 'closing'].includes(consultation.status)
    : isInProgress

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-text-secondary hover:text-brand">
        <ArrowLeft className="h-4 w-4" /> Volver
      </button>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="page-title">Detalle de consulta</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {consultation.consultationType && (
            <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-brand-muted text-brand">
              <Tag className="h-3 w-3" />
              {consultation.consultationType.name}
            </span>
          )}
          {consultation.modality && (
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              isPresencial ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {isPresencial ? 'Presencial' : 'Videollamada'}
            </span>
          )}
          <StatusBadge status={consultation.status} />
        </div>
      </div>

      {bloqueada && (
        <div className="card border-2 border-border-default bg-bg-surface flex items-start gap-2.5">
          <LockSimple className="h-5 w-5 text-text-tertiary shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-text-primary">
              {isCancelled ? 'Consulta cancelada'
                : isExpired ? 'Turno vencido'
                : isNoShow ? 'Consulta con ausencia'
                : 'Consulta cerrada'}
            </p>
            <p className="text-sm text-text-secondary">
              Queda como registro: no se puede editar ni agregar nada más.
              {isCompleted && consultation.completedAt && (
                <> Cerrada el {new Date(consultation.completedAt).toLocaleString('es-AR', {
                  day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
                })}.</>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Patient card */}
      <div className="card">
        <h2 className="font-semibold text-text-primary mb-4">Paciente</h2>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-brand-muted flex items-center justify-center">
            <span className="text-brand font-semibold text-lg">{patientName?.[0]}</span>
          </div>
          <div>
            <p className="font-semibold text-text-primary">{patientName || '—'}</p>
            <p className="text-sm text-text-secondary">{consultation.patient?.email}</p>
          </div>
        </div>
        {consultation.scheduledAt && (
          <div className="mt-3 pt-3 border-t border-border-default text-sm text-text-secondary">
            Agendada para:{' '}
            <span className="text-text-primary font-medium">
              {new Date(consultation.scheduledAt).toLocaleString('es-AR', {
                weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
              })}
            </span>
          </div>
        )}
        {isCompleted && consultation.durationMinutes != null && (
          <div className="mt-2 flex items-center gap-1.5 text-sm text-text-secondary">
            <Clock className="h-4 w-4" />
            Duración:{' '}
            <span className="text-text-primary font-medium">{consultation.durationMinutes} min</span>
          </div>
        )}

        {/* Lo que el paciente contestó antes de entrar. Va acá y no solo en la
            videollamada porque en una consulta presencial no hay videollamada:
            este es el único lugar donde el profesional puede leerlo. */}
        {hasPreconsulta(consultation.preconsultaData) && (
          <div className="mt-3">
            <PreconsultaSummary preconsulta={consultation.preconsultaData} />
          </div>
        )}
      </div>

      {/* Cobertura médica */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-brand" />
            <h2 className="font-semibold text-text-primary">Cobertura médica</h2>
            <InfoTooltip
              align="left"
              title="Para qué sirve"
              label="Es el financiador que viaja en la receta electrónica para que la farmacia aplique la cobertura. Tiene que elegirse del listado: el nombre escrito a mano no sirve para emitir. No es obligatorio — sin financiador la receta sale como particular."
            >
              <Info className="h-3.5 w-3.5 text-text-tertiary cursor-help" />
            </InfoTooltip>
          </div>
          {!editingCoverage && !bloqueada && (
            <button
              onClick={() => setEditingCoverage(true)}
              className="flex items-center gap-1 text-xs text-text-secondary hover:text-brand transition-colors"
            >
              <PencilSimple className="h-3.5 w-3.5" />
              Editar
            </button>
          )}
        </div>

        {editingCoverage ? (
          <div className="space-y-3">
            <FinanciadorPicker
              coverageType={coverageForm.coverageType}
              financiadorId={coverageForm.financiadorId}
              financiadorName={coverageForm.obraSocialName}
              affiliateNumber={coverageForm.affiliateNumber}
              onChange={v => setCoverageForm({
                coverageType:    v.coverageType,
                financiadorId:   v.financiadorId,
                obraSocialName:  v.financiadorName,
                affiliateNumber: v.affiliateNumber,
              })}
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setEditingCoverage(false); setCoverageForm({
                  coverageType:    consultation.coverageType ?? consultation.patient?.coverageType ?? null,
                  financiadorId:   consultation.financiadorId ?? consultation.patient?.financiadorId ?? null,
                  obraSocialName:  consultation.obraSocialName || consultation.patient?.insuranceName || '',
                  affiliateNumber: consultation.affiliateNumber || consultation.patient?.insuranceNum || '',
                }) }}
                className="btn-secondary flex-1 py-2 flex items-center justify-center gap-1"
              >
                <X className="h-4 w-4" /> Cancelar
              </button>
              <button
                onClick={saveCoverage}
                disabled={savingCoverage}
                className="btn-primary flex-1 py-2 flex items-center justify-center gap-1"
              >
                <Check className="h-4 w-4" /> {savingCoverage ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        ) : consultation.coverageType === 'particular' ? (
          <p className="text-sm text-text-primary">
            <span className="font-medium">Particular</span>
            <span className="text-text-secondary"> — sin cobertura</span>
          </p>
        ) : consultation.obraSocialName ? (
          <div className="flex items-start gap-4 flex-wrap">
            <div>
              <p className="text-xs text-text-secondary">Obra social</p>
              <p className="text-sm font-medium text-text-primary mt-0.5">{consultation.obraSocialName}</p>
            </div>
            {consultation.affiliateNumber && (
              <div>
                <p className="text-xs text-text-secondary">N° afiliado</p>
                <p className="text-sm font-medium text-text-primary mt-0.5">{consultation.affiliateNumber}</p>
              </div>
            )}
            {/* Una obra social cargada a mano antes de que existiera el catálogo
                no tiene idFinanciador, y sin él la receta no se puede emitir.
                Se avisa acá y no recién al intentar emitirla. */}
            {!consultation.financiadorId && (
              <p className="w-full text-[11px] text-amber-700 font-medium">
                Falta elegirla del listado de obras sociales.
              </p>
            )}
          </div>
        ) : (
          /* Sólo el resultado, sin explicar (Mateo, 2026-07-31): esta pantalla es
             para leer el estado de la consulta. El "para qué sirve" vive en el
             tooltip del encabezado, y el "qué pasa si no la cargás" en el propio
             formulario de cobertura, que es donde se decide. */
          <p className="text-sm text-text-muted">Sin definir</p>
        )}
      </div>

      {/* ── Acciones de la consulta ── */}
      {/* Presencial — code gate to enter */}
      {isPresencial && isPending && (
        <div className="card border-2 border-brand/20 bg-brand-muted/30">
          <div className="flex items-center gap-2 mb-3">
            <Key className="h-5 w-5 text-brand" />
            <h2 className="font-semibold text-text-primary">Ingresar a la consulta</h2>
          </div>
          <p className="text-sm text-text-secondary mb-4">
            Pedile al paciente su código de 4 dígitos para abrir la sesión.
          </p>
          <div className="flex gap-3">
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={enterCode}
              onChange={e => setEnterCode(e.target.value.replace(/\D/g, ''))}
              placeholder="0000"
              className="form-input text-center tracking-[0.3em] text-xl font-mono w-28"
            />
            <button
              onClick={handleEnter}
              disabled={entering || enterCode.length !== 4}
              className="btn-primary flex-1"
            >
              {entering ? 'Ingresando…' : 'Ingresar'}
            </button>
          </div>
        </div>
      )}

      {/* Presencial — in progress indicator */}
      {isPresencial && isInProgress && (
        <div className="card border-2 border-green-200 bg-green-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
            <span className="font-semibold text-green-800">Consulta en curso</span>
          </div>
          {consultation.startedAt && (
            <span className="text-sm text-green-700">
              Inicio:{' '}
              {new Date(consultation.startedAt).toLocaleTimeString('es-AR', {
                hour: '2-digit', minute: '2-digit',
              })}
            </span>
          )}
        </div>
      )}

      {/* VideoCamera — access button */}
      {isVideo && ['pending', 'confirmed', 'in_progress'].includes(consultation.status) && (
        <Link
          to={`/profesional/videollamada/${id}`}
          className="btn-primary w-full py-3 flex items-center justify-center gap-2"
        >
          <VideoCamera className="h-5 w-5" />
          Acceder a la videollamada
        </Link>
      )}

      {/* ── Historia clínica de esta consulta ── */}
      {/* Historia Clínica */}
      <div className="card space-y-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-muted flex items-center justify-center shrink-0">
              <FirstAidKit className="h-4 w-4 text-brand" />
            </div>
            <div>
              <h2 className="font-semibold text-text-primary">Historia Clínica</h2>
              <p className="text-xs text-text-secondary">Esta consulta</p>
            </div>
          </div>
          {isPresencial && !showScribe && !bloqueada && (
            <button
              onClick={() => setShowScribe(true)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-brand text-white hover:bg-brand/90"
            >
              <Sparkle weight="fill" className="h-3.5 w-3.5" /> Nota con IA
            </button>
          )}
        </div>

        {isPresencial && showScribe && (
          <ScribeSession
            patientId={consultation.patientId}
            professionalId={profile.id}
            specialty={profProfile?.specialty}
            licenseType={profProfile?.licenseType}
            licenseNumber={profProfile?.licenseNumber}
            encounterId={clinicalEncounterId}
            ensureEncounter={ensureEncounter}
            getAudioStream={() => navigator.mediaDevices.getUserMedia({ audio: true })}
            stopStream={stream => stream.getTracks().forEach(t => t.stop())}
            onFinalized={() => {}}
            onClose={() => setShowScribe(false)}
          />
        )}

        {/* Allergies subsection */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <FirstAidKit className="h-4 w-4 text-brand" />
            <p className="text-sm font-semibold text-text-primary">Alergias</p>
          </div>
          <AllergyPanel
            patientId={consultation.patientId}
            encounterId={clinicalEncounterId}
            bloqueada={bloqueada}
          />
        </div>

        {/* Signos vitales sacado de la pantalla (Mateo, 2026-07-29): "por ahora
            no vamos a tener esto". `VitalsPanel` y `clinical_observations` siguen
            existiendo — se sacó el punto de entrada, no el modelo de datos, para
            poder volver a colgarlo acá cuando haya de dónde medir. */}

        <div className="border-t border-border-default" />

        {/* Prescriptions subsection */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Pill className="h-4 w-4 text-brand" />
            <p className="text-sm font-semibold text-text-primary">Recetas digitales</p>
          </div>
          <PrescriptionCreator
            patientId={consultation.patientId}
            encounterId={clinicalEncounterId}
            ensureEncounter={ensureEncounter}
            professionalId={profile?.id ?? null}
            consultationId={consultation.id}
            bloqueada={bloqueada}
            onIssued={() => clinicalService.getIssuedRecetasByConsultation(consultation.id).then(setRecetas).catch(() => {})}
            // El profesional acaba de cargar el DNI o el sexo que faltaba: hay que
            // volver a leer el paciente y su propio perfil para que el cartel
            // desaparezca y el botón de emitir quede habilitado sin recargar.
            onDatosActualizados={() => {
              load()
              professionalService.getByUserId(profile.id).then(setProfProfile).catch(() => {})
            }}
            profile={profile}
            profProfile={profProfile}
            paciente={consultation.patient}
            cobertura={consultation.financiadorId ? {
              idFinanciador: consultation.financiadorId,
              afiliado: consultation.affiliateNumber,
            } : null}
          />
        </div>
      </div>

      {/* Receta electrónica emitida.
          Antes acá se mostraba un archivo que el profesional subía a mano al
          cerrar la consulta. Una imagen no es una receta: la receta es el PDF
          firmado que devuelve RCTA. Ahora sale de `clinical_medications` y una
          sola receta puede agrupar varios medicamentos, así que se agrupa por
          `rcta_prescription_id`. */}
      {recetas.length > 0 && (
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <FilePdf className="h-5 w-5 text-brand" />
            <h2 className="font-semibold text-text-primary">
              Receta{recetas.length > 1 ? 's' : ''} electrónica{recetas.length > 1 ? 's' : ''}
            </h2>
          </div>
          {recetas.map(r => (
            <div key={r.prescriptionId} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-text-primary">{r.medications.join(' · ')}</p>
                <p className="text-[11px] text-text-tertiary">
                  N° {r.prescriptionId}
                  {r.issuedAt && ` · ${new Date(r.issuedAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}`}
                </p>
              </div>
              {r.pdfUrl && (
                <a
                  href={r.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-brand font-medium hover:underline shrink-0"
                >
                  <FilePdf className="h-4 w-4" /> Ver PDF
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Notas ── */}
      {/* Closing notes (completed) */}
      {consultation.closingNotes && (
        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="h-5 w-5 text-brand" />
            <h2 className="font-semibold text-text-primary">Notas de cierre</h2>
          </div>
          <p className="text-sm text-text-secondary">{consultation.closingNotes}</p>
        </div>
      )}

      {/* ── Cobro ── */}
      {/* Cobro de esta consulta */}
      <ConsultationPaymentCard payment={consultation.payment} />

      {/* Navigation shortcuts */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          to={`/profesional/paciente/${consultation.patientId}`}
          className="btn-secondary py-3 flex items-center justify-center gap-2"
        >
          <User className="h-5 w-5" />
          Perfil del paciente
        </Link>
        <Link
          to={`/profesional/historia-clinica/${consultation.patientId}`}
          className="btn-secondary py-3 flex items-center justify-center gap-2"
        >
          <ClipboardText className="h-5 w-5" />
          Historia clínica
        </Link>
      </div>

      {/* Reagendar */}
      {!isCancelled && (
        <button
          onClick={() => setReagendarOpen(true)}
          className="btn-secondary w-full py-3 flex items-center justify-center gap-2"
        >
          <CalendarPlus className="h-5 w-5" />
          Agendar próxima consulta
        </button>
      )}

      {/* Close consultation */}
      {/* Cerrar es la acción terminal de esta pantalla, no una más de la lista:
          después de esto la consulta queda como registro y no se toca nunca más.
          Era un `btn-secondary` perdido al final, con el mismo peso visual que
          "Agendar próxima consulta". */}
      {showCloseButton && (
        <div className="card border-2 border-brand/20 space-y-3">
          <div className="flex items-start gap-2.5">
            <LockSimple className="h-5 w-5 text-brand shrink-0 mt-0.5" />
            <div>
              <h2 className="font-semibold text-text-primary">Cerrar la consulta</h2>
              <p className="text-sm text-text-secondary">
                Revisá que estén la receta, las alergias y lo que quieras dejar
                asentado. Al cerrar, la consulta queda como registro y no se puede
                editar ni agregar nada más.
              </p>
            </div>
          </div>
          <button onClick={() => setCloseModal(true)} className="btn-primary w-full py-3">
            Cerrar consulta
          </button>
        </div>
      )}

      <CloseConsultationModal
        open={closeModal}
        onClose={() => setCloseModal(false)}
        consultationId={id}
        patientName={patientName}
        modality={consultation.modality}
        profile={profile}
        patientId={consultation.patientId}
        ensureEncounter={ensureEncounter}
        licenseType={profProfile?.licenseType}
        licenseNumber={profProfile?.licenseNumber}
        onFinalized={() => navigate('/profesional/dashboard')}
      />

      <Modal open={reagendarOpen} onClose={() => setReagendarOpen(false)} title="Agendar próxima consulta">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Nueva consulta con <strong>{patientName || 'el/la paciente'}</strong>, misma modalidad ({consultation.modality ?? '—'}).
          </p>
          <div>
            <label className="form-label">Fecha y hora</label>
            <input
              type="datetime-local"
              value={reagendarDate}
              onChange={e => setReagendarDate(e.target.value)}
              className="form-input"
            />
          </div>
          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
            <button onClick={() => setReagendarOpen(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handleReagendar} disabled={savingReagendar} className="btn-primary flex-1">
              {savingReagendar ? 'Agendando…' : 'Confirmar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
