import { Trash, X } from '@phosphor-icons/react'

// Barra flotante que aparece cuando hay filas seleccionadas en una tabla del
// super admin. Vive pegada abajo del viewport para no tapar la tabla.
export default function BulkActionBar({ count, onDelete, onClear }) {
  if (count === 0) return null

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-text-primary text-white rounded-2xl shadow-xl px-4 py-3 flex items-center gap-4 animate-fade-in">
      <span className="text-sm font-medium">{count} seleccionado{count === 1 ? '' : 's'}</span>
      <button
        onClick={onDelete}
        className="flex items-center gap-1.5 text-sm font-medium text-white bg-danger hover:bg-danger/90 transition-colors px-3 py-1.5 rounded-xl"
      >
        <Trash className="h-4 w-4" />
        Eliminar
      </button>
      <button onClick={onClear} className="text-white/60 hover:text-white transition-colors" title="Cancelar selección">
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
