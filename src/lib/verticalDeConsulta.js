import { triageDe } from '../data/triage'

// `triageDe` devuelve el genérico para una vertical que no conoce; ese objeto
// es la forma de saber si una vertical tiene triage propio sin duplicar la lista.
const GENERICO = triageDe('__sin_triage__')
const reconoce = v => Boolean(v) && triageDe(v) !== GENERICO

/**
 * La vertical de una consulta (agendada) para elegir su triage.
 *
 *   1. `consultation.vertical`, si el triage la reconoce (los valores viejos
 *      'salud' / 'Psicología' ya tienen alias en `triageDe`).
 *   2. Si no, la vertical de la especialidad del profesional
 *      (`specialties.vertical_id`).
 *   3. Si no se puede, `null` = Clínica, lo de siempre.
 *
 * @param {object|null} consultation — de `consultationsService.getById`
 * @param {Array} especialidades — de `useEspecialidades().especialidades`
 */
export function verticalDeConsulta(consultation, especialidades = []) {
  if (!consultation) return null
  if (reconoce(consultation.vertical)) return consultation.vertical
  const slug = consultation.professional?.professionalProfiles?.[0]?.specialty
  const esp = slug ? especialidades.find(e => e.slug === slug) : null
  return esp?.verticalId ?? null
}
