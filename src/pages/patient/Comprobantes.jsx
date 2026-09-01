import { useState, useEffect, useMemo } from 'react'
import { VideoCamera, Hospital, Heartbeat, Receipt, CircleNotch } from '@phosphor-icons/react'
import { consultationsService } from '../../services/consultationsService'

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function formatARS(n) {
  if (!n) return '—'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

function formatDate(str) {
  if (!str) return '—'
  const d = new Date(str)
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`
}

const MODALITY_ICON = {
  video:      { Icon: VideoCamera, label: 'Videoconsulta', color: '#7CB38B' },
  presencial: { Icon: Hospital,    label: 'Presencial',    color: '#9B8EC4' },
  emergency:  { Icon: Heartbeat,   label: 'Emergencia',    color: '#D9534F' },
}

const PAYMENT_BADGE = {
  paid:            { label: 'Cobrado',    cls: 'bg-emerald-100 text-emerald-700' },
  pending_payment: { label: 'Pendiente',  cls: 'bg-amber-100 text-amber-700' },
  refunded:        { label: 'Reembolsado',cls: 'bg-red-100 text-red-600' },
  exempt:          { label: 'Bonificado', cls: 'bg-violet-100 text-violet-700' },
}

const STATUS_BADGE = {
  finalized:            { label: 'Finalizada', cls: 'bg-green-100 text-green-700' },
  completed:            { label: 'Completada', cls: 'bg-green-100 text-green-700' },
  confirmed:            { label: 'Confirmada', cls: 'bg-blue-100 text-blue-700' },
  in_progress:          { label: 'En curso',   cls: 'bg-brand/10 text-brand' },
  pending_pro_close:    { label: 'Finalizada', cls: 'bg-green-100 text-green-700' },
  pending_patient_close:{ label: 'Finalizada', cls: 'bg-green-100 text-green-700' },
  expired:              { label: 'Vencida',    cls: 'bg-gray-100 text-gray-500' },
  no_show:              { label: 'Ausente',    cls: 'bg-orange-100 text-orange-700' },
  cancelled:            { label: 'Cancelada',  cls: 'bg-red-100 text-red-600' },
}

export default function PatientComprobantes({ profile }) {
  const [receipts, setReceipts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.id) return
    consultationsService.getReceiptsForPatient(profile.id)
      .then(setReceipts)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [profile?.id])

  const totalPaid = useMemo(() =>
    receipts.filter(r => r.paymentStatus === 'paid').reduce((sum, r) => sum + (r.priceAtBooking || 0), 0),
    [receipts]
  )

  const byMonth = useMemo(() => {
    const groups = {}
    receipts.forEach(r => {
      const d = new Date(r.scheduledAt || r.createdAt || '')
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
      const label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`
      if (!groups[key]) groups[key] = { label, items: [] }
      groups[key].items.push(r)
    })
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a)).map(([, g]) => g)
  }, [receipts])

  if (loading) return (
    <div className="absolute inset-0 flex items-center justify-center bg-bg-primary">
      <CircleNotch className="w-7 h-7 text-brand animate-spin" />
    </div>
  )

  return (
    <div className="absolute inset-0 bg-bg-primary pt-6 sm:pt-8 pb-32 px-5 overflow-y-auto scrollbar-hide animate-fade-in">
      <div className="max-w-lg lg:max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6 mt-4">
          <h1 className="text-[28px] font-black text-text-primary tracking-tight leading-none">Comprobantes</h1>
          <p className="text-text-secondary text-[14px] mt-1">Historial de consultas</p>
        </div>

        {/* Summary */}
        {totalPaid > 0 && (
          <div className="card p-5 mb-6 flex items-center justify-between">
            <div>
              <p className="text-xs text-text-secondary font-medium uppercase tracking-wide">Total abonado</p>
              <p className="text-2xl font-black text-text-primary mt-1">{formatARS(totalPaid)}</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-brand/10 flex items-center justify-center">
              <Receipt className="w-6 h-6 text-brand" />
            </div>
          </div>
        )}

        {receipts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Receipt className="w-14 h-14 text-text-muted opacity-30" />
            <p className="text-[15px] text-text-secondary font-medium">Sin consultas registradas aún</p>
            <p className="text-sm text-text-muted">Tus comprobantes aparecerán aquí después de cada consulta</p>
          </div>
        ) : (
          byMonth.map(group => (
            <div key={group.label} className="mb-6">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">{group.label}</p>
              <div className="space-y-3">
                {group.items.map(r => {
                  const modKey = r.modality ?? 'video'
                  const { Icon, label: modalityLabel, color } = MODALITY_ICON[modKey] ?? MODALITY_ICON.video
                  const payBadge = r.paymentStatus ? PAYMENT_BADGE[r.paymentStatus] : null
                  const stBadge = STATUS_BADGE[r.status] ?? null
                  const badge = payBadge ?? stBadge
                  const proName = r.professional?.fullName ?? '—'
                  const specialty = r.professional?.professionalProfiles?.[0]?.specialty ?? r.vertical ?? ''

                  return (
                    <div key={r.id} className="card p-4 flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: color + '18' }}>
                        <Icon className="w-5 h-5" style={{ color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-text-primary text-[14px] truncate">{proName}</p>
                        <p className="text-xs text-text-secondary mt-0.5">{modalityLabel}{specialty ? ` · ${specialty.replace('_', ' ')}` : ''}</p>
                        <p className="text-xs text-text-muted mt-0.5">{formatDate(r.scheduledAt)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-black text-[15px] text-text-primary">{formatARS(r.priceAtBooking)}</p>
                        {badge && (
                          <span className={`mt-1 inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>
                            {badge.label}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
