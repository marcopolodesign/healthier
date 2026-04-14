const STATUS_CONFIG = {
  pending:     { label: 'Pendiente',  cls: 'status-badge status-pending' },
  confirmed:   { label: 'Confirmada', cls: 'status-badge status-confirmed' },
  in_progress: { label: 'En curso',   cls: 'status-badge status-in-progress' },
  completed:   { label: 'Completada', cls: 'status-badge status-completed' },
  cancelled:   { label: 'Cancelada',  cls: 'status-badge status-cancelled' },
}

export default function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status] || { label: status, cls: 'status-badge bg-gray-100 text-gray-600' }
  return <span className={config.cls}>{config.label}</span>
}
