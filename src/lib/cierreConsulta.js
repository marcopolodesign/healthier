// Qué ve el paciente cuando el profesional corta la consulta.
//
// Hay UNA sola pantalla para eso (`pages/patient/ConsultationReview.jsx`):
// "tu consulta finalizó" + calificar + el estado de la receta en vivo. Esta
// lógica es pura a propósito, para que `scripts/test-cierre-consulta.mjs` la
// pueda correr sin navegador — es el control de que el paciente no vuelve a
// caer en el inicio por su cuenta (Mateo, 2026-10-13). Espejo de
// `mobile/src/lib/cierreConsulta.ts`.

// `closing` = el profesional cortó y está cargando el cierre (migración 098).
const SACAN_DE_LA_LLAMADA = ['closing', 'completed', 'cancelled', 'no_show', 'expired']
const CERRADAS = ['completed', 'cancelled', 'no_show', 'expired']

export const terminoLaLlamada = (status) => !!status && SACAN_DE_LA_LLAMADA.includes(status)

/** 'preparando' mientras el profesional cierra; 'lista' cuando completó; null en los demás. */
export function estadoDeReceta(status) {
  if (status === 'closing') return 'preparando'
  if (status === 'completed') return 'lista'
  return null
}

/** ¿Ya terminó de verdad? (deja de sondearse) */
export const estaCerrada = (status) => !!status && CERRADAS.includes(status)
