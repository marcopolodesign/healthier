import { createPortal } from 'react-dom'
import { Warning, CircleNotch } from '@phosphor-icons/react'

// Confirmación genérica para borrados individuales o masivos en super admin.
export default function ConfirmDeleteDialog({ open, title, message, confirmLabel = 'Eliminar', loading, onConfirm, onCancel }) {
  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center px-4">
      <button aria-label="Cerrar" onClick={onCancel} className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
        <div className="w-10 h-10 rounded-full bg-danger-muted flex items-center justify-center mb-4">
          <Warning className="h-5 w-5 text-danger" weight="fill" />
        </div>
        <h3 className="text-base font-semibold text-text-primary">{title}</h3>
        <p className="text-sm text-text-secondary mt-1.5">{message}</p>
        <div className="flex gap-3 mt-6">
          <button onClick={onCancel} disabled={loading} className="btn-secondary flex-1">
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={loading} className="btn-danger flex-1 flex items-center justify-center gap-2">
            {loading && <CircleNotch className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
