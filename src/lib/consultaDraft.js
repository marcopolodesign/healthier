/**
 * Borrador de la "consulta estructurada" — `ConsultaEstructurada.jsx`
 * (sección "Consulta" de la planilla, `pages/professional/VideoCall.jsx`).
 *
 * Todo lo que se documenta durante la consulta (motivo, enfermedad actual,
 * antecedentes, síntomas marcados desde el copiloto, vitales, examen físico,
 * diferenciales) vive en UN solo objeto — el "draft" — que se persiste
 * debounced en `consultations.hc_draft` (ver `useConsultaDraft.js`) y se
 * asienta como UNA sola entrada de la historia clínica al guardar o al
 * cerrar la consulta, en vez de una entrada por cada tap (lo que hacía el
 * viejo `GuiaClinicaConsulta`, reemplazado por `CopilotoClinico`).
 *
 * Este módulo es puro a propósito — sin React, sin hooks — para que tanto el
 * botón "Guardar consulta en la HC" (`ConsultaEstructurada`) como el
 * auto-asentado al cerrar (`CloseConsultationModal`) usen EXACTAMENTE la
 * misma lógica de composición y guardado. Dos implementaciones divergentes
 * es lo que produce que un texto se vea distinto según por dónde se guardó.
 */

import { clinicalService } from '../services/clinicalService'

/** Forma vacía del draft — usada al no haber nada persistido todavía. */
export function emptyDraft() {
  return {
    motivo: null,
    motivoLibre: '',
    enfermedadActual: '',
    antecedentes: {
      personales: [],
      personalesOtros: '',
      familiares: [],
      familiaresOtros: '',
      tabaquismo: '',
      alcohol: '',
      actividadFisica: '',
    },
    // { texto, checked, origen: 'bandera' | 'pregunta' | 'manual' }
    sintomas: [],
    vitales: { taSistolica: '', taDiastolica: '', fc: '', fr: '', temp: '', sat: '', peso: '', talla: '' },
    examen: { sistemas: {}, hallazgos: '' }, // sistemas: { [nombre]: 'normal' | 'alterado' }
    diferenciales: [], // { nombre, cie }
    diagnosticoTexto: '',
    asentada: false,
  }
}

/**
 * Rehidrata un draft guardado (jsonb de `consultations.hc_draft`, o el
 * fragmento embebido en `clinical_entries.data`) contra la forma vacía —
 * tolera un draft viejo con campos faltantes en vez de romper.
 */
export function hydrateDraft(saved) {
  const base = emptyDraft()
  if (!saved || typeof saved !== 'object') return base
  return {
    ...base,
    ...saved,
    antecedentes: { ...base.antecedentes, ...(saved.antecedentes ?? {}) },
    vitales: { ...base.vitales, ...(saved.vitales ?? {}) },
    examen: {
      ...base.examen,
      ...(saved.examen ?? {}),
      sistemas: { ...(saved.examen?.sistemas ?? {}) },
    },
    sintomas: Array.isArray(saved.sintomas) ? saved.sintomas : [],
    diferenciales: Array.isArray(saved.diferenciales) ? saved.diferenciales : [],
  }
}

// ── Síntomas (sección "05") — alimentados por el copiloto y por carga manual ──

/**
 * Toggle de un ítem del copiloto (bandera roja o pregunta dirigida) contra la
 * lista de síntomas: si ya existe un síntoma con ese `texto`+`origen` se
 * quita (des-click), si no se agrega marcado como presente. La existencia en
 * esta lista — no el `checked` — es lo que el copiloto usa para pintarse
 * seleccionado, así que desmarcar el checkbox en "05" (queda "referido") no
 * deselecciona el ítem en el copiloto; sólo quitarlo (la X) o volver a
 * tocarlo en el copiloto lo hace.
 */
export function toggleSintomaOrigen(draft, texto, origen) {
  const yaExiste = draft.sintomas.some(s => s.origen === origen && s.texto === texto)
  if (yaExiste) {
    return { ...draft, sintomas: draft.sintomas.filter(s => !(s.origen === origen && s.texto === texto)) }
  }
  return { ...draft, sintomas: [...draft.sintomas, { texto, checked: true, origen }] }
}

/** Checked = presente; unchecked = queda anotado como referido/no confirmado. */
export function toggleSintomaChecked(draft, index) {
  return { ...draft, sintomas: draft.sintomas.map((s, i) => (i === index ? { ...s, checked: !s.checked } : s)) }
}

export function removeSintoma(draft, index) {
  return { ...draft, sintomas: draft.sintomas.filter((_, i) => i !== index) }
}

export function addSintomaManual(draft, texto) {
  const limpio = texto.trim()
  if (!limpio) return draft
  return { ...draft, sintomas: [...draft.sintomas, { texto: limpio, checked: true, origen: 'manual' }] }
}

// ── Diferenciales (sección "08") — alimentados por el copiloto ───────────────

/** Mismo patrón que los síntomas: toggle por nombre, existencia = seleccionado. */
export function toggleDiferencial(draft, nombre, cie) {
  const yaExiste = draft.diferenciales.some(d => d.nombre === nombre)
  if (yaExiste) return removeDiferencial(draft, nombre)
  return { ...draft, diferenciales: [...draft.diferenciales, { nombre, cie: cie ?? null }] }
}

export function removeDiferencial(draft, nombre) {
  return { ...draft, diferenciales: draft.diferenciales.filter(d => d.nombre !== nombre) }
}

// ── Vitales (sección "06") — evaluación contra rango de referencia ───────────
// Rangos documentados en `src/lib/clinicalGuideKB.js` (VITALES_RANGOS), junto
// al resto del contenido clínico de Nacho.

export function evaluarTA(sistolica, diastolica) {
  if (!sistolica || !diastolica) return null
  if (sistolica >= 140 || diastolica >= 90) return 'alto'
  if (sistolica < 90) return 'bajo'
  return 'normal'
}

export function evaluarFC(fc) {
  if (!fc) return null
  if (fc < 60) return 'bajo'
  if (fc > 100) return 'alto'
  return 'normal'
}

export function evaluarFR(fr) {
  if (!fr) return null
  if (fr < 12) return 'bajo'
  if (fr > 20) return 'alto'
  return 'normal'
}

export function evaluarTemp(temp) {
  if (!temp) return null
  if (temp >= 38) return 'alto'
  if (temp < 35) return 'bajo'
  return 'normal'
}

export function evaluarSat(sat) {
  if (!sat) return null
  if (sat < 95) return 'bajo'
  return 'normal'
}

export function calcularIMC(pesoKg, tallaCm) {
  const peso = Number(pesoKg)
  const talla = Number(tallaCm)
  if (!peso || !talla) return null
  const tallaM = talla / 100
  return peso / (tallaM * tallaM)
}

/** Categorías OMS. */
export function categoriaIMC(imc) {
  if (imc == null) return null
  if (imc < 18.5) return 'Bajo peso'
  if (imc < 25) return 'Normal'
  if (imc < 30) return 'Sobrepeso'
  if (imc < 35) return 'Obesidad I'
  if (imc < 40) return 'Obesidad II'
  return 'Obesidad III'
}

// ── Composición del texto legible + guardado como UNA entrada ────────────────

/**
 * Arma el texto legible y multi-línea de la nota, saltando las secciones
 * vacías. Es lo que se guarda en `clinical_entries.content` — la data
 * estructurada completa va aparte, en `clinical_entries.data`.
 */
export function composeConsultaContent(draft) {
  const partes = []

  const motivoTexto = draft.motivo || draft.motivoLibre?.trim()
  if (motivoTexto) partes.push(`Motivo: ${motivoTexto}`)

  if (draft.enfermedadActual?.trim()) {
    partes.push(`Enfermedad actual: ${draft.enfermedadActual.trim()}`)
  }

  const a = draft.antecedentes
  const antecLineas = []
  if (a.personales?.length) antecLineas.push(`Personales: ${a.personales.join(', ')}`)
  if (a.personalesOtros?.trim()) antecLineas.push(`Otros: ${a.personalesOtros.trim()}`)
  if (a.familiares?.length) antecLineas.push(`Familiares: ${a.familiares.join(', ')}`)
  if (a.familiaresOtros?.trim()) antecLineas.push(`Otros familiares: ${a.familiaresOtros.trim()}`)
  if (a.tabaquismo) {
    const label = { nunca: 'nunca fumó', ex_fumador: 'ex fumador', actual: 'fumador actual' }[a.tabaquismo] ?? a.tabaquismo
    antecLineas.push(`Tabaquismo: ${label}`)
  }
  if (a.alcohol?.trim()) antecLineas.push(`Alcohol: ${a.alcohol.trim()}`)
  if (a.actividadFisica?.trim()) antecLineas.push(`Actividad física: ${a.actividadFisica.trim()}`)
  if (antecLineas.length) partes.push(`Antecedentes:\n${antecLineas.map(l => `- ${l}`).join('\n')}`)

  if (draft.sintomas?.length) {
    const lineas = draft.sintomas.map(s => `- ${s.texto}${s.checked ? '' : ' (referido, no confirmado)'}`)
    partes.push(`Síntomas:\n${lineas.join('\n')}`)
  }

  const v = draft.vitales ?? {}
  const vLineas = []
  if (v.taSistolica && v.taDiastolica) {
    const estado = evaluarTA(Number(v.taSistolica), Number(v.taDiastolica))
    vLineas.push(`TA ${v.taSistolica}/${v.taDiastolica} mmHg${estado && estado !== 'normal' ? ' (fuera de rango)' : ''}`)
  }
  if (v.fc) vLineas.push(`FC ${v.fc} lpm${evaluarFC(Number(v.fc)) !== 'normal' ? ' (fuera de rango)' : ''}`)
  if (v.fr) vLineas.push(`FR ${v.fr} rpm${evaluarFR(Number(v.fr)) !== 'normal' ? ' (fuera de rango)' : ''}`)
  if (v.temp) vLineas.push(`T° ${v.temp} °C${evaluarTemp(Number(v.temp)) !== 'normal' ? ' (fuera de rango)' : ''}`)
  if (v.sat) vLineas.push(`SatO₂ ${v.sat}%${evaluarSat(Number(v.sat)) !== 'normal' ? ' (fuera de rango)' : ''}`)
  if (v.peso) vLineas.push(`Peso ${v.peso} kg`)
  if (v.talla) vLineas.push(`Talla ${v.talla} cm`)
  const imc = calcularIMC(v.peso, v.talla)
  if (imc != null) vLineas.push(`IMC ${imc.toFixed(1)} (${categoriaIMC(imc)})`)
  if (vLineas.length) partes.push(`Vitales:\n${vLineas.map(l => `- ${l}`).join('\n')}`)

  const ex = draft.examen ?? {}
  const exLineas = Object.entries(ex.sistemas ?? {})
    .filter(([, estado]) => estado === 'alterado')
    .map(([sistema]) => `- ${sistema}: alterado`)
  if (exLineas.length || ex.hallazgos?.trim()) {
    const bloque = [...exLineas]
    if (ex.hallazgos?.trim()) bloque.push(`Hallazgos: ${ex.hallazgos.trim()}`)
    partes.push(`Examen físico:\n${bloque.join('\n')}`)
  }

  const dxLineas = []
  if (draft.diferenciales?.length) {
    dxLineas.push(...draft.diferenciales.map(d => `- ${d.nombre}${d.cie ? ` (${d.cie})` : ''}`))
  }
  if (draft.diagnosticoTexto?.trim()) dxLineas.push(draft.diagnosticoTexto.trim())
  if (dxLineas.length) partes.push(`Diagnóstico:\n${dxLineas.join('\n')}`)

  return partes.join('\n\n')
}

/** True si hay algo digno de guardar — evita asentar una entrada vacía al cerrar. */
export function hasMeaningfulContent(draft) {
  if (!draft) return false
  if (draft.motivo || draft.motivoLibre?.trim()) return true
  if (draft.enfermedadActual?.trim()) return true
  const a = draft.antecedentes ?? {}
  if (
    a.personales?.length || a.personalesOtros?.trim() ||
    a.familiares?.length || a.familiaresOtros?.trim() ||
    a.tabaquismo || a.alcohol?.trim() || a.actividadFisica?.trim()
  ) return true
  if (draft.sintomas?.length) return true
  const v = draft.vitales ?? {}
  if (Object.values(v).some(x => x !== '' && x != null)) return true
  const ex = draft.examen ?? {}
  if (Object.keys(ex.sistemas ?? {}).length || ex.hallazgos?.trim()) return true
  if (draft.diferenciales?.length) return true
  if (draft.diagnosticoTexto?.trim()) return true
  return false
}

/**
 * Compone y guarda el draft como UNA entrada `clinical_entries` de tipo
 * `consultation` (migración 122). Compartido por el botón "Guardar consulta
 * en la HC" (`ConsultaEstructurada`) y por el auto-asentado al cerrar
 * (`CloseConsultationModal`) — ver el comentario de arriba del módulo.
 */
export async function guardarConsultaEnHC({ draft, ensureEncounter, patientId, professionalId, licenseType, licenseNumber }) {
  const content = composeConsultaContent(draft)
  const encounterId = await ensureEncounter()
  return clinicalService.addEntry(encounterId, {
    patientId,
    professionalId,
    entryType: 'consultation',
    content: content || 'Consulta documentada sin contenido adicional.',
    data: { source: 'consulta_estructurada', ...draft, asentada: true },
    licenseType,
    licenseNumber,
  })
}
