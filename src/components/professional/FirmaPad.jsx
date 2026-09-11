import { useCallback, useEffect, useRef, useState } from 'react'
import { PencilSimple, Camera, ArrowCounterClockwise, Check, Trash, CircleNotch } from '@phosphor-icons/react'
import { firmaService } from '../../services/firmaService'
import { limpiarFoto, recortarAlTrazo } from '../../lib/firmaImagen'
import { toast } from '../Toast'

/**
 * Carga de la firma ológrafa del profesional — la que se imprime en el bloque
 * "FIRMA Y SELLO" de la receta electrónica.
 *
 * Dos caminos, porque la mitad de los profesionales entra desde el teléfono y
 * la otra mitad desde la computadora:
 *  - **Firmar** con el dedo o el mouse sobre el recuadro.
 *  - **Subir una foto** de la firma hecha en papel, que se limpia sola (ver
 *    `lib/firmaImagen.js`).
 *
 * Se usa en dos lugares: la pestaña Firma de Configuración y la hoja que se
 * abre al emitir una receta sin firma cargada (`FirmaSheet`).
 *
 * ── Detalles que parecen de adorno y no lo son ──────────────────────────────
 * `touch-action: none` sobre el canvas: sin eso, en el teléfono el primer
 * movimiento del dedo scrollea la página en vez de dibujar, y la pantalla se
 * vuelve inusable justo en el caso más importante. Vale también dentro del
 * WebView de la app, que es como llega esta pantalla a mobile.
 *
 * Pointer Events en vez de mouse + touch por separado: es un solo juego de
 * handlers para dedo, mouse y lápiz, y `setPointerCapture` hace que el trazo no
 * se corte cuando el dedo se va del recuadro.
 */

const ALTO_CANVAS = 200
const COLOR_TRAZO = '#1b2a22'

export default function FirmaPad({ userId, onGuardada, compacto = false }) {
  const canvasRef = useRef(null)
  const dibujandoRef = useRef(false)
  const hayTrazoRef = useRef(false)
  const ultimoRef = useRef(null)
  const fileRef = useRef(null)

  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [procesandoFoto, setProcesandoFoto] = useState(false)
  const [firmaGuardada, setFirmaGuardada] = useState(null)
  const [editando, setEditando] = useState(false)
  const [hayTrazo, setHayTrazo] = useState(false)

  // ── Carga inicial ──────────────────────────────────────────────────────────
  useEffect(() => {
    let vivo = true
    firmaService.get(userId)
      .then(f => { if (vivo) { setFirmaGuardada(f); setEditando(!f) } })
      .catch(err => { if (vivo) toast.error(err.message ?? 'No se pudo leer tu firma') })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [userId])

  // ── Canvas ─────────────────────────────────────────────────────────────────
  // Se dimensiona en píxeles reales del dispositivo y se escala el contexto: un
  // canvas a CSS pixels se ve borroso en cualquier pantalla retina, y una firma
  // borrosa al recortarla queda peor todavía.
  const prepararCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const ancho = canvas.clientWidth || 600
    canvas.width = Math.round(ancho * dpr)
    canvas.height = Math.round(ALTO_CANVAS * dpr)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, ancho, ALTO_CANVAS)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = COLOR_TRAZO
    ctx.lineWidth = 2.6
    hayTrazoRef.current = false
    setHayTrazo(false)
  }, [])

  useEffect(() => {
    if (!editando || cargando) return
    prepararCanvas()
    // Rotar el teléfono cambia el ancho del canvas, y redimensionarlo lo borra
    // igual: mejor volver a prepararlo que dejar el trazo estirado.
    const onResize = () => prepararCanvas()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [editando, cargando, prepararCanvas])

  const puntoDe = e => {
    const r = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onPointerDown = e => {
    e.preventDefault()
    canvasRef.current.setPointerCapture?.(e.pointerId)
    dibujandoRef.current = true
    ultimoRef.current = puntoDe(e)
  }

  const onPointerMove = e => {
    if (!dibujandoRef.current) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const p = puntoDe(e)
    const a = ultimoRef.current ?? p
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ultimoRef.current = p
    if (!hayTrazoRef.current) { hayTrazoRef.current = true; setHayTrazo(true) }
  }

  const onPointerUp = e => {
    if (!dibujandoRef.current) return
    e.preventDefault()
    dibujandoRef.current = false
    ultimoRef.current = null
  }

  // ── Guardar ────────────────────────────────────────────────────────────────
  const guardar = async recorte => {
    setGuardando(true)
    try {
      await firmaService.save(userId, {
        dataUrl: recorte.canvas.toDataURL('image/png'),
        origen: recorte.origen,
        ancho: recorte.ancho,
        alto: recorte.alto,
      })
      const fresca = await firmaService.get(userId)
      setFirmaGuardada(fresca)
      setEditando(false)
      toast.success('Firma guardada — va a salir en tus próximas recetas')
      onGuardada?.(fresca)
    } catch (err) {
      toast.error(err.message ?? 'No se pudo guardar la firma')
    } finally {
      setGuardando(false)
    }
  }

  const guardarTrazo = () => {
    const recorte = recortarAlTrazo(canvasRef.current)
    if (!recorte) { toast.warning('Todavía no hay nada dibujado'); return }
    guardar({ ...recorte, origen: 'trazo' })
  }

  const onArchivo = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.warning('Tiene que ser una imagen'); return }

    setProcesandoFoto(true)
    try {
      const img = await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file)
        const i = new Image()
        i.onload = () => { URL.revokeObjectURL(url); resolve(i) }
        i.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo abrir la imagen')) }
        i.src = url
      })
      const recorte = limpiarFoto(img)
      if (!recorte) {
        toast.warning('No se encontró una firma en la foto. Probá con más luz y el papel bien plano.')
        return
      }
      await guardar({ ...recorte, origen: 'foto' })
    } catch (err) {
      toast.error(err.message ?? 'No se pudo procesar la foto')
    } finally {
      setProcesandoFoto(false)
    }
  }

  // Se puede borrar —es su firma— pero se avisa qué implica: desde que es
  // obligatoria, quedarse sin firma es quedarse sin poder recetar. Mismo
  // criterio que desconectar Mercado Pago en Configuración. Para reemplazarla
  // no hace falta borrarla: está "Cambiar la firma".
  const borrar = async () => {
    if (!confirm('¿Eliminar tu firma? No vas a poder emitir recetas hasta que cargues otra.')) return
    setGuardando(true)
    try {
      await firmaService.remove(userId)
      setFirmaGuardada(null)
      setEditando(true)
      toast.success('Firma eliminada')
      onGuardada?.(null)
    } catch (err) {
      toast.error(err.message ?? 'No se pudo eliminar la firma')
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) {
    return <div className="h-40 rounded-xl border border-border-default bg-bg-surface animate-pulse" />
  }

  // ── Firma ya cargada ───────────────────────────────────────────────────────
  if (firmaGuardada && !editando) {
    return (
      <div className="space-y-3">
        <PreviewReceta dataUrl={firmaGuardada.dataUrl} />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setEditando(true)} disabled={guardando}
            className="btn-secondary py-2.5 px-4 text-sm flex items-center gap-2">
            <PencilSimple className="h-4 w-4" /> Cambiar la firma
          </button>
          <button type="button" onClick={borrar} disabled={guardando}
            className="py-2.5 px-4 text-sm text-danger hover:bg-danger/5 rounded-xl flex items-center gap-2 disabled:opacity-50">
            {guardando ? <CircleNotch className="h-4 w-4 animate-spin" /> : <Trash className="h-4 w-4" />} Eliminar
          </button>
        </div>
      </div>
    )
  }

  // ── Cargar / cambiar ───────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {!compacto && (
        <p className="text-sm text-text-secondary">
          Firmá con el dedo o el mouse dentro del recuadro. Se guarda una sola vez y sale
          en todas tus recetas.
        </p>
      )}

      <div className="rounded-xl border border-border-default bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          style={{ height: ALTO_CANVAS, touchAction: 'none' }}
          className="w-full block cursor-crosshair"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerUp}
        />
        <div className="border-t border-border-default px-3 py-2 flex items-center justify-between">
          <span className="text-[11px] text-text-tertiary">
            {hayTrazo ? 'Se recorta sola al trazo' : 'Firmá acá arriba'}
          </span>
          <button type="button" onClick={prepararCanvas} disabled={!hayTrazo || guardando}
            className="text-xs text-text-secondary hover:text-text-primary flex items-center gap-1.5 disabled:opacity-40">
            <ArrowCounterClockwise className="h-3.5 w-3.5" /> Empezar de nuevo
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={guardarTrazo} disabled={!hayTrazo || guardando || procesandoFoto}
          className="btn-primary py-2.5 px-4 text-sm font-semibold flex items-center gap-2 disabled:opacity-50">
          {guardando ? <CircleNotch className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Guardar firma
        </button>

        <button type="button" onClick={() => fileRef.current?.click()} disabled={guardando || procesandoFoto}
          className="btn-secondary py-2.5 px-4 text-sm flex items-center gap-2 disabled:opacity-50">
          {procesandoFoto ? <CircleNotch className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          Subir una foto
        </button>

        {firmaGuardada && (
          <button type="button" onClick={() => setEditando(false)} disabled={guardando}
            className="py-2.5 px-4 text-sm text-text-secondary hover:text-text-primary">
            Cancelar
          </button>
        )}

        {/* `capture` no se fuerza: en el teléfono conviene poder elegir entre
            sacar la foto en el momento y tomar una que ya está en el carrete. */}
        <input ref={fileRef} type="file" accept="image/*" onChange={onArchivo} className="hidden" />
      </div>

      {!compacto && (
        <p className="text-xs text-text-tertiary">
          Si preferís la foto: firmá en una hoja blanca, sacale la foto de frente y con
          buena luz. El fondo del papel se limpia solo.
        </p>
      )}
    </div>
  )
}

/**
 * Cómo queda la firma en la receta, al tamaño real.
 *
 * No es decoración: el bloque del PDF es chico y angosto, y sin verlo el
 * profesional guarda una firma enorme, la ve perfecta en pantalla y se entera
 * de que salió ilegible recién cuando el paciente llega a la farmacia.
 */
function PreviewReceta({ dataUrl }) {
  return (
    <div className="rounded-xl border border-border-default bg-white p-4">
      <p className="text-[11px] uppercase tracking-wide text-text-tertiary mb-3">
        Así va a salir en la receta
      </p>
      <div className="w-[200px] ml-auto text-center">
        <img src={dataUrl} alt="Tu firma" className="h-[38px] mx-auto object-contain" />
        <div className="border-t border-dotted border-text-tertiary mt-0.5 pt-1">
          <span className="text-[9px] tracking-wide text-text-secondary">FIRMA Y SELLO</span>
        </div>
      </div>
    </div>
  )
}
