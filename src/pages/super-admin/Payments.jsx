import { useState, useEffect, useMemo } from 'react'
import { CurrencyDollar, Users, ArrowClockwise, CheckCircle, CircleNotch, Sparkle, HandCoins, ArrowUUpLeft, ArrowsLeftRight } from '@phosphor-icons/react'
import { paymentsService } from '../../services/paymentsService'
import { mpService } from '../../services/mpService'
import { reassignmentsService } from '../../services/reassignmentsService'
import { toast } from '../../components/Toast'
import Modal from '../../components/Modal'
import { formatARS, formatDate } from '../../lib/format'

const METHOD_LABELS = { card: 'Tarjeta', credits: 'Créditos', mixed: 'Mixto' }
// 'authorized' / 'cancelled' come from the on-demand pre-authorization flow
// (spec Sección D4) — a hold on the card that hasn't been captured yet, or
// one that was released without ever charging anything. Neither counts as
// billed revenue: the totals above already only sum `status === 'approved'`.
const STATUS_BADGE = {
  approved:   'bg-emerald-50 text-emerald-600',
  pending:    'bg-amber-50 text-amber-600',
  authorized: 'bg-amber-50 text-amber-700',
  rejected:   'bg-gray-100 text-gray-500',
  refunded:   'bg-red-50 text-red-600',
  cancelled:  'bg-gray-100 text-gray-500',
}
const STATUS_LABEL = {
  approved:   'Aprobado',
  pending:    'Pendiente',
  authorized: 'Autorizado — sin capturar',
  rejected:   'Rechazado',
  refunded:   'Reembolsado',
  cancelled:  'Autorización cancelada',
}

// Motivo de cada solicitud de crédito. `turno_vencido`/`ausencia` las abre el
// cron cuando la consulta no se prestó; `cancelacion_paciente` la pide el
// paciente. Ver docs/estados-consulta.md.
const MOTIVO_REFUND = {
  turno_vencido:        { label: 'Turno vencido',            cls: 'status-expired' },
  ausencia:             { label: 'Ausencia',                 cls: 'status-cancelled' },
  cancelacion_paciente: { label: 'Cancelada por el paciente', cls: 'status-in-progress' },
}
const MOTIVOS_PLATAFORMA = ['turno_vencido', 'ausencia']

export default function SuperAdminPayments() {
  const [payments, setPayments] = useState([])
  const [pendingRefunds, setPendingRefunds] = useState([])
  const [pendingConversions, setPendingConversions] = useState([])
  const [pendingSettlements, setPendingSettlements] = useState([])
  const [reassignments, setReassignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [approvingId, setApprovingId] = useState(null)
  const [settlingId, setSettlingId] = useState(null)
  const [confirmSettleId, setConfirmSettleId] = useState(null)
  const [settlingOwedId, setSettlingOwedId] = useState(null)
  const [confirmSettleOwedId, setConfirmSettleOwedId] = useState(null)
  const [forceRefundId, setForceRefundId] = useState(null)
  const [forceRefundReason, setForceRefundReason] = useState('')
  const [forcingRefund, setForcingRefund] = useState(false)

  // Refund-request queue (cancellation → Healthy Credits) — approve/reject
  const [approvingRefundId, setApprovingRefundId] = useState(null)
  const [confirmApproveRefundId, setConfirmApproveRefundId] = useState(null)
  const [rejectingRefundId, setRejectingRefundId] = useState(null)
  // Dos colas distintas: la falla es nuestra (vencimiento/ausencia) o la
  // decisión fue del paciente. El criterio para aprobar no es el mismo.
  const refundsPlataforma = pendingRefunds.filter(p => MOTIVOS_PLATAFORMA.includes(p.refundRequestReason))
  const refundsPaciente   = pendingRefunds.filter(p => !MOTIVOS_PLATAFORMA.includes(p.refundRequestReason))

  const [rejectFormId, setRejectFormId] = useState(null)
  const [rejectReason, setRejectReason] = useState('')

  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', status: '', method: '' })

  const load = () => {
    setLoading(true)
    const apiFilters = {
      ...(filters.dateFrom ? { dateFrom: new Date(filters.dateFrom).toISOString() } : {}),
      ...(filters.dateTo ? { dateTo: new Date(filters.dateTo + 'T23:59:59').toISOString() } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.method ? { method: filters.method } : {}),
    }
    Promise.all([
      paymentsService.getAllPayments(apiFilters),
      paymentsService.getPendingRefundRequests(),
      paymentsService.getPendingConversionRequests(),
      paymentsService.getPendingSettlements(),
      reassignmentsService.getAll(),
    ])
      .then(([pays, refunds, conversions, settlements, reassigns]) => {
        setPayments(pays)
        setPendingRefunds(refunds)
        setPendingConversions(conversions)
        setPendingSettlements(settlements)
        setReassignments(reassigns)
      })
      .catch(() => toast.error('Error al cargar pagos'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = (e) => {
    e.preventDefault()
    load()
  }

  const clearFilters = () => {
    setFilters({ dateFrom: '', dateTo: '', status: '', method: '' })
    setTimeout(load, 0)
  }

  const handleForceRefund = async (tipo) => {
    if (forceRefundReason.trim().length < 5) {
      toast.error('Escribí el motivo de la devolución')
      return
    }
    setForcingRefund(true)
    try {
      const { error } = await mpService.forceRefund(forceRefundId, forceRefundReason.trim(), tipo)
      if (error) throw new Error(error)
      toast.success(tipo === 'credito'
        ? 'Se acreditaron los Healthy Credits'
        : 'Devolución enviada a Mercado Pago')
      setForceRefundId(null)
      load()
    } catch (err) {
      toast.error(err?.message || 'No pudimos hacer la devolución')
    } finally {
      setForcingRefund(false)
    }
  }

  const handleApproveConversion = async (paymentId) => {
    setApprovingId(paymentId)
    try {
      const { data, error } = await mpService.approveMpConversion(paymentId)
      if (error) throw new Error(error)
      toast.success('Devolución por Mercado Pago aprobada')
      load()
    } catch (err) {
      toast.error(err?.message || 'No pudimos aprobar la devolución')
    } finally {
      setApprovingId(null)
    }
  }

  const handleApproveRefund = async (paymentId) => {
    setApprovingRefundId(paymentId)
    try {
      const { data, error } = await mpService.approveRefund(paymentId)
      if (error) throw new Error(error)
      toast.success('Devolución aprobada — se acreditaron los Healthy Credits')
      setConfirmApproveRefundId(null)
      load()
    } catch (err) {
      toast.error(err?.message || 'No pudimos aprobar la devolución')
    } finally {
      setApprovingRefundId(null)
    }
  }

  const handleRejectRefund = async (paymentId) => {
    setRejectingRefundId(paymentId)
    try {
      const { data, error } = await mpService.rejectRefund(paymentId, rejectReason.trim() || undefined)
      if (error) throw new Error(error)
      toast.success('Solicitud de devolución rechazada')
      setRejectFormId(null)
      setRejectReason('')
      load()
    } catch (err) {
      toast.error(err?.message || 'No pudimos rechazar la solicitud')
    } finally {
      setRejectingRefundId(null)
    }
  }

  const handleMarkSettlementPaid = async (paymentId) => {
    setSettlingId(paymentId)
    try {
      const { error } = await paymentsService.markSettlementPaid(paymentId)
      if (error) throw new Error(error.message || error)
      toast.success('Pago marcado como liquidado')
      setConfirmSettleId(null)
      load()
    } catch (err) {
      toast.error(err?.message || 'No pudimos marcar el pago como liquidado')
    } finally {
      setSettlingId(null)
    }
  }

  /** super_admin marca como pagada (transferencia manual) la parte que se le debe al que atendió de verdad. */
  const handleMarkOwedPaid = async (reassignmentId) => {
    setSettlingOwedId(reassignmentId)
    try {
      const { error } = await reassignmentsService.markOwedPaid(reassignmentId)
      if (error) throw new Error(error.message || error)
      toast.success('Transferencia marcada como pagada')
      setConfirmSettleOwedId(null)
      load()
    } catch (err) {
      toast.error(err?.message || 'No pudimos marcar la transferencia como pagada')
    } finally {
      setSettlingOwedId(null)
    }
  }

  const settlementsTotal = useMemo(
    () => pendingSettlements.reduce((s, p) => s + Number(p.manualSettlementAmount || 0), 0),
    [pendingSettlements]
  )

  // Reasignaciones vivas (no 'superseded' ni 'no_payment' — esas no mueven plata).
  const activeReassignments = useMemo(
    () => reassignments.filter(r => ['pending', 'partially_recovered', 'recovered'].includes(r.status)),
    [reassignments]
  )
  // Saldo pendiente de recuperar, agrupado por profesional original — el
  // mismo número que lee mp-payment (get_professional_pending_debt) antes de
  // firmar su próximo cobro directo.
  const debtByProfessional = useMemo(() => {
    const map = new Map()
    for (const r of activeReassignments) {
      if (!['pending', 'partially_recovered'].includes(r.status)) continue
      const remaining = Number(r.amountToRecoverFromOriginal || 0) - Number(r.amountRecovered || 0)
      if (remaining <= 0) continue
      const key = r.originalProfessionalId
      const prev = map.get(key) || { professional: r.original, debt: 0 }
      prev.debt += remaining
      map.set(key, prev)
    }
    return [...map.values()]
  }, [activeReassignments])

  const totals = useMemo(() => {
    // Only 'approved' counts as billed — pre-authorization holds ('authorized')
    // and released holds ('cancelled') never moved real money (spec D4).
    const approved = payments.filter(p => p.status === 'approved')
    return {
      gross: approved.reduce((s, p) => s + Number(p.grossAmount || 0), 0),
      // La comisión de Healthier es `platform_fee`. "Bruto menos neto" también
      // incluía la comisión de Mercado Pago y la inflaba (2026-07-29).
      commission: approved.reduce((s, p) => s + Number(p.platformFee || 0), 0),
      mpFees: approved.reduce((s, p) => s + Number(p.mpFeeActual ?? p.mpFeeEstimated ?? 0), 0),
      // El neto real es el que MP acredita; `net_to_professional` es la parte
      // contractual calculado con una comisión de MP estimada.
      net: approved.reduce((s, p) => s + Number(p.mpNetReceivedAmount ?? p.netToProfessional ?? 0), 0),
      count: approved.length,
    }
  }, [payments])

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title-lg">Pagos</h1>
        <p className="text-text-secondary mt-1">Todos los pagos de consultas procesados en la plataforma</p>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Facturado (bruto)',       value: totals.gross,      icon: CurrencyDollar, color: 'text-blue-600 bg-blue-50' },
          { label: 'Comisión Healthier',      value: totals.commission, icon: Sparkle,        color: 'text-brand bg-brand-muted' },
          { label: 'Fees Mercado Pago',       value: totals.mpFees,     icon: ArrowClockwise, color: 'text-amber-600 bg-amber-50' },
          { label: 'Neto médicos',            value: totals.net,        icon: CheckCircle,    color: 'text-emerald-600 bg-emerald-50' },
        ].map(c => (
          <div key={c.label} className="card">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${c.color}`}>
              <c.icon className="h-5 w-5" />
            </div>
            <p className="text-xl font-semibold text-text-primary">{loading ? '—' : formatARS(c.value)}</p>
            <p className="text-xs text-text-secondary mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* ─── Devoluciones ─── */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-text-primary">Devoluciones</h2>

        {/* Solicitudes de devolución (créditos) — nunca automáticas, revisión
            manual. Separadas por origen: aprobar un crédito porque el turno se
            venció de nuestro lado no es la misma decisión que aprobarlo porque
            el paciente canceló (Mateo, 2026-08-05). */}
        <div className="card border-amber-200 bg-amber-50/60">
          <h3 className="font-semibold text-amber-800 mb-1 flex items-center gap-2">
            Vencidas o con ausencia
            {refundsPlataforma.length > 0 && (
              <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-amber-600 text-white text-xs font-semibold">
                {refundsPlataforma.length}
              </span>
            )}
          </h3>
          <p className="text-xs text-amber-800/80 mb-3">
            El paciente pagó y no recibió la consulta. Las abre el sistema.
          </p>
          {refundsPlataforma.length === 0 ? (
            <p className="text-sm text-text-secondary">No hay solicitudes por vencimiento ni ausencia.</p>
          ) : (
            <div className="space-y-2">
              {refundsPlataforma.map(p => (
                <div key={p.id} className="bg-white rounded-xl p-3 border border-amber-100">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-text-primary text-sm truncate">
                        {p.patient?.fullName || 'Paciente'} <span className="text-text-tertiary font-normal">→</span> {p.professional?.fullName || 'Profesional'}
                      </p>
                      <p className="text-xs text-text-secondary mt-0.5">
                        {formatARS(p.grossAmount)} · Turno: {p.consultation?.scheduledAt ? formatDate(p.consultation.scheduledAt) : '—'} · Solicitado el {formatDate(p.refundRequestedAt)}
                      </p>
                      <span className={`status-badge mt-1.5 ${MOTIVO_REFUND[p.refundRequestReason]?.cls ?? 'status-pending'}`}>
                        {MOTIVO_REFUND[p.refundRequestReason]?.label ?? 'Motivo sin registrar'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {confirmApproveRefundId === p.id ? (
                        <>
                          <button
                            onClick={() => handleApproveRefund(p.id)}
                            disabled={approvingRefundId === p.id}
                            className="btn-primary text-xs px-3 py-2 disabled:opacity-40"
                          >
                            {approvingRefundId === p.id ? <CircleNotch className="h-4 w-4 animate-spin" /> : '¿Confirmar?'}
                          </button>
                          <button
                            onClick={() => setConfirmApproveRefundId(null)}
                            disabled={approvingRefundId === p.id}
                            className="text-xs text-text-secondary hover:text-text-primary"
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmApproveRefundId(p.id)} className="btn-primary text-xs px-3 py-2">
                          Aprobar
                        </button>
                      )}
                      {rejectFormId !== p.id && (
                        <button
                          onClick={() => { setRejectFormId(p.id); setRejectReason('') }}
                          className="btn-secondary text-xs px-3 py-2"
                        >
                          Rechazar
                        </button>
                      )}
                    </div>
                  </div>
                  {rejectFormId === p.id && (
                    <div className="mt-2.5 flex items-center gap-2">
                      <input
                        type="text"
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="Motivo del rechazo (opcional)"
                        className="form-input text-xs flex-1"
                      />
                      <button
                        onClick={() => handleRejectRefund(p.id)}
                        disabled={rejectingRefundId === p.id}
                        className="btn-danger text-xs px-3 py-2 shrink-0 disabled:opacity-40"
                      >
                        {rejectingRefundId === p.id ? <CircleNotch className="h-4 w-4 animate-spin" /> : 'Confirmar rechazo'}
                      </button>
                      <button
                        onClick={() => { setRejectFormId(null); setRejectReason('') }}
                        disabled={rejectingRefundId === p.id}
                        className="text-xs text-text-secondary hover:text-text-primary shrink-0"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card border-amber-200 bg-amber-50/60">
          <h3 className="font-semibold text-amber-800 mb-1 flex items-center gap-2">
            Canceladas por el paciente
            {refundsPaciente.length > 0 && (
              <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-amber-600 text-white text-xs font-semibold">
                {refundsPaciente.length}
              </span>
            )}
          </h3>
          <p className="text-xs text-amber-800/80 mb-3">
            Las pide el paciente al cancelar, dentro de la ventana de reembolso.
          </p>
          {refundsPaciente.length === 0 ? (
            <p className="text-sm text-text-secondary">No hay cancelaciones de pacientes pendientes.</p>
          ) : (
            <div className="space-y-2">
              {refundsPaciente.map(p => (
                <div key={p.id} className="bg-white rounded-xl p-3 border border-amber-100">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-text-primary text-sm truncate">
                        {p.patient?.fullName || 'Paciente'} <span className="text-text-tertiary font-normal">→</span> {p.professional?.fullName || 'Profesional'}
                      </p>
                      <p className="text-xs text-text-secondary mt-0.5">
                        {formatARS(p.grossAmount)} · Turno: {p.consultation?.scheduledAt ? formatDate(p.consultation.scheduledAt) : '—'} · Solicitado el {formatDate(p.refundRequestedAt)}
                      </p>
                      <span className={`status-badge mt-1.5 ${MOTIVO_REFUND[p.refundRequestReason]?.cls ?? 'status-pending'}`}>
                        {MOTIVO_REFUND[p.refundRequestReason]?.label ?? 'Motivo sin registrar'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {confirmApproveRefundId === p.id ? (
                        <>
                          <button
                            onClick={() => handleApproveRefund(p.id)}
                            disabled={approvingRefundId === p.id}
                            className="btn-primary text-xs px-3 py-2 disabled:opacity-40"
                          >
                            {approvingRefundId === p.id ? <CircleNotch className="h-4 w-4 animate-spin" /> : '¿Confirmar?'}
                          </button>
                          <button
                            onClick={() => setConfirmApproveRefundId(null)}
                            disabled={approvingRefundId === p.id}
                            className="text-xs text-text-secondary hover:text-text-primary"
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmApproveRefundId(p.id)} className="btn-primary text-xs px-3 py-2">
                          Aprobar
                        </button>
                      )}
                      {rejectFormId !== p.id && (
                        <button
                          onClick={() => { setRejectFormId(p.id); setRejectReason('') }}
                          className="btn-secondary text-xs px-3 py-2"
                        >
                          Rechazar
                        </button>
                      )}
                    </div>
                  </div>
                  {rejectFormId === p.id && (
                    <div className="mt-2.5 flex items-center gap-2">
                      <input
                        type="text"
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        placeholder="Motivo del rechazo (opcional)"
                        className="form-input text-xs flex-1"
                      />
                      <button
                        onClick={() => handleRejectRefund(p.id)}
                        disabled={rejectingRefundId === p.id}
                        className="btn-danger text-xs px-3 py-2 shrink-0 disabled:opacity-40"
                      >
                        {rejectingRefundId === p.id ? <CircleNotch className="h-4 w-4 animate-spin" /> : 'Confirmar rechazo'}
                      </button>
                      <button
                        onClick={() => { setRejectFormId(null); setRejectReason('') }}
                        disabled={rejectingRefundId === p.id}
                        className="text-xs text-text-secondary hover:text-text-primary shrink-0"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Solicitudes de conversión a devolución por Mercado Pago */}
        <div className="card border-amber-200 bg-amber-50/60">
          <h3 className="font-semibold text-amber-800 mb-3 flex items-center gap-2">
            Solicitudes de devolución por Mercado Pago
            {pendingConversions.length > 0 && (
              <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-amber-600 text-white text-xs font-semibold">
                {pendingConversions.length}
              </span>
            )}
          </h3>
          {pendingConversions.length === 0 ? (
            <p className="text-sm text-text-secondary">No hay solicitudes de conversión a Mercado Pago pendientes.</p>
          ) : (
            <div className="space-y-2">
              {pendingConversions.map(p => (
                <div key={p.id} className="flex items-center gap-3 bg-white rounded-xl p-3 border border-amber-100">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-text-primary text-sm truncate">{p.patient?.fullName || 'Paciente'}</p>
                    <p className="text-xs text-text-secondary mt-0.5">
                      {formatARS(p.grossAmount)} · Solicitado el {formatDate(p.refundConversionRequestedAt)}
                    </p>
                    {!p.mpPaymentId && (
                      <p className="text-xs text-red-500 mt-0.5">Sin mp_payment_id — este pago fue 100% créditos, no hay nada que devolver por MP.</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleApproveConversion(p.id)}
                    disabled={approvingId === p.id || !p.mpPaymentId}
                    className="btn-primary text-xs px-3 py-2 shrink-0 disabled:opacity-40"
                  >
                    {approvingId === p.id ? <CircleNotch className="h-4 w-4 animate-spin" /> : 'Aprobar'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <form onSubmit={applyFilters} className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Desde</label>
          <input type="date" value={filters.dateFrom} onChange={e => setFilters(p => ({ ...p, dateFrom: e.target.value }))} className="form-input text-sm" />
        </div>
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Hasta</label>
          <input type="date" value={filters.dateTo} onChange={e => setFilters(p => ({ ...p, dateTo: e.target.value }))} className="form-input text-sm" />
        </div>
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Estado</label>
          <select value={filters.status} onChange={e => setFilters(p => ({ ...p, status: e.target.value }))} className="form-select text-sm">
            <option value="">Todos</option>
            <option value="approved">Aprobado</option>
            <option value="pending">Pendiente</option>
            <option value="authorized">Autorizado — sin capturar</option>
            <option value="rejected">Rechazado</option>
            <option value="refunded">Reembolsado</option>
            <option value="cancelled">Autorización cancelada</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Método</label>
          <select value={filters.method} onChange={e => setFilters(p => ({ ...p, method: e.target.value }))} className="form-select text-sm">
            <option value="">Todos</option>
            <option value="card">Tarjeta</option>
            <option value="credits">Créditos</option>
            <option value="mixed">Mixto</option>
          </select>
        </div>
        <button type="submit" className="btn-primary text-sm px-4 py-2">Filtrar</button>
        <button type="button" onClick={clearFilters} className="text-sm text-text-secondary hover:text-text-primary">Limpiar</button>
      </form>

      {/* Pagos pendientes a profesionales — cuenta corriente */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-text-primary flex items-center gap-2">
              <HandCoins className="h-5 w-5 text-brand" />
              Pagos pendientes a profesionales
            </h2>
            <p className="text-xs text-text-secondary mt-1">
              Consultas pagadas con Healthy Credits — deuda de Healthier con el profesional, se salda por transferencia manual.
            </p>
          </div>
          {pendingSettlements.length > 0 && (
            <div className="text-right shrink-0">
              <p className="text-lg font-semibold text-text-primary">{formatARS(settlementsTotal)}</p>
              <p className="text-xs text-text-secondary">{pendingSettlements.length} pendiente{pendingSettlements.length !== 1 ? 's' : ''}</p>
            </div>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-10 bg-bg-surface rounded-lg animate-pulse" />)}</div>
        ) : pendingSettlements.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <HandCoins className="h-10 w-10 text-text-muted mb-3" />
            <p className="text-text-secondary text-sm">No hay pagos pendientes a profesionales.</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr>
                  <th className="table-header">Fecha</th>
                  <th className="table-header">Profesional</th>
                  <th className="table-header">Consulta</th>
                  <th className="table-header text-right">Monto adeudado</th>
                  <th className="table-header text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {pendingSettlements.map(p => (
                  <tr key={p.id} className="table-row">
                    <td className="table-cell whitespace-nowrap text-text-tertiary">{formatDate(p.createdAt)}</td>
                    <td className="table-cell">
                      <p className="text-text-primary truncate max-w-[180px]">{p.professional?.fullName || '—'}</p>
                      <p className="text-xs text-text-tertiary truncate max-w-[180px]">{p.professional?.email || ''}</p>
                    </td>
                    <td className="table-cell text-text-tertiary">
                      {p.consultation?.scheduledAt ? formatDate(p.consultation.scheduledAt) : '—'}
                    </td>
                    <td className="table-cell text-right font-semibold">{formatARS(p.manualSettlementAmount)}</td>
                    <td className="table-cell text-right">
                      {confirmSettleId === p.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleMarkSettlementPaid(p.id)}
                            disabled={settlingId === p.id}
                            className="btn-primary text-xs px-3 py-2 disabled:opacity-40"
                          >
                            {settlingId === p.id ? <CircleNotch className="h-4 w-4 animate-spin" /> : '¿Confirmar?'}
                          </button>
                          <button
                            onClick={() => setConfirmSettleId(null)}
                            disabled={settlingId === p.id}
                            className="text-xs text-text-secondary hover:text-text-primary"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmSettleId(p.id)}
                          className="btn-secondary text-xs px-3 py-2"
                        >
                          Marcar pagado
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reasignaciones y deudas por profesional (migración 102) */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-text-primary flex items-center gap-2">
              <ArrowsLeftRight className="h-5 w-5 text-brand" />
              Reasignaciones y deudas
            </h2>
            <p className="text-xs text-text-secondary mt-1">
              Consultas reasignadas desde Consultas — el cobro sigue yendo contra el profesional original; su próxima consulta directa se descuenta automáticamente hasta cubrir la deuda.
            </p>
          </div>
        </div>

        {debtByProfessional.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-2">Saldo pendiente de recuperar</p>
            <div className="flex flex-wrap gap-2">
              {debtByProfessional.map(({ professional, debt }) => (
                <span key={professional?.id ?? debt} className="inline-flex items-center gap-1.5 text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-full px-3 py-1.5">
                  {professional?.fullName || 'Profesional'} — debe {formatARS(debt)}
                </span>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-10 bg-bg-surface rounded-lg animate-pulse" />)}</div>
        ) : activeReassignments.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <ArrowsLeftRight className="h-10 w-10 text-text-muted mb-3" />
            <p className="text-text-secondary text-sm">No hay consultas reasignadas.</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr>
                  <th className="table-header">Fecha</th>
                  <th className="table-header">Original → Atendió</th>
                  <th className="table-header text-right">Neto en juego</th>
                  <th className="table-header text-right">Recuperado del original</th>
                  <th className="table-header text-right">Debe al que atendió</th>
                  <th className="table-header">Estado</th>
                  <th className="table-header text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {activeReassignments.map(r => (
                  <tr key={r.id} className="table-row">
                    <td className="table-cell whitespace-nowrap text-text-tertiary">{formatDate(r.createdAt)}</td>
                    <td className="table-cell">
                      <p className="text-text-primary truncate max-w-[220px]">
                        {r.original?.fullName || '—'} <span className="text-text-tertiary font-normal">→</span> {r.covering?.fullName || '—'}
                      </p>
                    </td>
                    <td className="table-cell text-right">{formatARS(r.netAmount)}</td>
                    <td className="table-cell text-right text-text-tertiary">
                      {formatARS(r.amountRecovered)} / {formatARS(r.amountToRecoverFromOriginal)}
                    </td>
                    <td className="table-cell text-right font-semibold">
                      {formatARS(r.amountOwedToCoveringProfessional)}
                      {r.owedSettledAt && <span className="block text-[10px] font-normal text-emerald-600">pagado {formatDate(r.owedSettledAt)}</span>}
                    </td>
                    <td className="table-cell">
                      <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${
                        r.status === 'recovered' ? 'bg-emerald-50 text-emerald-600'
                        : r.status === 'partially_recovered' ? 'bg-amber-50 text-amber-700'
                        : 'bg-amber-50 text-amber-600'
                      }`}>
                        {r.status === 'recovered' ? 'Recuperado' : r.status === 'partially_recovered' ? 'Parcial' : 'Pendiente'}
                      </span>
                    </td>
                    <td className="table-cell text-right">
                      {Number(r.amountOwedToCoveringProfessional || 0) > 0 && !r.owedSettledAt && (
                        confirmSettleOwedId === r.id ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleMarkOwedPaid(r.id)}
                              disabled={settlingOwedId === r.id}
                              className="btn-primary text-xs px-3 py-2 disabled:opacity-40"
                            >
                              {settlingOwedId === r.id ? <CircleNotch className="h-4 w-4 animate-spin" /> : '¿Confirmar?'}
                            </button>
                            <button
                              onClick={() => setConfirmSettleOwedId(null)}
                              disabled={settlingOwedId === r.id}
                              className="text-xs text-text-secondary hover:text-text-primary"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmSettleOwedId(r.id)}
                            className="btn-secondary text-xs px-3 py-2"
                          >
                            Marcar pagado
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-text-primary">Pagos</h2>
          <span className="text-xs text-text-secondary">{payments.length} registros</span>
        </div>
        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-bg-surface rounded-lg animate-pulse" />)}</div>
        ) : payments.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <Users className="h-10 w-10 text-text-muted mb-3" />
            <p className="text-text-secondary text-sm">No hay pagos para estos filtros</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr>
                  <th className="table-header">Fecha</th>
                  <th className="table-header">Paciente</th>
                  <th className="table-header">Profesional</th>
                  <th className="table-header">Consulta</th>
                  <th className="table-header text-right">Bruto</th>
                  <th className="table-header text-right">Créditos</th>
                  <th className="table-header text-right">Cobrado</th>
                  <th className="table-header text-right">Fee MP</th>
                  <th className="table-header text-right">Comisión</th>
                  <th className="table-header text-right">Neto médico</th>
                  <th className="table-header">Método</th>
                  <th className="table-header">Estado</th>
                  <th className="table-header">MP ID / Refund</th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => {
                  const commission = Number(p.platformFee || 0)
                  return (
                    <tr key={p.id} className="table-row">
                      <td className="table-cell whitespace-nowrap text-text-tertiary">{formatDate(p.createdAt)}</td>
                      <td className="table-cell truncate max-w-[140px]">{p.patient?.fullName || '—'}</td>
                      <td className="table-cell truncate max-w-[140px]">{p.professional?.fullName || '—'}</td>
                      <td className="table-cell text-text-tertiary">
                        {p.consultation?.scheduledAt ? formatDate(p.consultation.scheduledAt) : '—'}
                        {p.consultation?.status && (
                          <span className="ml-1.5 text-[10px] uppercase tracking-wide text-text-muted">{p.consultation.status}</span>
                        )}
                      </td>
                      <td className="table-cell text-right">{formatARS(p.grossAmount)}</td>
                      <td className="table-cell text-right text-text-tertiary">{p.creditsUsed > 0 ? formatARS(p.creditsUsed) : '—'}</td>
                      <td className="table-cell text-right">{formatARS(p.chargedAmount)}</td>
                      <td className="table-cell text-right text-text-tertiary">{formatARS(p.mpFeeActual ?? p.mpFeeEstimated)}</td>
                      <td className="table-cell text-right text-text-tertiary">{formatARS(commission)}</td>
                      <td className="table-cell text-right font-semibold">
                        {formatARS(p.mpNetReceivedAmount ?? p.netToProfessional)}
                        {p.mpNetReceivedAmount == null && (
                          <span className="block text-[10px] font-normal text-text-tertiary">estimado</span>
                        )}
                      </td>
                      <td className="table-cell">{METHOD_LABELS[p.method] || p.method}</td>
                      <td className="table-cell">
                        <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${STATUS_BADGE[p.status] ?? 'bg-gray-100 text-gray-500'}`}>
                          {STATUS_LABEL[p.status] ?? p.status}
                        </span>
                        {/* Devolución directa: el flujo normal arranca con el
                            paciente cancelando ANTES del turno, así que un pago
                            de una consulta ya atendida no tenía ninguna salida.
                            Pide motivo, que queda asentado. */}
                        {p.status === 'approved' && p.mpPaymentId && (
                          <button
                            onClick={() => { setForceRefundId(p.id); setForceRefundReason('') }}
                            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-danger border border-danger/40 rounded-full px-2.5 py-1 hover:bg-danger/10 transition-colors"
                          >
                            <ArrowUUpLeft className="h-3 w-3" /> Devolver
                          </button>
                        )}
                        {p.refundReason && (
                          <p className="text-[10px] text-text-tertiary mt-0.5 max-w-[140px]">
                            {p.refundForcedBy ? 'Devuelto por admin: ' : ''}{p.refundReason}
                          </p>
                        )}
                      </td>
                      <td className="table-cell text-text-tertiary">
                        <p className="truncate max-w-[120px]">{p.mpPaymentId || '—'}</p>
                        {p.refundType && (
                          <p className="text-[10px] uppercase tracking-wide mt-0.5">
                            Refund: {p.refundType}
                            {p.refundConversionRequestedAt && !p.refundConversionResolvedAt ? ' (conversión pendiente)' : ''}
                            {p.refundConversionResolvedAt ? ' (convertido a MP)' : ''}
                          </p>
                        )}
                        {/* On-demand pre-auth timestamps (spec D4) */}
                        {p.authorizedAt && (
                          <p
                            className="text-[10px] uppercase tracking-wide mt-0.5"
                            title={`Autorizado: ${formatDate(p.authorizedAt)}${p.capturedAt ? ` · Capturado: ${formatDate(p.capturedAt)}` : ''}${p.authCancelledAt ? ` · Cancelado: ${formatDate(p.authCancelledAt)}` : ''}`}
                          >
                            {p.capturedAt ? `Capturado ${formatDate(p.capturedAt)}` : p.authCancelledAt ? `Autorización cancelada` : `Autorizado ${formatDate(p.authorizedAt)}`}
                          </p>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Devolución directa — pide motivo antes de mover plata real. */}
      <Modal
        open={Boolean(forceRefundId)}
        onClose={() => setForceRefundId(null)}
        title="Devolver este pago"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Se devuelve el total. Por Mercado Pago es plata real y no se puede deshacer;
            en Healthy Credits el monto queda como saldo del paciente dentro de la
            plataforma. El motivo queda asentado en la bitácora de la consulta.
          </p>
          <div>
            <label className="form-label">Motivo</label>
            <textarea
              value={forceRefundReason}
              onChange={e => setForceRefundReason(e.target.value)}
              rows={3}
              placeholder="Ej: el profesional no se conectó y el paciente reclamó"
              className="form-textarea"
            />
          </div>
          {/* Dos formas de devolver, y la diferencia importa: por MP se va la
              plata de verdad y la comisión no vuelve; en créditos queda adentro
              de la plataforma. Cuál corresponde depende de por qué se devuelve,
              así que se elige acá y no se decide por defecto. */}
          <div className="space-y-2">
            <button
              onClick={() => handleForceRefund('mp')}
              disabled={forcingRefund}
              className="btn-danger w-full py-2.5"
            >
              {forcingRefund ? 'Procesando…' : 'Devolver la plata por Mercado Pago'}
            </button>
            <button
              onClick={() => handleForceRefund('credito')}
              disabled={forcingRefund}
              className="btn-secondary w-full py-2.5"
            >
              {forcingRefund ? 'Procesando…' : 'Devolver en Healthy Credits'}
            </button>
            <button
              onClick={() => setForceRefundId(null)}
              className="w-full py-2 text-sm text-text-secondary hover:text-text-primary"
            >
              Cancelar
            </button>
          </div>
        </div>
      </Modal>
    </div>

  )
}
