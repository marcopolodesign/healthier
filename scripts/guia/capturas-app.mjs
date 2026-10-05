#!/usr/bin/env node
// Las capturas de la APP (iOS) para la guía de uso, con sus marcas medidas
// sobre el árbol de accesibilidad del simulador (no a ojo).
//
// Antes (una vez): la app del worktree de mobile corriendo en el simulador
// contra STAGING y con la sesión de la cuenta que pide cada bloque. Cómo se
// levanta está en scripts/guia/README.md.
//
//   node scripts/guia/capturas-app.mjs paciente      # con la sesión de paciente.completo@
//   node scripts/guia/capturas-app.mjs profesional   # con la sesión de clinica@
//
// Deja public/guia-img/<id>.jpg y la entrada en src/guia/marcas.json.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buscar, tocar, tocarEn, foto, esperar, elementos } from './simulador.mjs'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SALIDA = path.join(RAIZ, 'public/guia-img')
const MARCAS = path.join(RAIZ, 'src/guia/marcas.json')

const tab = (t) => async () => { await tocar(new RegExp(`^${t}$`), 2200) }

/** Cada marca: un texto (o varios, y se toma la caja que los cubre a todos). */
const TOMAS = {
  paciente: [
    { id: 'pac-app-inicio', pasos: tab('Inicio'), marcas: [
        [1, ['Hola ', 'Ver el carrito de farmacia', /^\d\+?$|^9\+$/]], [2, 'TU PRÓXIMO TURNO'], [3, /Clínica$/], [4, ['Inicio', 'Perfil']]] },
    { id: 'pac-app-turnos', pasos: tab('Turnos'), marcas: [
        [1, ['Próximos', 'Historial']], [2, ['Valentina Ortega', 'Videoconsulta · ']], [3, /^Ingresar$/]] },
    { id: 'pac-app-boveda', pasos: tab('Bóveda'), marcas: [
        [1, 'Historia Clínica, Ver'], [2, ['Análisis de sangre, Activo', 'Farmacia, Tus pedidos']]] },
    { id: 'pac-app-historia', pasos: async () => {
        await tab('Bóveda')(); await tocar('Historia Clínica, Ver', 2500)
        const c = buscar(/^\d{2} de .+ ›$/); if (c) await tocar(c, 2000) },
      marcas: [[1, 'ALERGIAS ACTIVAS'], [2, [/^\d{2} de .+ ›$/, 'NOTAS CLÍNICAS']], [3, 'Exportar']] },
    { id: 'pac-app-perfil', pasos: tab('Perfil'), marcas: [
        [1, ['Editar mis datos', 'PERFIL CLÍNICO', 'Obra social']], [2, ['Mis profesionales', 'Grupo familiar,']], [3, ['Mis datos', 'Comprobantes']]] },
  ],
  profesional: [
    { id: 'pro-app-inicio', pasos: tab('Inicio'), marcas: [
        [1, /^Consulta inmediata/], [2, /^Tu link para tus pacientes/], [3, ['Inicio', /^Más/]]] },
  ],
}

function caja(patron) {
  const lista = Array.isArray(patron) ? patron : [patron]
  const cajas = lista.map((p) => buscar(p)).filter(Boolean)
  if (!cajas.length || (Array.isArray(patron) && cajas.length < lista.length)) return null
  const x = Math.min(...cajas.map((c) => c.x)), y = Math.min(...cajas.map((c) => c.y))
  const x2 = Math.max(...cajas.map((c) => c.x + c.width)), y2 = Math.max(...cajas.map((c) => c.y + c.height))
  return { x, y, width: x2 - x, height: y2 - y }
}

const grupo = process.argv[2]
if (!TOMAS[grupo]) { console.log('Uso: capturas-app.mjs paciente|profesional [id ...]'); process.exit(1) }
const solo = process.argv.slice(3)
const marcas = JSON.parse(fs.readFileSync(MARCAS, 'utf8'))
const tmp = path.join(os.tmpdir(), 'guia-app.png')
for (const t of TOMAS[grupo].filter((t) => !solo.length || solo.includes(t.id))) {
  try {
    await t.pasos()
    await esperar(800)
    // La pantalla en puntos: la raíz del árbol.
    const raiz = elementos().sort((a, b) => b.width * b.height - a.width * a.height)[0]
    const W = raiz.width, H = raiz.height
    const medidas = []
    for (const [n, p] of t.marcas) {
      const c = caja(p)
      if (!c) { console.log(`   · ${t.id}: la marca ${n} no aparece`); continue }
      const x = Math.max(0, c.x), y = Math.max(0, c.y)
      const w = Math.min(c.width - (x - c.x), W - x), h = Math.min(c.height - (y - c.y), H - y)
      if (w <= 4 || h <= 4) { console.log(`   · ${t.id}: la marca ${n} queda fuera de pantalla`); continue }
      const pc = (v, d) => Math.round((v / d) * 1000) / 10
      medidas.push({ n, x: pc(x, W), y: pc(y, H), w: pc(w, W), h: pc(h, H) })
    }
    foto(tmp)
    // A 2x alcanza para la guía: la captura del simulador es 3x.
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '--resampleWidth', String(W * 2), tmp, '--out', path.join(SALIDA, `${t.id}.jpg`)], { stdio: 'ignore' })
    marcas[t.id] = { movil: true, app: true, ancho: W, alto: H, marcas: medidas }
    console.log(`${medidas.length < t.marcas.length ? '△' : '✓'} ${t.id} (${medidas.length} marcas)`)
  } catch (e) {
    console.log(`✗ ${t.id}: ${e.message.split('\n')[0]}`)
  }
}
fs.writeFileSync(MARCAS, JSON.stringify(Object.fromEntries(Object.entries(marcas).sort()), null, 1) + '\n')
