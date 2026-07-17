import { useRef, useState } from 'react'
import { Upload, File, X, CircleNotch } from '@phosphor-icons/react';
import { compressImage } from '../lib/imageCompression'

export default function FileUpload({ onFile, accept = '.pdf,.jpg,.jpeg,.png', label = 'Subir archivo', hint = '' }) {
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

  return (
    <div>
      {!file ? (
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
