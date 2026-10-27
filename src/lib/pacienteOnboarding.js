/**
 * Onboarding del paciente por pasos (2026-10-18) — la contraparte de
 * `profileCompleteness.js` del profesional.
 *
 * Una sola fuente para tres lugares: el wizard (`pages/patient/Onboarding.jsx`),
 * la tarjeta "Te faltan N datos" del inicio y la vista del super admin
 * (`super-admin/Usuarios.jsx`). La app tiene la copia en
 * `mobile/src/lib/pacienteOnboarding.ts` — si cambia un paso acá, cambia allá.
 *
 * Pura, sin red: un paso está hecho exactamente cuando el dato que representa
 * está cargado en `profiles`. Nada se marca "completo" a mano, así que no hay
 * un estado que se desincronice del dato real.
 *
 * El índice de cada paso es lo que se guarda en
 * `profiles.paciente_paso_onboarding` (migración 205): NO reordenar sin migrar.
 */
import { dniValido } from './dni.js'

/**
 * Columnas de `profiles` que mira el onboarding (super admin: Pacientes y
 * Prospectos). Los de salud y emergencia se traen sólo para saber si están
 * cargados: el drawer no muestra el valor.
 */
export const CAMPOS_ONBOARDING = 'phone, titular_id, dni, gender, birth_date, coverage_type, financiador_id, insurance_name, insurance_num, height_cm, weight_kg, blood_type, allergies, emergency_name, emergency_phone, consentimiento_at, consentimiento_version, paciente_paso_onboarding, onboarding_completado_at, requiere_onboarding'

/** Versión del texto de consentimiento. Subirla vuelve a pedirlo. */
export const CONSENT_VERSION = '3.0'

export const PASOS_PACIENTE = [
  { key: 'consentimiento', titulo: 'Antes de empezar',                  corto: 'Consentimiento', obligatorio: true },
  { key: 'datos',          titulo: 'Tus datos',                         corto: 'Tus datos',      obligatorio: true },
  { key: 'cobertura',      titulo: 'Tu cobertura',                      corto: 'Cobertura',      obligatorio: true },
  { key: 'salud',          titulo: 'Tu salud',                          corto: 'Salud',          obligatorio: false },
  { key: 'emergencia',     titulo: 'Si pasa algo, ¿a quién llamamos?',  corto: 'Emergencia',     obligatorio: false },
]

const lleno = v => v != null && String(v).trim() !== ''

/** El paciente eligió cobertura: particular, o una obra social DEL CATÁLOGO (con id). */
export function coberturaElegida(p) {
  if (p?.coverageType === 'particular') return true
  return p?.coverageType === 'financiador' && p?.financiadorId != null
}

/**
 * Qué le falta de cada paso, en etiquetas cortas para chips ("Sin DNI").
 * Los opcionales no generan chips: no se le reclaman a nadie.
 */
function faltantesDelPaso(key, p) {
  switch (key) {
    case 'consentimiento':
      return p?.consentimientoAt ? [] : ['Sin consentimiento']
    case 'datos':
      return [
        !dniValido(p?.dni) && 'Sin DNI',
        !lleno(p?.gender) && 'Sin sexo',
        !lleno(p?.birthDate) && 'Sin fecha de nacimiento',
      ].filter(Boolean)
    case 'cobertura':
      return coberturaElegida(p) ? [] : ['Sin cobertura']
    default:
      return []
  }
}

function pasoHecho(key, p) {
  if (key === 'salud') return [p?.heightCm, p?.weightKg, p?.bloodType, p?.allergies].some(lleno)
  if (key === 'emergencia') return lleno(p?.emergencyName) && lleno(p?.emergencyPhone)
  return faltantesDelPaso(key, p).length === 0
}

/**
 * Estado completo del onboarding de un paciente (perfil en camelCase).
 *
 * - `pasos`: los cinco, con `done` y `faltan`.
 * - `faltan`: chips de lo obligatorio que falta, en orden.
 * - `obligatoriosCompletos`: ya puede recetársele y cobrársele por su cobertura.
 * - `primerPendiente`: índice donde abrir el wizard (el primer paso sin hacer;
 *   si está todo, el último).
 */
export function completitudPaciente(p) {
  const pasos = PASOS_PACIENTE.map((paso, i) => {
    const faltan = faltantesDelPaso(paso.key, p)
    return { ...paso, indice: i, done: pasoHecho(paso.key, p), faltan }
  })
  const obligatorios = pasos.filter(s => s.obligatorio)
  const obligatoriosHechos = obligatorios.filter(s => s.done).length
  const primer = pasos.findIndex(s => !s.done)
  return {
    pasos,
    faltan: pasos.flatMap(s => s.faltan),
    obligatoriosHechos,
    obligatoriosTotal: obligatorios.length,
    obligatoriosCompletos: obligatoriosHechos === obligatorios.length,
    completados: pasos.filter(s => s.done).length,
    total: pasos.length,
    primerPendiente: primer === -1 ? pasos.length - 1 : primer,
  }
}

/**
 * ¿Es un lead? (Mateo, 2026-10-26): "alguien que completó el onboarding, no
 * solamente que se registró". Registrado sin terminar = prospecto.
 *
 * Lead = terminó el wizard (`onboarding_completado_at`). Sólo cuentan los que
 * pasaron por él (`entraEnEmbudo`): los pacientes de antes del wizard (206) y
 * los familiares a cargo no son ni lead ni prospecto (decidido por Mateo,
 * 2026-10-26 — esa base no vino por la pauta).
 */
export function entraEnEmbudo(p) {
  return !p?.titularId && p?.requiereOnboarding === true
}

export function esLead(p) {
  return entraEnEmbudo(p) && !!p?.onboardingCompletadoAt
}

export function esProspecto(p) {
  return entraEnEmbudo(p) && !p?.onboardingCompletadoAt
}

/**
 * ¿El wizard es obligatorio para este paciente? (Mateo, 2026-10-19)
 *
 * Sólo para los NUEVOS: `requiere_onboarding` (migración 206) es true en todo
 * paciente titular creado después de la 206 y false en los que ya existían, a
 * los que no se les muestra el wizard ni se les vuelve a pedir nada. Termina
 * cuando llega al final del wizard (`onboarding_completado_at`, 205), que sólo
 * se alcanza con los tres obligatorios hechos.
 *
 * Familiares a cargo nunca (la base ya los marca false; esto es por las dudas).
 */
export function onboardingBloqueante(p) {
  if (!p || p.role !== 'patient' || p.titularId) return false
  return p.requiereOnboarding === true && !p.onboardingCompletadoAt
}
