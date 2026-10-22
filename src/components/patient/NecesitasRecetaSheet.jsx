import { useNavigate } from 'react-router-dom'
import { Stethoscope, ShoppingBag, LockSimple } from '@phosphor-icons/react'
import PatientSheet from './PatientSheet'
import { usePharmacyCart } from '../../context/PharmacyCartContext'
import { formatARS } from '../../lib/format'

/**
 * "Necesitás receta" — la hoja que se abre cuando el paciente quiere un
 * producto con receta y no tiene una vigente que lo cubra (pedido de Mateo y
 * Nacho, 2026-10-22). Lo manda a la consulta inmediata de Clínica.
 *
 * Se abre de dos maneras y las dos llegan acá: tocando "Pedir receta" en el
 * catálogo (`cart.pedirReceta`) o cuando el servidor rechaza el "+" con HR001
 * (migración 214) — así un producto que la pantalla creía cubierto, y que la
 * base no, termina en el mismo lugar.
 *
 * Montada una sola vez, en `PatientMobileLayout`, junto a la hoja del carrito.
 */
export default function NecesitasRecetaSheet() {
  const navigate = useNavigate()
  const { recetaPara: producto, cerrarReceta, closeSheet } = usePharmacyCart()
  const controlado = producto?.prescriptionType === 'receta_archivada'

  const irAVideoconsulta = () => {
    cerrarReceta()
    closeSheet()
    navigate('/paciente/ondemand/clinica')
  }

  return (
    <PatientSheet open={!!producto} onClose={cerrarReceta} maxWidth="max-w-md">
      <div className="px-6 pt-4 pb-8 sm:pt-8 flex flex-col gap-5">
        <div className="w-14 h-14 rounded-full bg-brand-tertiary-muted flex items-center justify-center">
          <Stethoscope className="w-7 h-7 text-brand-tertiary-hover" />
        </div>
        <div>
          <h2 className="font-serif font-light text-[28px] leading-tight text-text-primary">Necesitás receta</h2>
          <p className="text-[15px] leading-[22px] text-text-secondary mt-2">
            Pedila en tu videoconsulta con un clínico. Si te la indica, aparece en Tus recetas y la comprás desde acá.
          </p>
          {controlado && (
            <p className="flex items-start gap-2 text-[14px] leading-[20px] text-brand-tertiary-hover mt-3">
              <LockSimple className="w-4 h-4 mt-0.5 shrink-0" />
              Es un medicamento controlado: cada compra necesita una receta nueva.
            </p>
          )}
        </div>

        {producto?.name && (
          <div className="flex items-center gap-3 rounded-2xl border border-border-default bg-bg-surface p-3">
            <div className="w-12 h-12 rounded-xl bg-bg-primary flex items-center justify-center overflow-hidden shrink-0">
              {producto.imageUrl
                ? <img src={producto.imageUrl} alt="" className="w-full h-full object-cover" />
                : <ShoppingBag className="w-5 h-5 text-text-tertiary" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-text-primary leading-snug">{producto.name}</p>
              {producto.price != null && <p className="text-[14px] text-text-secondary">{formatARS(producto.price)}</p>}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            onClick={irAVideoconsulta}
            className="w-full py-4 rounded-full bg-brand hover:bg-brand-hover text-white text-[15px] font-semibold flex items-center justify-center gap-2"
          >
            <Stethoscope className="w-5 h-5" /> Hacer videoconsulta ahora
          </button>
          <button
            onClick={cerrarReceta}
            className="w-full py-3 rounded-full text-[15px] font-semibold text-text-secondary hover:bg-bg-surface-hover"
          >
            Ahora no
          </button>
        </div>
      </div>
    </PatientSheet>
  )
}
