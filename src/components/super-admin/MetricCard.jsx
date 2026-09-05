/**
 * La tarjeta de número del panel de super admin.
 *
 * Estaba copiada en Referidos y volvió a aparecer en Mails; vive acá para que
 * la próxima pantalla que necesite mostrar un número no la escriba una tercera
 * vez con otro tamaño de fuente.
 */
const TONOS = {
  neutral: 'text-text-primary',
  ok: 'text-green-700',
  bad: 'text-danger',
}

export default function MetricCard({ label, value, hint, tone = 'neutral', small = false }) {
  return (
    <div className="card">
      <p className="text-xs text-text-secondary font-medium uppercase tracking-wide">{label}</p>
      <p className={`${small ? 'text-base' : 'text-2xl'} font-semibold mt-1 ${TONOS[tone]}`}>{value}</p>
      {hint && <p className="text-xs text-text-tertiary mt-0.5">{hint}</p>}
    </div>
  )
}
