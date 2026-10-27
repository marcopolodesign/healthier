/**
 * La vertical de una consulta (agendada) para elegir su triage.
 *
 *   1. `consultation.vertical`, tal cual. `triageDe` resuelve los valores
 *      viejos ('salud', 'Psicología') y le da el triage genérico a una vertical
 *      que todavía no tiene uno propio — igual que la consulta inmediata.
 *   2. Si no hay, la vertical de la especialidad del profesional
 *      (`specialties.vertical_id`).
 *   3. Si no se puede, `null` = Clínica, lo de siempre.
 *
 * @param {object|null} consultation — de `consultationsService.getById`
 * @param {Array} especialidades — de `useEspecialidades().especialidades`
 */
export function verticalDeConsulta(consultation, especialidades = []) {
  if (!consultation) return null
  if (consultation.vertical) return consultation.vertical
  // `professional_profiles.user_id` es único: PostgREST lo devuelve como
  // objeto, no como arreglo (mismo criterio que `perfilDelProfesional` en
  // consultationsService, que no se importa para no arrastrar el cliente de
  // Supabase a la prueba).
  const pp = consultation.professional?.professionalProfiles
  const slug = (Array.isArray(pp) ? pp[0] : pp)?.specialty
  const esp = slug ? especialidades.find(e => e.slug === slug) : null
  return esp?.verticalId ?? null
}
