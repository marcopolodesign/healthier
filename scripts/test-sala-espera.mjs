#!/usr/bin/env node
/**
 * Control de la sala de espera habilitada (2026-10-13): cuando el profesional
 * habilita al paciente (`patient_admitted_at`) el texto pasa a "<profesional>
 * te está esperando" y deja de decir que lo esperan. Falla si vuelve.
 * Uso: node scripts/test-sala-espera.mjs   (desde website/)
 */
import { readFileSync } from 'node:fs'
import { nombreCorto, textoSalaHabilitada } from '../src/lib/salaEspera.js'

let fallas = 0
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fallas++ }

ok(nombreCorto('Dra. Valentina Ortega') === 'Dra. Valentina Ortega', 'Dra. Valentina Ortega tal cual')
ok(nombreCorto('Macarena Alejandra Arteaga') === 'Macarena Arteaga', 'primer nombre + último apellido, sin inventar tratamiento')
ok(nombreCorto('Dra. María Guadalupe Fernández Etcheverry') === 'Dra. María Etcheverry', 'dos nombres y dos apellidos → primer nombre + último apellido')
ok(nombreCorto('Dra. Maximiliana Fernández-Etcheverry') === 'Dra. Fernández-Etcheverry', 'más de 24 caracteres → tratamiento + apellido')
ok(nombreCorto('') === null && nombreCorto(null) === null, 'sin nombre → null')
ok(textoSalaHabilitada(null).titulo === 'Tu profesional te está esperando', 'sin nombre: "Tu profesional te está esperando"')
ok(textoSalaHabilitada('Dra. Valentina Ortega').titulo === 'Dra. Valentina Ortega\nte está esperando', 'con nombre, cortado antes de "te está esperando"')
ok(textoSalaHabilitada('x').sub === 'Ya te habilitó. Entrá cuando quieras.', 'subtítulo')

const sala = readFileSync(new URL('../src/pages/patient/WaitingRoom.jsx', import.meta.url), 'utf8')
ok(/textoSalaHabilitada\(/.test(sala), 'WaitingRoom.jsx usa textoSalaHabilitada')
ok(/canEnter\s*\?\s*textoHabilitado\.titulo/.test(sala), 'el título cambia con canEnter (habilitado o en curso)')
ok(/patient_admitted_at\)\s*setAdmitted\(true\)/.test(sala), 'el Realtime sigue marcando admitted con patient_admitted_at')

console.log(fallas ? `\n${fallas} falla(s)` : '\nTodo verde')
process.exit(fallas ? 1 : 0)
