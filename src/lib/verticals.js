import { Stethoscope, AppleLogo, Brain, Barbell, PawPrint, Pulse } from '@phosphor-icons/react'

// Single source of truth for specialty labels, vertical mappings, and options.

export const SPECIALTY_LABELS = {
  medicina_general: 'Medicina General',
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
  { id: 'nutricion',   nombre: 'Nutrición',         icon: AppleLogo,   color: '#059669', bg: '#ECFDF5', shadow: 'rgba(5,150,105,0.15)',  eta: '10 min' },
  { id: 'mente',       nombre: 'Psicología',        icon: Brain,       color: '#7C3AED', bg: '#F5F3FF', shadow: 'rgba(124,58,237,0.15)', eta: '15 min' },
  { id: 'fisico',      nombre: 'Kinesiología',      icon: Barbell,     color: '#EA580C', bg: '#FFF7ED', shadow: 'rgba(234,88,12,0.15)',  eta: '5 min',  comingSoon: true },
  { id: 'veterinaria', nombre: 'Veterinaria',       icon: PawPrint,    color: '#0284C7', bg: '#F0F9FF', shadow: 'rgba(2,132,199,0.15)',  eta: '8 min',  comingSoon: true },
  { id: 'preparador',  nombre: 'Preparador Físico', icon: Pulse,       color: '#0F766E', bg: '#F0FDFA', shadow: 'rgba(15,118,110,0.15)', eta: '12 min', comingSoon: true },
]

// Keyed lookup and guard helper used across surfaces
export const VERTICALS_BY_ID = Object.fromEntries(VERTICALS.map(v => [v.id, v]))
export const isComingSoon = id => !!VERTICALS_BY_ID[id]?.comingSoon

// Option list for select inputs (used in Onboarding and Profile)
export const SPECIALTIES = Object.entries(SPECIALTY_LABELS).map(([value, label]) => ({ value, label }))

// Maps dashboard vertical IDs → professional_profiles.specialty slug(s)
export const VERTICAL_SPECIALTIES = {
  clinica:     ['medicina_general', 'cardiologia', 'dermatologia', 'otra'],
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
