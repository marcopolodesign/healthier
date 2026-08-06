import { useState, useEffect } from 'react'
import { toast } from '../../components/Toast'
import { paymentsService } from '../../services/paymentsService'

export default function SuperAdminSettings() {
  // Real, persisted platform settings (spec D6 / B2) — commission, MP fee
  // estimate, the refund eligibility window used by mp-payment/mp-refund, y
  // la duración del slot de turno que arma la grilla en /paciente/reservar.
  const [platformSettings, setPlatformSettings] = useState({
    commissionRate: 0.20,
    mpFeeEstimateRate: 0.0629,
    refundWindowBusinessHours: 48,
    slotDurationMinutes: 15,
  })
  const [loading, setLoading] = useState(true)
  const [savingPayments, setSavingPayments] = useState(false)
  const [savingSlots, setSavingSlots] = useState(false)

  useEffect(() => {
    paymentsService.getPlatformSettings()
      .then(s => setPlatformSettings({
        commissionRate: s?.commissionRate ?? 0.20,
        mpFeeEstimateRate: s?.mpFeeEstimateRate ?? 0.0629,
        refundWindowBusinessHours: s?.refundWindowBusinessHours ?? 48,
        slotDurationMinutes: s?.slotDurationMinutes ?? 15,
      }))
      .catch(() => toast.error('No pudimos cargar la configuración de pagos'))
      .finally(() => setLoading(false))
  }, [])

  const saveSlotDuration = async () => {
    setSavingSlots(true)
    try {
      await paymentsService.updatePlatformSettings({ slotDurationMinutes: platformSettings.slotDurationMinutes })
      toast.success('Duración del turno actualizada — se aplica a partir de ahora, no mueve los turnos ya reservados')
    } catch (err) {
      toast.error(err?.message || 'Error al guardar la duración del turno')
    } finally {
      setSavingSlots(false)
    }
  }

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
                El médico recibe {(100 - platformSettings.commissionRate * 100).toFixed(1)}% del precio. Mercado Pago le cobra su comisión sobre esa parte — Healthier cobra su porcentaje completo del bruto.
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
                Sólo informativo: estima cuánto le va a acreditar MP al profesional mientras la captura no trajo el fee real. Ya NO interviene en el cálculo de la comisión, que es un porcentaje fijo del bruto.
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

      {/* ── Turnos — duración del slot, persisted in platform_settings ── */}
      <div className="card space-y-5">
        <div>
          <h2 className="font-semibold text-text-primary">Turnos</h2>
          <p className="text-sm text-text-secondary mt-0.5">
            Duración de cada slot que se le ofrece al paciente al reservar. No mueve ni recalcula los turnos ya reservados — sólo cambia los horarios disponibles de ahí en adelante.
          </p>
        </div>

        {loading ? (
          <div className="h-16 bg-bg-surface rounded-xl animate-pulse" />
        ) : (
          <div>
            <label className="form-label">Duración del turno</label>
            <select
              value={platformSettings.slotDurationMinutes}
              onChange={e => setPlatformSettings(p => ({ ...p, slotDurationMinutes: Number(e.target.value) }))}
              className="form-select"
            >
              {[10, 15, 20, 30, 45, 60].map(min => (
                <option key={min} value={min}>{min} minutos</option>
              ))}
            </select>
            <p className="text-xs text-text-muted mt-1">
              Sólo opciones que entran parejo en una agenda — un valor libre como 7 minutos deja un resto suelto al final de cada franja horaria.
            </p>
          </div>
        )}

        <button type="button" onClick={saveSlotDuration} disabled={savingSlots || loading} className="btn-primary">
          {savingSlots ? 'Guardando...' : 'Guardar duración del turno'}
        </button>
      </div>
    </div>
  )
}
