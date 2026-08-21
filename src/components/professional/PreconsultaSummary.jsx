import { Warning } from '@phosphor-icons/react'
import InfoTooltip from '../common/InfoTooltip'

/**
 * Lo que el paciente contestó antes de entrar a la sala.
 *
 * Vive acá y no dentro de una pantalla porque el profesional lo necesita en más
 * de un lugar: en la videollamada y en el detalle de la consulta — y en una
 * consulta presencial no hay videollamada, así que el detalle es el ÚNICO lugar
 * donde puede verlo.
 *
 * Soporta los dos formatos:
 *  - v2 (actual): síntoma codificado en ICD-10 + respuestas de calificación.
 *  - v1 (consultas viejas): tres campos de texto libre.
 */

// Campos de los payloads v1.
const V1_FIELDS = [
  { key: 'mainComplaint',      label: 'Motivo principal' },
  { key: 'symptoms',           label: 'Síntomas' },
  { key: 'currentMedications', label: 'Medicación actual' },
]

/** True si hay algo que mostrar, en cualquiera de los dos formatos. */
export function hasPreconsulta(preconsulta) {
  return Boolean(
    preconsulta && (preconsulta.symptom || V1_FIELDS.some(f => preconsulta[f.key]))
  )
}

/**
 * La pre-consulta como texto plano, para asentarla en la historia clínica.
 *
 * `consultations.preconsulta_data` es un jsonb que se puede pisar con un UPDATE;
 * la HC exige un asiento inalterable (Ley 26.529 Art. 15 y 16). Esto arma el
 * texto que se guarda como entrada, dejando explícito que lo declaró el paciente
 * y no el profesional.
 */
export function preconsultaToText(preconsulta) {
  if (!hasPreconsulta(preconsulta)) return null
  const lines = ['Pre-consulta declarada por el paciente:']

  if (preconsulta.symptom) {
    // Misma normalización que `Structured` — acá pesa más: esto se asienta en
    // la HC, que es append-only, así que un "Motivo: no especificado" con el
    // texto disponible queda escrito para siempre.
    const raw = preconsulta.symptom
    const s = typeof raw === 'string' ? { label: raw } : raw
    const code = s.icd10Code ?? s.icd10_code
    const freeText = s.freeText ?? s.free_text
    lines.push(`Motivo: ${s.label ?? 'no especificado'}${code ? ` (CIE-10 ${code})` : ' (sin codificar)'}`)
    if (freeText) lines.push(`En sus palabras: ${freeText}`)
    for (const a of Array.isArray(preconsulta.answers) ? preconsulta.answers : []) {
      const qlabel = a.questionLabel ?? a.question_label
      const redFlag = a.redFlag ?? a.red_flag
      lines.push(`${qlabel}: ${(a.labels ?? []).join(' · ')}${redFlag ? '  [signo de alarma]' : ''}`)
    }
    const med = preconsulta.medication ?? {}
    lines.push(`Medicación actual: ${med.taking ? (med.detail || 'sí, sin detalle') : 'no toma medicación'}`)
  } else {
    for (const f of V1_FIELDS) {
      if (preconsulta[f.key]) lines.push(`${f.label}: ${preconsulta[f.key]}`)
    }
  }

  return lines.join('\n')
}

// El payload se escribe en snake_case, pero `consultationsService.getById` pasa
// la fila entera por `toCamelCase`, que también recorre el jsonb — así que las
// keys pueden llegar en cualquiera de las dos formas según cómo se haya leído.
// Leer solo una dejaba las preguntas en blanco.
function Structured({ preconsulta }) {
  // `symptom` puede venir como string en vez de objeto (payloads viejos y
  // sembrados). Sin normalizar, `s.label` daba undefined y el motivo salía
  // como "Motivo no especificado" teniendo el texto ahí mismo.
  const raw = preconsulta.symptom
  const s = typeof raw === 'string' ? { label: raw } : (raw ?? {})
  const answers = Array.isArray(preconsulta.answers) ? preconsulta.answers : []
  const med = preconsulta.medication ?? {}
  const code = s.icd10Code ?? s.icd10_code
  const freeText = s.freeText ?? s.free_text

  return (
    <>
      <div className="flex items-start gap-2">
        <p className="text-sm font-bold text-text-primary leading-tight flex-1">
          {s.label ?? 'Motivo no especificado'}
        </p>
        {code
          ? (
            <InfoTooltip
              className="shrink-0"
              title={`CIE-10 · ${code}`}
              label="Código de la Clasificación Internacional de Enfermedades (CIE-10 / ICD-10, OMS). Lo eligió el paciente al describir su motivo, no es un diagnóstico. Es el mismo estándar que se manda como diagnóstico en la receta electrónica."
            >
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white border border-brand/30 text-brand cursor-help">{code}</span>
            </InfoTooltip>
          )
          : (
            <InfoTooltip
              className="shrink-0"
              title="Sin código CIE-10"
              label="El paciente escribió su motivo con sus palabras en vez de elegirlo del catálogo, así que no quedó codificado en CIE-10. Podés codificarlo vos al cargar el diagnóstico en la historia clínica."
            >
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-amber-300 text-amber-700 cursor-help">sin codificar</span>
            </InfoTooltip>
          )}
      </div>
      {freeText && <p className="text-xs text-text-primary leading-relaxed">{freeText}</p>}

      <div className="space-y-1.5">
        {answers.map((a, i) => {
          const qid = a.questionId ?? a.question_id ?? i
          const qlabel = a.questionLabel ?? a.question_label
          const redFlag = a.redFlag ?? a.red_flag
          return (
            <div key={qid} className="flex items-start gap-1.5">
              {redFlag && <Warning className="h-3 w-3 text-red-600 mt-0.5 shrink-0" weight="fill" />}
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">{qlabel}</p>
                <p className={`text-xs leading-relaxed ${redFlag ? 'text-red-700 font-semibold' : 'text-text-primary'}`}>
                  {(a.labels ?? []).join(' · ')}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      <div>
        <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Medicación actual</p>
        <p className="text-xs text-text-primary leading-relaxed">
          {med.taking ? (med.detail || 'Sí, sin detalle') : 'No toma medicación'}
        </p>
      </div>
    </>
  )
}

function Legacy({ preconsulta }) {
  return V1_FIELDS.filter(f => preconsulta[f.key]).map(f => (
    <div key={f.key}>
      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">{f.label}</p>
      <p className="text-xs text-text-primary whitespace-pre-wrap leading-relaxed">{preconsulta[f.key]}</p>
    </div>
  ))
}

export default function PreconsultaSummary({ preconsulta }) {
  if (!hasPreconsulta(preconsulta)) return null

  // Se elige por FORMA, y SÓLO por forma — `version` ya no participa.
  //
  // `hasPreconsulta` daba `true` con sólo tener `symptom` (la clave de v2),
  // pero el ruteo miraba `version === 2`: cualquier payload con `symptom` y
  // sin el marcador `version` pasaba el guard, caía en `Legacy` —que sólo sabe
  // leer los tres campos de v1— y pintaba una tarjeta VACÍA, sólo el
  // encabezado. Guard y renderer decían cosas distintas.
  //
  // Mirar `version` además de la forma arreglaba un sentido y dejaba el otro
  // roto: un payload marcado `version: 2` pero con campos v1 iba a `Structured`,
  // que muestra "Motivo no especificado" y descarta el texto — la misma
  // tarjeta inútil, desde el otro lado. `symptom` es lo único que distingue de
  // verdad los dos formatos, así que decide él solo.
  //
  // Se vio con una fila sembrada (`{ source: 'demo', symptom: 'Dolor de
  // garganta' }`) pero no es problema de esa fila. Pesa más desde que esta
  // tarjeta encabeza la pestaña "Hoy" (2026-08-21): antes una tarjeta vacía
  // quedaba enterrada en "Historia", ahora es lo primero que ve el profesional.
  const esEstructurada = Boolean(preconsulta.symptom)

  return (
    <div className="rounded-lg border border-brand/20 bg-brand-muted/20 p-2.5 space-y-2">
      <p className="text-[10px] font-bold text-brand uppercase tracking-wide">Pre-consulta del paciente</p>
      {esEstructurada
        ? <Structured preconsulta={preconsulta} />
        : <Legacy preconsulta={preconsulta} />}
    </div>
  )
}
