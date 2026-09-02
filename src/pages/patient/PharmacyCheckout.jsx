import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, MapPin, CircleNotch, Pill, Plus, Minus, Trash } from '@phosphor-icons/react'
import { medicationOrdersService } from '../../services/medicationOrdersService'
import { usePharmacyCart } from '../../context/PharmacyCartContext'
import { toast } from '../../components/Toast'
import { formatARS as fmtPrice } from '../../lib/format'

/**
 * Checkout de farmacia.
 *
 * Ya no recibe el pedido por `location.state`: el carrito **es** el borrador
 * en la base (`PharmacyCartContext` + migración 138), así que entrar acá es
 * simplemente mirar lo que ya existe. Eso saca de un plumazo el caso de
 * "entré al checkout y no había nada" cuando se recargaba la página, y el
 * aviso de "tenés un pedido sin completar" que había que ir a rescatar.
 *
 * El listado va compacto a propósito (pedido de Mateo, 2026-09-02): acá el
 * paciente ya eligió, sólo está confirmando. La versión con foto y tarjeta
 * grande es la del catálogo.
 */
export default function PharmacyCheckout({ profile }) {
  const navigate = useNavigate()
  const { order, items, total, add, subtract, remove, loading, syncing } = usePharmacyCart()

  const [address, setAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [addressTouched, setAddressTouched] = useState(false)

  // La dirección del pedido gana sobre la del perfil, pero sólo hasta que el
  // paciente empieza a escribir: si no, cada respuesta del carrito le pisaría
  // lo que está tipeando.
  useEffect(() => {
    if (addressTouched) return
    setAddress(order?.deliveryAddress || profile?.address || '')
  }, [order?.deliveryAddress, profile?.address, addressTouched])

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

  if (!loading && !items.length) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-bg-primary px-8 text-center">
        <p className="text-text-tertiary text-[14px]">
          Tu carrito está vacío.{' '}
          <button onClick={() => navigate('/paciente/farmacia')} className="text-brand underline">Volver a Farmacia</button>
        </p>
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
        {loading ? (
          <div className="h-40 rounded-2xl bg-bg-secondary animate-pulse" />
        ) : (
          <>
            <div className={`bg-bg-secondary rounded-2xl border border-border-default p-4 ${syncing ? 'opacity-70' : ''}`}>
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest">Medicamentos</p>
                <button onClick={() => navigate('/paciente/farmacia')} className="text-[11px] font-semibold text-brand">
                  Agregar más
                </button>
              </div>

              {/* Listado compacto: una línea por medicamento. */}
              <ul className="divide-y divide-border-default">
                {items.map(it => (
                  <li key={it.productId ?? it.itemId} className="flex items-center gap-2 py-2">
                    <Pill className="w-3.5 h-3.5 text-brand shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-text-primary truncate leading-tight">{it.name}</p>
                      <p className="text-[10px] text-text-tertiary leading-tight">
                        {it.quantity} × {fmtPrice(it.unitPrice)}
                        {it.requiresPrescription ? ' · con receta' : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => subtract({ id: it.productId })}
                        disabled={it.quantity <= 1}
                        aria-label={`Quitar una unidad de ${it.name}`}
                        className="w-6 h-6 rounded-full flex items-center justify-center text-brand disabled:opacity-30"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => add({ id: it.productId })}
                        aria-label={`Agregar una unidad de ${it.name}`}
                        className="w-6 h-6 rounded-full flex items-center justify-center text-brand"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => remove({ id: it.productId }, it.quantity)}
                        aria-label={`Eliminar ${it.name} del pedido`}
                        className="w-6 h-6 rounded-full flex items-center justify-center text-text-tertiary hover:text-danger"
                      >
                        <Trash className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <span className="text-[12px] font-semibold text-text-primary w-16 text-right shrink-0">
                      {fmtPrice(it.unitPrice * it.quantity)}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="flex items-center justify-between pt-3 mt-1 border-t border-border-default">
                <span className="text-[13px] font-semibold text-text-secondary">Total</span>
                <span className="text-[20px] font-black text-text-primary">{fmtPrice(total)}</span>
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
                onChange={e => { setAddressTouched(true); setAddress(e.target.value) }}
                placeholder="Calle, número, piso, ciudad..."
              />
            </div>

            <button
              onClick={confirmAddress}
              disabled={saving || syncing || !address.trim() || !order?.id}
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
