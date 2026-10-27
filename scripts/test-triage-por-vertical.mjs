// Control de "lo arreglado no vuelve" para el triage de la pre-consulta por
// vertical (Mateo, 2026-10-27). Antes todas las verticales usaban el catálogo de
// síntomas de Clínica: quien pedía una psicóloga elegía entre "Fiebre" y "Dolor
// de pecho". Falla si:
//   1. psicología vuelve a mostrar el catálogo clínico, a preguntar medicación, o
//      manda un main_complaint vacío (la Edge Function descarta el pedido);
//   2. psiquiatría / clínica / pediatría pierden medicación y alergias, o el peso
//      de pediatría deja de codificarse ("No lo sé" incluido);
//   3. Clínica sin vertical deja de ser el catálogo y el payload de siempre;
//   4. alguna vertical tiene opciones o preguntas repetidas, o labels > 300;
//   5. la web y la app dejan de tener el mismo triage.
//   npm run test:triage
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { TRIAGES, triageDe, preguntasDe, cierreDe } from '../src/data/triage.js'
import { ALL_SYMPTOMS, COMMON_QUESTIONS } from '../src/data/symptoms.js'
import { armarPreconsulta, pasosDe, estaRespondida, motivoCompleto, parseNumero, NO_SE } from '../src/lib/armarPreconsulta.js'
import { verticalDeConsulta } from '../src/lib/verticalDeConsulta.js'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const ids = qs => qs.map(q => q.id)

// ── 1. Salud mental: motivo abierto, sólo la pregunta de riesgo ──────────────

test('mente: motivo abierto, sin catálogo, una sola pregunta (riesgo) y sin cierre', () => {
  const t = triageDe('mente')
  assert.equal(t.motivo.tipo, 'abierto')
  assert.equal(t.motivo.opciones, undefined, 'no hay lista de síntomas')
  assert.deepEqual(ids(preguntasDe(t, null)), ['riesgo'])
  assert.deepEqual(cierreDe(t), [])
  assert.deepEqual(pasosDe({ triage: t }), ['motivo', 'preguntas'])
  assert.deepEqual(pasosDe({ triage: t, pideDatos: true }), ['motivo', 'preguntas', 'datos'])
  // Los alias viejos de la base caen en el mismo triage.
  assert.equal(triageDe('Psicología'), t)
  assert.equal(triageDe('psicologia'), t)
})

test('mente: con el texto vacío el main_complaint NO es vacío (la Edge Function lo descarta)', () => {
  const t = triageDe('mente')
  const p = armarPreconsulta({ triage: t, motivo: null, textoMotivo: '   ', respuestas: { riesgo: 'no' } })
  assert.ok(p.main_complaint.trim().length > 0)
  assert.equal(p.main_complaint, t.motivo.sinTexto)
  assert.equal(p.symptom.id, 'abierto')
  assert.equal(p.symptom.free_text, null)
  assert.equal(p.symptom.icd10_code, null)
  assert.ok(p.symptom.label.trim().length > 0)
  assert.equal(motivoCompleto({ triage: t, motivo: null, textoMotivo: '' }), true, 'el motivo es opcional')
})

test('mente: con texto lo cuenta con sus palabras; no hay medicación', () => {
  const t = triageDe('mente')
  const p = armarPreconsulta({ triage: t, motivo: null, textoMotivo: ' Me cuesta dormir ', respuestas: { riesgo: 'no' } })
  assert.equal(p.symptom.label, 'Lo cuenta con sus palabras')
  assert.equal(p.symptom.free_text, 'Me cuesta dormir')
  assert.equal(p.main_complaint, 'Me cuesta dormir')
  assert.equal(p.current_medications, null)
  assert.deepEqual(p.medication, { taking: false, detail: null })
  assert.deepEqual(p.answers.map(a => a.question_id), ['riesgo'])
  assert.equal(p.has_red_flags, false)
})

test('mente: "Sí, ahora mismo" da red_flag y has_red_flags; el aviso trae las líneas', () => {
  const t = triageDe('mente')
  const [riesgo] = preguntasDe(t, null)
  const ahora = riesgo.options.find(o => o.redFlag && o.aviso)
  assert.ok(ahora, 'una opción de riesgo inmediato con aviso')
  assert.ok(ahora.aviso.llamadas.some(l => l.tel === '135'))
  assert.ok(ahora.aviso.llamadas.some(l => l.tel === '08003451435'))
  assert.equal(ahora.aviso.emergencia, '911')
  const p = armarPreconsulta({ triage: t, motivo: null, textoMotivo: '', respuestas: { riesgo: ahora.value } })
  assert.equal(p.answers[0].red_flag, true)
  assert.equal(p.has_red_flags, true)
  assert.deepEqual(p.answers[0].values, [ahora.value])
})

// ── 2. Las que recetan: medicación y alergias; pediatría, el peso ────────────

test('psiquiatría, clínica y pediatría: el cierre tiene medicación y alergias', () => {
  for (const v of ['psiquiatria', 'clinica', 'pediatria']) {
    const c = ids(cierreDe(triageDe(v)))
    assert.ok(c.includes('medicacion'), `${v}: medicación`)
    assert.ok(c.includes('alergias'), `${v}: alergias`)
  }
})

test('pediatría: el peso es numérico en kg, con "No lo sé", y se codifica', () => {
  const t = triageDe('pediatria')
  const peso = cierreDe(t).find(q => q.id === 'peso')
  assert.ok(peso, 'pediatría pregunta el peso')
  assert.equal(peso.type, 'numero')
  assert.equal(peso.unidad, 'kg')
  assert.ok(peso.opcionNoSe)
  const motivo = t.motivo.opciones[0]
  const base = { triage: t, motivo, textoMotivo: '' }
  const resp = { medicacion: 'no', alergias: 'no' }
  for (const q of preguntasDe(t, motivo)) resp[q.id] = q.type === 'multi' ? [q.options[0].value] : q.options[0]?.value

  const conNumero = armarPreconsulta({ ...base, respuestas: { ...resp, peso: '12,5' } })
  const a = conNumero.answers.find(x => x.question_id === 'peso')
  assert.deepEqual(a.values, ['12.5'])
  assert.deepEqual(a.labels, ['12.5 kg'])

  const noSe = armarPreconsulta({ ...base, respuestas: { ...resp, peso: NO_SE } })
  const b = noSe.answers.find(x => x.question_id === 'peso')
  assert.deepEqual(b.values, ['no_se'])
  assert.deepEqual(b.labels, [peso.opcionNoSe])
})

test('el número: entre 0 y 200 exclusivo, admite coma', () => {
  assert.equal(parseNumero('12,5'), 12.5)
  assert.equal(parseNumero('0'), null)
  assert.equal(parseNumero('200'), null)
  assert.equal(parseNumero('199.9'), 199.9)
  assert.equal(parseNumero('abc'), null)
  assert.equal(parseNumero(''), null)
  const peso = cierreDe(triageDe('pediatria')).find(q => q.id === 'peso')
  assert.equal(estaRespondida(peso, { peso: '' }), false)
  assert.equal(estaRespondida(peso, { peso: '0' }), false)
  assert.equal(estaRespondida(peso, { peso: NO_SE }), true)
  assert.equal(estaRespondida(peso, { peso: '8' }), true)
})

test('el detalle obligatorio (medicación "Sí") bloquea hasta que se escribe', () => {
  const q = cierreDe(triageDe('clinica')).find(x => x.id === 'medicacion')
  assert.equal(estaRespondida(q, {}), false)
  assert.equal(estaRespondida(q, { medicacion: 'no' }), true)
  assert.equal(estaRespondida(q, { medicacion: 'si' }, {}), false)
  assert.equal(estaRespondida(q, { medicacion: 'si' }, { medicacion: '  ' }), false)
  assert.equal(estaRespondida(q, { medicacion: 'si' }, { medicacion: 'Omeprazol' }), true)
})

// ── 3. Clínica sin vertical = lo de siempre ──────────────────────────────────

// El armado de payload que había en PreconsultaForm antes del triage por vertical.
function payloadDeAntes({ symptom, freeText, answers, medication }) {
  const questions = symptom.freeText ? COMMON_QUESTIONS : [...COMMON_QUESTIONS, ...symptom.questions]
  const structured = questions.map(q => {
    const raw = answers[q.id]
    const values = Array.isArray(raw) ? raw : [raw]
    const picked = values.map(v => q.options.find(o => o.value === v)).filter(Boolean)
    return { question_id: q.id, question_label: q.label, values, labels: picked.map(o => o.label), red_flag: picked.some(o => o.redFlag) }
  })
  return {
    version: 2,
    symptom: { id: symptom.id, label: symptom.label, icd10_code: symptom.icd10Code, icd10_display: symptom.icd10Display, free_text: symptom.freeText ? freeText.trim() : null },
    answers: structured,
    medication: { taking: medication.value === 'si', detail: medication.value === 'si' ? medication.detail.trim() : null },
    has_red_flags: structured.some(a => a.red_flag),
    main_complaint: symptom.freeText ? `Otro motivo (sin codificar): ${freeText.trim()}` : `${symptom.label} (${symptom.icd10Code})`,
    symptoms: structured.map(a => `${a.question_label} ${a.labels.join(', ')}`).join('\n'),
    current_medications: medication.value === 'si' ? medication.detail.trim() : 'No toma medicación',
  }
}

test('clínica sin vertical (null) es el catálogo de siempre', () => {
  const t = triageDe(null)
  assert.equal(t, triageDe(undefined))
  assert.equal(t, triageDe('clinica'))
  assert.equal(t, triageDe('salud'))
  assert.equal(t.motivo.tipo, 'lista')
  assert.deepEqual(ids(t.motivo.opciones), ids(ALL_SYMPTOMS))
})

test('clínica: el payload es igual al de antes (fiebre + respuestas)', () => {
  const t = triageDe(null)
  const fiebre = ALL_SYMPTOMS.find(s => s.id === 'fiebre')
  assert.ok(fiebre)
  const answers = {}
  for (const q of [...COMMON_QUESTIONS, ...fiebre.questions]) answers[q.id] = q.type === 'multi' ? [q.options[0].value] : q.options[q.options.length - 1].value
  const esperado = payloadDeAntes({ symptom: fiebre, freeText: '', answers, medication: { value: 'si', detail: ' Ibuprofeno 400mg ' } })

  const nuevo = armarPreconsulta({
    triage: t, motivo: fiebre, textoMotivo: '',
    respuestas: { ...answers, medicacion: 'si', alergias: 'no' },
    detalles: { medicacion: ' Ibuprofeno 400mg ' },
  })
  // Lo único nuevo en Clínica es la pregunta de alergias (queda al final de answers).
  const alergias = nuevo.answers.find(a => a.question_id === 'alergias')
  assert.deepEqual(alergias.labels, ['No'])
  const sinAlergias = { ...nuevo, answers: nuevo.answers.filter(a => a.question_id !== 'alergias'), symptoms: esperado.symptoms }
  assert.deepEqual(sinAlergias, esperado)
  // Y symptoms (texto plano) suma esa línea al final, sin tocar el resto.
  assert.ok(nuevo.symptoms.startsWith(esperado.symptoms))
})

test('clínica: "Otro motivo" sigue yendo sin codificar', () => {
  const t = triageDe(null)
  const otro = ALL_SYMPTOMS.find(s => s.freeText)
  const answers = {}
  for (const q of COMMON_QUESTIONS) answers[q.id] = q.options[0].value
  const p = armarPreconsulta({ triage: t, motivo: otro, textoMotivo: ' me duele la rodilla ', respuestas: { ...answers, medicacion: 'no', alergias: 'no' } })
  assert.equal(p.main_complaint, 'Otro motivo (sin codificar): me duele la rodilla')
  assert.equal(p.symptom.free_text, 'me duele la rodilla')
  assert.equal(p.symptom.icd10_code, null)
  assert.equal(p.current_medications, 'No toma medicación')
})

test('una vertical sin triage propio usa el genérico (campo abierto + medicación)', () => {
  const g = triageDe('vertical_nueva_del_super_admin')
  assert.equal(g.motivo.tipo, 'abierto')
  assert.deepEqual(ids(cierreDe(g)), ['medicacion'])
  assert.deepEqual(pasosDe({ triage: g }), ['motivo', 'cierre'])
  assert.equal(motivoCompleto({ triage: g, motivo: null, textoMotivo: '' }), false, 'acá el motivo es obligatorio')
})

// ── 4. Todas las verticales ──────────────────────────────────────────────────

function recorridos(t) {
  return t.motivo.tipo === 'lista' ? t.motivo.opciones.map(o => ({ motivo: o, preguntas: [...preguntasDe(t, o), ...cierreDe(t)] })) : [{ motivo: null, preguntas: [...preguntasDe(t, null), ...cierreDe(t)] }]
}

test('todas las verticales: opciones con value único, ids de pregunta únicos por recorrido, labels ≤ 300', () => {
  assert.ok(Object.keys(TRIAGES).length >= 9)
  for (const [v, t] of Object.entries(TRIAGES)) {
    if (t.motivo.tipo === 'lista') {
      assert.equal(new Set(ids(t.motivo.opciones)).size, t.motivo.opciones.length, `${v}: ids de motivo repetidos`)
      for (const o of t.motivo.opciones) assert.ok(o.label.length <= 300, `${v}/${o.id}: label largo`)
    }
    for (const { motivo, preguntas } of recorridos(t)) {
      const donde = `${v}/${motivo?.id ?? 'abierto'}`
      assert.equal(new Set(ids(preguntas)).size, preguntas.length, `${donde}: ids de pregunta repetidos`)
      assert.ok(preguntas.length <= 20, `${donde}: más de 20 respuestas`)
      for (const q of preguntas) {
        assert.ok(q.label.length <= 300, `${donde}/${q.id}: label largo`)
        if (q.type === 'single' || q.type === 'multi' || q.type === 'single_with_detail') {
          const values = q.options.map(o => o.value)
          assert.equal(new Set(values).size, values.length, `${donde}/${q.id}: values repetidos`)
          assert.ok(values.length >= 2, `${donde}/${q.id}: menos de 2 opciones`)
          for (const o of q.options) {
            assert.ok(o.label.length <= 300, `${donde}/${q.id}/${o.value}: label largo`)
            assert.ok(o.value.length <= 80, `${donde}/${q.id}/${o.value}: value largo`)
          }
        }
        if (q.type === 'numero') assert.ok(q.unidad && q.opcionNoSe, `${donde}/${q.id}: número sin unidad o sin "No lo sé"`)
      }
      // Un recorrido contestado con la primera opción da un payload que la Edge Function acepta.
      const respuestas = {}
      for (const q of preguntas) {
        if (q.type === 'multi') respuestas[q.id] = [q.options[0].value]
        else if (q.type === 'texto') respuestas[q.id] = 'texto'
        else if (q.type === 'numero') respuestas[q.id] = '10'
        else respuestas[q.id] = q.options[0].value
      }
      assert.ok(todasRespondidas(preguntas, respuestas, { medicacion: 'x', alergias: 'x' }), `${donde}: no se puede completar`)
      const p = armarPreconsulta({ triage: t, motivo, textoMotivo: motivo?.freeText ? 'algo' : '', respuestas, detalles: { medicacion: 'x', alergias: 'x' } })
      assert.ok(p.main_complaint.trim().length > 0, `${donde}: main_complaint vacío`)
      assert.ok(p.main_complaint.length <= 300, `${donde}: main_complaint largo`)
      assert.ok(p.answers.length <= 20, `${donde}: demasiadas answers`)
      for (const a of p.answers) {
        assert.ok(a.question_id && a.question_label, `${donde}: answer sin id o label`)
        for (const l of a.labels) assert.ok(l.length > 0 && l.length <= 300, `${donde}/${a.question_id}: label fuera de rango`)
        for (const x of a.values) assert.ok(x.length <= 80, `${donde}/${a.question_id}: value largo`)
      }
      // La medicación va a `medication`, no a `answers`.
      assert.ok(!p.answers.some(a => a.question_id === 'medicacion'), `${donde}: medicación en answers`)
    }
  }
})

function todasRespondidas(preguntas, respuestas, detalles) {
  return preguntas.every(q => estaRespondida(q, respuestas, detalles))
}

test('los pasos vacíos se saltean y la cuenta sale de la lista', () => {
  for (const [v, t] of Object.entries(TRIAGES)) {
    const motivo = t.motivo.tipo === 'lista' ? t.motivo.opciones[0] : null
    const pasos = pasosDe({ triage: t, motivo, pideDatos: true })
    assert.equal(pasos[0], 'motivo', v)
    assert.equal(pasos.at(-1), 'datos', v)
    assert.equal(pasos.includes('preguntas'), preguntasDe(t, motivo).length > 0, `${v}: paso de preguntas`)
    assert.equal(pasos.includes('cierre'), cierreDe(t).length > 0, `${v}: paso de cierre`)
    assert.equal(pasosDe({ triage: t, motivo, pideDatos: false }).length, pasos.length - 1, `${v}: "datos" sólo si faltan`)
  }
})

// ── La vertical de una consulta agendada ─────────────────────────────────────

test('verticalDeConsulta: la de la consulta si el triage la reconoce, si no la de la especialidad, si no null', () => {
  const esp = [{ slug: 'psicologia_clinica', verticalId: 'mente' }, { slug: 'pediatria', verticalId: 'pediatria' }]
  const con = (vertical, specialty) => ({ vertical, professional: { professionalProfiles: [{ specialty }] } })
  assert.equal(verticalDeConsulta(con('mente', 'pediatria'), esp), 'mente')
  assert.equal(verticalDeConsulta(con('Psicología', null), esp), 'Psicología', 'el alias viejo se reconoce')
  assert.equal(verticalDeConsulta(con('salud', 'pediatria'), esp), 'salud')
  assert.equal(verticalDeConsulta(con(undefined, 'psicologia_clinica'), esp), 'mente')
  assert.equal(verticalDeConsulta(con('rara', 'pediatria'), esp), 'pediatria')
  assert.equal(verticalDeConsulta(con(undefined, 'otra'), esp), null)
  assert.equal(verticalDeConsulta(con(undefined, undefined), []), null)
  assert.equal(verticalDeConsulta(null, esp), null)
})

// ── 5. Paridad con la app ────────────────────────────────────────────────────

test('paridad: el triage de la web y el de la app son el mismo', async (t) => {
  const candidatos = [
    join(RAIZ, '..', '..', '..', '..', 'mobile', '.claude', 'worktrees', 'triage-por-vertical', 'src', 'data', 'triage.ts'),
    join(RAIZ, '..', 'mobile', 'src', 'data', 'triage.ts'),
    join(RAIZ, '..', '..', '..', '..', 'mobile', 'src', 'data', 'triage.ts'),
  ]
  const ruta = candidatos.find(existsSync)
  if (!ruta) return t.skip('no se encontró mobile/src/data/triage.ts: paridad sin verificar')
  const tsx = join(RAIZ, 'node_modules', '.bin', 'tsx')
  const salida = execFileSync(tsx, ['-e', `import { TRIAGES } from ${JSON.stringify(pathToFileURL(ruta).href)}; process.stdout.write(JSON.stringify(TRIAGES))`], { encoding: 'utf8', maxBuffer: 1 << 26 })
  assert.equal(salida, JSON.stringify(TRIAGES), `el triage de la app (${ruta}) difiere del de la web`)
})
