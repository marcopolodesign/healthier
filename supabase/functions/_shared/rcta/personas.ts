// ── Paciente y nombres, como los pide el servicio de recetas ──────────────────
// Generar Receta: nombre y apellido por separado (2 a 50), tipoDoc, nroDoc,
// sexo F/M/X/O y fechaNacimiento. Lo usan `rcta-issue` y las Otras
// Prescripciones (certificados).
// ─────────────────────────────────────────────────────────────────────────────

// RCTA quiere nombre y apellido por separado. Desde la migración 183 el perfil
// los tiene (`first_name` / `last_name`) y se usan tal cual. Los perfiles que
// todavía no los confirmaron caen al corte sobre `full_name`: la última palabra
// es el apellido, todo lo anterior el nombre.
// deno-lint-ignore no-explicit-any
export function nombreYApellido(p: any): { nombre: string; apellido: string } {
  const nombre = String(p?.first_name ?? '').trim()
  const apellido = String(p?.last_name ?? '').trim()
  if (nombre && apellido) return { nombre, apellido }
  const parts = String(p?.full_name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { nombre: '', apellido: '' }
  if (parts.length === 1) return { nombre: parts[0], apellido: '' }
  return { nombre: parts.slice(0, -1).join(' '), apellido: parts[parts.length - 1] }
}

/** `profiles.gender` (castellano) → F/M/X. */
export function mapSexo(gender: string | null | undefined): 'F' | 'M' | 'X' {
  if (gender === 'femenino') return 'F'
  if (gender === 'masculino') return 'M'
  return 'X'
}

/**
 * El bloque `paciente`. La cobertura se OMITE cuando es particular: mandarla
 * vacía o con un id inventado no es lo mismo que no mandarla (la cuarta prueba
 * de certificación es justamente una receta sin financiador).
 */
export function armarPaciente(
  // deno-lint-ignore no-explicit-any
  patient: any,
  cobertura: { idFinanciador: string; numero: string } | null = null,
) {
  const { nombre, apellido } = nombreYApellido(patient)
  return {
    nombre,
    apellido,
    ...(cobertura ? { cobertura } : {}),
    tipoDoc: 'DNI',
    nroDoc: String(patient?.dni ?? '').replace(/\D/g, ''),
    sexo: mapSexo(patient?.gender),
    fechaNacimiento: patient?.birth_date ?? null,
    telefono: patient?.phone ?? null,
  }
}
