import { useEffect, useState } from 'react'
import { FileText, CheckCircle, XCircle } from '@phosphor-icons/react'
import { medicationOrdersService } from '../../services/medicationOrdersService'
import { toast } from '../Toast'
import { formatDate } from '../../lib/format'

const esPdf = path => /\.pdf$/i.test(path ?? '')
const esHeic = path => /\.hei[cf]$/i.test(path || '')

/**
 * "Ya tengo receta" (migración 254), del lado de la farmacia: la foto o el PDF
 * que subió el paciente, y aprobar o rechazar. Aprobar cobra solo la reserva
 * (si no falta nada del médico); rechazar la libera y cancela el pedido. Lo
 * hace la base con `farmacia_resolver_receta_subida`, que re-valida el rol.
 */
export default function RecetaSubidaRevision({ orderId, puedeResolver, esperandoMedico, onResuelto }) {
  const [subidas, setSubidas] = useState([])
  const [urls, setUrls] = useState({})
  const [rechazando, setRechazando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    medicationOrdersService.getRecetasSubidas(orderId)
      .then(async filas => {
        setSubidas(filas)
        const pares = await Promise.all(filas.map(async f =>
          [f.itemId, await medicationOrdersService.urlDeRecetaSubida(f.archivoPath).catch(() => null)]))
        setUrls(Object.fromEntries(pares))
      })
      .catch(err => toast.error(err?.message || 'No pudimos cargar la receta subida'))
  }, [orderId])

  if (subidas.length === 0) return null
  const pendientes = subidas.filter(s => !s.aprobadaAt)

  const resolver = async aprobar => {
    if (!aprobar && !motivo.trim()) { toast.error('Escribí el motivo del rechazo'); return }
    setEnviando(true)
    try {
      const r = await medicationOrdersService.resolverRecetaSubida(orderId, aprobar, aprobar ? null : motivo.trim())
      toast.success(
        r?.estado === 'rechazada' ? 'Receta rechazada. Se liberó la reserva y no se le cobra.'
          : r?.estado === 'aprobada_esperando_medico' ? 'Receta aprobada. Falta la receta del médico para cobrar.'
          : 'Receta aprobada. Estamos cobrando el pedido.'
      )
      setRechazando(false)
      onResuelto?.()
    } catch (err) {
      toast.error(err?.message || 'No pudimos resolver la receta')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="card space-y-4">
      <p className="text-xs uppercase text-text-muted font-semibold">Receta subida por el paciente</p>
      {subidas.map(s => (
        <div key={s.itemId} className="space-y-2">
          <p className="text-sm text-text-primary">
            {s.medicamento}
            {s.aprobadaAt && <span className="text-emerald-600"> · aprobada {formatDate(s.aprobadaAt)}</span>}
          </p>
          {urls[s.itemId] && (esPdf(s.archivoPath) || esHeic(s.archivoPath) ? (
            // HEIC (la foto por defecto del iPhone) no se ve en Chrome ni Firefox:
            // se abre como archivo, igual que el PDF.
            <a href={urls[s.itemId]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-brand font-semibold">
              <FileText className="h-4 w-4" /> {esPdf(s.archivoPath) ? 'Abrir el PDF' : 'Abrir la foto'}
            </a>
          ) : (
            <a href={urls[s.itemId]} target="_blank" rel="noreferrer" className="block">
              <img src={urls[s.itemId]} alt={`Receta de ${s.medicamento}`} className="max-h-96 rounded-xl bg-bg-surface object-contain" />
            </a>
          ))}
        </div>
      ))}

      {puedeResolver && pendientes.length > 0 && !rechazando && (
        <div className="flex flex-wrap gap-3">
          <button className="btn-primary flex items-center gap-1.5" disabled={enviando} onClick={() => resolver(true)}>
            <CheckCircle className="h-4 w-4" /> Aprobar receta
          </button>
          <button className="btn-secondary flex items-center gap-1.5" disabled={enviando} onClick={() => setRechazando(true)}>
            <XCircle className="h-4 w-4" /> Rechazar
          </button>
        </div>
      )}
      {puedeResolver && pendientes.length > 0 && esperandoMedico && (
        <p className="text-xs text-text-secondary">El pedido también tiene un medicamento cuya receta hace un médico de Healthier: se cobra cuando estén las dos.</p>
      )}

      {rechazando && (
        <div className="space-y-3">
          <textarea className="form-textarea" rows={2} value={motivo} onChange={e => setMotivo(e.target.value)}
            placeholder="No se lee la fecha, la receta está vencida, no corresponde al medicamento..." />
          <p className="text-xs text-text-secondary">Se cancela el pedido y se libera la reserva: no se le cobra. El paciente ve el motivo.</p>
          <div className="flex gap-3">
            <button className="btn-danger" disabled={enviando || !motivo.trim()} onClick={() => resolver(false)}>Rechazar receta</button>
            <button className="btn-secondary" disabled={enviando} onClick={() => { setRechazando(false); setMotivo('') }}>Volver</button>
          </div>
        </div>
      )}
    </div>
  )
}
