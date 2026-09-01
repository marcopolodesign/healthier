import { useRef, useState } from 'react'
import { Upload, File, X, CircleNotch } from '@phosphor-icons/react';
import { compressImage } from '../lib/imageCompression'

/**
 * `existing` — un archivo que el usuario YA subió en una sesión anterior
 * (`{ name, updatedAt }`). No es un `File`: no se puede rellenar un
 * `<input type=file>` por seguridad del browser, así que se muestra aparte y
 * quien consume el componente decide qué hacer si no llega uno nuevo (en
 * onboarding: reusar el que ya estaba en vez de guardar el legajo sin
 * documento).
 */
export default function FileUpload({ onFile, accept = '.pdf,.jpg,.jpeg,.png', label = 'Subir archivo', hint = '', existing = null }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState(null)
  const [processing, setProcessing] = useState(false)

  const handle = async (f) => {
    if (!f) return
    setProcessing(true)
    const processed = await compressImage(f)
    setProcessing(false)
    setFile(processed)
    onFile?.(processed)
  }

  const clear = () => {
    setFile(null)
    onFile?.(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  // `processing` lo excluye para que al elegir el reemplazo caiga en la rama
  // de abajo y se vea "Procesando imagen…" — si no, la tarjeta seguiría
  // diciendo "Ya subido" mientras comprime, sin ninguna señal de que pasó algo.
  const shownExisting = !file && existing && !processing

  return (
    <div>
      {shownExisting ? (
        <div className="flex items-center gap-3 p-3 bg-bg-surface border border-border-default rounded-lg">
          <File className="h-8 w-8 text-text-tertiary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{existing.name}</p>
            <p className="text-xs text-text-secondary">
              Ya subido{existing.updatedAt ? ` el ${new Date(existing.updatedAt).toLocaleDateString('es-AR')}` : ''}
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
        <div className="flex items-center gap-3 p-3 bg-brand-muted border border-brand/20 rounded-lg">
          <File className="h-8 w-8 text-brand shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{file.name}</p>
            <p className="text-xs text-text-secondary">{(file.size / 1024).toFixed(1)} KB</p>
          </div>
          <button onClick={clear} className="text-text-tertiary hover:text-error transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  )
}
