export const STATUS_CONFIG = {
  pending:               { label: 'Pendiente',             cls: 'status-badge status-pending' },
  confirmed:             { label: 'Confirmada',            cls: 'status-badge status-confirmed' },
  in_progress:           { label: 'En curso',              cls: 'status-badge status-in-progress' },
  // El profesional cortó la llamada y está cargando el cierre (migración 098)
  // — el paciente ya no puede reingresar a la sala en este estado.
  closing:               { label: 'Cerrando',              cls: 'status-badge bg-amber-50 text-amber-700' },
  completed:             { label: 'Completada',            cls: 'status-badge status-completed' },
  cancelled:             { label: 'Cancelada',             cls: 'status-badge status-cancelled' },
  pending_pro_close:     { label: 'En revisión',           cls: 'status-badge bg-amber-50 text-amber-700' },
  pending_patient_close: { label: 'Esperando confirmación', cls: 'status-badge bg-amber-50 text-amber-600' },
  finalized:             { label: 'Finalizada',            cls: 'status-badge bg-gray-100 text-gray-600' },
  no_show:               { label: 'Ausente',               cls: 'status-badge bg-orange-50 text-orange-700' },
  expired:               { label: 'Vencida',               cls: 'status-badge status-expired' },
}

export default function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status] || { label: status, cls: 'status-badge bg-gray-100 text-gray-600' }
  return <span className={config.cls}>{config.label}</span>
}
