#!/usr/bin/env node
// Control de la normalización del DNI del registro profesional (2026-10-16):
// pegado con puntos, CUIT/CUIL y largos inválidos. Sin red, sin base.
//   node scripts/verificar-dni-registro.mjs
import { normalizarDni, dniValido } from '../src/lib/dni.js'

const casos = [
  ['28.999.888', '28999888', true],
  ['20-28999888-3', '28999888', true],
  ['27 94123456 1', '94123456', true],
  ['1234567', '1234567', true],
  ['12345', '12345', false],
  ['123456789', '123456789', false],
  ['', '', false],
]
let ok = true
for (const [entrada, normal, valido] of casos) {
  const bien = normalizarDni(entrada) === normal && dniValido(entrada) === valido
  if (!bien) ok = false
  console.log(`${bien ? '✓' : '✗'} ${JSON.stringify(entrada)} → ${normalizarDni(entrada)} (${dniValido(entrada) ? 'válido' : 'inválido'})`)
}
process.exit(ok ? 0 : 1)
