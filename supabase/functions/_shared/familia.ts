// Grupo familiar (migración 181): el titular actúa en nombre de un familiar sin
// login propio — reserva, paga, entra a la sala y cancela por él.
//
// Las Edge Functions corren con la service key (sin auth.uid()), así que no
// pueden usar `puedo_actuar_como()`: la misma regla se consulta acá, contra la
// tabla de vínculo.
// deno-lint-ignore no-explicit-any
export async function puedeActuarComo(db: any, userId: string, pacienteId: string | null | undefined): Promise<boolean> {
  if (!userId || !pacienteId) return false
  if (userId === pacienteId) return true
  const { data } = await db
    .from('family_members')
    .select('id')
    .eq('patient_id', userId)
    .eq('familiar_id', pacienteId)
    .eq('puede_gestionar', true)
    .maybeSingle()
  return Boolean(data)
}
