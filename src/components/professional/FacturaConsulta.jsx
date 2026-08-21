import { useRef, useState } from 'react'
import { FilePdf, Upload, CircleNotch, ArrowsClockwise } from '@phosphor-icons/react'
import SignedDocLink from '../SignedDocLink'

const MAX_MB = 10

/**
 * Factura del profesional por la consulta (migración 119).
 *
 * Un solo control para los dos lugares donde aparece:
 *  - `CloseConsultationModal` — al cerrar, con `modo="diferido"`: no sube nada
 *    todavía, sólo entrega el File al padre, que lo sube DESPUÉS de que el
 *    cierre haya salido bien. Subir antes dejaría facturas de consultas que no
 *    llegaron a cerrarse.
 *  - `ConsultationDetail` — con `modo="inmediato"`: sube al instante y avisa,
 *    porque ahí no hay ningún "guardar" que lo acompañe.
 *
 * Se puede reemplazar siempre, también con la consulta ya cerrada — es lo
 * único editable después del cierre, a propósito (ver migración 119).
 */
export default function FacturaConsulta({
  invoiceUrl,
  invoiceUploadedAt,
  modo = 'inmediato',
  onSubir,          // (file) => Promise<void>  — sólo en modo inmediato
  onArchivoElegido, // (file) => void           — sólo en modo diferido
  disabled = false,
}) {
  const inputRef = useRef(null)
  const [subiendo, setSubiendo] = useState(false)
  const [pendiente, setPendiente] = useState(null)
  const [error, setError] = useState(null)

  // Sin esto, rechazar un archivo dejaba el input con ese mismo valor: volver a
  // elegir EL MISMO archivo no dispara `change`, así que el error se quedaba en
  // pantalla y el botón parecía muerto.
  const limpiarInput = () => { if (inputRef.current) inputRef.current.value = '' }

  const elegir = async (file) => {
    if (!file) return
    setError(null)

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('La factura tiene que ser un PDF.')
      limpiarInput()
      return
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`El archivo supera los ${MAX_MB} MB.`)
      limpiarInput()
      return
    }

    if (modo === 'diferido') {
      setPendiente(file)
      onArchivoElegido?.(file)
      return
    }

    setSubiendo(true)
    try {
      await onSubir?.(file)
    } catch (err) {
      // El motivo real, nunca un mensaje genérico.
      setError(err?.message || 'No se pudo subir la factura.')
    } finally {
      setSubiendo(false)
      limpiarInput()
    }
  }

  const yaHay = Boolean(invoiceUrl)
  const fecha = invoiceUploadedAt
    ? new Date(invoiceUploadedAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={e => elegir(e.target.files?.[0])}
      />

      {yaHay && (
        <div className="flex items-center gap-3 rounded-lg border border-border-default bg-bg-surface p-3">
          <FilePdf className="h-5 w-5 text-brand shrink-0" />
          <div className="flex-1 min-w-0">
            <SignedDocLink
              bucket="professional-docs"
              url={invoiceUrl}
              className="text-sm font-medium text-brand hover:underline"
            >
              Ver factura
            </SignedDocLink>
            {fecha && <p className="text-xs text-text-tertiary">Subida el {fecha}</p>}
          </div>
        </div>
      )}

      {pendiente && (
        <div className="flex items-center gap-3 rounded-lg border border-brand/30 bg-brand-muted/30 p-3">
          <FilePdf className="h-5 w-5 text-brand shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{pendiente.name}</p>
            <p className="text-xs text-text-tertiary">Se adjunta al confirmar el cierre.</p>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => { setPendiente(null); onArchivoElegido?.(null); limpiarInput() }}
            className="text-xs text-text-secondary underline shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Quitar
          </button>
        </div>
      )}

      {!pendiente && (
        <button
          type="button"
          disabled={disabled || subiendo}
          onClick={() => inputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed border-border-default text-sm text-text-secondary hover:border-brand hover:text-brand hover:bg-brand-muted/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {subiendo ? (
            <><CircleNotch className="h-4 w-4 animate-spin" /> Subiendo…</>
          ) : yaHay ? (
            <><ArrowsClockwise className="h-4 w-4" /> Reemplazar factura</>
          ) : (
            <><Upload className="h-4 w-4" /> Subir factura (PDF)</>
          )}
        </button>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}
