import { useState, useEffect, useMemo } from 'react'
import { CurrencyDollar, Users, ArrowClockwise, CheckCircle, CircleNotch, Sparkle } from '@phosphor-icons/react'
import { paymentsService } from '../../services/paymentsService'
import { mpService } from '../../services/mpService'
import { toast } from '../../components/Toast'

function formatARS(amount) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount || 0)
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const METHOD_LABELS = { card: 'Tarjeta', credits: 'Créditos', mixed: 'Mixto' }
const STATUS_BADGE = {
  approved: 'bg-emerald-50 text-emerald-600',
  pending:  'bg-amber-50 text-amber-600',
  rejected: 'bg-gray-100 text-gray-500',
  refunded: 'bg-red-50 text-red-600',
}
const STATUS_LABEL = { approved: 'Aprobado', pending: 'Pendiente', rejected: 'Rechazado', refunded: 'Reembolsado' }

export default function SuperAdminPayments() {
  const [payments, setPayments] = useState([])
  const [pendingConversions, setPendingConversions] = useState([])
  const [loading, setLoading] = useState(true)
  const [approvingId, setApprovingId] = useState(null)

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
      paymentsService.getPendingConversionRequests(),
    ])
      .then(([pays, conversions]) => {
        setPayments(pays)
        setPendingConversions(conversions)
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

  const totals = useMemo(() => {
    const approved = payments.filter(p => p.status === 'approved')
    return {
      gross: approved.reduce((s, p) => s + Number(p.grossAmount || 0), 0),
      commission: approved.reduce((s, p) => s + (Number(p.grossAmount || 0) - Number(p.netToProfessional || 0)), 0),
      mpFees: approved.reduce((s, p) => s + Number(p.mpFeeActual ?? p.mpFeeEstimated ?? 0), 0),
      net: approved.reduce((s, p) => s + Number(p.netToProfessional || 0), 0),
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

      {/* Pending MP-conversion requests */}
      {pendingConversions.length > 0 && (
        <div className="card border-amber-200 bg-amber-50/60">
          <h2 className="font-semibold text-amber-800 mb-3">
            Solicitudes de devolución por Mercado Pago
            <span className="ml-2 inline-flex items-center justify-center h-5 w-5 rounded-full bg-amber-600 text-white text-xs font-semibold">
              {pendingConversions.length}
            </span>
          </h2>
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
        </div>
      )}

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
            <option value="rejected">Rechazado</option>
            <option value="refunded">Reembolsado</option>
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
                  const commission = Number(p.grossAmount || 0) - Number(p.netToProfessional || 0)
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
                      <td className="table-cell text-right font-semibold">{formatARS(p.netToProfessional)}</td>
                      <td className="table-cell">{METHOD_LABELS[p.method] || p.method}</td>
                      <td className="table-cell">
                        <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${STATUS_BADGE[p.status] ?? 'bg-gray-100 text-gray-500'}`}>
                          {STATUS_LABEL[p.status] ?? p.status}
                        </span>
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
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
