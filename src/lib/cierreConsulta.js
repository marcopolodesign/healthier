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

/**
 * Lo que el paciente ve en la pantalla de cierre, con las MISMAS definiciones que
 * el resumen (`ConsultationSummary.jsx` / `consultation/summary.tsx`):
 *  - Indicaciones: las notas de cierre, las notas de tipo "Indicación" que el
 *    profesional cargó en la consulta y lo medicado que NO salió por receta.
 *  - Receta: los medicamentos con receta electrónica emitida (`issued` + PDF),
 *    agrupados por receta.
 */
export function contenidoDeCierre(closingNotes, encuentro) {
  const indicaciones = []
  if ((closingNotes ?? '').trim()) indicaciones.push({ id: 'cierre', texto: closingNotes.trim() })
  for (const e of encuentro?.entries ?? []) {
    if (e.entryType === 'indication' && (e.content ?? '').trim()) indicaciones.push({ id: e.id, texto: e.content.trim() })
  }
  const meds = encuentro?.medications ?? []
  for (const m of meds) {
    if (m.rctaStatus === 'issued') continue
    const detalle = [m.dosageText || m.dosage, m.frequency].filter(Boolean).join(' · ')
    const nota = m.notes || m.instructions
    indicaciones.push({ id: m.id, titulo: m.medicationName, texto: [detalle, nota].filter(Boolean).join('\n') || undefined })
  }
  const porReceta = new Map()
  for (const m of meds) {
    if (m.rctaStatus !== 'issued' || !m.rctaPdfUrl) continue
    const key = m.rctaPrescriptionId ?? m.id
    const prev = porReceta.get(key)
    if (prev) prev.medicamentos.push(m.medicationName ?? '')
    else porReceta.set(key, { id: key, pdfUrl: m.rctaPdfUrl, medicamentos: [m.medicationName ?? ''] })
  }
  return { indicaciones, recetas: Array.from(porReceta.values()) }
}

/**
 * Qué muestra la sección de contenido:
 *  - 'preparando': el profesional está cerrando y todavía no hay nada que mostrar.
 *  - 'contenido': hay indicaciones y/o receta (se pintan en el lugar apenas llegan).
 *  - 'resumen': terminó sin indicaciones ni receta → "El resumen de tu consulta está listo".
 *  - null: la consulta no terminó con cierre (en llamada, cancelada, ausente).
 */
export function estadoDelCierre(status, c) {
  if (status !== 'closing' && status !== 'completed') return null
  if (c.indicaciones.length || c.recetas.length) return 'contenido'
  return status === 'closing' ? 'preparando' : 'resumen'
}

/** ¿Ya terminó de verdad? (deja de sondearse) */
export const estaCerrada = (status) => !!status && CERRADAS.includes(status)
