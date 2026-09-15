import { useRef, useState } from 'react'
import { Upload, File, X, CircleNotch, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { compressImage } from '../lib/imageCompression'

/**
 * `existing` — un archivo que el usuario YA subió en una sesión anterior
 * (`{ name, updatedAt }`). No es un `File`: no se puede rellenar un
 * `<input type=file>` por seguridad del browser, así que se muestra aparte y
 * quien consume el componente decide qué hacer si no llega uno nuevo (en
 * onboarding: reusar el que ya estaba en vez de guardar el legajo sin
 * documento).
 *
 * `uploader` — si se pasa, el archivo **se sube en el momento en que se elige**
 * (`async (file) => url`) y la tarjeta muestra subiendo / subido / el error con
 * "Reintentar". Sin `uploader` el componente se queda como estaba: sólo avisa
 * qué archivo se eligió y el que lo consume sube después.
 *
 * ── Por qué subir al elegir ─────────────────────────────────────────────────
 * Antes los seis documentos del legajo se subían todos juntos al apretar
 * "Enviar para revisión". Eso amontona en un solo botón todo lo que puede
 * fallar, y cuando falla lo hace **lejos del campo que lo causó**: la persona
 * está mirando la pantalla de revisión y el error habla de un archivo que
 * eligió cinco minutos antes. Peor: un solo archivo ilegible tiraba abajo el
 * envío entero y el legajo no se creaba, así que el profesional quedaba fuera
 * de la cola de aprobación sin saberlo (le pasó a Santiago Fourcade tres días
 * seguidos, 2026-09-11 al 14).
 *
 * Subiendo al elegir, el error aparece pegado al campo, con el archivo todavía
 * fresco en la cabeza de quien lo eligió, y el envío final ya no sube nada: no
 * puede fallar por un archivo.
 */
export default function FileUpload({ onFile, accept = '.pdf,.jpg,.jpeg,.png', label = 'Subir archivo', hint = '', existing = null, uploader = null }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [subido, setSubido] = useState(false)
  const [error, setError] = useState(null)
  // Un archivo vacío o ilegible no mejora reintentando: ahí el único camino es
  // elegir otro. Mostrar "Reintentar" en ese caso es mandar a la persona a
  // apretar tres veces un botón que ya sabemos que no la va a sacar del pozo.
  const [reintentable, setReintentable] = useState(true)

  const subir = async (f) => {
    if (!uploader) return
    setSubiendo(true)
    setError(null)
    try {
      await uploader(f)
      setSubido(true)
    } catch (err) {
      setSubido(false)
      setReintentable(!err?.noReintentar)
      setError(err?.message || 'No pudimos subir ese archivo.')
    } finally {
      setSubiendo(false)
    }
  }

  const handle = async (f) => {
    if (!f) return
    setProcessing(true)
    setError(null)
    setReintentable(true)
    setSubido(false)
    let processed = f
    try {
      processed = await compressImage(f)
    } catch {
      // Comprimir es una mejora, no un requisito: si la imagen no se puede
      // leer, que lo diga el uploader con su propio texto.
      processed = f
    }
    setProcessing(false)
    setFile(processed)
    onFile?.(processed)
    await subir(processed)
  }

  const clear = () => {
    setFile(null)
    setSubido(false)
    setError(null)
    setReintentable(true)
    onFile?.(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  // `processing` lo excluye para que al elegir el reemplazo caiga en la rama
  // de abajo y se vea "Procesando imagen…" — si no, la tarjeta seguiría
  // diciendo "Ya subido" mientras comprime, sin ninguna señal de que pasó algo.
  const shownExisting = !file && existing && !processing
  // Un archivo que ya está en el bucket pero pesa 0 bytes está tan roto como
  // uno que falló: se subió "bien" y no tiene nada adentro. Ver
  // `lib/archivoSubible.js`.
  const existingVacio = shownExisting && existing.size === 0

  return (
    <div>
      {shownExisting ? (
        <div className={`flex items-center gap-3 p-3 bg-bg-surface border rounded-lg ${existingVacio ? 'border-danger/40' : 'border-border-default'}`}>
          {existingVacio
            ? <WarningCircle className="h-8 w-8 text-danger shrink-0" />
            : <File className="h-8 w-8 text-text-tertiary shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{existing.name}</p>
            <p className={`text-xs ${existingVacio ? 'text-danger' : 'text-text-secondary'}`}>
              {existingVacio
                ? 'Quedó vacío — subilo de nuevo'
                : `Ya subido${existing.updatedAt ? ` el ${new Date(existing.updatedAt).toLocaleDateString('es-AR')}` : ''}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-xs font-medium text-brand hover:underline shrink-0 whitespace-nowrap"
          >
            Reemplazar
          </button>
          <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={e => handle(e.target.files[0])} />
        </div>
      ) : !file ? (
        <div
          onClick={() => !processing && inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); if (!processing) handle(e.dataTransfer.files[0]) }}
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${processing ? 'cursor-wait opacity-70' : 'cursor-pointer'} ${
            dragging ? 'border-brand bg-brand-muted' : 'border-border-default hover:border-brand hover:bg-brand-muted'
          }`}
        >
          {processing ? (
            <>
              <CircleNotch className="h-8 w-8 mx-auto text-brand mb-2 animate-spin" />
              <p className="text-sm font-medium text-text-primary">Procesando imagen…</p>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 mx-auto text-text-tertiary mb-2" />
              <p className="text-sm font-medium text-text-primary">{label}</p>
              {hint && <p className="text-xs text-text-secondary mt-1">{hint}</p>}
              <p className="text-xs text-text-tertiary mt-1">Arrastrá o hacé clic para seleccionar</p>
            </>
          )}
          <input ref={inputRef} type="file" accept={accept} className="hidden" disabled={processing} onChange={e => handle(e.target.files[0])} />
        </div>
      ) : (
        <div className={`flex items-center gap-3 p-3 border rounded-lg ${
          error ? 'bg-bg-surface border-danger/40' : 'bg-brand-muted border-brand/20'
        }`}>
          {subiendo
            ? <CircleNotch className="h-8 w-8 text-brand shrink-0 animate-spin" />
            : error
              ? <WarningCircle className="h-8 w-8 text-danger shrink-0" />
              : subido
                ? <CheckCircle className="h-8 w-8 text-brand shrink-0" />
                : <File className="h-8 w-8 text-brand shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{file.name}</p>
            {subiendo ? (
              <p className="text-xs text-text-secondary">Subiendo…</p>
            ) : error ? (
              <p className="text-xs text-danger">{error}</p>
            ) : (
              <p className="text-xs text-text-secondary">
                {subido ? 'Subido' : `${(file.size / 1024).toFixed(1)} KB`}
              </p>
            )}
          </div>
          {error && (
            <div className="flex flex-col items-end gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="text-xs font-medium text-brand hover:underline whitespace-nowrap"
              >
                Elegir otro
              </button>
              {reintentable && (
                <button
                  type="button"
                  onClick={() => subir(file)}
                  className="text-xs font-medium text-text-tertiary hover:underline whitespace-nowrap"
                >
                  Reintentar
                </button>
              )}
            </div>
          )}
          {!subiendo && (
            <button onClick={clear} className="text-text-tertiary hover:text-error transition-colors">
              <X className="h-5 w-5" />
            </button>
          )}
          {/* El input vive también en esta rama: sin él, una vez que la tarjeta
              muestra un archivo no hay forma de elegir otro sin borrarlo antes,
              que es justo lo que hace falta cuando el elegido no se pudo leer. */}
          <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={e => handle(e.target.files[0])} />
        </div>
      )}
    </div>
  )
}
