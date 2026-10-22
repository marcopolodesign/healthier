import { useEffect, useState } from 'react'
import { FileImage, CircleNotch } from '@phosphor-icons/react'
import { ordenTrasladoService, ultimosPorTipo, TIPO_DOCUMENTO } from '../../services/ordenTrasladoService'

/** "14:32" si es de hoy; si no, "22 oct, 14:32". */
export function horaDeOrden(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const hoy = new Date().toDateString() === d.toDateString()
  return hoy ? hora : `${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}, ${hora}`
}

/** La pestaña se abre EN el click (antes de cualquier await), o el bloqueador de popups la frena. */
function abrirPestana() {
  // Sin 'noopener' en los features: con eso `window.open` devuelve null.
  const pestana = window.open('', '_blank')
  if (pestana) pestana.opener = null
  return pestana
}

/** Carga en `pestana` (ya abierta en el click) la foto con una URL firmada recién pedida. */
async function abrirFoto(path, pestana = abrirPestana()) {
  try {
    const url = await ordenTrasladoService.urlFoto(path)
    if (pestana) pestana.location.href = url
    else window.open(url, '_blank', 'noopener')
  } catch (e) {
    pestana?.close()
    throw e
  }
}

function Documento({ doc }) {
  const [miniatura, setMiniatura] = useState(null)
  const [abriendo, setAbriendo] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let vivo = true
    ordenTrasladoService.urlFoto(doc.fotoPath).then(u => { if (vivo) setMiniatura(u) }).catch(() => {})
    return () => { vivo = false }
  }, [doc.fotoPath])

  async function abrir() {
    setAbriendo(true)
    setError('')
    try { await abrirFoto(doc.fotoPath) } catch (e) { setError(e?.message || 'No pudimos abrir la foto.') }
    setAbriendo(false)
  }

  return (
    <div className="space-y-2">
      <p className="font-semibold text-text-primary">{TIPO_DOCUMENTO[doc.tipo] ?? 'Documento'}</p>
      <button
        type="button"
        onClick={abrir}
        className="w-full flex items-center gap-3 text-left rounded-xl hover:bg-bg-surface transition-colors"
        aria-label={`Ver la foto: ${TIPO_DOCUMENTO[doc.tipo] ?? 'documento'}`}
      >
        <span className="w-16 h-16 shrink-0 rounded-xl overflow-hidden bg-bg-surface border border-border-default flex items-center justify-center">
          {miniatura
            ? <img src={miniatura} alt="" className="w-full h-full object-cover" />
            : <FileImage className="h-6 w-6 text-text-tertiary" />}
        </span>
        <span className="min-w-0 flex-1">
          {doc.tipo !== 'negativa' && <span className="block font-semibold text-text-primary truncate">{doc.institucion}</span>}
          <span className="block text-sm text-text-secondary tabular-nums">
            {doc.subidor?.fullName ? `Subida por ${doc.subidor.fullName}` : 'Subida'} · {horaDeOrden(doc.subidaAt)}
          </span>
        </span>
        {abriendo && <CircleNotch className="h-4 w-4 animate-spin text-text-tertiary shrink-0" />}
      </button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
}

/**
 * Los documentos de cierre de una emergencia (migración 213): la orden de
 * traslado y la negativa de atención, el último de cada tipo. Miniatura, qué
 * es y "Subida por Dra. X · 14:32"; click → la foto en una pestaña nueva (URL
 * firmada, 10 min).
 *
 * Se usa en el panel del despacho (en curso y terminado), en la HC del
 * profesional y del paciente. `documentos`: si el padre ya los trajo, no se
 * vuelven a pedir. Sin documentos no dibuja nada, salvo que venga `vacio`.
 */
export default function OrdenDeTrasladoCard({ emergencyId, documentos: dados, tipos = ['orden_traslado', 'negativa'], vacio = null, className = '' }) {
  const [docs, setDocs] = useState(undefined)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!emergencyId && dados === undefined) return
    let vivo = true
    setDocs(undefined)
    setError('')
    const lectura = dados !== undefined ? Promise.resolve(dados ?? []) : ordenTrasladoService.listar(emergencyId)
    lectura
      .then(lista => { if (vivo) setDocs(lista) })
      .catch(e => { if (vivo) { setDocs([]); setError(e?.message || 'No pudimos leer los documentos.') } })
    return () => { vivo = false }
  }, [emergencyId, dados])

  if (docs === undefined) return null
  const ultimos = ultimosPorTipo(docs)
  const orden = tipos.includes('orden_traslado') ? ultimos.orden_traslado : null
  const negativa = tipos.includes('negativa') ? ultimos.negativa : null
  if (!orden && !negativa) {
    if (error) return <p className={`text-sm text-danger ${className}`}>{error}</p>
    return vacio ? <p className={`text-sm text-text-secondary ${className}`}>{vacio}</p> : null
  }

  return (
    <div className={`card space-y-4 ${className}`} data-testid="orden-traslado">
      {orden && <Documento doc={orden} />}
      {negativa && <Documento doc={negativa} />}
    </div>
  )
}

/**
 * Sólo el ícono, para una tabla (super admin): abre el último documento (la
 * orden si hay, si no la negativa) en una pestaña nueva.
 */
export function BotonOrden({ emergencyId, soloNegativa = false }) {
  const [error, setError] = useState('')
  const etiqueta = soloNegativa ? 'Ver la negativa de atención' : 'Ver la orden de traslado'
  async function abrir(ev) {
    ev.stopPropagation()
    const pestana = abrirPestana()
    try {
      const { orden_traslado: orden, negativa } = ultimosPorTipo(await ordenTrasladoService.listar(emergencyId))
      const doc = orden ?? negativa
      if (!doc) throw new Error('No hay documentos')
      await abrirFoto(doc.fotoPath, pestana)
    } catch (e) {
      pestana?.close()
      setError(e?.message || 'No pudimos abrir la foto')
    }
  }
  return (
    <button type="button" onClick={abrir} title={error || etiqueta} aria-label={etiqueta} className="p-1 rounded-lg hover:bg-bg-surface">
      <FileImage className={`h-5 w-5 ${error ? 'text-danger' : 'text-text-secondary'}`} />
    </button>
  )
}
