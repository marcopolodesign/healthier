import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, CircleNotch, User, ShareFat, ClipboardText, CalendarCheck } from '@phosphor-icons/react'
import { derivacionesService, textoHistoriaClinica, destinoLabel, derivacionVigente } from '../../services/derivacionesService'
import { useEspecialidades } from '../../hooks/useEspecialidades'
import DerivacionEstado, { consentimientoLabel } from '../../components/DerivacionEstado'
import Modal from '../../components/Modal'
import { toast } from '../../components/Toast'
import { formatDate } from '../../lib/format'

function Dato({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold text-text-tertiary uppercase tracking-widest">{label}</span>
      <span className="text-sm font-medium text-text-primary">{children || '—'}</span>
    </div>
  )
}

/**
 * Una derivación vista por el profesional (el que derivó o el que recibe).
 * Es a donde llevan el push y el mail `pro-derivacion-recibida`.
 */
export default function DerivacionDetalle({ profile }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const { porSlug } = useEspecialidades()
  const [d, setD] = useState(null)
  const [loading, setLoading] = useState(true)
  const [cancelando, setCancelando] = useState(false)
  const [rechazoOpen, setRechazoOpen] = useState(false)
  const [motivoRechazo, setMotivoRechazo] = useState('')
  const [rechazando, setRechazando] = useState(false)
  const [veHc, setVeHc] = useState(null)

  const cargar = () =>
    derivacionesService.getById(id)
      .then(setD)
      .catch(err => toast.error(err?.message ?? 'Error al cargar la derivación'))
      .finally(() => setLoading(false))

  useEffect(() => { cargar() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!d?.patientId) return
    derivacionesService.veHistoriaClinica(d.patientId).then(setVeHc).catch(() => setVeHc(null))
  }, [d?.patientId, d?.consentimientoHc])

  const cancelar = async () => {
    setCancelando(true)
    try {
      await derivacionesService.cancelar(d.id)
      toast.success('Derivación cancelada')
      await cargar()
    } catch (err) {
      toast.error(err?.message ?? 'No pudimos cancelar la derivación')
    } finally {
      setCancelando(false)
    }
  }

  const rechazar = async () => {
    setRechazando(true)
    try {
      await derivacionesService.rechazar(d.id, motivoRechazo)
      toast.success('Derivación rechazada. Le avisamos al paciente.')
      setRechazoOpen(false)
      setMotivoRechazo('')
      await cargar()
    } catch (err) {
      toast.error(err?.message ?? 'No pudimos rechazar la derivación')
    } finally {
      setRechazando(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><CircleNotch className="h-6 w-6 animate-spin text-brand" /></div>
  }
  if (!d) {
    return <div className="text-center py-20 text-text-secondary">Derivación no encontrada</div>
  }

  const soyQuienDerivo = d.derivadoPor === profile?.id
  const recibo = !soyQuienDerivo
  const soyDestino = d.profesionalDestinoId === profile?.id
  // Al que derivó le importa qué respondió el paciente; al que recibe, qué va a poder ver.
  const consentimiento = soyQuienDerivo
    ? `Compartir con quien lo atienda: ${consentimientoLabel(d)}`
    : textoHistoriaClinica(d, veHc)

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto pb-12">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-text-secondary hover:text-brand">
        <ArrowLeft className="h-4 w-4" /> Volver
      </button>

      <div className="card flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-brand-muted flex items-center justify-center shrink-0 overflow-hidden">
          {d.paciente?.avatarUrl
            ? <img src={d.paciente.avatarUrl} alt="" className="w-full h-full object-cover" />
            : <User className="h-6 w-6 text-brand" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-widest">Derivación</p>
          <h1 className="text-xl font-normal text-text-primary truncate">{d.paciente?.fullName ?? 'Paciente'}</h1>
        </div>
        <DerivacionEstado derivacion={d} />
      </div>

      <div className="card space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Dato label="Derivado por">{soyQuienDerivo ? 'Vos' : d.derivado?.fullName}</Dato>
          <Dato label="Derivado a">{recibo && d.profesionalDestinoId === profile?.id ? 'Vos' : destinoLabel(d, porSlug)}</Dato>
          <Dato label="Fecha">{formatDate(d.createdAt)}</Dato>
          <Dato label="Vence">{['pendiente', 'rechazada'].includes(d.estado) ? formatDate(d.venceAt) : '—'}</Dato>
        </div>
        <div>
          <span className="text-[11px] font-semibold text-text-tertiary uppercase tracking-widest">Motivo</span>
          <p className="text-sm text-text-primary mt-1 whitespace-pre-line">“{d.motivo}”</p>
        </div>
        <Dato label="Historia clínica">{consentimiento}</Dato>
        {d.estado === 'rechazada' && (
          <div className="rounded-xl bg-orange-50 border border-orange-200 p-3 text-sm text-orange-800">
            <p className="font-semibold">
              {soyDestino ? 'Rechazaste esta derivación' : `${d.destino?.fullName ?? 'El profesional'} la rechazó`}
            </p>
            {d.motivoRechazo && <p className="mt-1 whitespace-pre-line">“{d.motivoRechazo}”</p>}
            {soyQuienDerivo && (
              <p className="mt-1 text-xs">El paciente puede reservar con otro profesional de la misma especialidad.</p>
            )}
          </div>
        )}
        {d.estado === 'reservada' && d.consultaReservada?.scheduledAt && (
          <Dato label="Turno">{formatDate(d.consultaReservada.scheduledAt)}</Dato>
        )}
      </div>

      <div className="space-y-3">
        {d.consultaReservadaId && recibo && (
          <Link to={`/profesional/consulta/${d.consultaReservadaId}`} className="btn-primary w-full py-3 flex items-center justify-center gap-2">
            <CalendarCheck className="h-5 w-5" />
            Ver el turno
          </Link>
        )}
        <Link to={`/profesional/paciente/${d.patientId}`} className="btn-secondary w-full py-3 flex items-center justify-center gap-2">
          <ShareFat className="h-5 w-5" />
          Ficha del paciente
        </Link>
        {(soyQuienDerivo || veHc) && (
          <Link to={`/profesional/historia-clinica/${d.patientId}`} className="btn-secondary w-full py-3 flex items-center justify-center gap-2">
            <ClipboardText className="h-5 w-5" />
            Historia clínica
          </Link>
        )}
        {soyDestino && d.estado === 'pendiente' && (
          <button onClick={() => setRechazoOpen(true)} className="btn-secondary w-full py-3 text-danger">
            Rechazar
          </button>
        )}
        {soyQuienDerivo && derivacionVigente(d) && (
          <button onClick={cancelar} disabled={cancelando} className="btn-danger w-full py-3">
            {cancelando ? 'Cancelando…' : 'Cancelar derivación'}
          </button>
        )}
      </div>

      <Modal open={rechazoOpen} onClose={() => !rechazando && setRechazoOpen(false)} title="Rechazar derivación" size="sm">
        <div className="space-y-4">
          <div>
            <label className="form-label">¿Por qué no podés tomarla? <span className="normal-case font-normal text-text-tertiary">(opcional, lo ve el paciente)</span></label>
            <textarea
              value={motivoRechazo}
              onChange={e => setMotivoRechazo(e.target.value)}
              rows={3}
              className="form-textarea"
            />
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setRechazoOpen(false)} disabled={rechazando} className="btn-secondary flex-1 py-2.5">
              Volver
            </button>
            <button type="button" onClick={rechazar} disabled={rechazando} className="btn-danger flex-1 py-2.5">
              {rechazando ? 'Rechazando…' : 'Rechazar derivación'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
