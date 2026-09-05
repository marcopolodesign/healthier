import { useNavigate, useLocation } from 'react-router-dom'
import { ShoppingBag, Pill, Plus, Minus, Trash, CircleNotch } from '@phosphor-icons/react'
import PatientSheet from './PatientSheet'
import { usePharmacyCart } from '../../context/PharmacyCartContext'
import { formatARS as fmtPrice } from '../../lib/format'

/**
 * El carrito de farmacia, siempre a mano.
 *
 * Vive en `PatientMobileLayout`. La píldora aparece mientras haya algo en el
 * carrito, pero SÓLO en las 4 páginas del nav (ver `RUTAS_CON_PILL`): un
 * nivel más abajo — videollamada, pago, sala de espera, una receta — no se
 * pinta. Al tocarla se abre la hoja con los productos
 * y el botón de ir al checkout, que es el mismo `PatientSheet` que ya usan el
 * resto de las hojas del paciente: en teléfono sube desde abajo con su
 * manija, en escritorio es un modal centrado.
 */
// Las 4 pestañas del nav de paciente (`PatientBottomNav`). Si se agrega o
// renombra una pestaña, esta lista va con ella.
const RUTAS_CON_PILL = new Set([
  '/paciente/dashboard',
  '/paciente/consultas',
  '/paciente/documentos',
  '/paciente/perfil',
])

export default function PharmacyCartSheet() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { items, count, total, add, subtract, remove, syncing, sheetOpen, openSheet, closeSheet } = usePharmacyCart()

  if (!count) return null

  // La píldora sólo va en las páginas principales del nav (pedido de Mateo,
  // 2026-09-04). Antes se pintaba en TODA pantalla de paciente que no fuera
  // Farmacia — o sea también encima de la videollamada, del pago de la
  // consulta y de la sala de espera. Ahí molesta y confunde: en medio de
  // pagar una consulta, un botón con otro total al lado del importe se lee
  // como parte de ese pago.
  //
  // Es una lista blanca y con coincidencia EXACTA, no `startsWith`: apenas se
  // baja un nivel (una receta, un documento, el detalle de una consulta) la
  // píldora desaparece. Y así una pantalla nueva nace sin carrito encima,
  // que es lo que hay que garantizar — con una lista negra habría que
  // acordarse de sumarla.
  const mostrarPill = RUTAS_CON_PILL.has(pathname.replace(/\/$/, ''))

  const irAlCheckout = () => {
    closeSheet()
    navigate('/paciente/farmacia/checkout')
  }

  return (
    <>
      {mostrarPill && (
      <button
        onClick={openSheet}
        aria-label={`Ver el carrito — ${count} producto${count !== 1 ? 's' : ''}`}
        className={`fixed right-4 z-[60] flex items-center gap-2 rounded-full bg-brand px-4 py-3 text-white shadow-[0_8px_30px_rgba(0,0,0,0.18)]
                    active:scale-[0.98] transition-transform bottom-24 lg:bottom-28`}
      >
        <div className="relative">
          <ShoppingBag className="w-5 h-5" weight="fill" />
          <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-white text-brand text-[10px] font-bold flex items-center justify-center">
            {count}
          </span>
        </div>
        <span className="text-[13px] font-bold">{fmtPrice(total)}</span>
        {syncing && <CircleNotch className="w-3.5 h-3.5 animate-spin opacity-80" />}
      </button>
      )}

      <PatientSheet open={sheetOpen} onClose={closeSheet}>
        <div className="flex-shrink-0 px-5 pt-2 pb-3 flex items-baseline justify-between">
          <h2 className="font-bold text-[17px] text-text-primary">Tu carrito</h2>
          <span className="text-[12px] text-text-secondary">{count} producto{count !== 1 ? 's' : ''}</span>
        </div>

        <div className="flex-1 overflow-y-auto px-5 space-y-2">
          {items.map(it => (
            <div key={it.productId ?? it.itemId} className="flex items-center gap-3 rounded-xl border border-border-default bg-bg-surface px-3 py-2.5">
              <div className="w-10 h-10 rounded-lg bg-bg-primary flex items-center justify-center overflow-hidden shrink-0">
                {it.imageUrl
                  ? <img src={it.imageUrl} alt="" className="w-full h-full object-cover" />
                  : <Pill className="w-4 h-4 text-brand" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-text-primary truncate">{it.name}</p>
                <p className="text-[11px] text-text-secondary">
                  {fmtPrice(it.unitPrice)}{it.presentation ? ` · ${it.presentation}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 bg-brand/10 rounded-full px-1.5 py-1 shrink-0">
                <button
                  onClick={() => subtract({ id: it.productId })}
                  disabled={it.quantity <= 1}
                  aria-label={`Quitar una unidad de ${it.name}`}
                  className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-brand disabled:opacity-40"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="text-[12px] font-semibold text-brand w-5 text-center">{it.quantity}</span>
                <button
                  onClick={() => add({ id: it.productId })}
                  aria-label={`Agregar una unidad de ${it.name}`}
                  className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-brand"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
              <button
                onClick={() => remove({ id: it.productId }, it.quantity)}
                aria-label={`Sacar ${it.name} del carrito`}
                className="w-8 h-8 rounded-full flex items-center justify-center text-text-tertiary hover:text-danger hover:bg-danger/10 shrink-0"
              >
                <Trash className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex-shrink-0 px-5 pt-4 pb-6 space-y-3 border-t border-border-default mt-3">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-text-secondary">Total</span>
            <span className="text-[20px] font-black text-text-primary">{fmtPrice(total)}</span>
          </div>
          <button
            onClick={irAlCheckout}
            className="w-full py-4 rounded-full bg-brand text-white font-bold text-[15px] active:scale-[0.99] transition-transform"
          >
            Proceder al checkout
          </button>
        </div>
      </PatientSheet>
    </>
  )
}
