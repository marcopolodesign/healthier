import { useEffect, useState } from 'react'
import { FileImage, CircleNotch } from '@phosphor-icons/react'
import { ordenTrasladoService } from '../../services/ordenTrasladoService'

/** "14:32" si es de hoy; si no, "22 oct, 14:32". */
export function horaDeOrden(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const hoy = new Date().toDateString() === d.toDateString()
  return hoy ? hora : `${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}, ${hora}`
}

/**
 * La orden de traslado de una emergencia (migración 213), como card: miniatura,
 * institución y "Subida por Dra. X · 14:32". Click → la foto en una pestaña
 * nueva (URL firmada, 10 min). Vale la última que se subió.
 *
 * Se usa en el panel del despacho (en curso y terminado), en el super admin y
 * en la atención de la HC. Si la emergencia no tiene orden no dibuja nada,
 * salvo que venga `vacio` (el texto a mostrar en ese caso).
 */
export default function OrdenDeTrasladoCard({ emergencyId, orden: ordenDada, vacio = null, className = '' }) {
  const [orden, setOrden] = useState(undefined)
  const [miniatura, setMiniatura] = useState(null)
  const [abriendo, setAbriendo] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!emergencyId && ordenDada === undefined) return
    let vivo = true
    setOrden(undefined)
    setMiniatura(null)
    setError('')
    // Si el padre ya la trajo (el panel del historial), no se vuelve a listar.
    const lectura = ordenDada !== undefined
      ? Promise.resolve(ordenDada ? [ordenDada] : [])
      : ordenTrasladoService.listar(emergencyId)
    lectura
      .then(async lista => {
        if (!vivo) return
        const ultima = lista[0] ?? null
        setOrden(ultima)
        if (ultima) {
          const url = await ordenTrasladoService.urlFoto(ultima.fotoPath).catch(() => null)
          if (vivo) setMiniatura(url)
        }
      })
      .catch(e => { if (vivo) { setOrden(null); setError(e?.message || 'No pudimos leer la orden de traslado.') } })
    return () => { vivo = false }
  }, [emergencyId, ordenDada])

  // Se pide una URL nueva al abrir: la de la miniatura puede haber vencido.
  async function abrir() {
    if (!orden) return
    // La pestaña se abre en el click (si no, el bloqueador de popups la frena).
    // Sin 'noopener' en los features: con eso `window.open` devuelve null.
    const pestana = window.open('', '_blank')
    if (pestana) pestana.opener = null
    setAbriendo(true)
    setError('')
    try {
      const url = await ordenTrasladoService.urlFoto(orden.fotoPath)
      if (pestana) pestana.location.href = url
      else window.open(url, '_blank', 'noopener')
    } catch (e) {
      pestana?.close()
      setError(e?.message || 'No pudimos abrir la foto.')
    } finally {
      setAbriendo(false)
    }
  }

  if (orden === undefined) return null
  if (!orden) {
    if (error) return <p className={`text-sm text-danger ${className}`}>{error}</p>
    return vacio ? <p className={`text-sm text-text-secondary ${className}`}>{vacio}</p> : null
  }

  return (
    <div className={`card space-y-2 ${className}`} data-testid="orden-traslado">
      <p className="font-semibold text-text-primary">Orden de traslado</p>
      <button
        type="button"
        onClick={abrir}
        className="w-full flex items-center gap-3 text-left rounded-xl hover:bg-bg-surface transition-colors"
        aria-label="Ver la foto de la orden de traslado"
      >
        <span className="w-16 h-16 shrink-0 rounded-xl overflow-hidden bg-bg-surface border border-border-default flex items-center justify-center">
          {miniatura
            ? <img src={miniatura} alt="" className="w-full h-full object-cover" />
            : <FileImage className="h-6 w-6 text-text-tertiary" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-text-primary truncate">{orden.institucion}</span>
          <span className="block text-sm text-text-secondary tabular-nums">
            Subida por {orden.subidor?.fullName || 'la tripulación'} · {horaDeOrden(orden.subidaAt)}
          </span>
        </span>
        {abriendo && <CircleNotch className="h-4 w-4 animate-spin text-text-tertiary shrink-0" />}
      </button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
}

/**
 * Sólo el ícono, para una tabla (super admin): abre la última orden en una
 * pestaña nueva. Se dibuja cuando la fila ya sabe que hay orden.
 */
export function BotonOrden({ emergencyId }) {
  const [error, setError] = useState('')
  async function abrir(ev) {
    ev.stopPropagation()
    const pestana = window.open('', '_blank')
    if (pestana) pestana.opener = null
    try {
      const [ultima] = await ordenTrasladoService.listar(emergencyId)
      if (!ultima) throw new Error('No hay orden')
      const url = await ordenTrasladoService.urlFoto(ultima.fotoPath)
      if (pestana) pestana.location.href = url
    } catch (e) {
      pestana?.close()
      setError(e?.message || 'No pudimos abrir la foto')
    }
  }
  return (
    <button type="button" onClick={abrir} title={error || 'Ver la orden de traslado'} aria-label="Ver la orden de traslado" className="p-1 rounded-lg hover:bg-bg-surface">
      <FileImage className={`h-5 w-5 ${error ? 'text-danger' : 'text-text-secondary'}`} />
    </button>
  )
}
