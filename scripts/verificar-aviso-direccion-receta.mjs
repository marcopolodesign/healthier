#!/usr/bin/env node
// Control de regresión — la dirección que pide la receta electrónica.
//
// Caso real (2026-09-28): una pediatra que atiende sólo por videollamada quiso
// emitir una receta y se enteró ahí de que le faltaba la dirección. El
// dashboard no le avisó (el aviso sólo salía para presenciales) y el cartel de
// la receta la mandaba a /profesional/configuracion, donde ese campo no existe.
//
// Chequea, sobre el código:
//  1. Todo link "tu perfil" de DatosRecetaFaltantes apunta a la pantalla que
//     tiene el campo de dirección (/profesional/perfil).
//  2. Esa pantalla sigue teniendo el campo.
//  3. El dashboard avisa a todos (receta + mapa), sin depender de
//     atiendePresencial, también si la dirección no tiene coordenadas.
//
// Uso: node scripts/verificar-aviso-direccion-receta.mjs   (sale 1 si falla)
import { readFileSync } from 'node:fs'

const leer = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const fallas = []

const faltantes = leer('src/components/professional/DatosRecetaFaltantes.jsx')
if (/to="\/profesional\/configuracion"/.test(faltantes)) {
  fallas.push('DatosRecetaFaltantes manda a /profesional/configuracion, que no tiene el campo de dirección')
}
if (!/to="\/profesional\/perfil"/.test(faltantes)) {
  fallas.push('DatosRecetaFaltantes no linkea a /profesional/perfil')
}

const perfil = leer('src/pages/professional/Profile.jsx')
if (!/label="Dirección del consultorio"/.test(perfil)) {
  fallas.push('/profesional/perfil ya no tiene el campo "Dirección del consultorio" — actualizar los links que mandan ahí')
}

const dashboard = leer('src/pages/professional/Dashboard.jsx')
// Desde el 2026-09-30 el aviso es para todos (receta + mapa del paciente).
const cond = dashboard.match(/const avisoDireccion = ([\s\S]*?)\n\n/)
if (!cond) {
  fallas.push('Dashboard: no está el aviso avisoDireccion')
} else {
  if (/atiendePresencial/.test(cond[1])) fallas.push('Dashboard: el aviso de la dirección volvió a depender de atiendePresencial')
  if (!/latitude/.test(cond[1])) fallas.push('Dashboard: el aviso no mira si la dirección tiene coordenadas')
  if (!/\{avisoDireccion && \(/.test(dashboard)) fallas.push('Dashboard: el aviso está calculado pero no se muestra')
}

// 4. El super admin ve qué le falta para recetar y puede cargar la dirección.
const superAdmin = leer('src/pages/super-admin/Profesionales.jsx')
if (!/faltanParaRecetar\(/.test(superAdmin)) fallas.push('Super admin: no muestra qué le falta para recetar')
if (!/label="Dirección del consultorio"/.test(superAdmin)) fallas.push('Super admin: no puede cargar la dirección')
const datos = leer('src/lib/datosReceta.js')
for (const campo of ['dni', 'gender', 'licenseNumber', 'address', 'hasSignature']) {
  if (!new RegExp(`d\\.${campo}\\b`).test(datos)) fallas.push(`faltanParaRecetar dejó de mirar ${campo}`)
}

if (fallas.length) {
  console.error('✗ aviso de dirección para recetar:\n  - ' + fallas.join('\n  - '))
  process.exit(1)
}
console.log('✓ aviso de dirección para recetar: dashboard + link al perfil correctos')
