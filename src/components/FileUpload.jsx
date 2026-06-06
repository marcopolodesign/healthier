import { useRef, useState } from 'react'
import { Upload, File, X } from '@phosphor-icons/react';

export default function FileUpload({ onFile, accept = '.pdf,.jpg,.jpeg,.png', label = 'Subir archivo', hint = '' }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState(null)

  const handle = (f) => {
    if (!f) return
    setFile(f)
    onFile?.(f)
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
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files[0]) }}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            dragging ? 'border-brand bg-brand-muted' : 'border-border-default hover:border-brand hover:bg-brand-muted'
          }`}
        >
          <Upload className="h-8 w-8 mx-auto text-text-tertiary mb-2" />
          <p className="text-sm font-medium text-text-primary">{label}</p>
          {hint && <p className="text-xs text-text-secondary mt-1">{hint}</p>}
          <p className="text-xs text-text-tertiary mt-1">Arrastrá o hacé clic para seleccionar</p>
          <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={e => handle(e.target.files[0])} />
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
