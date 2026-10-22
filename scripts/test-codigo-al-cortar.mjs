#!/usr/bin/env node
/**
 * Control de "cortar la videoconsulta sin haber pedido el código" (Mateo,
 * 2026-10-22: "Sino cortás y no se lo pediste — es peligroso").
 *
 * Falla si:
 *   1. La lógica (`src/lib/codigoAlCortar.js`) deja cortar directo sin código
 *      verificado estando en la llamada.
 *   2. Algún botón de colgar de `professional/VideoCall.jsx` corta sin pasar por
 *      `intentarCortar` (que abre la hoja), o la hoja deja de estar montada.
 *   3. La hoja (`CodigoAlCortarSheet.jsx`) pierde "Pedir código", la
 *      confirmación de "Cortar sin código" o usa un pedido de código propio en
 *      vez del de la sala (`solicitar_codigo`).
 *   4. La X de la app deja de pasar por la hoja (`__healthierAntesDeSalir`).
 *
 * La prueba real —profesional y paciente conectados— está en docs/testing.md.
 *
 * Uso (desde `website/`):  node scripts/test-codigo-al-cortar.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { hayQuePedirCodigo, alCortar, pasoDeLaHoja } = await import(resolve(raiz, 'src/lib/codigoAlCortar.js'))
const sala = readFileSync(resolve(raiz, 'src/pages/professional/VideoCall.jsx'), 'utf8')
const hoja = readFileSync(resolve(raiz, 'src/components/professional/CodigoAlCortarSheet.jsx'), 'utf8')

let fallas = 0
const prueba = (nombre, fn) => {
  try { fn(); console.log(`  ok  ${nombre}`) }
  catch (e) { fallas++; console.error(`  MAL ${nombre}\n      ${e.message}`) }
}

console.log('Lógica')
const enLlamadaSinCodigo = { enLlamada: true, codigoVerificadoEn: null, simulando: false }
prueba('en la llamada y sin código → se pide el código', () => assert.equal(hayQuePedirCodigo(enLlamadaSinCodigo), true))
prueba('colgar sin código abre la hoja, no corta', () => assert.equal(alCortar(enLlamadaSinCodigo, 'colgar').accion, 'pedir-codigo'))
prueba('la X de la app sin código también abre la hoja', () => assert.equal(alCortar(enLlamadaSinCodigo, 'salir').accion, 'pedir-codigo'))
prueba('con el código verificado corta directo', () => {
  assert.equal(alCortar({ ...enLlamadaSinCodigo, codigoVerificadoEn: '2026-10-22T20:00:00Z' }, 'colgar').accion, 'cortar')
  assert.equal(alCortar({ ...enLlamadaSinCodigo, codigoVerificadoEn: '2026-10-22T20:00:00Z' }, 'salir').accion, 'salir')
})
prueba('el "Volver" de la web sin código abre la hoja; con código, sale', () => {
  assert.equal(alCortar(enLlamadaSinCodigo, 'volver').accion, 'pedir-codigo')
  assert.equal(alCortar({ ...enLlamadaSinCodigo, codigoVerificadoEn: 'x' }, 'volver').accion, 'salir')
})
prueba('en la sala de espera (sin llamada) no hay código que pedir', () => assert.equal(hayQuePedirCodigo({ ...enLlamadaSinCodigo, enLlamada: false }), false))
prueba('en la práctica (simulación) no se pide', () => assert.equal(hayQuePedirCodigo({ ...enLlamadaSinCodigo, simulando: true }), false))
prueba('pasos de la hoja', () => {
  const base = { codigoVerificadoEn: null, confirmando: false, intentosRestantes: 5, solicitado: false }
  assert.equal(pasoDeLaHoja(base), 'pedir')
  assert.equal(pasoDeLaHoja({ ...base, solicitado: true }), 'esperando')
  assert.equal(pasoDeLaHoja({ ...base, confirmando: true }), 'confirmar')
  assert.equal(pasoDeLaHoja({ ...base, intentosRestantes: 0 }), 'agotado')
  assert.equal(pasoDeLaHoja({ ...base, codigoVerificadoEn: 'x', confirmando: true }), 'verificado')
})

console.log('La sala del profesional')
prueba('todo botón de colgar llama a handleLeave, y handleLeave pasa por intentarCortar', () => {
  assert.match(sala, /function handleLeave\(\) \{ intentarCortar\('colgar'\) \}/)
  const colgar = sala.match(/<button[^>]*?(?:Finalizar la consulta|btn-danger)[\s\S]*?>/g) || []
  assert.ok(colgar.length >= 3, `esperaba ≥3 botones de colgar, hay ${colgar.length}`)
})
prueba('ningún botón corta la llamada directo (cortarLlamada sólo desde intentarCortar/la hoja)', () => {
  assert.doesNotMatch(sala, /onClick=\{cortarLlamada\}/)
  const usos = sala.match(/(?<!function )cortarLlamada\(\)/g) || []
  assert.equal(usos.length, 2, `cortarLlamada() se llama ${usos.length} veces (esperaba 2: intentarCortar y cortarDesdeLaHoja)`)
})
prueba('la hoja está montada en la sala y abre con hojaCodigo', () => {
  assert.match(sala, /<CodigoAlCortarSheet[\s\S]*?open=\{!!hojaCodigo\}/)
})
prueba('la hoja usa el pedido de código de la sala (solicitarCodigo → solicitar_codigo)', () => {
  assert.match(sala, /onSolicitar=\{solicitarCodigo\}/)
  assert.match(sala, /event: 'solicitar_codigo'/)
  assert.doesNotMatch(hoja, /channel|broadcast|supabase/, 'la hoja no debe tener su propio canal de pedido')
})
prueba('el "Volver" de la web pasa por la hoja (no navega directo)', () => {
  assert.match(sala, /onClick=\{\(\) => intentarCortar\('volver'\)\}/)
  assert.doesNotMatch(sala, /onClick=\{\(\) => navigate\(-1\)\}/)
})
prueba('la X de la app pasa por la hoja', () => {
  assert.match(sala, /window\.__healthierAntesDeSalir = \(\) => intentarCortarRef\.current\('salir'\)/)
})

console.log('La hoja')
prueba('tiene "Pedir código" como acción principal', () => assert.match(hoja, /btn-primary[\s\S]*?Pedir código a/))
prueba('"Cortar sin código" pide confirmación antes de cortar', () => {
  assert.match(hoja, /onClick=\{\(\) => setConfirmando\(true\)\}/)
  assert.match(hoja, /onClick=\{onCortarSinCodigo\}[\s\S]*?Sí, \{saliendo \? 'salir' : 'cortar'\} sin código/)
})
prueba('cerrar la hoja = seguir en la llamada', () => assert.match(hoja, /onClose=\{onSeguir\}/))
prueba('sin textos por debajo de 14px', () => assert.doesNotMatch(hoja, /text-xs|text-\[1[0-3]px\]/))

if (fallas) { console.error(`\n${fallas} falla(s)`); process.exit(1) }
console.log('\nTodo bien')
