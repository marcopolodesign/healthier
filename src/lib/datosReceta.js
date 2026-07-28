/**
 * Qué datos hacen falta para poder emitir una receta electrónica (RCTA).
 *
 * La lista NO es una suposición: sale de probar contra el sandbox de Innovamed
 * quitando un campo por vez y anotando qué respondió (2026-07-28). Cada entrada
 * lleva el código de error que devuelve la API cuando falta, para que cuando
 * alguien vea ese código sepa de inmediato a qué campo corresponde.
 *
 * La regla de producto que esto habilita: **preguntar solo lo que falta.** Un
 * paciente que ya cargó su DNI no lo tiene que volver a escribir; a uno que no
 * lo tiene se lo pedimos en el momento en que hace falta, no al registrarse.
 */

/** Campos del paciente que Innovamed exige. */
export const CAMPOS_PACIENTE = [
  { campo: 'dni',       label: 'DNI',                 qbi: 'QBI156' },
  { campo: 'gender',    label: 'Sexo',                qbi: 'QBI206' },
  { campo: 'birthDate', label: 'Fecha de nacimiento', qbi: 'QBI224' },
]

/**
 * Campos del profesional. `fechaNacimiento` y `especialidad` NO están: se probó
 * y la API los acepta vacíos.
 */
export const CAMPOS_PROFESIONAL = [
  { campo: 'dni',    label: 'DNI',                    qbi: 'QBI156' },
  { campo: 'gender', label: 'Sexo',                   qbi: 'QBI206' },
]

export const CAMPOS_PERFIL_PROFESIONAL = [
  { campo: 'licenseNumber', label: 'Matrícula',                  qbi: 'QBI60'  },
  { campo: 'address',       label: 'Domicilio de atención',      qbi: 'QBI248' },
]

const vacio = v => v == null || String(v).trim() === ''

/**
 * Qué le falta al paciente. Devuelve [] cuando está completo.
 * @param {{dni?, gender?, birthDate?}} paciente
 */
export function faltanDatosPaciente(paciente) {
  if (!paciente) return CAMPOS_PACIENTE
  return CAMPOS_PACIENTE.filter(c => vacio(paciente[c.campo]))
}

/**
 * Qué le falta al profesional, mirando su perfil de usuario y el profesional.
 * @param {{dni?, gender?}} profile
 * @param {{licenseNumber?, address?}} profProfile
 */
export function faltanDatosProfesional(profile, profProfile) {
  return [
    ...CAMPOS_PROFESIONAL.filter(c => vacio(profile?.[c.campo])),
    ...CAMPOS_PERFIL_PROFESIONAL.filter(c => vacio(profProfile?.[c.campo])),
  ]
}

/** Texto listo para mostrar: "DNI y Sexo" / "DNI, Sexo y Fecha de nacimiento". */
export function listar(campos) {
  const l = campos.map(c => c.label)
  if (l.length <= 1) return l[0] ?? ''
  return `${l.slice(0, -1).join(', ')} y ${l[l.length - 1]}`
}

/** Opciones de sexo, con los mismos valores que ya usa la base. */
export const OPCIONES_SEXO = [
  { value: 'femenino',  label: 'Femenino' },
  { value: 'masculino', label: 'Masculino' },
  { value: 'otro',      label: 'Otro' },
]
