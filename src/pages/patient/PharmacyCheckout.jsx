import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, MapPin, CaretRight, CircleNotch, Pill, Plus, Minus, Trash } from '@phosphor-icons/react'
import { medicationOrdersService } from '../../services/medicationOrdersService'
import { patientAddressesService } from '../../services/patientAddressesService'
import { usePharmacyCart } from '../../context/PharmacyCartContext'
import { toast } from '../../components/Toast'
import { formatARS as fmtPrice } from '../../lib/format'
import AddressPickerSheet from '../../components/patient/AddressPickerSheet'
import AddressFormSheet from '../../components/patient/AddressFormSheet'

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

  // "Mis direcciones" (migración 173) reemplaza al textarea de texto libre:
  // el paciente elige entre las que ya cargó, en vez de reescribirla en cada
  // pedido. Default: la principal, si no la más nueva — `list()` ya las
  // devuelve en ese orden.
  const [addresses, setAddresses] = useState([])
  const [loadingAddresses, setLoadingAddresses] = useState(true)
  const [selectedAddressId, setSelectedAddressId] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [savingAddress, setSavingAddress] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    patientAddressesService.list(profile.id)
      .then(list => {
        setAddresses(list)
        setSelectedAddressId(prev => prev ?? list[0]?.id ?? null)
      })
      .catch(() => toast.error('No pudimos cargar tus direcciones'))
      .finally(() => setLoadingAddresses(false))
  }, [profile?.id])

  const selectedAddress = addresses.find(a => a.id === selectedAddressId) ?? null

  const handleAddAddress = async payload => {
    setSavingAddress(true)
    try {
      const created = await patientAddressesService.create(profile.id, payload)
      setAddresses(prev => [created, ...prev])
      setSelectedAddressId(created.id)
      setFormOpen(false)
      toast.success('Dirección agregada')
    } catch (err) {
      toast.error(err?.message || 'No pudimos guardar la dirección')
    } finally {
      setSavingAddress(false)
    }
  }

  const confirmAddress = async () => {
    if (!selectedAddress) { toast.error('Elegí una dirección de entrega'); return }
    setSaving(true)
    try {
      const texto = [selectedAddress.direccion, selectedAddress.pisoDepto].filter(Boolean).join(', ')
      const updated = await medicationOrdersService.updateDeliveryAddress(order.id, texto)
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
            <div className={`bg-bg-secondary rounded-2xl border border-border-subtle p-4 ${syncing ? 'opacity-70' : ''}`}>
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest">Medicamentos</p>
                <button onClick={() => navigate('/paciente/farmacia')} className="text-[11px] font-semibold text-brand">
                  Agregar más
                </button>
              </div>

              {/* Listado compacto: una línea por medicamento. */}
              <ul className="divide-y divide-border-subtle">
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

              <div className="flex items-center justify-between pt-3 mt-1 border-t border-border-subtle">
                <span className="text-[13px] font-semibold text-text-secondary">Total</span>
                <span className="text-[20px] font-black text-text-primary">{fmtPrice(total)}</span>
              </div>
            </div>

            <div className="bg-bg-secondary rounded-2xl border border-border-subtle p-4">
              <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" /> Dirección de entrega
              </p>
              {loadingAddresses ? (
                <div className="h-14 rounded-xl bg-bg-primary animate-pulse" />
              ) : selectedAddress ? (
                <button
                  onClick={() => setPickerOpen(true)}
                  className="w-full flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-white px-4 py-3 text-left hover:bg-bg-surface transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-text-primary">{selectedAddress.etiqueta}</p>
                    <p className="text-[12px] text-text-secondary truncate">
                      {selectedAddress.direccion}{selectedAddress.pisoDepto ? `, ${selectedAddress.pisoDepto}` : ''}
                    </p>
                  </div>
                  <CaretRight className="w-4 h-4 text-text-tertiary shrink-0" />
                </button>
              ) : (
                <button
                  onClick={() => setFormOpen(true)}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl border-2 border-dashed border-border-subtle text-[13px] font-semibold text-brand hover:bg-brand-muted/40 transition-colors"
                >
                  <Plus className="w-4 h-4" /> Agregar dirección
                </button>
              )}
            </div>

            <button
              onClick={confirmAddress}
              disabled={saving || syncing || !selectedAddress || !order?.id}
              className="w-full py-5 rounded-full font-bold text-[16px] flex items-center justify-center gap-3 bg-brand text-white hover:bg-brand-hover active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {saving && <CircleNotch className="w-5 h-5 animate-spin" />}
              {saving ? 'Guardando...' : 'Continuar a pago'}
            </button>
          </>
        )}
      </div>

      <AddressPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        addresses={addresses}
        selectedId={selectedAddressId}
        onSelect={a => { setSelectedAddressId(a.id); setPickerOpen(false) }}
        onAdd={() => { setPickerOpen(false); setFormOpen(true) }}
      />
      <AddressFormSheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSave={handleAddAddress}
        saving={savingAddress}
      />
    </div>
  )
}
