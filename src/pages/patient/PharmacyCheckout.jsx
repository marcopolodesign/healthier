import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, MapPin, CircleNotch, Pill, Trash, Plus, Minus } from '@phosphor-icons/react'
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
  const [updatingItem, setUpdatingItem] = useState(null) // id del item en vuelo

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

  /**
   * quantity 0 saca el medicamento. Si era el último, el borrador entero
   * desaparece (migración 137) y no hay pedido al que volver: se vuelve al
   * catálogo en vez de dejar una pantalla vacía.
   */
  const changeItemQuantity = async (item, quantity) => {
    setUpdatingItem(item.id)
    try {
      const updated = await medicationOrdersService.setItemQuantity(item.id, quantity)
      if (!updated) {
        toast.info('Tu pedido quedó vacío')
        navigate('/paciente/farmacia', { replace: true })
        return
      }
      setOrder(updated)
    } catch (err) {
      toast.error(err?.message || 'No se pudo actualizar el pedido')
    } finally {
      setUpdatingItem(null)
    }
  }

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
                  <div key={it.id} className={`bg-white rounded-xl px-3 py-2.5 flex items-center gap-3 border border-border-default ${updatingItem === it.id ? 'opacity-50 pointer-events-none' : ''}`}>
                    <Pill className="w-4 h-4 text-brand shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-text-primary truncate">{it.medicationName}</p>
                      <p className="text-[11px] text-text-secondary">{fmtPrice(it.unitPrice * it.quantity)}</p>
                    </div>
                    <div className="flex items-center gap-1 bg-brand/10 rounded-full px-1.5 py-1 shrink-0">
                      <button
                        onClick={() => changeItemQuantity(it, it.quantity - 1)}
                        disabled={it.quantity <= 1}
                        aria-label={`Quitar una unidad de ${it.medicationName}`}
                        className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-brand disabled:opacity-40"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-[12px] font-semibold text-brand w-5 text-center">{it.quantity}</span>
                      <button
                        onClick={() => changeItemQuantity(it, it.quantity + 1)}
                        aria-label={`Agregar una unidad de ${it.medicationName}`}
                        className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-brand"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    <button
                      onClick={() => changeItemQuantity(it, 0)}
                      aria-label={`Eliminar ${it.medicationName} del pedido`}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-text-tertiary hover:text-danger hover:bg-danger/10 shrink-0"
                    >
                      <Trash className="w-4 h-4" />
                    </button>
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
