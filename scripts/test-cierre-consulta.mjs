#!/usr/bin/env node
/**
 * Control de "el paciente no vuelve a caer en el inicio solo" (Mateo, 2026-10-13).
 *
 * La prueba real (el profesional finaliza → el paciente cae en UNA pantalla con
 * "Tu consulta finalizó" + calificar + receta en vivo) se hace desde el front —
 * ver docs/testing.md. Esto es la red que falla si alguien vuelve a poner una
 * salida automática al inicio:
 *
 *   1. La lógica de estados (`src/lib/cierreConsulta.js`).
 *   2. `patient/VideoCall.jsx` no tiene su propio cartel de "Preparando tu
 *      receta" ni ninguna navegación al inicio (`/paciente/dashboard`).
 *   3. `patient/ConsultationReview.jsx` llega al inicio sólo desde botones
 *      (`volverAlInicio`) y no navega dentro de un efecto.
 *
 * Uso (desde `website/`):  node scripts/test-cierre-consulta.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { terminoLaLlamada, contenidoDeCierre, estadoDelCierre, estaCerrada } = await import(resolve(raiz, 'src/lib/cierreConsulta.js'))
let fallas = 0
const prueba = (nombre, fn) => {
  try { fn(); console.log(`  ok  ${nombre}`) }
  catch (e) { fallas++; console.error(`  MAL ${nombre}\n      ${e.message}`) }
}

console.log('Lógica de estados')
prueba('closing saca al paciente de la llamada', () => assert.equal(terminoLaLlamada('closing'), true))
prueba('completed, cancelled y no_show también', () => ['completed', 'cancelled', 'no_show'].forEach(e => assert.equal(terminoLaLlamada(e), true)))
prueba('in_progress y confirmed NO', () => ['in_progress', 'confirmed', 'pending', null, undefined].forEach(e => assert.equal(terminoLaLlamada(e), false)))
const vacio = contenidoDeCierre(null, null)
const conReceta = contenidoDeCierre('Reposo', { medications: [
  { id: 'm1', medicationName: 'Amoxicilina', rctaStatus: 'issued', rctaPdfUrl: 'https://x/r1.pdf', rctaPrescriptionId: 'R1' },
  { id: 'm2', medicationName: 'Ibuprofeno', rctaStatus: 'issued', rctaPdfUrl: 'https://x/r1.pdf', rctaPrescriptionId: 'R1' },
  { id: 'm3', medicationName: 'Té de tilo', dosageText: '1 taza', frequency: 'de noche', rctaStatus: null },
], entries: [
  { id: 'e1', entryType: 'indication', content: 'Tomar mucho líquido' },
  { id: 'e2', entryType: 'note', content: 'nota interna' },
] })
prueba('contenido: receta agrupada por receta, con sus medicamentos', () => {
  assert.equal(conReceta.recetas.length, 1)
  assert.deepEqual(conReceta.recetas[0].medicamentos, ['Amoxicilina', 'Ibuprofeno'])
})
prueba('contenido: indicaciones = notas de cierre + notas "Indicación" + lo no recetado (no las notas comunes ni lo recetado)', () => {
  assert.deepEqual(conReceta.indicaciones.map((i) => i.id), ['cierre', 'e1', 'm3'])
})
prueba('sin receta no hay recetas', () => assert.equal(contenidoDeCierre('Reposo', null).recetas.length, 0))
prueba('closing sin datos => preparando', () => assert.equal(estadoDelCierre('closing', vacio), 'preparando'))
prueba('closing con datos => contenido (se pinta en el lugar)', () => assert.equal(estadoDelCierre('closing', conReceta), 'contenido'))
prueba('completed con datos => contenido', () => assert.equal(estadoDelCierre('completed', conReceta), 'contenido'))
prueba('completed sin nada => "resumen listo"', () => assert.equal(estadoDelCierre('completed', vacio), 'resumen'))
prueba('otros estados => sin sección', () => ['in_progress', 'cancelled', 'no_show', null].forEach((e) => assert.equal(estadoDelCierre(e, conReceta), null)))
prueba('closing sigue sondeando; completed deja de hacerlo', () => { assert.equal(estaCerrada('closing'), false); assert.equal(estaCerrada('completed'), true) })

console.log('Navegación')
const leer = (r) => readFileSync(resolve(raiz, r), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const llamada = leer('src/pages/patient/VideoCall.jsx')
const cierre = leer('src/pages/patient/ConsultationReview.jsx')
prueba('VideoCall no manda nunca al inicio', () => assert.doesNotMatch(llamada, /paciente\/dashboard/))
prueba('VideoCall no tiene un cartel propio de "Preparando tu receta"', () => assert.doesNotMatch(llamada, /Preparando tu receta/))
prueba('VideoCall pasa a la pantalla de cierre con closing', () => assert.match(llamada, /terminoLaLlamada\(/))
prueba('ConsultationReview: el inicio se alcanza sólo desde volverAlInicio', () => {
  const usos = cierre.match(/paciente\/dashboard/g) ?? []
  assert.equal(usos.length, 1, `hay ${usos.length} referencias al inicio; tiene que haber una`)
  assert.match(cierre, /const volverAlInicio = \(\) => navigate\('\/paciente\/dashboard'\)/)
})
prueba('ConsultationReview: si la reseña falla se muestra el error real y no "Gracias"', () => {
  assert.match(cierre, /catch \(err\)[\s\S]{0,300}toast\.error\(err\?\.message/)
})
prueba('ConsultationReview: el comentario aparece recién con estrellas', () => assert.match(cierre, /rating > 0 && \(/))
prueba('ConsultationReview: sin textos por debajo de 14px', () => {
  const chicos = [...cierre.matchAll(/text-\[(\d+)px\]/g)].map(m => +m[1]).filter(n => n < 14)
  assert.deepEqual(chicos, [])
})
prueba('ConsultationReview: volverAlInicio sólo se usa en onClick', () => {
  const usos = [...cierre.matchAll(/volverAlInicio/g)].length
  const enClick = [...cierre.matchAll(/onClick=\{volverAlInicio\}/g)].length
  assert.equal(usos, enClick + 1, 'volverAlInicio se llama desde otro lado que un botón')
})
prueba('ConsultationReview: no navega al inicio dentro de un efecto', () => {
  assert.doesNotMatch(cierre, /useEffect\([\s\S]{0,900}navigate\('\/paciente\/dashboard/)
})

if (fallas) { console.error(`\n${fallas} falla(s)`); process.exit(1) }
console.log('\nTodo en verde')
