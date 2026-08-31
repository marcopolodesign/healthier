/**
 * Cambios sensibles del legajo profesional — el lado del cliente de la
 * migración 132.
 *
 * La regla real vive en la base (trigger `marcar_reverificacion_del_profesional`):
 * cambiar cualquiera de estos campos baja `is_verified` y deja el perfil en
 * `reverification_pending`. Este archivo NO la implementa — sólo le permite a
 * la UI **avisar antes** ("esto va a volver a revisión, ¿seguimos?") y
 * mostrarle al super admin qué se tocó.
 *
 * 🔴 La lista tiene que coincidir con `columnas_sensibles_del_profesional()` de
 * la migración 132 (más `full_name` y `dni`, que viven en `profiles`). Si se
 * agrega un documento al legajo, va en los dos lados: acá para que el aviso
 * aparezca, y en la migración para que la regla se cumpla. Que se desincronicen
 * no rompe la regla — sólo hace que el profesional se entere después de guardar
 * en vez de antes.
 */

/** Nombre de cada campo sensible tal como se le muestra a una persona. */
export const CAMPOS_SENSIBLES = {
  specialty:                          'Especialidad',
  sub_specialty:                      'Sub-especialidad',
  license_type:                       'Tipo de matrícula',
  license_number:                     'Número de matrícula',
  title_document_url:                 'Título',
  license_document_url:               'Matrícula',
  dni_document_url:                   'DNI',
  malpractice_insurance_document_url: 'Seguro de mala praxis',
  specialist_certificate_document_url:'Certificado de especialista',
  cuit_document_url:                  'Constancia de CUIT',
  cuit_number:                        'CUIT',
  full_name:                          'Nombre completo',
  dni:                                'DNI',
}

/** Los mismos campos en camelCase, que es como los ve el front. */
const EN_CAMEL = Object.fromEntries(
  Object.keys(CAMPOS_SENSIBLES).map(c => [
    c.replace(/_([a-z])/g, (_, l) => l.toUpperCase()),
    CAMPOS_SENSIBLES[c],
  ])
)

/**
 * Qué campos sensibles cambian entre dos versiones del formulario, en camelCase.
 * Devuelve las etiquetas legibles, listas para mostrar.
 *
 * `undefined` en `ahora` significa "este formulario no toca ese campo" (por
 * ejemplo `/profesional/perfil`, que no muestra la matrícula), no "lo estás
 * borrando" — si no, guardar la bio parecería estar borrando el legajo entero.
 */
export function camposSensiblesQueCambian(antes = {}, ahora = {}) {
  return Object.keys(EN_CAMEL)
    .filter(campo => ahora[campo] !== undefined && (antes[campo] ?? null) !== (ahora[campo] ?? null))
    .map(campo => EN_CAMEL[campo])
}

/**
 * "tu especialidad", "tu especialidad y tu matrícula", "tu especialidad, tu
 * matrícula y tu DNI" — para meter la lista de campos dentro de una frase sin
 * que quede un `join(', ')` en medio de una oración.
 */
export function enumerarCampos(etiquetas) {
  const conArticulo = [...new Set(etiquetas)].map(e => `tu ${e.toLowerCase()}`)
  if (conArticulo.length <= 1) return conArticulo[0] ?? ''
  return `${conArticulo.slice(0, -1).join(', ')} y ${conArticulo.at(-1)}`
}

/** ¿Este perfil está sujeto a la regla? Sólo lo está el que ya fue revisado. */
export function requiereReverificacion(profProfile) {
  return !!(profProfile?.isVerified || profProfile?.reverificationPending)
}
