/**
 * Biomarcadores — lógica compartida entre el BioVisor del paciente, la Bóveda y
 * la Historia Clínica del profesional.
 *
 * Existe porque las tres pantallas leían la MISMA tabla (`diagnostic_reports`) y
 * cada una interpretaba los valores a su manera. El caso concreto que lo
 * disparó: un rango abierto tipo "HDL ≥ 40" llega del extractor como
 * `min: 40, max: 0`. El BioVisor ya lo sabía manejar; la Historia Clínica no, y
 * le pintaba "Alerta" en rojo al profesional sobre valores perfectamente
 * normales. Dos criterios distintos sobre el mismo dato clínico no es una
 * inconsistencia estética.
 *
 * Regla: NINGUNA pantalla debe leer `param.min`/`param.max` crudos ni comparar
 * parámetros por su `id`. Todo pasa por acá.
 */

// ─── Rangos de referencia ─────────────────────────────────────────────────────

/**
 * Sanea el rango de un parámetro.
 *
 * Muchísimos valores de laboratorio se informan como "> 40" o "< 130", y de eso
 * el extractor devuelve un solo extremo — el otro viene en 0. Tomado literal, un
 * HDL con `min 40 / max 0` daba una barra roja llena y un "Máx: 0" sin sentido.
 */
export function rangoDe(param) {
  const min = Number.isFinite(param?.min) ? param.min : null
  const max = Number.isFinite(param?.max) ? param.max : null
  // Un máximo que no supera al mínimo no es un máximo: es "sin techo".
  const maxReal = max != null && min != null && max <= min ? null : max
  const minReal = min === 0 && maxReal != null ? null : min
  return { min: minReal, max: maxReal }
}

/** "40 – 130", "≥ 40", "≤ 130" o "Sin rango de referencia". */
export function textoRango(rango) {
  const { min, max } = rango ?? {}
  if (min != null && max != null) return `${min} – ${max}`
  if (min != null) return `≥ ${min}`
  if (max != null) return `≤ ${max}`
  return 'Sin rango de referencia'
}

export function getStatus(value, min, max) {
  // Sin ningún extremo no se puede opinar: no se inventa un estado.
  if (min == null && max == null) return 'normal'
  const dentro = (min == null || value >= min) && (max == null || value <= max)
  if (dentro) return 'normal'
  // El margen sale del extremo que exista; con rango abierto se usa el propio
  // valor de referencia como escala.
  const escala = (min != null && max != null) ? max - min : Math.abs(min ?? max) || 1
  const margen = escala * 0.25
  if ((min != null && value < min - margen) || (max != null && value > max + margen)) return 'danger'
  return 'warning'
}

/** Estado de un parámetro, saneando primero su rango. Usar SIEMPRE esta, nunca
 *  `getStatus` con `param.min`/`param.max` crudos. */
export function estadoDe(param) {
  const { min, max } = rangoDe(param)
  return getStatus(param.value, min, max)
}

export const ETIQUETA_ESTADO = { normal: 'Normal', warning: 'Atención', danger: 'Alerta' }
export const BADGE_ESTADO = {
  normal: 'bg-green-100 text-green-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
}

// ─── Identidad de un biomarcador ──────────────────────────────────────────────

/** Palabras que no distinguen un analito de otro. */
const VACIAS = new Set(['de', 'del', 'en', 'la', 'el', 'los', 'las', 'y', 'a'])

/**
 * Clave estable de un biomarcador a partir de su nombre.
 *
 * El extractor devuelve texto libre, así que "HDL Colesterol", "Colesterol HDL"
 * y "colesterol  hdl" son el mismo analito escrito de tres formas. Se normaliza
 * (sin acentos, minúsculas, sin puntuación) y se ordenan las palabras, para que
 * el orden en que el laboratorio las escribió no parta la serie histórica en dos.
 *
 * Esto es un parche razonable, no la solución: la solución es que cada parámetro
 * traiga un código LOINC y comparar por código. Ver `nextsteps.md`.
 */
export function claveBiomarcador(nombre) {
  return String(nombre ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t && !VACIAS.has(t))
    .sort()
    .join('-')
}

// ─── Estudios ─────────────────────────────────────────────────────────────────

/** Un estudio está analizado cuando tiene biomarcadores extraídos. Subir y
 *  analizar son dos pasos distintos: una fila con `parameters: []` es un
 *  documento guardado que todavía nadie leyó con IA. */
export function estaAnalizado(report) {
  return (report?.parameters?.length ?? 0) > 0
}

/** Del más nuevo al más viejo, por fecha del estudio. */
export function ordenarPorFecha(reports) {
  return [...(reports ?? [])].sort((a, b) =>
    String(b?.reportDate ?? '').localeCompare(String(a?.reportDate ?? ''))
  )
}

/**
 * El último valor conocido de CADA biomarcador, a través de todos los estudios.
 *
 * Es el corazón de la unificación, y responde a la pregunta de qué pasa cuando
 * subís un estudio nuevo: **no reemplaza nada**. Cada estudio es una foto
 * inmutable con su fecha; lo que se recalcula es qué foto es la más reciente
 * *para cada analito por separado*.
 *
 * Antes, la pantalla de Parámetros mostraba literalmente `parameters` del último
 * estudio analizado. Con dos estudios de distinto tipo eso miente feo: subís un
 * análisis de orina el martes y el lunes tenías uno de sangre → tu colesterol
 * DESAPARECE de la pantalla, como si no te lo hubieras hecho nunca. No cambió
 * ningún valor; cambió cuál era "el último estudio".
 *
 * Además el valor anterior de cada parámetro sale de la medición anterior *del
 * mismo analito*, no del estudio anterior. La comparación vieja era por `id`, y
 * el `id` que devuelve el extractor es el índice dentro de ese estudio — o sea
 * que la flechita de tendencia comparaba el 3er parámetro de un estudio contra
 * el 3er parámetro del otro. Con dos análisis de sangre listados en distinto
 * orden ya daba mal; con uno de sangre y uno de orina comparaba HDL contra pH.
 *
 * @returns {Array<{clave, param, fecha, reportId, studyType, esDelUltimoEstudio, anterior: {value, fecha}|null}>}
 */
export function ultimasMediciones(reports) {
  const analizados = ordenarPorFecha((reports ?? []).filter(estaAnalizado))
  const idUltimo = analizados[0]?.id ?? null
  const porClave = new Map()

  // Del más nuevo al más viejo: la primera aparición de un analito es su valor
  // actual, y la segunda es contra qué compararlo.
  for (const report of analizados) {
    for (const param of report.parameters ?? []) {
      const clave = claveBiomarcador(param?.name)
      if (!clave || !Number.isFinite(param?.value)) continue
      const yaVisto = porClave.get(clave)
      if (!yaVisto) {
        porClave.set(clave, {
          clave,
          param,
          fecha: report.reportDate,
          reportId: report.id,
          studyType: report.studyType ?? null,
          esDelUltimoEstudio: report.id === idUltimo,
          anterior: null,
        })
      } else if (!yaVisto.anterior) {
        yaVisto.anterior = { value: param.value, fecha: report.reportDate }
      }
    }
  }
  return [...porClave.values()]
}

/**
 * La serie histórica de un biomarcador: todas sus mediciones, de la más vieja a
 * la más nueva. Matchea por clave normalizada, así que un cambio de redacción
 * del laboratorio no corta la serie.
 */
export function serieDe(reports, nombreOClave) {
  const clave = claveBiomarcador(nombreOClave)
  return ordenarPorFecha((reports ?? []).filter(estaAnalizado))
    .flatMap(r => (r.parameters ?? [])
      .filter(p => claveBiomarcador(p.name) === clave)
      .map(p => ({ ...p, fecha: r.reportDate, reportId: r.id, studyType: r.studyType ?? null })))
    .reverse()
}

/** Fecha larga en castellano a partir de un `date` de Postgres (YYYY-MM-DD).
 *  El mediodía evita que la zona horaria corra el día para atrás. */
export function fechaLarga(fecha) {
  if (!fecha) return ''
  return new Date(`${fecha}T12:00:00`).toLocaleDateString('es-AR', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

/** "8 nov" — para badges y ejes donde no entra la fecha larga. */
export function fechaCorta(fecha) {
  if (!fecha) return ''
  return new Date(`${fecha}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
}
