import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, MapPin, CircleNotch, Pill } from '@phosphor-icons/react'
import { medicationOrdersService } from '../../services/medicationOrdersService'
import { toast } from '../../components/Toast'
import { formatARS as fmtPrice } from '../../lib/format'

export default function PharmacyCheckout({ profile }) {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state ?? {}

  const [order, setOrder] = useState(null)
  const [address, setAddress] = useState(profile?.address ?? '')
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)

  // Draft is created as soon as checkout starts (state-resilience — before
  // the payment step) unless we're resuming an already-drafted order.
  useEffect(() => {
    if (state.orderId) {
      medicationOrdersService.getById(state.orderId).then(o => {
        setOrder(o)
        setAddress(o.deliveryAddress || profile?.address || '')
      }).catch(err => toast.error(err?.message || 'Error al cargar el pedido'))
      return
    }
    if (!state.items?.length) return
    setCreating(true)
    medicationOrdersService.createDraft({
      patientId: profile.id,
      deliveryAddress: profile?.address ?? null,
      items: state.items,
    })
      .then(setOrder)
      .catch(err => toast.error(err?.message || 'Error al crear el pedido'))
      .finally(() => setCreating(false))
  }, [state.orderId]) // eslint-disable-line react-hooks/exhaustive-deps

  const confirmAddress = async () => {
    if (!address.trim()) { toast.error('Ingresá una dirección de entrega'); return }
    setSaving(true)
    try {
      const updated = await medicationOrdersService.updateDeliveryAddress(order.id, address.trim())
      navigate('/paciente/farmacia/pago', { state: { orderId: updated.id } })
    } catch (err) {
      toast.error(err?.message || 'Error al guardar la dirección')
    } finally {
      setSaving(false)
    }
  }

  if (!state.items?.length && !state.orderId) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-bg-primary">
        <p className="text-text-tertiary text-[14px]">No hay un pedido en curso. <button onClick={() => navigate('/paciente/farmacia')} className="text-brand underline">Volver a Farmacia</button></p>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 overflow-y-auto bg-bg-primary">
      <div className="sticky top-0 z-20 bg-bg-primary/95 backdrop-blur-sm border-b border-border-default">
        <div className="flex items-center gap-3 px-4 py-4 max-w-lg mx-auto">
          <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-bg-secondary border border-border-default flex items-center justify-center flex-shrink-0 hover:bg-gray-100 transition-colors">
            <ArrowLeft className="w-5 h-5 text-text-primary" />
          </button>
          <h2 className="flex-1 text-center font-bold text-lg text-text-primary">Tu pedido</h2>
          <div className="w-9" />
        </div>
      </div>

      <div className="px-4 py-6 pb-32 max-w-lg mx-auto space-y-4">
        {(creating || !order) ? (
          <div className="h-40 rounded-2xl bg-bg-secondary animate-pulse" />
        ) : (
          <>
            <div className="bg-bg-secondary rounded-2xl border border-border-default p-4">
              <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest mb-3">Medicamentos</p>
              <div className="space-y-2">
                {(order.items ?? []).map(it => (
                  <div key={it.id} className="bg-white rounded-xl px-3 py-2.5 flex items-center justify-between border border-border-default">
                    <div className="flex items-center gap-2">
                      <Pill className="w-4 h-4 text-brand shrink-0" />
                      <span className="text-[13px] font-semibold text-text-primary">{it.medicationName} x{it.quantity}</span>
                    </div>
                    <span className="text-[13px] text-text-secondary">{fmtPrice(it.unitPrice * it.quantity)}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-3 mt-3 border-t border-border-default">
                <span className="text-[13px] font-semibold text-text-secondary">Total</span>
                <span className="text-[20px] font-black text-text-primary">{fmtPrice(order.total)}</span>
              </div>
            </div>

            <div className="bg-bg-secondary rounded-2xl border border-border-default p-4">
              <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" /> Dirección de entrega
              </p>
              <textarea
                className="form-input"
                rows={2}
                value={address}
                onChange={e => setAddress(e.target.value)}
                placeholder="Calle, número, piso, ciudad..."
              />
            </div>

            <button
              onClick={confirmAddress}
              disabled={saving || !address.trim()}
              className="w-full py-5 rounded-full font-bold text-[16px] flex items-center justify-center gap-3 bg-brand text-white hover:bg-brand-hover active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {saving && <CircleNotch className="w-5 h-5 animate-spin" />}
              {saving ? 'Guardando...' : 'Continuar a pago'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
