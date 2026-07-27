import { useState, useEffect } from 'react'
import { toast } from '../../components/Toast'
import { paymentsService } from '../../services/paymentsService'

export default function SuperAdminSettings() {
  // Real, persisted platform settings (spec D6 / B2) — commission, MP fee
  // estimate, and the refund eligibility window used by mp-payment/mp-refund.
  const [platformSettings, setPlatformSettings] = useState({
    commissionRate: 0.22,
    mpFeeEstimateRate: 0.0629,
    refundWindowBusinessHours: 48,
  })
  const [loading, setLoading] = useState(true)
  const [savingPayments, setSavingPayments] = useState(false)

  useEffect(() => {
    paymentsService.getPlatformSettings()
      .then(s => setPlatformSettings({
        commissionRate: s?.commissionRate ?? 0.22,
        mpFeeEstimateRate: s?.mpFeeEstimateRate ?? 0.0629,
        refundWindowBusinessHours: s?.refundWindowBusinessHours ?? 48,
      }))
      .catch(() => toast.error('No pudimos cargar la configuración de pagos'))
      .finally(() => setLoading(false))
  }, [])

  const savePaymentSettings = async (e) => {
    e.preventDefault()
    setSavingPayments(true)
    try {
      await paymentsService.updatePlatformSettings(platformSettings)
      toast.success('Configuración de pagos guardada — se aplica al próximo pago')
    } catch (err) {
      toast.error(err?.message || 'Error al guardar la configuración de pagos')
    } finally {
      setSavingPayments(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Configuración de la plataforma</h1>
        <p className="text-text-secondary mt-1">Ajustes globales del sistema</p>
      </div>

      {/* ── Pagos / Mercado Pago — persisted in platform_settings ── */}
      <form onSubmit={savePaymentSettings} className="card space-y-5">
        <div>
          <h2 className="font-semibold text-text-primary">Pagos y comisiones</h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Estos valores se usan en tiempo real por el próximo pago que se procese (mp-payment) y por la ventana de reembolso (mp-refund).
          </p>
        </div>

        {loading ? (
          <div className="h-32 bg-bg-surface rounded-xl animate-pulse" />
        ) : (
          <>
            <div>
              <label className="form-label">Comisión Healthier (%)</label>
              <input
                type="number"
                min="0" max="100" step="0.1"
                value={Math.round(platformSettings.commissionRate * 1000) / 10}
                onChange={e => setPlatformSettings(p => ({ ...p, commissionRate: Number(e.target.value) / 100 }))}
                className="form-input"
              />
              <p className="text-xs text-text-muted mt-1">
                El médico recibe {(100 - platformSettings.commissionRate * 100).toFixed(1)}% neto del precio de la consulta.
              </p>
            </div>

            <div>
              <label className="form-label">Fee estimado de Mercado Pago (%)</label>
              <input
                type="number"
                min="0" max="100" step="0.01"
                value={Math.round(platformSettings.mpFeeEstimateRate * 10000) / 100}
                onChange={e => setPlatformSettings(p => ({ ...p, mpFeeEstimateRate: Number(e.target.value) / 100 }))}
                className="form-input"
              />
              <p className="text-xs text-text-muted mt-1">
                Usado para calcular el application_fee que absorbe Healthier — se reconcilia con el fee real del webhook.
              </p>
            </div>

            <div>
              <label className="form-label">Ventana de reembolso (hs hábiles)</label>
              <input
                type="number"
                min="0" step="1"
                value={platformSettings.refundWindowBusinessHours}
                onChange={e => setPlatformSettings(p => ({ ...p, refundWindowBusinessHours: Number(e.target.value) }))}
                className="form-input"
              />
              <p className="text-xs text-text-muted mt-1">
                Horas hábiles (lun–vie) mínimas de anticipación para que una cancelación reciba Healthy Credits.
              </p>
            </div>
          </>
        )}

        <button type="submit" disabled={savingPayments || loading} className="btn-primary">
          {savingPayments ? 'Guardando...' : 'Guardar configuración de pagos'}
        </button>
      </form>
    </div>
  )
}
