import { Warning } from '@phosphor-icons/react'

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

// El payload se escribe en snake_case, pero `consultationsService.getById` pasa
// la fila entera por `toCamelCase`, que también recorre el jsonb — así que las
// keys pueden llegar en cualquiera de las dos formas según cómo se haya leído.
// Leer solo una dejaba las preguntas en blanco.
function Structured({ preconsulta }) {
  const s = preconsulta.symptom ?? {}
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
          ? <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white border border-brand/30 text-brand shrink-0">{code}</span>
          : <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-amber-300 text-amber-700 shrink-0">sin codificar</span>}
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
  return (
    <div className="rounded-lg border border-brand/20 bg-brand-muted/20 p-2.5 space-y-2">
      <p className="text-[10px] font-bold text-brand uppercase tracking-wide">Pre-consulta del paciente</p>
      {preconsulta.version === 2
        ? <Structured preconsulta={preconsulta} />
        : <Legacy preconsulta={preconsulta} />}
    </div>
  )
}
