#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Control de "verticales dinámicas" (migración 199, 2026-10-16). Falla (exit 1)
// si vuelve alguno de estos:
//
//  1. El carrusel del paciente no pone primero las verticales con alguien en
//     línea (lógica pura de src/lib/carruselVerticales.js).
//  2. Las áreas del onboarding dejan de ser las verticales (una vertical con
//     especialidad no aparece, u "Otra" no queda al final).
//  3. Contra una base (`staging` | `produccion`): hay una vertical sin nombre o
//     color, o una vertical sin ninguna especialidad activa (no se la podría
//     elegir en el onboarding), o la fila 'sos' se lista como vertical; y lo de
//     la migración 200: Odontología sin HC ni receta, Psiquiatría separada,
//     Entrenamiento en Preparación física.
//
//   node scripts/verificar-carrusel-verticales.mjs            # sólo 1 y 2
//   node scripts/verificar-carrusel-verticales.mjs staging    # 1, 2 y 3
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { ordenarCarrusel } from '../src/lib/carruselVerticales.js'

let fallas = 0
const check = (ok, msg) => { console.log(`${ok ? '🟢' : '🔴'} ${msg}`); if (!ok) fallas++ }

// ── 1. Orden del carrusel ────────────────────────────────────────────────────
const verticales = [
  { id: 'clinica' }, { id: 'pediatria' }, { id: 'nutricion' },
  { id: 'mente' }, { id: 'odontologia', comingSoon: true },
]
const porVertical = { clinica: ['medicina_general', 'cardiologia'], pediatria: ['pediatria'], nutricion: ['nutricion'], mente: ['psicologia'] }

let r = ordenarCarrusel(verticales, porVertical, [{ specialty: 'pediatria' }])
check(r[0].id === 'pediatria' && r[0].disponible, 'con un pediatra en línea, Pediatría va primera')
check(r.slice(1).map(v => v.id).join() === 'clinica,nutricion,mente', 'el resto sigue en el orden del admin')
check(!r.some(v => v.id === 'odontologia'), 'una vertical deshabilitada no entra')

r = ordenarCarrusel(verticales, porVertical, [{ specialty: 'psicologia' }, { specialty: 'cardiologia' }])
check(r.map(v => v.id).join() === 'clinica,mente,pediatria,nutricion', 'dos con gente: las dos primero, en orden del admin')

r = ordenarCarrusel(verticales, porVertical, [{ specialty: 'pediatria', vencido: true }], p => !p.vencido)
check(r[0].id === 'clinica' && r.every(v => !v.disponible), 'un pro con la presencia vencida no cuenta como disponible')

r = ordenarCarrusel(verticales, porVertical, [])
check(r.length === 4 && r.every(v => v.disponible === false), 'sin nadie en línea se muestran todas, apagadas')

// ── 2. Onboarding = verticales ───────────────────────────────────────────────
// lib/verticals.js importa íconos de React: se evalúa sólo la función.
const fuente = readFileSync(new URL('../src/lib/verticals.js', import.meta.url), 'utf8')
const cuerpo = fuente.slice(fuente.indexOf('export function categoriasDeOnboarding'), fuente.indexOf('// Specialty options for a given category'))
// eslint-disable-next-line no-new-func
const categoriasDeOnboarding = new Function('OTRA', `${cuerpo.replace('export ', '')}; return categoriasDeOnboarding`)(
  { id: 'otra', label: 'Otra', specialtyValues: ['otra'] }
)
const cats = categoriasDeOnboarding(
  [{ id: 'clinica', nombre: 'Clínica' }, { id: 'odontologia', nombre: 'Odontología' }, { id: 'preparador', nombre: 'Preparación física' }],
  [
    { slug: 'medicina_general', verticalId: 'clinica', active: true, sortOrder: 1 },
    { slug: 'otra', verticalId: 'clinica', active: true, sortOrder: 9 },
    { slug: 'odontologia', verticalId: 'odontologia', active: true, sortOrder: 40 },
    { slug: 'vieja', verticalId: 'clinica', active: false, sortOrder: 2 },
  ]
)
check(cats.map(c => c.id).join() === 'clinica,odontologia,otra', 'áreas = verticales con especialidad + "Otra" al final')
check(cats[0].specialtyValues.join() === 'medicina_general', '"otra" y las inactivas no se repiten adentro de Clínica')

// ── 3. Base ──────────────────────────────────────────────────────────────────
const entorno = process.argv[2]
if (entorno) {
  const env = {}
  const leer = f => { for (const l of readFileSync(f, 'utf8').split('\n')) { const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '') } }
  leer('/Users/mataldao/Local/.env')
  let url, key
  if (entorno === 'staging') { url = env.HEALTHIER_STAGING_SUPABASE_URL; key = env.HEALTHIER_STAGING_SUPABASE_ANON_KEY }
  else { leer(new URL('../../../../.env', import.meta.url).pathname); url = env.VITE_SUPABASE_URL; key = env.VITE_SUPABASE_ANON_KEY }
  const get = async q => (await fetch(`${url}/rest/v1/${q}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })).json()
  const filas = await get('vertical_settings?select=id,nombre,color,tipo')
  if (!Array.isArray(filas)) { check(false, `no pude leer vertical_settings: ${JSON.stringify(filas)}`) }
  else {
    const vs = filas.filter(f => f.tipo === 'vertical')
    check(filas.find(f => f.id === 'sos')?.tipo === 'servicio', "'sos' es servicio, no vertical")
    check(vs.every(v => v.nombre && /^#[0-9A-Fa-f]{6}$/.test(v.color ?? '')), `${vs.length} verticales con nombre y color`)
    const esp = await get('specialties?select=slug,vertical_id&active=eq.true&parent_id=is.null')
    const conEsp = new Set(esp.map(e => e.vertical_id))
    const huerfanas = vs.filter(v => !conEsp.has(v.id))
    // Migración 200: herramientas y catálogo movido.
    const h = await get('vertical_settings?select=id,herramienta_historia_clinica,herramienta_receta&id=eq.odontologia')
    check(h?.[0]?.herramienta_historia_clinica === false && h?.[0]?.herramienta_receta === false, 'Odontología sin historia clínica ni receta')
    const mov = Object.fromEntries((await get('specialties?select=slug,vertical_id&slug=in.(psiquiatria,entrenamiento,kinesiologia)')).map(e => [e.slug, e.vertical_id]))
    check(mov.psiquiatria === 'psiquiatria', 'Psiquiatría es vertical propia (no cuelga de Clínica)')
    check(mov.entrenamiento === 'preparador', 'Entrenamiento Físico está en Preparación física')
    check(mov.kinesiologia === 'fisico', 'Kinesiología tiene su especialidad')
    check(huerfanas.length === 0, `toda vertical tiene especialidad${huerfanas.length ? ` (faltan: ${huerfanas.map(v => v.id).join(', ')})` : ''}`)
  }
}

process.exit(fallas ? 1 : 0)
