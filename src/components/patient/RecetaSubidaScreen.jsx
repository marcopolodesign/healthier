import { useEffect, useRef, useState } from 'react'
import { X, Camera, FilePdf, CircleNotch, Image as ImageIcon } from '@phosphor-icons/react'
import { medicationOrdersService } from '../../services/medicationOrdersService'
import { usePharmacyCart } from '../../context/PharmacyCartContext'
import { toast } from '../Toast'
import { formatARS } from '../../lib/format'
import { tipoDe, TIPOS_RECETA } from '../../lib/archivoSubible'
import { LIMITE_BUCKET_BYTES } from '../../lib/subidaConProgreso'

/**
 * "Ya tengo receta" — Versión 3 de Felipe (2026-11-26): pantalla de cámara,
 * "¿Se lee bien?". El paciente saca una foto o sube el PDF, confirma que se lee
 * y recién ahí se sube al bucket privado y se agrega el producto marcado
 * `receta_via = 'subida'`. La farmacia la aprueba antes de preparar; si la
 * rechaza, se libera la reserva y no se cobra.
 */
export default function RecetaSubidaScreen({ producto, onCerrar, onListo }) {
  const { addConReceta } = usePharmacyCart()
  const camaraRef = useRef(null)
  const archivoRef = useRef(null)
  const [archivo, setArchivo] = useState(null)
  const [vista, setVista] = useState(null)
  const [enviando, setEnviando] = useState(false)

  // Al entrar abre la cámara (o el selector, en escritorio): es lo que vino a hacer.
  useEffect(() => { camaraRef.current?.click() }, [])
  useEffect(() => () => { if (vista) URL.revokeObjectURL(vista) }, [vista])

  const elegir = e => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    let tipo
    try { tipo = tipoDe(f, TIPOS_RECETA) } catch (err) { toast.error(err.message); return }
    if (f.size > LIMITE_BUCKET_BYTES) { toast.error('El archivo pesa más de 10 MB. Probá con una foto más liviana.'); return }
    setArchivo(f)
    setVista(tipo === 'application/pdf' ? null : URL.createObjectURL(f))
  }

  const usarEsta = async () => {
    if (!archivo || enviando) return
    setEnviando(true)
    try {
      const path = await medicationOrdersService.subirReceta(archivo)
      const ok = await addConReceta(producto, 'subida', path)
      if (ok) onListo()
    } catch (err) {
      toast.error(err?.message || 'No pudimos subir la receta')
    } finally {
      setEnviando(false)
    }
  }

  const esPdf = !vista && !!archivo

  return (
    <div className="fixed inset-0 z-[80] bg-midnight flex flex-col sm:items-center sm:justify-center">
      <input ref={camaraRef} type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={elegir} />
      <input ref={archivoRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={elegir} />

      <div className="w-full sm:max-w-md flex flex-col flex-1 sm:flex-none sm:h-[90dvh] sm:rounded-[28px] sm:overflow-hidden bg-midnight">
        <div className="flex items-center px-4 pt-5 pb-3">
          <button onClick={onCerrar} aria-label="Cerrar" className="w-10 h-10 rounded-full flex items-center justify-center text-white">
            <X className="w-6 h-6" />
          </button>
          <p className="flex-1 text-center text-[12px] font-semibold uppercase tracking-[0.16em] text-white/80">Tu receta</p>
          <div className="w-10" />
        </div>

        <div className="flex-1 min-h-0 px-5 pb-5">
          <div className="h-full rounded-[24px] bg-white/10 flex items-center justify-center overflow-hidden">
            {vista ? (
              <img src={vista} alt="Tu receta" className="max-h-full max-w-full object-contain" />
            ) : esPdf ? (
              <div className="flex flex-col items-center gap-3 text-white px-6 text-center">
                <FilePdf className="w-14 h-14" />
                <p className="text-[15px] break-all">{archivo.name}</p>
              </div>
            ) : (
              <button onClick={() => camaraRef.current?.click()} className="flex flex-col items-center gap-3 text-white/80 px-6 text-center">
                <ImageIcon className="w-12 h-12" />
                <p className="text-[15px]">Sacale una foto a tu receta o subí el PDF.</p>
              </button>
            )}
          </div>
        </div>

        <div className="bg-bg-secondary rounded-t-[28px] sm:rounded-none px-6 pt-6 pb-8 flex flex-col gap-4">
          <div>
            <h2 className="font-serif font-light text-[26px] leading-tight text-text-primary">¿Se lee bien?</h2>
            <p className="text-[15px] leading-[22px] text-text-secondary mt-2">
              Que se vean el nombre, la firma y la fecha. La farmacia la revisa antes de preparar.
            </p>
          </div>
          <button
            onClick={usarEsta}
            disabled={!archivo || enviando}
            className="w-full py-4 rounded-full bg-brand hover:bg-brand-hover text-white text-[16px] font-medium flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {enviando && <CircleNotch className="w-5 h-5 animate-spin" />}
            Usar esta{producto?.price != null ? ` · Comprar ${formatARS(producto.price)}` : ''}
          </button>
          <div className="grid grid-cols-2 gap-2.5">
            <button onClick={() => camaraRef.current?.click()} disabled={enviando}
              className="py-3.5 rounded-full bg-bg-surface-hover text-[15px] text-text-primary flex items-center justify-center gap-2">
              <Camera className="w-4.5 h-4.5" /> {archivo ? 'Sacar otra' : 'Sacar foto'}
            </button>
            <button onClick={() => archivoRef.current?.click()} disabled={enviando}
              className="py-3.5 rounded-full bg-bg-surface-hover text-[15px] text-text-primary flex items-center justify-center gap-2">
              <FilePdf className="w-4.5 h-4.5" /> Subir PDF
            </button>
          </div>
          <p className="text-center text-[13px] text-text-secondary">Si la farmacia no la aprueba, no se cobra.</p>
        </div>
      </div>
    </div>
  )
}
