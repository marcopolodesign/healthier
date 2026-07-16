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

// ── Visual vertical cards — single source of truth for all paciente surfaces ──
// Every field is a superset: id/nombre/icon/color/bg always; shadow+eta for
// Dashboard; price for the booking wizard; comingSoon gates interactivity.
export const VERTICALS = [
  { id: 'clinica',     nombre: 'Clínica',          icon: Stethoscope, color: '#b05a36', bg: '#fef9ef', shadow: 'rgba(176,90,54,0.15)',  eta: '3 min'  },
  { id: 'pediatria',   nombre: 'Pediatría',         icon: Baby,        color: '#DB2777', bg: '#FDF2F8', shadow: 'rgba(219,39,119,0.15)', eta: '10 min' },
  { id: 'nutricion',   nombre: 'Nutrición',         icon: AppleLogo,   color: '#059669', bg: '#ECFDF5', shadow: 'rgba(5,150,105,0.15)',  eta: '10 min', comingSoon: true },
  { id: 'mente',       nombre: 'Psicología',        icon: Brain,       color: '#7C3AED', bg: '#F5F3FF', shadow: 'rgba(124,58,237,0.15)', eta: '15 min', comingSoon: true },
  { id: 'fisico',      nombre: 'Kinesiología',      icon: Barbell,     color: '#EA580C', bg: '#FFF7ED', shadow: 'rgba(234,88,12,0.15)',  eta: '5 min',  comingSoon: true },
  { id: 'veterinaria', nombre: 'Veterinaria',       icon: PawPrint,    color: '#0284C7', bg: '#F0F9FF', shadow: 'rgba(2,132,199,0.15)',  eta: '8 min',  comingSoon: true },
  { id: 'preparador',  nombre: 'Preparador Físico', icon: Pulse,       color: '#0F766E', bg: '#F0FDFA', shadow: 'rgba(15,118,110,0.15)', eta: '12 min', comingSoon: true },
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

// Returns the first pro in `pool` whose specialty matches any slug for the given verticalId
export function pickProForVertical(pool, verticalId) {
  const slugs = VERTICAL_SPECIALTIES[verticalId] || []
  return pool.find(p => slugs.includes(p.specialty)) || null
}
