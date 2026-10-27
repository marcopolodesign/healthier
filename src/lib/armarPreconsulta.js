/**
 * Armado de la pre-consulta (payload `version: 2`) a partir del triage de la
 * vertical. Lógica PURA: la usan el formulario de la web, el control
 * `npm run test:triage` y, copiada tal cual, la app (`mobile/src/lib/armarPreconsulta.ts`).
 * 🔴 Si se cambia una, se cambia la otra.
 *
 * El formato que sale es el de siempre, así que el panel del profesional, el
 * pedido de consulta inmediata y la Edge Function `ondemand-despacho`
 * (`sanearPreconsulta`: labels 300, values 80, free_text 1000,
 * main_complaint 300, hasta 20 answers) lo leen sin cambios.
 */
import { preguntasDe, cierreDe } from '../data/triage'

/** Límites que coinciden con los de la Edge Function. */
export const LIMITES = { motivo: 1000, texto: 300, detalle: 300, label: 300 }

/** Valor que guarda `respuestas[qid]` cuando elige "No lo sé" en una pregunta numérica. */
export const NO_SE = 'no_se'

const MOTIVO_VACIO = 'Sin motivo escrito'

// ── Pasos ────────────────────────────────────────────────────────────────────

/**
 * Los pasos del formulario, en orden y sin los vacíos:
 * 'motivo' → 'preguntas' → 'cierre' → 'datos'.
 *
 * Sin motivo elegido todavía (lista), el paso de preguntas cuenta si cualquier
 * opción del catálogo tiene preguntas: así el "Paso 1 de N" ya es el N real
 * en la gran mayoría de los casos, y se corrige sólo al elegir.
 */
export function pasosDe({ triage, motivo = null, pideDatos = false }) {
  const pasos = ['motivo']
  const tienePreguntas = triage.motivo.tipo === 'lista' && !motivo
    ? (triage.motivo.opciones ?? []).some(o => preguntasDe(triage, o).length > 0)
    : preguntasDe(triage, motivo).length > 0
  if (tienePreguntas) pasos.push('preguntas')
  if (cierreDe(triage).length > 0) pasos.push('cierre')
  if (pideDatos) pasos.push('datos')
  return pasos
}

// ── Validación ───────────────────────────────────────────────────────────────

/** El número de una respuesta numérica (admite coma decimal), o null si no es válido: entre 0 y 200, exclusivo. */
export function parseNumero(v) {
  if (typeof v !== 'string') return null
  const t = v.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const n = Number(t)
  return n > 0 && n < 200 ? n : null
}

/** ¿Está contestada esta pregunta? Las `opcional` siempre lo están. */
export function estaRespondida(q, respuestas, detalles = {}) {
  if (q.opcional) return true
  const v = respuestas[q.id]
  switch (q.type) {
    case 'multi':
      return Array.isArray(v) && v.length > 0
    case 'texto':
      return typeof v === 'string' && v.trim().length > 0
    case 'numero':
      return v === NO_SE || parseNumero(v) !== null
    case 'single_with_detail': {
      if (!v) return false
      const o = q.options.find(op => op.value === v)
      return !(o?.detailLabel && o.detailRequired && !(detalles[q.id] ?? '').trim())
    }
    default:
      return Boolean(v)
  }
}

/** ¿Están contestadas todas las preguntas de una lista? */
export function todasRespondidas(preguntas, respuestas, detalles = {}) {
  return preguntas.every(q => estaRespondida(q, respuestas, detalles))
}

/** ¿Está completo el paso del motivo? */
export function motivoCompleto({ triage, motivo, textoMotivo }) {
  const texto = (textoMotivo ?? '').trim()
  if (triage.motivo.tipo === 'abierto') return triage.motivo.opcional ? true : texto.length > 0
  return Boolean(motivo) && (!motivo.freeText || texto.length > 0)
}

// ── Payload ──────────────────────────────────────────────────────────────────

function codificar(q, respuestas, detalles) {
  const raw = respuestas[q.id]
  if (q.type === 'texto') {
    return { values: [], labels: [String(raw ?? '').trim().slice(0, LIMITES.texto)], red_flag: false }
  }
  if (q.type === 'numero') {
    if (raw === NO_SE) return { values: [NO_SE], labels: [q.opcionNoSe], red_flag: false }
    const n = parseNumero(raw)
    return { values: [String(n)], labels: [q.unidad ? `${n} ${q.unidad}` : String(n)], red_flag: false }
  }
  const values = Array.isArray(raw) ? raw : [raw]
  const elegidas = values.map(v => q.options.find(o => o.value === v)).filter(Boolean)
  if (q.type === 'single_with_detail') {
    const detalle = (detalles[q.id] ?? '').trim()
    const o = elegidas[0]
    return {
      values: o ? [o.value] : [],
      labels: o ? [o.detailLabel && detalle ? `${o.label}: ${detalle}` : o.label] : [],
      red_flag: elegidas.some(x => x.redFlag),
    }
  }
  return { values, labels: elegidas.map(o => o.label), red_flag: elegidas.some(o => o.redFlag) }
}

/**
 * @param {object}  p
 * @param {object}  p.triage       — `triageDe(vertical)`
 * @param {object|null} p.motivo   — la opción elegida (tipo 'lista'), o null
 * @param {string}  p.textoMotivo  — el texto del motivo abierto o del "Otro motivo"
 * @param {object}  p.respuestas   — { [qid]: valor | valor[] } (numero: texto tipeado o NO_SE)
 * @param {object}  p.detalles     — { [qid]: texto del detalle }
 */
export function armarPreconsulta({ triage, motivo, textoMotivo = '', respuestas = {}, detalles = {} }) {
  const texto = textoMotivo.trim()
  const abierto = triage.motivo.tipo === 'abierto'

  const preguntas = [...preguntasDe(triage, motivo), ...cierreDe(triage)]
  const pMedicacion = preguntas.find(q => q.id === 'medicacion')

  const answers = preguntas
    .filter(q => q.id !== 'medicacion')
    // Un texto opcional que quedó vacío no es una respuesta: no se manda.
    .filter(q => !(q.type === 'texto' && !String(respuestas[q.id] ?? '').trim()))
    .map(q => ({ question_id: q.id, question_label: q.label, ...codificar(q, respuestas, detalles) }))

  const toma = pMedicacion ? respuestas.medicacion === 'si' : false
  const detalleMed = toma ? (detalles.medicacion ?? '').trim() : null

  let symptom
  let mainComplaint
  if (abierto) {
    const sinTexto = triage.motivo.sinTexto || MOTIVO_VACIO
    symptom = {
      id: 'abierto',
      label: texto ? 'Lo cuenta con sus palabras' : sinTexto,
      icd10_code: null,
      icd10_display: null,
      free_text: texto || null,
    }
    // Nunca vacío: la Edge Function descarta la preconsulta sin main_complaint.
    mainComplaint = texto || sinTexto
  } else {
    symptom = {
      id: motivo.id,
      label: motivo.label,
      icd10_code: motivo.icd10Code ?? null,
      icd10_display: motivo.icd10Display ?? null,
      free_text: motivo.freeText ? texto : null,
    }
    mainComplaint = motivo.freeText
      ? `Otro motivo (sin codificar): ${texto}`
      : (motivo.icd10Code ? `${motivo.label} (${motivo.icd10Code})` : motivo.label)
  }

  return {
    version: 2,
    symptom,
    answers,
    medication: { taking: toma, detail: detalleMed },
    has_red_flags: answers.some(a => a.red_flag),
    main_complaint: mainComplaint.slice(0, LIMITES.label),
    symptoms: answers.map(a => `${a.question_label} ${a.labels.join(', ')}`).join('\n'),
    current_medications: pMedicacion ? (toma ? detalleMed : 'No toma medicación') : null,
  }
}
