import { useState, useEffect, useMemo } from 'react'
import { TrendUp, TrendDown, CurrencyDollar, Clock, CheckCircle, ArrowClockwise, CaretDown, Users, Info, HandCoins } from '@phosphor-icons/react';
import { paymentsService } from '../../services/paymentsService'
import { toast } from '../../components/Toast'

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function formatARS(amount) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount || 0)
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
}

const METHOD_LABELS = { card: 'Tarjeta', credits: 'Créditos', mixed: 'Mixto' }

const STATUS_LABELS = {
  approved: { label: 'Cobrado',     className: 'bg-emerald-100 text-emerald-700' },
  pending:  { label: 'Procesando',  className: 'bg-amber-100 text-amber-700' },
  rejected: { label: 'Rechazado',   className: 'bg-gray-100 text-gray-500' },
  refunded: { label: 'Reembolsado',className: 'bg-red-100 text-red-600' },
}

const RANGE_OPTIONS = [
  { label: 'Este mes', months: 1 },
  { label: '3 meses',  months: 3 },
  { label: '6 meses',  months: 6 },
  { label: '1 año',    months: 12 },
  { label: 'Todo',     months: 999 },
]

// Date used to bucket a payment into a month/week — prefer when the
// consultation actually happened, fall back to when the payment was created.
function paymentDate(p) {
  return p.consultation?.completedAt || p.consultation?.scheduledAt || p.createdAt
}

export default function Ganancias({ profile }) {
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState(1)
  const [showRangeMenu, setShowRangeMenu] = useState(false)
  const [settlementBalance, setSettlementBalance] = useState(0)

  useEffect(() => {
    if (!profile?.id) return
    paymentsService.getMyPayments()
      .then(setPayments)
      .catch(() => toast.error('Error al cargar ganancias'))
      .finally(() => setLoading(false))
    paymentsService.getMySettlementBalance()
      .then(({ pending }) => setSettlementBalance(pending))
      .catch(() => {})
  }, [profile?.id])

  // ── Derived totals ──────────────────────────────────────────────────────────
  const now = new Date()

  const thisMonth = useMemo(() => {
    return payments.filter(p => {
      const d = new Date(paymentDate(p))
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    })
  }, [payments])

  const lastMonth = useMemo(() => {
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return payments.filter(p => {
      const d = new Date(paymentDate(p))
      return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear()
    })
  }, [payments])

  const thisWeek = useMemo(() => {
    const startOfWeek = new Date(now)
    startOfWeek.setDate(now.getDate() - now.getDay())
    startOfWeek.setHours(0, 0, 0, 0)
    return payments.filter(p => new Date(paymentDate(p)) >= startOfWeek)
  }, [payments])

  // El neto real es el que informa Mercado Pago (`mpNetReceivedAmount`): es lo que
  // efectivamente se acredita en la cuenta del profesional. `netToProfessional` es
  // la parte contractual del profesional (80% desde el 2026-07-29; 78% antes),
  // calculada con una comisión de MP ESTIMADA, y se queda corta
  // cuando la comisión real es menor — en el pago 170000525607 decía 780 y MP
  // acreditó 818,90. Mostrar el contractual acá era subinformar lo que gana.
  const netDe = p => Number(p.mpNetReceivedAmount ?? p.netToProfessional ?? 0)
  const netOf = (list, status) => list.reduce((s, p) => s + (p.status === status ? netDe(p) : 0), 0)

  const netTotal      = netOf(payments, 'approved')
  const pendingTotal   = netOf(payments, 'pending')
  const refundTotal    = payments.reduce((s, p) => s + (p.status === 'refunded' ? netDe(p) : 0), 0)
  const grossTotal     = payments.reduce((s, p) => s + (p.status === 'approved' ? Number(p.grossAmount || 0) : 0), 0)
  // La comisión de Healthier es `platformFee`, no "bruto menos neto": esa resta
  // incluía también la comisión de Mercado Pago y hacía parecer que Healthier se
  // quedaba con el 22% cuando se queda con el 14%.
  const commissionTotal = payments.reduce((s, p) => s + (p.status === 'approved' ? Number(p.platformFee || 0) : 0), 0)
  const mpFeeTotal      = payments.reduce((s, p) => s + (p.status === 'approved' ? Number(p.mpFeeActual ?? p.mpFeeEstimated ?? 0) : 0), 0)

  const thisMonthNet = netOf(thisMonth, 'approved')
  const lastMonthNet = netOf(lastMonth, 'approved')
  const weekNet      = netOf(thisWeek, 'approved')

  const monthDelta = lastMonthNet > 0
    ? Math.round(((thisMonthNet - lastMonthNet) / lastMonthNet) * 100)
    : thisMonthNet > 0 ? 100 : 0

  // ── Monthly chart data ──────────────────────────────────────────────────────
  const monthlyData = useMemo(() => {
    const numMonths = Math.min(range, 12)
    const months = []
    for (let i = numMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const label = MONTH_NAMES[d.getMonth()]
      const items = payments.filter(p => {
        const pd = new Date(paymentDate(p))
        return pd.getMonth() === d.getMonth() && pd.getFullYear() === d.getFullYear()
      })
      const net        = netOf(items, 'approved')
      const pending     = netOf(items, 'pending')
      const presencial  = items.reduce((s, p) => s + (p.status === 'approved' && p.consultation?.modality !== 'video' ? Number(p.mpNetReceivedAmount ?? p.netToProfessional ?? 0) : 0), 0)
      const video       = items.reduce((s, p) => s + (p.status === 'approved' && p.consultation?.modality === 'video' ? Number(p.mpNetReceivedAmount ?? p.netToProfessional ?? 0) : 0), 0)
      const countPres   = items.filter(p => p.status === 'approved' && p.consultation?.modality !== 'video').length
      const countVideo  = items.filter(p => p.status === 'approved' && p.consultation?.modality === 'video').length
      months.push({ key, label, net, pending, presencial, video, countPres, countVideo, count: items.filter(p => p.status === 'approved').length })
    }
    return months
  }, [payments, range])

  const chartMax = Math.max(...monthlyData.map(m => m.net + m.pending), 1)

  // ── Filtered history ────────────────────────────────────────────────────────
  const filteredHistory = useMemo(() => {
    if (range >= 999) return payments
    const cutoff = new Date(now.getFullYear(), now.getMonth() - range + 1, 1)
    return payments.filter(p => new Date(paymentDate(p)) >= cutoff)
  }, [payments, range])

  const selectedRangeLabel = RANGE_OPTIONS.find(r => r.months === range)?.label || 'Este mes'

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-bg-surface rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="h-28 bg-bg-surface rounded-2xl" />)}
        </div>
        <div className="h-56 bg-bg-surface rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Ganancias</h1>
          <div className="flex items-start gap-2 mt-2 max-w-lg">
            <Info className="h-4 w-4 text-brand mt-0.5 shrink-0" />
            {/* La frase original decía que la comisión de Mercado Pago la absorbe
                Healthier. Es al revés y se comprobó contra la API de MP: cobra las
                dos comisiones al `collector`, o sea al profesional. Desde el
                2026-07-29 el split es 20/80 flat, así que el 80% se puede nombrar
                — pero NO como "neto", porque de esa parte MP todavía descuenta lo
                suyo. Prometer un número fijo y depositar otro es la forma más
                rápida de que un médico desconfíe del resto de la pantalla. */}
            <p className="text-sm text-text-secondary">
              Te queda el <span className="font-semibold text-text-primary">80% del valor de la consulta</span> y
              Healthier se lleva el 20%. Mercado Pago cobra su comisión sobre tu parte, así
              que el neto de abajo — lo que MP efectivamente te acredita — es un poco menor.
            </p>
          </div>
        </div>

        {/* Range picker */}
        <div className="relative shrink-0">
          <button
            onClick={() => setShowRangeMenu(v => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-border-default rounded-xl text-sm font-medium text-text-primary hover:bg-bg-surface transition-colors"
          >
            {selectedRangeLabel}
            <CaretDown className="h-4 w-4 text-text-secondary" />
          </button>
          {showRangeMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowRangeMenu(false)} />
              <div className="absolute right-0 top-11 z-20 bg-white border border-border-default rounded-xl shadow-lg overflow-hidden min-w-[120px]">
                {RANGE_OPTIONS.map(opt => (
                  <button
                    key={opt.months}
                    onClick={() => { setRange(opt.months); setShowRangeMenu(false) }}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${range === opt.months ? 'bg-brand-muted text-brand font-medium' : 'text-text-primary hover:bg-bg-surface'}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── A cobrar de Healthier (cuenta corriente) ── */}
      {settlementBalance > 0 && (
        <div className="card bg-white border-brand/20">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-muted flex items-center justify-center shrink-0">
              <HandCoins className="h-5 w-5 text-brand" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">
                <span className="font-semibold text-text-primary">A cobrar de Healthier: {formatARS(settlementBalance)}</span> — consultas pagadas con Healthy Credits; Healthier te lo transfiere por fuera de la app.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

        {/* This month */}
        <div className="card bg-white">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Neto — Este mes</p>
              <p className="text-3xl font-bold text-text-primary mt-1">{formatARS(thisMonthNet)}</p>
              <p className="text-xs text-text-secondary mt-1">{thisMonth.filter(p => p.status === 'approved').length} consulta{thisMonth.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
              <TrendUp className="h-5 w-5 text-emerald-600" />
            </div>
          </div>
          {lastMonthNet > 0 || thisMonthNet > 0 ? (
            <div className={`flex items-center gap-1 mt-3 text-xs font-medium ${monthDelta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {monthDelta >= 0
                ? <TrendUp className="h-3.5 w-3.5" />
                : <TrendDown className="h-3.5 w-3.5" />
              }
              {Math.abs(monthDelta)}% vs. mes anterior
            </div>
          ) : null}
        </div>

        {/* This week */}
        <div className="card bg-white">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Neto — Esta semana</p>
              <p className="text-3xl font-bold text-text-primary mt-1">{formatARS(weekNet)}</p>
              <p className="text-xs text-text-secondary mt-1">{thisWeek.filter(p => p.status === 'approved').length} consulta{thisWeek.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
              <CurrencyDollar className="h-5 w-5 text-blue-600" />
            </div>
          </div>
          {pendingTotal > 0 && (
            <div className="flex items-center gap-1 mt-3 text-xs text-amber-600 font-medium">
              <Clock className="h-3.5 w-3.5" />
              {formatARS(pendingTotal)} procesando
            </div>
          )}
        </div>

        {/* Total histórico */}
        <div className="card bg-white">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Neto — Total histórico</p>
              <p className="text-3xl font-bold text-text-primary mt-1">{formatARS(netTotal)}</p>
              <p className="text-xs text-text-secondary mt-1">
                Bruto {formatARS(grossTotal)} · Comisión Healthier {formatARS(commissionTotal)} · Comisión MP {formatARS(mpFeeTotal)}
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-brand-muted flex items-center justify-center shrink-0">
              <CheckCircle className="h-5 w-5 text-brand" />
            </div>
          </div>
          {refundTotal > 0 && (
            <div className="flex items-center gap-1 mt-3 text-xs text-red-500 font-medium">
              <ArrowClockwise className="h-3.5 w-3.5" />
              {formatARS(refundTotal)} reembolsado
            </div>
          )}
        </div>
      </div>

      {/* ── Monthly chart ── */}
      <div className="card bg-white">
        <h2 className="font-semibold text-text-primary mb-6">Evolución mensual (neto)</h2>

        {monthlyData.every(m => m.net + m.pending === 0) ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <TrendUp className="h-10 w-10 text-text-muted mb-3" />
            <p className="text-text-secondary text-sm">Sin datos de ganancias en el período seleccionado</p>
          </div>
        ) : (
          <>
            {/* Bars */}
            <div className="flex items-end gap-2 h-40">
              {monthlyData.map(m => {
                const netPct        = (m.net / chartMax) * 100
                const pendingPct     = (m.pending / chartMax) * 100
                const isCurrentMonth = m.key === `${now.getFullYear()}-${now.getMonth()}`
                const hasData        = m.net + m.pending > 0
                return (
                  <div key={m.key} className="flex-1 flex flex-col items-center gap-1 group relative">
                    {/* Tooltip — desglose presencial vs video */}
                    {hasData && (
                      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        <div className="bg-text-primary text-white rounded-xl px-3 py-2.5 shadow-lg text-left min-w-[160px]">
                          <p className="text-xs font-semibold mb-2 text-white/80 uppercase tracking-wide">
                            {m.label} · {m.count} consulta{m.count !== 1 ? 's' : ''}
                          </p>
                          {m.countPres > 0 && (
                            <div className="flex items-center justify-between gap-3 mb-1">
                              <span className="flex items-center gap-1.5 text-xs text-white/80">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                                Presencial ({m.countPres})
                              </span>
                              <span className="text-xs font-semibold text-white">{formatARS(m.presencial)}</span>
                            </div>
                          )}
                          {m.countVideo > 0 && (
                            <div className="flex items-center justify-between gap-3 mb-1">
                              <span className="flex items-center gap-1.5 text-xs text-white/80">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                                Videollamada ({m.countVideo})
                              </span>
                              <span className="text-xs font-semibold text-white">{formatARS(m.video)}</span>
                            </div>
                          )}
                          {m.pending > 0 && (
                            <div className="flex items-center justify-between gap-3 pt-1.5 mt-1.5 border-t border-white/20">
                              <span className="text-xs text-amber-300">Procesando</span>
                              <span className="text-xs font-semibold text-amber-300">{formatARS(m.pending)}</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-3 pt-1.5 mt-1 border-t border-white/20">
                            <span className="text-xs text-white/60">Total neto</span>
                            <span className="text-xs font-bold text-white">{formatARS(m.net + m.pending)}</span>
                          </div>
                        </div>
                        {/* Arrow */}
                        <div className="w-2.5 h-2.5 bg-text-primary rotate-45 mx-auto -mt-1.5 rounded-sm" />
                      </div>
                    )}

                    {/* Bar column */}
                    <div className="w-full flex flex-col justify-end rounded-t-sm overflow-hidden" style={{ height: '120px' }}>
                      {/* Pending portion (on top) */}
                      {m.pending > 0 && (
                        <div
                          className="w-full bg-amber-200 transition-all duration-700"
                          style={{ height: `${pendingPct}%` }}
                        />
                      )}
                      {/* Net portion (bottom) */}
                      <div
                        className={`w-full transition-all duration-700 rounded-t-sm ${isCurrentMonth ? 'bg-brand' : 'bg-emerald-400'}`}
                        style={{ height: `${Math.max(netPct, m.net > 0 ? 2 : 0)}%` }}
                      />
                      {/* Empty bar placeholder */}
                      {m.net + m.pending === 0 && (
                        <div className="w-full bg-bg-surface" style={{ height: '4px' }} />
                      )}
                    </div>

                    <span className={`text-xs capitalize ${isCurrentMonth ? 'text-brand font-semibold' : 'text-text-secondary'}`}>
                      {m.label}
                    </span>
                    {m.count > 0 && (
                      <span className="text-[10px] text-text-muted">{m.count}</span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border-default">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-emerald-400" />
                <span className="text-xs text-text-secondary">Cobrado (neto)</span>
              </div>
              {pendingTotal > 0 && (
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm bg-amber-200" />
                  <span className="text-xs text-text-secondary">Procesando</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-brand" />
                <span className="text-xs text-text-secondary">Mes actual</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Transaction history ── */}
      <div className="card bg-white">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-text-primary">Historial de pagos</h2>
          <span className="text-xs text-text-secondary">{filteredHistory.length} registros</span>
        </div>

        {filteredHistory.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <Users className="h-10 w-10 text-text-muted mb-3" />
            <p className="text-text-secondary text-sm">No hay pagos en este período</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-border-default">
                  <th className="text-left text-xs font-medium text-text-secondary pb-3 px-4 sm:px-0">Paciente</th>
                  <th className="text-left text-xs font-medium text-text-secondary pb-3 px-2">Fecha</th>
                  <th className="text-left text-xs font-medium text-text-secondary pb-3 px-2">Método</th>
                  <th className="text-right text-xs font-medium text-text-secondary pb-3 px-2">Bruto</th>
                  <th className="text-right text-xs font-medium text-text-secondary pb-3 px-2">Comisión</th>
                  <th className="text-right text-xs font-medium text-text-secondary pb-3 px-2">Neto</th>
                  <th className="text-right text-xs font-medium text-text-secondary pb-3 px-4 sm:px-0">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {filteredHistory.map(p => {
                  const badge = STATUS_LABELS[p.status] || STATUS_LABELS.pending
                  const patientName = p.patient?.fullName || 'Paciente'
                  const commission = Number(p.platformFee || 0) + Number(p.mpFeeActual ?? p.mpFeeEstimated ?? 0)
                  const isRefund = p.status === 'refunded'
                  return (
                    <tr key={p.id} className="hover:bg-bg-surface/50 transition-colors">
                      <td className="py-3 px-4 sm:px-0">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-brand-muted flex items-center justify-center shrink-0 text-brand font-semibold text-xs">
                            {patientName.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-text-primary">{patientName}</p>
                            {p.consultation?.consultationType?.name && (
                              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-brand-muted text-brand font-medium mt-0.5 inline-block">
                                {p.consultation.consultationType.name}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-2 text-sm text-text-secondary whitespace-nowrap">
                        {formatDate(paymentDate(p))}
                      </td>
                      <td className="py-3 px-2 text-sm text-text-secondary whitespace-nowrap">
                        {METHOD_LABELS[p.method] || p.method}
                      </td>
                      <td className="py-3 px-2 text-right text-sm text-text-secondary">
                        {formatARS(p.grossAmount)}
                      </td>
                      <td className="py-3 px-2 text-right text-sm text-text-tertiary">
                        -{formatARS(commission)}
                      </td>
                      <td className="py-3 px-2 text-right">
                        <span className={`text-sm font-semibold ${isRefund ? 'text-red-500 line-through' : 'text-emerald-700'}`}>
                          {formatARS(netDe(p))}
                        </span>
                      </td>
                      <td className="py-3 px-4 sm:px-0 text-right">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Footer totals */}
            <div className="mt-4 pt-4 border-t border-border-default flex items-center justify-between px-4 sm:px-0">
              <span className="text-sm text-text-secondary font-medium">Neto del período</span>
              <span className="text-sm font-bold text-text-primary">
                {formatARS(netOf(filteredHistory, 'approved'))}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
