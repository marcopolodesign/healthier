import { useState, useEffect, useMemo } from 'react'
import { CalendarCheck, MagnifyingGlass, VideoCamera, MapPin, Lightning, CircleNotch } from '@phosphor-icons/react'
import { consultationsService } from '../../services/consultationsService'
import { toast } from '../../components/Toast'
import Modal from '../../components/Modal'
import StatusBadge, { STATUS_CONFIG } from '../../components/StatusBadge'
import { formatARS, formatDate } from '../../lib/format'
import { VERTICALS } from '../../lib/verticals'

// Vocabulario exacto de `consultations.status` — constraint vigente desde la
// migración 098 (`consultations_status_check`, que amplió el de la 089 con
// `closing`). No inventar valores nuevos acá: escribir uno que no esté en esta
// lista rompe el UPDATE contra la base.
// (STATUS_CONFIG de StatusBadge tiene más valores que el constraint — por eso
// se enumeran acá sólo los válidos y se toman las etiquetas de ahí.)
const STATUS_OPTIONS = ['pending', 'confirmed', 'in_progress', 'closing', 'pending_pro_close', 'completed', 'cancelled', 'no_show', 'expired']
  .map(value => ({ value, label: STATUS_CONFIG[value]?.label ?? value }))

// Vocabulario exacto de `consultations.payment_status` — constraint vigente
// desde la migración 056 (`consultations_payment_status_check`).
const PAYMENT_STATUS_OPTIONS = [
  { value: 'pending_payment', label: 'Pendiente de pago' },
  { value: 'in_process',      label: 'En proceso' },
  { value: 'paid',            label: 'Pagado' },
  { value: 'rejected',        label: 'Rechazado' },
  { value: 'refunded',        label: 'Reembolsado' },
]

const PAYMENT_STATUS_BADGE = {
  pending_payment: 'bg-amber-50 text-amber-600',
  in_process:      'bg-amber-50 text-amber-700',
  paid:            'bg-emerald-50 text-emerald-600',
  rejected:        'bg-gray-100 text-gray-500',
  refunded:        'bg-red-50 text-red-600',
}
const PAYMENT_STATUS_LABEL = Object.fromEntries(PAYMENT_STATUS_OPTIONS.map(o => [o.value, o.label]))

function PaymentBadge({ status }) {
  return (
    <span className={`inline-block whitespace-nowrap text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${PAYMENT_STATUS_BADGE[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {PAYMENT_STATUS_LABEL[status] ?? status ?? '—'}
    </span>
  )
}

function verticalInfo(id) {
  return VERTICALS.find(v => v.id === id) || null
}

function modalityLabel(m) {
  return m === 'video' ? 'Video' : m === 'presencial' ? 'Presencial' : '—'
}

function Field({ label, value, className = '' }) {
  return (
    <div className={className}>
      <span className="text-text-tertiary">{label}</span>
      <p className="text-text-primary">{value ?? '—'}</p>
    </div>
  )
}

// `<input type="datetime-local">` quiere "YYYY-MM-DDTHH:mm" en hora LOCAL —
// pasarle el ISO tal cual lo corre a UTC y desfasa el horario mostrado.
function toDatetimeLocalValue(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function SuperAdminConsultas() {
  const [consultations, setConsultations] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ search: '', status: '', paymentStatus: '' })
  const [selected, setSelected] = useState(null) // fila abierta en el panel de detalle
  const [form, setForm] = useState(null)         // campos editables del panel
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    consultationsService.getAll()
      .then(setConsultations)
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase()
    return consultations.filter(c => {
      if (filters.status && c.status !== filters.status) return false
      if (filters.paymentStatus && c.paymentStatus !== filters.paymentStatus) return false
      if (q) {
        const haystack = [
          c.patient?.fullName, c.patient?.email,
          c.professional?.fullName, c.professional?.email,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [consultations, filters])

  const openDetail = (c) => {
    setSelected(c)
    setForm({
      status: c.status || '',
      scheduledAt: toDatetimeLocalValue(c.scheduledAt),
      paymentStatus: c.paymentStatus || '',
      cancelReason: c.cancelReason || '',
    })
  }

  const closeDetail = () => {
    setSelected(null)
    setForm(null)
  }

  const handleSave = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const patch = {
        status: form.status,
        scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
        paymentStatus: form.paymentStatus,
        // El input de motivo sólo se muestra con status cancelada, y `form` se
        // inicializa desde `selected` — así que el valor del form ya es correcto
        // en ambos casos.
        cancelReason: form.cancelReason || null,
      }
      const updated = await consultationsService.update(selected.id, patch)
      toast.success('Consulta actualizada')
      // El update de Supabase no vuelve a traer los joins (patient/professional/
      // consultation_type) — se pisan encima de la fila que ya teníamos en vez
      // de perderlos.
      const merged = { ...selected, ...updated }
      setConsultations(prev => prev.map(c => c.id === merged.id ? merged : c))
      setSelected(merged)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title-lg">Consultas</h1>
        <p className="text-text-secondary mt-1">Todas las consultas agendadas en la plataforma</p>
      </div>

      {/* Filters */}
      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="text-xs text-text-secondary mb-1 block">Buscar</label>
          <div className="relative">
            <MagnifyingGlass className="h-4 w-4 text-text-tertiary absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={filters.search}
              onChange={e => setFilters(p => ({ ...p, search: e.target.value }))}
              placeholder="Paciente o profesional, nombre o email"
              className="form-input text-sm pl-9 w-full"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Estado</label>
          <select value={filters.status} onChange={e => setFilters(p => ({ ...p, status: e.target.value }))} className="form-select text-sm">
            <option value="">Todos</option>
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Pago</label>
          <select value={filters.paymentStatus} onChange={e => setFilters(p => ({ ...p, paymentStatus: e.target.value }))} className="form-select text-sm">
            <option value="">Todos</option>
            {PAYMENT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {(filters.search || filters.status || filters.paymentStatus) && (
          <button
            type="button"
            onClick={() => setFilters({ search: '', status: '', paymentStatus: '' })}
            className="text-sm text-text-secondary hover:text-text-primary"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-text-primary">Consultas</h2>
          <span className="text-xs text-text-secondary">{filtered.length} registro{filtered.length !== 1 ? 's' : ''}</span>
        </div>
        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-10 bg-bg-surface rounded-lg animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <CalendarCheck className="h-10 w-10 text-text-muted mb-3" />
            <p className="text-text-secondary text-sm">No hay consultas para estos filtros</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[1080px] text-sm">
              <thead>
                <tr>
                  <th className="table-header">Fecha</th>
                  <th className="table-header">Paciente</th>
                  <th className="table-header">Profesional</th>
                  <th className="table-header">Vertical</th>
                  <th className="table-header">Modalidad</th>
                  <th className="table-header">Estado</th>
                  <th className="table-header">Pago</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const vertical = verticalInfo(c.vertical)
                  return (
                    <tr key={c.id} className="table-row cursor-pointer" onClick={() => openDetail(c)}>
                      <td className="table-cell whitespace-nowrap text-text-tertiary">{formatDate(c.scheduledAt)}</td>
                      <td className="table-cell">
                        <p className="text-text-primary truncate max-w-[160px]">{c.patient?.fullName || '—'}</p>
                        <p className="text-xs text-text-tertiary truncate max-w-[160px]">{c.patient?.email || ''}</p>
                      </td>
                      <td className="table-cell">
                        <p className="text-text-primary truncate max-w-[160px]">{c.professional?.fullName || '—'}</p>
                        <p className="text-xs text-text-tertiary truncate max-w-[160px]">{c.professional?.email || ''}</p>
                      </td>
                      <td className="table-cell">
                        {vertical ? (
                          <span className="inline-flex items-center gap-1.5" style={{ color: vertical.color }}>
                            <vertical.icon className="h-4 w-4" /> {vertical.nombre}
                          </span>
                        ) : (
                          <span className="text-text-tertiary">{c.vertical || '—'}</span>
                        )}
                      </td>
                      <td className="table-cell">
                        {c.modality === 'video' ? (
                          <span className="flex items-center gap-1 text-brand"><VideoCamera className="h-4 w-4" /> Video</span>
                        ) : c.modality === 'presencial' ? (
                          <span className="flex items-center gap-1 text-emerald-600"><MapPin className="h-4 w-4" /> Presencial</span>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                        {c.isOnDemand && (
                          <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase text-amber-700 bg-amber-50 rounded-full px-1.5 py-0.5">
                            <Lightning className="h-3 w-3" weight="fill" /> On demand
                          </span>
                        )}
                      </td>
                      <td className="table-cell"><StatusBadge status={c.status} /></td>
                      <td className="table-cell">
                        <PaymentBadge status={c.paymentStatus} />
                        <p className="text-xs text-text-tertiary mt-0.5">{formatARS(c.priceAtBooking)}</p>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail / edit panel */}
      <Modal open={Boolean(selected)} onClose={closeDetail} title="Detalle de la consulta" size="xl">
        {selected && form && (
          <div className="space-y-5">
            {/* Turno */}
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-2">Turno</h4>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Field label="Agendado para" value={formatDate(selected.scheduledAt)} />
                <Field label="Iniciado" value={formatDate(selected.startedAt)} />
                <Field label="Completado" value={formatDate(selected.completedAt)} />
                <Field label="Duración" value={selected.durationMinutes ? `${selected.durationMinutes} min` : '—'} />
                <Field label="Modalidad" value={modalityLabel(selected.modality)} />
                <Field label="Vertical" value={verticalInfo(selected.vertical)?.nombre || selected.vertical || '—'} />
                <Field label="On demand" value={selected.isOnDemand ? 'Sí' : 'No'} />
                {selected.consultationType?.name && <Field label="Tipo" value={selected.consultationType.name} />}
              </div>
            </section>

            {/* Personas */}
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-2">Personas</h4>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <span className="text-text-tertiary">Paciente</span>
                  <p className="text-text-primary">{selected.patient?.fullName || '—'}</p>
                  <p className="text-xs text-text-tertiary">{selected.patient?.email || ''}</p>
                </div>
                <div>
                  <span className="text-text-tertiary">Profesional</span>
                  <p className="text-text-primary">{selected.professional?.fullName || '—'}</p>
                  <p className="text-xs text-text-tertiary">{selected.professional?.email || ''}</p>
                </div>
              </div>
            </section>

            {/* Pago */}
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-2">Pago</h4>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><span className="text-text-tertiary">Estado de pago</span><p><PaymentBadge status={selected.paymentStatus} /></p></div>
                <Field label="Precio" value={formatARS(selected.priceAtBooking)} />
                <div><span className="text-text-tertiary">MP payment ID</span><p className="text-text-primary truncate">{selected.mpPaymentId || '—'}</p></div>
                <Field label="Pagado el" value={formatDate(selected.paidAt)} />
                <Field label="Devolución pendiente" value={selected.refundPending ? 'Sí' : 'No'} />
                <Field label="Cobertura" value={selected.coverageType === 'financiador' ? 'Obra social / prepaga' : selected.coverageType === 'particular' ? 'Particular' : '—'} />
                {selected.obraSocialName && <Field label="Obra social" value={selected.obraSocialName} />}
                {selected.affiliateNumber && <Field label="N° de afiliado" value={selected.affiliateNumber} />}
              </div>
            </section>

            {/* Cancelación */}
            {(selected.status === 'cancelled' || selected.cancelledAt || selected.cancelReason) && (
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-2">Cancelación</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <Field label="Cancelado el" value={formatDate(selected.cancelledAt)} />
                  <div><span className="text-text-tertiary">Cancelado por</span><p className="text-text-primary truncate">{selected.cancelledBy || '—'}</p></div>
                  {selected.cancelReason && <Field label="Motivo" value={selected.cancelReason} className="col-span-2" />}
                </div>
              </section>
            )}

            {/* Notas de cierre */}
            {selected.closingNotes && (
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-2">Notas de cierre</h4>
                <p className="text-sm text-text-primary whitespace-pre-wrap">{selected.closingNotes}</p>
              </section>
            )}

            {/* Código de cierre (migración 099) — cómo se validó, o por qué no */}
            {(selected.closingCodeVerifiedAt || selected.closingSkippedCodeReason) && (
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-2">Código de cierre</h4>
                {selected.closingCodeVerifiedAt ? (
                  <Field label="Verificado el" value={formatDate(selected.closingCodeVerifiedAt)} />
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                    <p className="text-xs font-semibold text-amber-700 mb-1">Cerrada sin código</p>
                    <p className="text-sm text-text-primary whitespace-pre-wrap">{selected.closingSkippedCodeReason}</p>
                  </div>
                )}
              </section>
            )}

            {/* Edición */}
            <section className="border-t border-border-default pt-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-3">Editar</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Estado</label>
                  <select
                    value={form.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                    className="form-select text-sm w-full"
                  >
                    {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Pago</label>
                  <select
                    value={form.paymentStatus}
                    onChange={e => setForm(f => ({ ...f, paymentStatus: e.target.value }))}
                    className="form-select text-sm w-full"
                  >
                    {PAYMENT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="form-label">Fecha y hora del turno</label>
                  <input
                    type="datetime-local"
                    value={form.scheduledAt}
                    onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))}
                    className="form-input text-sm w-full"
                  />
                </div>
                {form.status === 'cancelled' && (
                  <div className="col-span-2">
                    <label className="form-label">Motivo de cancelación</label>
                    <input
                      type="text"
                      value={form.cancelReason}
                      onChange={e => setForm(f => ({ ...f, cancelReason: e.target.value }))}
                      placeholder="Motivo"
                      className="form-input text-sm w-full"
                    />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 mt-4">
                <button onClick={handleSave} disabled={saving} className="btn-primary text-sm px-4 py-2 disabled:opacity-40">
                  {saving ? <CircleNotch className="h-4 w-4 animate-spin" /> : 'Guardar'}
                </button>
                <button onClick={closeDetail} disabled={saving} className="text-sm text-text-secondary hover:text-text-primary">
                  Cerrar
                </button>
              </div>
            </section>
          </div>
        )}
      </Modal>
    </div>
  )
}
