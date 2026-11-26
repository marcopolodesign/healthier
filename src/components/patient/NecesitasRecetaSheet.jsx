import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, VideoCamera, ShoppingBag, LockSimple, CircleNotch } from '@phosphor-icons/react'
import PatientSheet from './PatientSheet'
import RecetaSubidaScreen from './RecetaSubidaScreen'
import { usePharmacyCart } from '../../context/PharmacyCartContext'
import { formatARS } from '../../lib/format'

/**
 * "Necesita receta" — la hoja que se abre cuando el paciente quiere un
 * producto con receta y no tiene una vigente que lo cubra.
 *
 * Versión 3 de Felipe, elegida por Mateo (2026-11-26): "Un camino". El camino
 * principal es comprar ahora y que un médico de Healthier le haga la receta
 * sin costo (el pago se reserva y se cobra cuando la receta está lista; si no
 * corresponde, se libera). Los otros dos, chicos: "Ya tengo receta" (sube la
 * foto o el PDF y la farmacia la aprueba) y la videoconsulta de siempre.
 *
 * Se abre de dos maneras y las dos llegan acá: tocando "Pedir receta" en el
 * catálogo (`cart.pedirReceta`) o cuando el servidor rechaza el "+" con HR001
 * (migración 214).
 *
 * Montada una sola vez, en `PatientMobileLayout`, junto a la hoja del carrito.
 */
export default function NecesitasRecetaSheet() {
  const navigate = useNavigate()
  const { recetaPara: producto, cerrarReceta, closeSheet, openSheet, addConReceta } = usePharmacyCart()
  const [agregando, setAgregando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [sinFoto, setSinFoto] = useState(false)
  const controlado = producto?.prescriptionType === 'receta_archivada'

  const cerrar = () => { setSubiendo(false); setSinFoto(false); cerrarReceta() }

  const irAVideoconsulta = () => {
    cerrar()
    closeSheet()
    navigate('/paciente/ondemand/clinica')
  }

  const comprarYPedirReceta = async () => {
    if (agregando) return
    setAgregando(true)
    const ok = await addConReceta(producto, 'solicitar')
    setAgregando(false)
    if (ok) { cerrar(); openSheet() }
  }

  if (subiendo && producto) {
    return (
      <RecetaSubidaScreen
        producto={producto}
        onCerrar={() => setSubiendo(false)}
        onListo={() => { cerrar(); openSheet() }}
      />
    )
  }

  return (
    <PatientSheet open={!!producto} onClose={cerrar} maxWidth="max-w-md">
      <div className="px-6 pt-4 pb-8 sm:pt-8 flex flex-col gap-6">
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
          <span>Con receta</span>
          {controlado && (
            <span className="flex items-center gap-1.5 text-brand-tertiary-hover">
              <LockSimple className="w-3.5 h-3.5" /> Controlado
            </span>
          )}
        </div>

        {producto?.name && (
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-bg-surface flex items-center justify-center overflow-hidden shrink-0">
              {producto.imageUrl && !sinFoto
                ? <img src={producto.imageUrl} alt="" onError={() => setSinFoto(true)} className="w-full h-full object-cover" />
                : <ShoppingBag className="w-6 h-6 text-text-tertiary" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] text-text-primary leading-snug">{producto.name}</p>
              {producto.price != null && <p className="text-[15px] text-text-secondary tabular-nums">{formatARS(producto.price)}</p>}
            </div>
          </div>
        )}

        <div>
          <h2 className="font-serif font-light text-[30px] leading-[1.1] text-text-primary">Te hacemos la receta, sin costo.</h2>
          <p className="text-[15px] leading-[22px] text-text-secondary mt-3">
            Comprás ahora. Un médico te llama y, si no corresponde, no se cobra nada.
          </p>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            onClick={comprarYPedirReceta}
            disabled={agregando}
            className="w-full py-4 rounded-full bg-brand hover:bg-brand-hover text-white text-[16px] font-medium flex items-center justify-center gap-2 disabled:opacity-70"
          >
            {agregando && <CircleNotch className="w-5 h-5 animate-spin" />}
            Comprar y pedir receta
          </button>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={() => setSubiendo(true)}
              className="py-3.5 rounded-full bg-bg-surface-hover text-[15px] text-text-primary flex items-center justify-center gap-2 hover:bg-border-subtle"
            >
              <Camera className="w-4.5 h-4.5" /> Ya tengo receta
            </button>
            <button
              onClick={irAVideoconsulta}
              className="py-3.5 rounded-full bg-bg-surface-hover text-[15px] text-text-primary flex items-center justify-center gap-2 hover:bg-border-subtle"
            >
              <VideoCamera className="w-4.5 h-4.5" /> Videoconsulta
            </button>
          </div>
        </div>

        {controlado && (
          <p className="text-center text-[13px] text-text-secondary -mt-2">
            Cada compra de este remedio lleva receta nueva.
          </p>
        )}
      </div>
    </PatientSheet>
  )
}
