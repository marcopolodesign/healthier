import { Stethoscope, AppleLogo, Brain, Barbell, PawPrint, Pulse, Baby, Question } from '@phosphor-icons/react'

// Single source of truth for specialty labels, vertical mappings, and options.

export const SPECIALTY_LABELS = {
  medicina_general: 'Medicina General',
  pediatria:        'Pediatría',
  nutricion:        'Nutrición',
  psicologia:       'Psicología',
  entrenamiento:    'Entrenamiento Físico',
  cardiologia:      'Cardiología',
  dermatologia:     'Dermatología',
  veterinaria:      'Veterinaria',
  otra:             'Otra',
}

// ── Identidad visual de las verticales ───────────────────────────────────────
// OJO: desde el 2026-07-31 esto NO decide qué vertical está habilitada. Eso vive
// en `vertical_settings` (migración 078) y se edita desde /super-admin/verticales,
// junto con el precio de la consulta inmediata. Para leer el estado real usá el
// hook `useVerticales()`, que mezcla esta identidad visual con la config de la
// base.
//
// El `comingSoon` de abajo quedó como **fallback** para el instante previo a que
// llegue el fetch (y para una caída de red): es el estado que era verdad hasta
// esa fecha. Si lo editás acá no cambia nada en producción — cambialo en el panel.
//
// Every field is a superset: id/nombre/icon/color/bg always; shadow+eta for
// Dashboard; price for the booking wizard; comingSoon gates interactivity.
// El campo `eta` ('3 min', '10 min', …) se eliminó el 2026-07-27: era un número
// inventado, sin ninguna medición detrás, y la ventana real del flujo on-demand
// es AUTH_WINDOW_SECONDS (10 min). OnDemand ahora deriva lo que muestra de esa
// constante. Si algún día se quiere mostrar una espera estimada de verdad, tiene
// que salir de datos reales, no de una constante escrita a mano.
export const VERTICALS = [
  { id: 'clinica',     img: '/images/landing/esp-medicina.jpg', nombre: 'Clínica',          icon: Stethoscope, color: '#b05a36', bg: '#fef9ef', shadow: 'rgba(176,90,54,0.15)'  },
  { id: 'pediatria',   img: '/images/landing/esp-pediatria.jpg', nombre: 'Pediatría',         icon: Baby,        color: '#DB2777', bg: '#FDF2F8', shadow: 'rgba(219,39,119,0.15)' },
  { id: 'nutricion',   img: '/images/landing/esp-nutricion.jpg', nombre: 'Nutrición',         icon: AppleLogo,   color: '#059669', bg: '#ECFDF5', shadow: 'rgba(5,150,105,0.15)', comingSoon: true },
  { id: 'mente',       img: '/images/landing/esp-psicologia.jpg', nombre: 'Psicología',        icon: Brain,       color: '#7C3AED', bg: '#F5F3FF', shadow: 'rgba(124,58,237,0.15)', comingSoon: true },
  { id: 'fisico',      img: '/images/landing/esp-entrenamiento.jpg', nombre: 'Kinesiología',      icon: Barbell,     color: '#EA580C', bg: '#FFF7ED', shadow: 'rgba(234,88,12,0.15)',  comingSoon: true },
  { id: 'veterinaria', nombre: 'Veterinaria',       icon: PawPrint,    color: '#0284C7', bg: '#F0F9FF', shadow: 'rgba(2,132,199,0.15)',  comingSoon: true },
  { id: 'preparador',  img: '/images/landing/esp-entrenamiento.jpg', nombre: 'Preparador Físico', icon: Pulse,       color: '#0F766E', bg: '#F0FDFA', shadow: 'rgba(15,118,110,0.15)', comingSoon: true },
]

// Keyed lookup and guard helper used across surfaces
export const VERTICALS_BY_ID = Object.fromEntries(VERTICALS.map(v => [v.id, v]))
export const isComingSoon = id => !!VERTICALS_BY_ID[id]?.comingSoon

// Option list for select inputs (used in Onboarding and Profile)
export const SPECIALTIES = Object.entries(SPECIALTY_LABELS).map(([value, label]) => ({ value, label }))

// ── Profession categories — presentation-only grouping over SPECIALTY_LABELS ──
// Purely for the onboarding UX (category chips → cascading specialty tags,
// Tandem Health-style). Does NOT change what's persisted: form.specialty still
// stores the exact same flat slug (e.g. 'pediatria') that professionalService,
// admin approval, and every patient-facing page already expect. No DB/schema
// change, no blast radius — see catchup.md 2026-07-16 for the reasoning.
export const PROFESSION_CATEGORIES = [
  { id: 'medico',        label: 'Médico',              icon: Stethoscope, specialtyValues: ['medicina_general', 'pediatria', 'cardiologia', 'dermatologia'] },
  { id: 'nutricion',     label: 'Nutrición',            icon: AppleLogo,   specialtyValues: ['nutricion'] },
  { id: 'psicologia',    label: 'Psicología',           icon: Brain,       specialtyValues: ['psicologia'] },
  { id: 'entrenamiento', label: 'Entrenamiento Físico', icon: Barbell,     specialtyValues: ['entrenamiento'] },
  { id: 'veterinaria',   label: 'Veterinaria',          icon: PawPrint,    specialtyValues: ['veterinaria'] },
  { id: 'otra',          label: 'Otra',                 icon: Question,    specialtyValues: ['otra'] },
]

// Drift guard: PROFESSION_CATEGORIES must partition every SPECIALTY_LABELS key
// exactly once. If someone adds a specialty without updating the category
// grouping above, it silently becomes unselectable in onboarding — warn loudly
// in dev instead of failing silently in production.
if (import.meta.env.DEV) {
  const covered = new Set(PROFESSION_CATEGORIES.flatMap(c => c.specialtyValues))
  const missing = Object.keys(SPECIALTY_LABELS).filter(k => !covered.has(k))
  if (missing.length) {
    console.warn(`[verticals.js] PROFESSION_CATEGORIES no cubre: ${missing.join(', ')} — quedarán ocultas en el onboarding de profesionales.`)
  }
}

// Specialty options for a given category id, in SPECIALTIES {value,label} shape
export function specialtiesForCategory(categoryId) {
  const category = PROFESSION_CATEGORIES.find(c => c.id === categoryId)
  if (!category) return []
  return category.specialtyValues.map(value => ({ value, label: SPECIALTY_LABELS[value] }))
}

// Reverse lookup — which category a given specialty slug belongs to (used to
// preselect the category chip when resubmitting/editing an existing profile)
export function categoryForSpecialty(specialtyValue) {
  return PROFESSION_CATEGORIES.find(c => c.specialtyValues.includes(specialtyValue))?.id ?? null
}

// Maps dashboard vertical IDs → professional_profiles.specialty slug(s)
export const VERTICAL_SPECIALTIES = {
  clinica:     ['medicina_general'],
  pediatria:   ['pediatria'],
  nutricion:   ['nutricion'],
  mente:       ['psicologia'],
  fisico:      ['entrenamiento'],
  veterinaria: ['veterinaria'],
}

// Inverso de VERTICAL_SPECIALTIES. Hace falta cuando la reserva arranca desde el
// perfil de un profesional en vez del wizard: ahí no hay selector de vertical,
// pero `consultations.vertical` se llena igual y es lo que agrupa la consulta.
const VERTICAL_BY_SPECIALTY = Object.fromEntries(
  Object.entries(VERTICAL_SPECIALTIES).flatMap(([vertical, slugs]) => slugs.map(slug => [slug, vertical]))
)

export const verticalForSpecialty = specialty => VERTICAL_BY_SPECIALTY[specialty] ?? null

// Returns the first pro in `pool` whose specialty matches any slug for the
// given verticalId. Prefers professionals who can actually receive paid
// bookings (mp_connected) — spec Sección D4 — falling back to any match so
// the map still shows a marker rather than nothing.
export function pickProForVertical(pool, verticalId) {
  const slugs = VERTICAL_SPECIALTIES[verticalId] || []
  const matches = pool.filter(p => slugs.includes(p.specialty))
  return matches.find(p => p.mpConnected !== false) || matches[0] || null
}
