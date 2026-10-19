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
 * ¿Se le muestra el aviso / se lo manda al wizard? Sólo a pacientes titulares:
 * un familiar a cargo (titular_id) lo completa quien lo cargó, desde su ficha.
 */
export function debeCompletarPerfil(p) {
  if (!p || p.role !== 'patient' || p.titularId) return false
  return !completitudPaciente(p).obligatoriosCompletos
}
