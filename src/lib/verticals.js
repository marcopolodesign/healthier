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
