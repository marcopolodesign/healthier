import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ShoppingBag, Pill, Plus, Minus, Trash, CircleNotch } from '@phosphor-icons/react'
import PatientSheet from './PatientSheet'
import { usePharmacyCart } from '../../context/PharmacyCartContext'
import { pharmacyService } from '../../services/pharmacyService'
import { formatARS as fmtPrice } from '../../lib/format'

/**
 * El carrito de farmacia, siempre a mano.
 *
 * Vive en `PatientMobileLayout`. La píldora aparece mientras haya algo en el
 * carrito, pero SÓLO en Consultas y Perfil (ver `RUTAS_CON_PILL`) — Inicio y
 * Bóveda tienen su propio ícono de carrito en el header (`PatientHeader` /
 * `Documents.jsx`, 2026-09-23) y no necesitan la píldora encima. Un nivel más
 * abajo — videollamada, pago, sala de espera, una receta — tampoco se pinta.
 * Al tocarla se abre la hoja con los productos y el botón de ir al checkout,
 * que es el mismo `PatientSheet` que ya usan el resto de las hojas del
 * paciente: en teléfono sube desde abajo con su manija, en escritorio es un
 * modal centrado.
 */
// Pedido de Mateo (2026-09-23): Inicio y Bóveda ya tienen el ícono del
// header, así que la píldora se saca de esas dos y se queda sólo en Consultas
// y Perfil, que todavía no tienen ícono propio.
const RUTAS_CON_PILL = new Set([
  '/paciente/consultas',
  '/paciente/perfil',
])

export default function PharmacyCartSheet() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { order, items, count, total, add, subtract, remove, syncing, sheetOpen, openSheet, closeSheet } = usePharmacyCart()

  // "Recetado por" — reusa el mismo matching por palabra clave que
  // `getPrescriptionMatch` (rcta-issue / Recetas.jsx), sin inventar una
  // heurística nueva. Sólo aplica si el carrito viene de una receta
  // (`order.rctaPrescriptionId`, sellado por `linkPrescription` al agregar
  // desde "Recetados por tu médico"): un carrito armado navegando el
  // catálogo suelto no tiene receta que mostrar, y no se le inventa una.
  const [profesionalPorProducto, setProfesionalPorProducto] = useState({})
  useEffect(() => {
    if (!sheetOpen || !order?.rctaPrescriptionId || !order?.patientId) { setProfesionalPorProducto({}); return }
    let cancelado = false
    pharmacyService.getPrescriptionMatch(order.rctaPrescriptionId, order.patientId)
      .then(({ medicamentos }) => {
        if (cancelado) return
        const mapa = {}
        for (const m of medicamentos) {
          if (m.product?.id && m.medication?.professional?.fullName) mapa[m.product.id] = m.medication.professional.fullName
        }
        setProfesionalPorProducto(mapa)
      })
      .catch(() => {})
    return () => { cancelado = true }
  }, [sheetOpen, order?.rctaPrescriptionId, order?.patientId])

  // La píldora sólo va en las páginas que todavía no tienen ícono propio en
  // el header (pedido de Mateo, 2026-09-04, actualizado 2026-09-23) Y sólo si
  // hay algo en el carrito. Antes se pintaba en TODA pantalla de paciente que
  // no fuera Farmacia — o sea también encima de la videollamada, del pago de
  // la consulta y de la sala de espera. Ahí molesta y confunde: en medio de
  // pagar una consulta, un botón con otro total al lado del importe se lee
  // como parte de ese pago.
  //
  // Es una lista blanca y con coincidencia EXACTA, no `startsWith`: apenas se
  // baja un nivel (una receta, un documento, el detalle de una consulta) la
  // píldora desaparece. Y así una pantalla nueva nace sin carrito encima,
  // que es lo que hay que garantizar — con una lista negra habría que
  // acordarse de sumarla.
  //
  // 🔴 El componente entero (no sólo la píldora) ya NO corta con `if
  // (!count) return null`: el ícono del header de Inicio/Bóveda tiene que
  // poder abrir la hoja aunque el carrito esté vacío (2026-09-23) — antes,
  // con el carrito en cero, `openSheet()` marcaba `sheetOpen=true` en el
  // contexto pero este componente nunca llegaba a montar el `PatientSheet`
  // que la dibuja, así que el clic no hacía nada.
  const mostrarPill = count > 0 && RUTAS_CON_PILL.has(pathname.replace(/\/$/, ''))

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
          <h2 className="text-[20px] font-semibold text-text-primary">Tu carrito</h2>
          <span className="text-[13px] text-text-secondary">{count} producto{count !== 1 ? 's' : ''}</span>
        </div>

        <div className="flex-1 overflow-y-auto px-5 space-y-2">
          {items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <ShoppingBag className="w-8 h-8 text-text-tertiary mb-2" />
              <p className="text-[14px] text-text-tertiary">Tu carrito está vacío</p>
            </div>
          )}
          {items.map(it => (
            <div key={it.productId ?? it.itemId} className="flex items-center gap-3 rounded-xl border border-border-subtle bg-bg-surface px-3 py-3">
              <div className="w-11 h-11 rounded-lg bg-bg-primary flex items-center justify-center overflow-hidden shrink-0">
                {/* Si la foto no carga se esconde y queda el fondo — mismo
                    criterio que la tarjeta del catálogo, donde el catálogo
                    sembrado tenía las 20 imágenes rotas (2026-09-17). */}
                {it.imageUrl
                  ? <img
                      src={it.imageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                    />
                  : <Pill className="w-4 h-4 text-brand" />}
              </div>
              {/* Jerarquía tipográfica HIG: nombre (Headline) → presentación
                  (Subheadline) → recetado por (Footnote). Máximo 3 niveles,
                  el contraste lo da el color de texto, no un cuarto tamaño. */}
              <div className="flex-1 min-w-0">
                <p className="text-[17px] font-semibold text-text-primary truncate">{it.name}</p>
                {it.presentation && <p className="text-[15px] text-text-secondary truncate">{it.presentation}</p>}
                {profesionalPorProducto[it.productId] && (
                  <p className="text-[13px] text-text-tertiary truncate">Recetado por {profesionalPorProducto[it.productId]}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <span className="text-[16px] font-semibold text-text-primary">{fmtPrice(it.unitPrice)}</span>
                <div className="flex items-center gap-1 bg-brand/10 rounded-full px-1.5 py-1">
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

        <div className="flex-shrink-0 px-5 pt-4 pb-6 space-y-3 border-t border-border-subtle mt-3">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-semibold text-text-secondary">Total</span>
            <span className="text-[20px] font-semibold text-text-primary">{fmtPrice(total)}</span>
          </div>
          <button
            onClick={irAlCheckout}
            disabled={count === 0}
            className="w-full py-4 rounded-full bg-brand text-white font-bold text-[15px] active:scale-[0.99] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Proceder al checkout
          </button>
        </div>
      </PatientSheet>
    </>
  )
}
