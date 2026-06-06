import { useState, useEffect, useMemo } from 'react'
import { TrendUp, TrendDown, CurrencyDollar, Clock, CheckCircle, ArrowClockwise, CaretDown, Users } from '@phosphor-icons/react';
import { consultationsService } from '../../services/consultationsService'
import { professionalService } from '../../services/professionalService'
import { toast } from '../../components/Toast'

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function formatARS(amount) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount || 0)
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
}

const PAYMENT_LABELS = {
  paid:            { label: 'Cobrado',    className: 'bg-emerald-100 text-emerald-700' },
  pending_payment: { label: 'Pendiente',  className: 'bg-amber-100 text-amber-700' },
  refunded:        { label: 'Reembolsado',className: 'bg-red-100 text-red-600' },
}

const RANGE_OPTIONS = [
  { label: '3 meses', months: 3 },
  { label: '6 meses', months: 6 },
  { label: '1 año',   months: 12 },
  { label: 'Todo',    months: 999 },
]

export default function Ganancias({ profile }) {
  const [earningsData, setEarningsData] = useState([])
  const [profProfile, setProfProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState(6)
  const [showRangeMenu, setShowRangeMenu] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    Promise.all([
      consultationsService.getEarningsData(profile.id),
      professionalService.getByUserId(profile.id),
    ]).then(([earnings, prof]) => {
      setEarningsData(earnings)
      setProfProfile(prof)
    }).catch(() => toast.error('Error al cargar ganancias'))
    .finally(() => setLoading(false))
  }, [profile?.id])

  // ── Derived totals ──────────────────────────────────────────────────────────
  const now = new Date()

  const thisMonth = useMemo(() => {
    return earningsData.filter(c => {
      const d = new Date(c.completedAt || c.scheduledAt)
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    })
  }, [earningsData])

  const lastMonth = useMemo(() => {
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return earningsData.filter(c => {
      const d = new Date(c.completedAt || c.scheduledAt)
      return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear()
    })
  }, [earningsData])

  const thisWeek = useMemo(() => {
    const startOfWeek = new Date(now)
    startOfWeek.setDate(now.getDate() - now.getDay())
    startOfWeek.setHours(0, 0, 0, 0)
    return earningsData.filter(c => new Date(c.completedAt || c.scheduledAt) >= startOfWeek)
  }, [earningsData])

  const paidTotal   = earningsData.reduce((s, c) => s + (c.paymentStatus === 'paid'            ? (c.priceAtBooking || 0) : 0), 0)
  const pendingTotal= earningsData.reduce((s, c) => s + (c.paymentStatus === 'pending_payment'  ? (c.priceAtBooking || 0) : 0), 0)
  const refundTotal = earningsData.reduce((s, c) => s + (c.paymentStatus === 'refunded'         ? (c.priceAtBooking || 0) : 0), 0)

  const thisMonthPaid  = thisMonth.reduce((s, c) => s + (c.paymentStatus === 'paid' ? (c.priceAtBooking || 0) : 0), 0)
  const lastMonthPaid  = lastMonth.reduce((s, c) => s + (c.paymentStatus === 'paid' ? (c.priceAtBooking || 0) : 0), 0)
  const weekPaid       = thisWeek.reduce((s, c) => s + (c.paymentStatus === 'paid'  ? (c.priceAtBooking || 0) : 0), 0)

  const monthDelta = lastMonthPaid > 0
    ? Math.round(((thisMonthPaid - lastMonthPaid) / lastMonthPaid) * 100)
    : thisMonthPaid > 0 ? 100 : 0

  // ── Monthly chart data ──────────────────────────────────────────────────────
  const monthlyData = useMemo(() => {
    const numMonths = Math.min(range, 12)
    const months = []
    for (let i = numMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const label = MONTH_NAMES[d.getMonth()]
      const items = earningsData.filter(c => {
        const cd = new Date(c.completedAt || c.scheduledAt)
        return cd.getMonth() === d.getMonth() && cd.getFullYear() === d.getFullYear()
      })
      const paid        = items.reduce((s, c) => s + (c.paymentStatus === 'paid'           ? (c.priceAtBooking || 0) : 0), 0)
      const pending     = items.reduce((s, c) => s + (c.paymentStatus === 'pending_payment' ? (c.priceAtBooking || 0) : 0), 0)
      const presencial  = items.reduce((s, c) => s + (c.modality !== 'video'               ? (c.priceAtBooking || 0) : 0), 0)
      const video       = items.reduce((s, c) => s + (c.modality === 'video'               ? (c.priceAtBooking || 0) : 0), 0)
      const countPres   = items.filter(c => c.modality !== 'video').length
      const countVideo  = items.filter(c => c.modality === 'video').length
      months.push({ key, label, paid, pending, presencial, video, countPres, countVideo, count: items.length })
    }
    return months
  }, [earningsData, range])

  const chartMax = Math.max(...monthlyData.map(m => m.paid + m.pending), 1)

  // ── Filtered history ────────────────────────────────────────────────────────
  const filteredHistory = useMemo(() => {
    if (range >= 999) return earningsData
    const cutoff = new Date(now.getFullYear(), now.getMonth() - range + 1, 1)
    return earningsData.filter(c => new Date(c.completedAt || c.scheduledAt) >= cutoff)
  }, [earningsData, range])

  const selectedRangeLabel = RANGE_OPTIONS.find(r => r.months === range)?.label || '6 meses'

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
          <div className="flex items-center gap-3 mt-1">
            {profProfile?.pricePresencial != null && (
              <span className="text-sm text-text-secondary">
                Presencial: <span className="font-semibold text-text-primary">{formatARS(profProfile.pricePresencial)}</span>
              </span>
            )}
            {profProfile?.pricePresencial != null && profProfile?.priceVideo != null && (
              <span className="text-text-muted text-xs">·</span>
            )}
            {profProfile?.priceVideo != null && (
              <span className="text-sm text-text-secondary">
                VideoCamera: <span className="font-semibold text-text-primary">{formatARS(profProfile.priceVideo)}</span>
              </span>
            )}
            {profProfile?.pricePresencial == null && profProfile?.priceVideo == null && profProfile?.sessionPrice != null && (
              <span className="text-sm text-text-secondary">
                Precio por sesión: <span className="font-semibold text-text-primary">{formatARS(profProfile.sessionPrice)}</span>
              </span>
            )}
          </div>
        </div>

        {/* Range picker */}
        <div className="relative">
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

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

        {/* This month */}
        <div className="card bg-white">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Este mes</p>
              <p className="text-3xl font-bold text-text-primary mt-1">{formatARS(thisMonthPaid)}</p>
              <p className="text-xs text-text-secondary mt-1">{thisMonth.length} consulta{thisMonth.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
              <TrendUp className="h-5 w-5 text-emerald-600" />
            </div>
          </div>
          {lastMonthPaid > 0 || thisMonthPaid > 0 ? (
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
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Esta semana</p>
              <p className="text-3xl font-bold text-text-primary mt-1">{formatARS(weekPaid)}</p>
              <p className="text-xs text-text-secondary mt-1">{thisWeek.length} consulta{thisWeek.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
              <CurrencyDollar className="h-5 w-5 text-blue-600" />
            </div>
          </div>
          {pendingTotal > 0 && (
            <div className="flex items-center gap-1 mt-3 text-xs text-amber-600 font-medium">
              <Clock className="h-3.5 w-3.5" />
              {formatARS(pendingTotal)} pendiente de cobro
            </div>
          )}
        </div>

        {/* Total histórico */}
        <div className="card bg-white">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Total histórico</p>
              <p className="text-3xl font-bold text-text-primary mt-1">{formatARS(paidTotal)}</p>
              <p className="text-xs text-text-secondary mt-1">{earningsData.length} consulta{earningsData.length !== 1 ? 's' : ''} completada{earningsData.length !== 1 ? 's' : ''}</p>
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
        <h2 className="font-semibold text-text-primary mb-6">Evolución mensual</h2>

        {monthlyData.every(m => m.paid + m.pending === 0) ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <TrendUp className="h-10 w-10 text-text-muted mb-3" />
            <p className="text-text-secondary text-sm">Sin datos de ganancias en el período seleccionado</p>
          </div>
        ) : (
          <>
            {/* Bars */}
            <div className="flex items-end gap-2 h-40">
              {monthlyData.map(m => {
                const paidPct        = (m.paid / chartMax) * 100
                const pendingPct     = (m.pending / chartMax) * 100
                const isCurrentMonth = m.key === `${now.getFullYear()}-${now.getMonth()}`
                const hasData        = m.paid + m.pending > 0
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
                              <span className="text-xs text-amber-300">Pendiente</span>
                              <span className="text-xs font-semibold text-amber-300">{formatARS(m.pending)}</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-3 pt-1.5 mt-1 border-t border-white/20">
                            <span className="text-xs text-white/60">Total</span>
                            <span className="text-xs font-bold text-white">{formatARS(m.paid + m.pending)}</span>
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
                      {/* Paid portion (bottom) */}
                      <div
                        className={`w-full transition-all duration-700 rounded-t-sm ${isCurrentMonth ? 'bg-brand' : 'bg-emerald-400'}`}
                        style={{ height: `${Math.max(paidPct, m.paid > 0 ? 2 : 0)}%` }}
                      />
                      {/* Empty bar placeholder */}
                      {m.paid + m.pending === 0 && (
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
                <span className="text-xs text-text-secondary">Cobrado</span>
              </div>
              {pendingTotal > 0 && (
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm bg-amber-200" />
                  <span className="text-xs text-text-secondary">Pendiente</span>
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
          <h2 className="font-semibold text-text-primary">Historial de consultas</h2>
          <span className="text-xs text-text-secondary">{filteredHistory.length} registros</span>
        </div>

        {filteredHistory.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <Users className="h-10 w-10 text-text-muted mb-3" />
            <p className="text-text-secondary text-sm">No hay consultas en este período</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[520px]">
              <thead>
                <tr className="border-b border-border-default">
                  <th className="text-left text-xs font-medium text-text-secondary pb-3 px-4 sm:px-0">Paciente</th>
                  <th className="text-left text-xs font-medium text-text-secondary pb-3 px-2">Fecha</th>
                  <th className="text-right text-xs font-medium text-text-secondary pb-3 px-2">Monto</th>
                  <th className="text-right text-xs font-medium text-text-secondary pb-3 px-4 sm:px-0">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {filteredHistory.map(c => {
                  const badge = PAYMENT_LABELS[c.paymentStatus] || PAYMENT_LABELS.pending_payment
                  const patientName = c.profiles?.fullName || c.profiles?.full_name || 'Paciente'
                  const amount = c.priceAtBooking || profProfile?.sessionPrice || 0
                  return (
                    <tr key={c.id} className="hover:bg-bg-surface/50 transition-colors">
                      <td className="py-3 px-4 sm:px-0">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-brand-muted flex items-center justify-center shrink-0 text-brand font-semibold text-xs">
                            {patientName.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-text-primary">{patientName}</p>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              {c.consultationType?.name && (
                                <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-brand-muted text-brand font-medium">
                                  {c.consultationType.name}
                                </span>
                              )}
                              {c.obraSocialName && (
                                <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">
                                  {c.obraSocialName}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-2 text-sm text-text-secondary whitespace-nowrap">
                        {formatDate(c.completedAt || c.scheduledAt)}
                      </td>
                      <td className="py-3 px-2 text-right">
                        <span className={`text-sm font-semibold ${c.paymentStatus === 'paid' ? 'text-emerald-700' : c.paymentStatus === 'refunded' ? 'text-red-500 line-through' : 'text-text-primary'}`}>
                          {amount > 0 ? formatARS(amount) : '—'}
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
              <span className="text-sm text-text-secondary font-medium">Total del período</span>
              <span className="text-sm font-bold text-text-primary">
                {formatARS(filteredHistory.reduce((s, c) => s + (c.paymentStatus === 'paid' ? (c.priceAtBooking || 0) : 0), 0))}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
