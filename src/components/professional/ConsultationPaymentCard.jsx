import { CurrencyDollar, ArrowsClockwise, Clock, Info } from '@phosphor-icons/react'
import InfoTooltip from '../common/InfoTooltip'

/**
 * El cobro de ESTA consulta, para el profesional.
 *
 * Existía el dato y no había dónde verlo: `consultationsService.getById` —la query
 * de esta pantalla— no traía el pago (el embed sólo estaba en `getByPatient`), así
 * que el profesional sólo veía plata en "Ganancias", agregada por mes.
 *
 * Los números salen de lo que informa Mercado Pago cuando lo tenemos:
 *  - `mpFeeActual` / `mpNetReceivedAmount` son lo que MP cobró y acreditó.
 *  - `mpFeeEstimated` / `netToProfessional` son nuestra estimación y el 78%
 *    contractual. Se usan sólo como respaldo, y se marcan como estimados.
 *
 * No mostrar un número redondeado como si fuera el real: el profesional concilia
 * esto contra su app de MP, y un peso de diferencia le hace desconfiar de todo.
 */

const STATUS = {
  approved:   { label: 'Cobrado',             cls: 'bg-green-100 text-green-700' },
  authorized: { label: 'Reservado sin cobrar', cls: 'bg-amber-100 text-amber-700' },
  pending:    { label: 'Pendiente',           cls: 'bg-gray-100 text-gray-600' },
  in_process: { label: 'En proceso',          cls: 'bg-amber-100 text-amber-700' },
  rejected:   { label: 'Rechazado',           cls: 'bg-red-100 text-red-700' },
  cancelled:  { label: 'Cancelado',           cls: 'bg-red-100 text-red-700' },
  refunded:   { label: 'Devuelto',            cls: 'bg-red-100 text-red-700' },
}

const METHODS = { card: 'Tarjeta', credits: 'Créditos Healthy', cash: 'Efectivo' }

const formatARS = n =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 })
    .format(Number(n ?? 0))

export default function ConsultationPaymentCard({ payment }) {
  const p = Array.isArray(payment) ? payment[0] : payment
  if (!p) return null

  const estado = STATUS[p.status] ?? STATUS.pending

  // Comisión de MP: la real si ya la informó, la estimada mientras no.
  const mpFee = p.mpFeeActual ?? p.mpFeeEstimated
  const mpFeeEsReal = p.mpFeeActual != null

  // Neto: lo que MP acredita. Si todavía no lo informó, el 78% contractual.
  const neto = p.mpNetReceivedAmount ?? p.netToProfessional
  const netoEsReal = p.mpNetReceivedAmount != null

  const liberacion = p.mpMoneyReleaseDate ? new Date(p.mpMoneyReleaseDate) : null
  const esDevuelto = p.status === 'refunded'

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CurrencyDollar className="h-4 w-4 text-brand" />
          <h2 className="font-semibold text-text-primary">Cobro</h2>
          <InfoTooltip
            align="left"
            title="De dónde salen estos números"
            label="Los informa Mercado Pago. La comisión de MP y el neto se toman de lo que MP realmente cobró y acreditó; mientras no lo informe se muestra nuestra estimación, aclarado como tal. La comisión de Healthier es fija y se descuenta en el mismo pago."
          >
            <Info className="h-3.5 w-3.5 text-text-tertiary cursor-help" />
          </InfoTooltip>
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${estado.cls}`}>
          {estado.label}
        </span>
      </div>

      <dl className="space-y-1.5 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-text-secondary">Cobrado al paciente</dt>
          <dd className="text-text-primary font-medium">{formatARS(p.grossAmount)}</dd>
        </div>

        {Number(p.creditsUsed) > 0 && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-text-secondary">Pagado con créditos Healthy</dt>
            <dd className="text-text-secondary">−{formatARS(p.creditsUsed)}</dd>
          </div>
        )}

        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-text-secondary">
            Comisión de Mercado Pago
            {!mpFeeEsReal && <span className="text-text-tertiary"> (estimada)</span>}
          </dt>
          <dd className="text-text-secondary">−{formatARS(mpFee)}</dd>
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-text-secondary">Comisión de Healthier</dt>
          <dd className="text-text-secondary">−{formatARS(p.platformFee)}</dd>
        </div>

        <div className="flex items-baseline justify-between gap-3 pt-2 border-t border-border-default">
          <dt className="font-semibold text-text-primary">
            {esDevuelto ? 'Neto (devuelto)' : 'Te queda'}
            {!netoEsReal && <span className="text-text-tertiary font-normal"> (estimado)</span>}
          </dt>
          <dd className={`font-bold ${esDevuelto ? 'text-danger line-through' : 'text-text-primary'}`}>
            {formatARS(neto)}
          </dd>
        </div>
      </dl>

      {liberacion && !esDevuelto && (
        <div className="flex items-center gap-1.5 text-xs text-text-secondary">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          Se libera el{' '}
          {liberacion.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
      )}

      {esDevuelto && p.refundedAt && (
        <div className="flex items-center gap-1.5 text-xs text-danger">
          <ArrowsClockwise className="h-3.5 w-3.5 shrink-0" />
          Devuelto el{' '}
          {new Date(p.refundedAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}
          {p.refundType === 'credit' && ' como créditos Healthy'}
        </div>
      )}

      {p.refundRequestStatus === 'pending' && (
        <p className="text-xs text-amber-700 font-medium">
          El paciente pidió la devolución — pendiente de revisión de Healthier.
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-1 text-[11px] text-text-tertiary">
        {p.method && <span>{METHODS[p.method] ?? p.method}</span>}
        {p.mpPaymentId && <span>· Operación MP {p.mpPaymentId}</span>}
      </div>
    </div>
  )
}
