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
const { terminoLaLlamada, estadoDeReceta, estaCerrada } = await import(resolve(raiz, 'src/lib/cierreConsulta.js'))
let fallas = 0
const prueba = (nombre, fn) => {
  try { fn(); console.log(`  ok  ${nombre}`) }
  catch (e) { fallas++; console.error(`  MAL ${nombre}\n      ${e.message}`) }
}

console.log('Lógica de estados')
prueba('closing saca al paciente de la llamada', () => assert.equal(terminoLaLlamada('closing'), true))
prueba('completed, cancelled y no_show también', () => ['completed', 'cancelled', 'no_show'].forEach(e => assert.equal(terminoLaLlamada(e), true)))
prueba('in_progress y confirmed NO', () => ['in_progress', 'confirmed', 'pending', null, undefined].forEach(e => assert.equal(terminoLaLlamada(e), false)))
prueba('closing => receta preparando', () => assert.equal(estadoDeReceta('closing'), 'preparando'))
prueba('completed => receta lista', () => assert.equal(estadoDeReceta('completed'), 'lista'))
prueba('otros estados => sin cartel de receta', () => ['in_progress', 'cancelled', 'no_show', null].forEach(e => assert.equal(estadoDeReceta(e), null)))
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
