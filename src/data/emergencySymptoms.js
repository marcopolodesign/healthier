/**
 * Patient-facing SOS triage catalog.
 *
 * Mirrors the clinical symptom lists the professional side already shows on
 * `pages/professional/Emergencias.jsx` (ROJO/AMARILLO) and the mobile app's
 * `mobile/app/emergency/triage.tsx` + `mobile/src/data/triageKeywords.ts` — so
 * a "Dolor opresivo en el pecho" checked here reads as the same thing on the
 * professional's dispatch screen. VERDE has no equivalent list elsewhere (the
 * old mobile flow just short-circuited to "sin síntomas" and booked a normal
 * consulta) — added here because the website flow shows all three severity
 * groups together instead of a step wizard, so VERDE needs real items too.
 *
 * Triage rule: the patient checks any number of symptoms across the three
 * groups; the resulting `triage_code` is the highest-severity group with at
 * least one checked item (ROJO > AMARILLO > VERDE) — see `computeTriageCode`.
 */

// Highest severity first — this order IS the triage rule.
export const TRIAGE_SEVERITY_ORDER = ['ROJO', 'AMARILLO', 'VERDE']

export const EMERGENCY_SYMPTOMS = {
  ROJO: {
    code: 'ROJO',
    label: 'Síntomas críticos',
    shortLabel: 'Rojo',
    description: 'Riesgo de vida — respuesta inmediata',
    color: '#dc2626',
    badgeClass: 'bg-rose-500/10 text-rose-600 border-rose-500/25',
    dotClass: 'bg-rose-500',
    checkboxClass: 'border-rose-500 bg-rose-500',
    items: [
      { id: 'rojo-inconsciencia', label: 'Inconsciencia o no responde' },
      { id: 'rojo-respirar', label: 'Dificultad severa para respirar' },
      { id: 'rojo-pecho', label: 'Dolor opresivo en el pecho' },
      { id: 'rojo-sangrado', label: 'Sangrado que no se detiene' },
      { id: 'rojo-convulsiones', label: 'Convulsiones activas' },
    ],
  },
  AMARILLO: {
    code: 'AMARILLO',
    label: 'Síntomas urgentes',
    shortLabel: 'Amarillo',
    description: 'Requiere atención pronta',
    color: '#d97706',
    badgeClass: 'bg-amber-500/10 text-amber-600 border-amber-500/25',
    dotClass: 'bg-amber-500',
    checkboxClass: 'border-amber-500 bg-amber-500',
    items: [
      { id: 'amarillo-dolor', label: 'Dolor muy severo o repentino' },
      { id: 'amarillo-fiebre', label: 'Fiebre alta que no baja' },
      { id: 'amarillo-trauma', label: 'Traumatismo o fractura' },
      { id: 'amarillo-vomitos', label: 'Vómitos o diarrea sin parar' },
      { id: 'amarillo-hablar', label: 'Dificultad para hablar o moverse' },
    ],
  },
  VERDE: {
    code: 'VERDE',
    label: 'Síntomas leves',
    shortLabel: 'Verde',
    description: 'Sin riesgo inmediato',
    color: '#059669',
    badgeClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/25',
    dotClass: 'bg-emerald-500',
    checkboxClass: 'border-emerald-500 bg-emerald-500',
    items: [
      { id: 'verde-malestar', label: 'Malestar general leve' },
      { id: 'verde-cabeza', label: 'Dolor de cabeza leve' },
      { id: 'verde-garganta', label: 'Congestión o dolor de garganta' },
      { id: 'verde-nauseas', label: 'Náuseas leves' },
      { id: 'verde-consulta', label: 'Consulta general o dudas de salud' },
    ],
  },
}

const ALL_ITEMS = Object.values(EMERGENCY_SYMPTOMS).flatMap(g => g.items)

/**
 * Given the set of checked symptom ids, returns the highest-severity triage
 * code present (ROJO > AMARILLO > VERDE), or null if nothing is checked.
 */
export function computeTriageCode(selectedIds) {
  if (!selectedIds || selectedIds.length === 0) return null
  const selectedSet = new Set(selectedIds)
  for (const code of TRIAGE_SEVERITY_ORDER) {
    if (EMERGENCY_SYMPTOMS[code].items.some(item => selectedSet.has(item.id))) {
      return code
    }
  }
  return null
}

/** Human-readable labels for the checked ids — stored on the emergency row so the professional sees exactly what was selected. */
export function symptomLabelsFromIds(selectedIds) {
  if (!selectedIds?.length) return []
  return selectedIds
    .map(id => ALL_ITEMS.find(item => item.id === id)?.label)
    .filter(Boolean)
}
