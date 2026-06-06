import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, FileText, Paperclip, VideoCamera, ClipboardText, User,
  Clock, Plus, Trash, CalendarPlus, Key, ShieldCheck, Tag, PencilSimple, Check, X,
  FirstAidKit, Heartbeat, Pill,
} from '@phosphor-icons/react'
import { consultationsService } from '../../services/consultationsService'
import { professionalService } from '../../services/professionalService'
import { heuralService } from '../../services/heuralService'
import StatusBadge from '../../components/StatusBadge'
import CloseConsultationModal from '../../components/CloseConsultationModal'
import Modal from '../../components/Modal'
import FileUpload from '../../components/FileUpload'
import AllergyPanel from '../../components/professional/AllergyPanel'
import VitalsPanel from '../../components/professional/VitalsPanel'
import PrescriptionCreator from '../../components/professional/PrescriptionCreator'
import { toast } from '../../components/Toast'

const ORDER_TYPE_LABELS = { orden: 'Orden', receta: 'Receta', derivacion: 'Derivación' }
const ORDER_TYPE_COLORS = {
  receta:     'bg-purple-100 text-purple-700',
  derivacion: 'bg-amber-100 text-amber-700',
  orden:      'bg-blue-100 text-blue-700',
}

export default function ConsultationDetail({ profile }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [consultation, setConsultation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [closeModal, setCloseModal] = useState(false)

  const [enterCode, setEnterCode] = useState('')
  const [entering, setEntering] = useState(false)

  const [addingOrder, setAddingOrder] = useState(false)
  const [orderFormKey, setOrderFormKey] = useState(0)
  const [orderForm, setOrderForm] = useState({ description: '', tipo: 'orden', file: null })
  const [savingOrder, setSavingOrder] = useState(false)

  const [reagendarOpen, setReagendarOpen] = useState(false)
  const [reagendarDate, setReagendarDate] = useState('')
  const [savingReagendar, setSavingReagendar] = useState(false)

  const [editingCoverage, setEditingCoverage] = useState(false)
  const [coverageForm, setCoverageForm] = useState({ obraSocialName: '', affiliateNumber: '' })
  const [savingCoverage, setSavingCoverage] = useState(false)

  // Heural — pre-consulta data (loaded lazily when the HC section is visible)
  const [preconsulta, setPreconsulta] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    consultationsService.getById(id)
      .then(setConsultation)
      .catch(() => toast.error('Error al cargar la consulta'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (consultation) {
      setCoverageForm({
        obraSocialName: consultation.obraSocialName || '',
        affiliateNumber: consultation.affiliateNumber || '',
      })
      // Load pre-consulta when heural encounter is available
      const patientHeuralId = consultation.patient?.heuralId
      const encounterId = consultation.heuralEncounterId
      if (patientHeuralId && encounterId) {
        heuralService.getPreconsulta(encounterId, patientHeuralId)
          .then(({ data }) => { if (data) setPreconsulta(data) })
          .catch(() => {})
      }
    }
  }, [consultation])

  const saveCoverage = async () => {
    setSavingCoverage(true)
    try {
      const updated = await consultationsService.update(id, {
        obraSocialName: coverageForm.obraSocialName.trim() || null,
        affiliateNumber: coverageForm.affiliateNumber.trim() || null,
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
      setConsultation(prev => ({ ...prev, ...updated, consultationOrders: prev.consultationOrders }))
      toast.success('Consulta iniciada')
    } catch (err) {
      const msg = err?.message ?? ''
      if (msg.includes('Código inválido')) toast.error('Código inválido. Verificá con el paciente.')
      else toast.error('Error al ingresar a la consulta')
    } finally {
      setEntering(false)
    }
  }

  const handleAddOrder = async () => {
    if (!orderForm.description.trim()) { toast.warning('Describí la orden'); return }
    setSavingOrder(true)
    try {
      let url = null
      if (orderForm.file) {
        url = await professionalService.uploadDocument(
          profile.id, orderForm.file, 'professional-docs', `order-${id}-${Date.now()}`
        )
      }
      await consultationsService.addOrder(id, {
        description: orderForm.description,
        orderType: orderForm.tipo,
        url,
      })
      setOrderForm({ description: '', tipo: 'orden', file: null })
      setOrderFormKey(k => k + 1)
      setAddingOrder(false)
      load()
    } catch {
      toast.error('Error al guardar la orden')
    } finally {
      setSavingOrder(false)
    }
  }

  const handleRemoveOrder = async (orderId) => {
    try {
      await consultationsService.removeOrder(orderId)
      setConsultation(prev => ({
        ...prev,
        consultationOrders: (prev.consultationOrders ?? []).filter(o => o.id !== orderId),
      }))
    } catch {
      toast.error('Error al eliminar la orden')
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
      })
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
  const isCompleted = consultation.status === 'completed'
  const isCancelled = consultation.status === 'cancelled'
  const showCloseButton = isVideo
    ? ['confirmed', 'in_progress', 'pending'].includes(consultation.status)
    : isInProgress
  const orders = consultation.consultationOrders ?? []

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-text-secondary hover:text-brand">
        <ArrowLeft className="h-4 w-4" /> Volver
      </button>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-text-primary">Detalle de consulta</h1>
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

      {/* Patient card */}
      <div className="card">
        <h2 className="font-semibold text-text-primary mb-4">Paciente</h2>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-brand-muted flex items-center justify-center">
            <span className="text-brand font-bold text-lg">{patientName?.[0]}</span>
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
      </div>

      {/* Cobertura médica */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-brand" />
            <h2 className="font-semibold text-text-primary">Cobertura médica</h2>
          </div>
          {!editingCoverage && (
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label text-xs">Obra social</label>
                <input
                  type="text"
                  value={coverageForm.obraSocialName}
                  onChange={e => setCoverageForm(p => ({ ...p, obraSocialName: e.target.value }))}
                  placeholder="Ej: OSDE, Swiss Medical"
                  className="form-input"
                />
              </div>
              <div>
                <label className="form-label text-xs">N° de afiliado</label>
                <input
                  type="text"
                  value={coverageForm.affiliateNumber}
                  onChange={e => setCoverageForm(p => ({ ...p, affiliateNumber: e.target.value }))}
                  placeholder="Ej: 123456789"
                  className="form-input"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setEditingCoverage(false); setCoverageForm({ obraSocialName: consultation.obraSocialName || '', affiliateNumber: consultation.affiliateNumber || '' }) }}
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
        ) : consultation.obraSocialName ? (
          <div className="flex items-start gap-4">
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
          </div>
        ) : (
          <p className="text-sm text-text-muted">Sin obra social registrada.</p>
        )}
      </div>

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

      {/* Orders & prescriptions */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-text-primary">Órdenes y recetas</h2>
          {!isCompleted && !isCancelled && !addingOrder && (
            <button
              onClick={() => setAddingOrder(true)}
              className="flex items-center gap-1 text-sm text-brand hover:underline"
            >
              <Plus className="h-4 w-4" /> Agregar
            </button>
          )}
        </div>

        {orders.length === 0 && !addingOrder && (
          <p className="text-sm text-text-muted">Sin órdenes adjuntas.</p>
        )}

        <div className="space-y-2">
          {orders.map(order => (
            <div
              key={order.id}
              className="flex items-start justify-between gap-3 py-2 border-b border-border-default last:border-0"
            >
              <div className="flex-1 min-w-0">
                <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full mr-2 ${ORDER_TYPE_COLORS[order.orderType] ?? 'bg-gray-100 text-gray-700'}`}>
                  {ORDER_TYPE_LABELS[order.orderType] ?? order.orderType}
                </span>
                <span className="text-sm text-text-primary">{order.description}</span>
                {order.url && (
                  <a
                    href={order.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 flex items-center gap-1 text-xs text-brand hover:underline"
                  >
                    <Paperclip className="h-3 w-3" /> Ver adjunto
                  </a>
                )}
              </div>
              {!isCompleted && !isCancelled && (
                <button
                  onClick={() => handleRemoveOrder(order.id)}
                  className="p-1 text-text-muted hover:text-danger"
                >
                  <Trash className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>

        {addingOrder && (
          <div className="mt-4 pt-4 border-t border-border-default space-y-3">
            <div className="flex gap-2 flex-wrap">
              {['orden', 'receta', 'derivacion'].map(t => (
                <button
                  key={t}
                  onClick={() => setOrderForm(p => ({ ...p, tipo: t }))}
                  className={`text-sm px-3 py-1 rounded-full border transition-colors ${
                    orderForm.tipo === t
                      ? 'bg-brand text-white border-brand'
                      : 'border-border-default text-text-secondary hover:border-brand'
                  }`}
                >
                  {ORDER_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={orderForm.description}
              onChange={e => setOrderForm(p => ({ ...p, description: e.target.value }))}
              placeholder="Descripción (ej: Hemograma completo)"
              className="form-input"
            />
            <FileUpload
              key={orderFormKey}
              onFile={f => setOrderForm(p => ({ ...p, file: f }))}
              accept=".pdf,.jpg,.jpeg,.png"
              label="Adjuntar archivo (opcional)"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setAddingOrder(false)
                  setOrderForm({ description: '', tipo: 'orden', file: null })
                  setOrderFormKey(k => k + 1)
                }}
                className="btn-secondary flex-1 py-2"
              >
                Cancelar
              </button>
              <button
                onClick={handleAddOrder}
                disabled={savingOrder}
                className="btn-primary flex-1 py-2"
              >
                {savingOrder ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        )}
      </div>

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

      {/* Legacy single prescription */}
      {consultation.prescriptionUrl && (
        <div className="card">
          <div className="flex items-center gap-2">
            <Paperclip className="h-5 w-5 text-brand" />
            <a
              href={consultation.prescriptionUrl}
              target="_blank"
              rel="noreferrer"
              className="text-brand text-sm font-medium hover:underline"
            >
              Ver receta adjunta
            </a>
          </div>
        </div>
      )}

      {/* Historia Clínica — Heural (only when patient has heural_id) */}
      {consultation.patient?.heuralId && (
        <div className="card space-y-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-muted flex items-center justify-center shrink-0">
              <FirstAidKit className="h-4 w-4 text-brand" />
            </div>
            <div>
              <h2 className="font-semibold text-text-primary">Historia Clínica</h2>
              <p className="text-xs text-text-secondary">Heural EHR · esta consulta</p>
            </div>
          </div>

          {/* Allergies subsection */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <FirstAidKit className="h-4 w-4 text-brand" />
              <p className="text-sm font-semibold text-text-primary">Alergias</p>
            </div>
            <AllergyPanel
              patientHeuralId={consultation.patient.heuralId}
              encounterId={consultation.heuralEncounterId ?? null}
            />
          </div>

          <div className="border-t border-border-default" />

          {/* Vitals subsection */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Heartbeat className="h-4 w-4 text-brand" />
              <p className="text-sm font-semibold text-text-primary">Signos vitales</p>
            </div>
            <VitalsPanel
              patientHeuralId={consultation.patient.heuralId}
              encounterId={consultation.heuralEncounterId ?? null}
              preconsulta={preconsulta}
            />
          </div>

          <div className="border-t border-border-default" />

          {/* Prescriptions subsection */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Pill className="h-4 w-4 text-brand" />
              <p className="text-sm font-semibold text-text-primary">Recetas digitales</p>
            </div>
            <PrescriptionCreator
              patientHeuralId={consultation.patient.heuralId ?? null}
              encounterId={consultation.heuralEncounterId ?? null}
              consultationId={id}
              patientPhone={consultation.patient?.phone ?? null}
              patientEmail={consultation.patient?.email ?? null}
            />
          </div>
        </div>
      )}

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
      {showCloseButton && (
        <button onClick={() => setCloseModal(true)} className="btn-secondary w-full py-3">
          Cerrar consulta
        </button>
      )}

      <CloseConsultationModal
        open={closeModal}
        onClose={() => setCloseModal(false)}
        consultationId={id}
        patientName={patientName}
        modality={consultation.modality}
        profile={profile}
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
          <div className="flex gap-3 pt-2">
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
