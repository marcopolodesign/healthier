#!/usr/bin/env node
// La guía de uso no se rompe en silencio. Controla, sin red ni browser:
//   - que existan las cinco guías y que las públicas sigan siendo públicas;
//   - que cada captura que nombra src/guia/contenido.js esté en public/guia-img/
//     y tenga sus marcas medidas en src/guia/marcas.json;
//   - que cada número que se explica esté en la captura (si una pantalla
//     cambió y la marca dejó de encontrarse, esto lo dice);
//   - que cada "Lo que podés hacer" lleve a una sección que existe;
//   - que las rutas /guia sigan en App.jsx y que el menú tenga la entrada;
//   - que no se nombre al proveedor de recetas en lo visible.
//
//   node scripts/prueba-guia.mjs        (o npm run test:guia)
//
// Para la prueba en el browser (que abra sin sesión, que carguen las capturas,
// sin scroll de costado, el super admin al login): scripts/guia/mirar.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GUIAS, GLOSARIO } from '../src/guia/contenido.js'
import { GUIAS_PUBLICAS, GUIA_DE_ROL } from '../src/guia/roles.js'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const marcas = JSON.parse(fs.readFileSync(path.join(RAIZ, 'src/guia/marcas.json'), 'utf8'))
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8')
const fallas = []
const mal = (m) => fallas.push(m)

for (const slug of ['paciente', 'profesional', 'farmacia', 'emergencias', 'super-admin']) {
  if (!GUIAS[slug]) mal(`falta la guía ${slug}`)
}
for (const slug of ['paciente', 'profesional', 'farmacia', 'emergencias']) {
  if (!GUIAS_PUBLICAS.includes(slug)) mal(`la guía ${slug} dejó de ser pública`)
}
if (GUIAS_PUBLICAS.includes('super-admin')) mal('la guía del super admin no puede ser pública')
for (const rol of ['patient', 'professional', 'pharmacy_admin', 'emergency_admin', 'emergency_crew', 'super_admin']) {
  if (!GUIAS[GUIA_DE_ROL[rol]]) mal(`el rol ${rol} no tiene guía`)
}

let capturas = 0
for (const [slug, g] of Object.entries(GUIAS)) {
  const ids = new Set(g.secciones.map((s) => s.id))
  if (ids.size !== g.secciones.length) mal(`${slug}: hay dos secciones con el mismo id`)
  for (const p of g.puede) if (!ids.has(p.ir)) mal(`${slug}: "${p.titulo}" lleva a #${p.ir}, que no existe`)
  for (const k of g.glosario) if (!GLOSARIO[k]) mal(`${slug}: el glosario nombra "${k}" y no está definido`)
  for (const s of g.secciones) {
    if (!s.captura) continue
    capturas++
    if (!fs.existsSync(path.join(RAIZ, 'public/guia-img', `${s.captura}.jpg`))) mal(`${slug}/${s.id}: falta la imagen ${s.captura}.jpg`)
    const m = marcas[s.captura]
    if (!m) { mal(`${slug}/${s.id}: ${s.captura} no tiene marcas medidas`); continue }
    if (!m.ancho || !m.alto) mal(`${s.captura}: falta el tamaño de la captura`)
    const medidos = new Set(m.marcas.map((x) => x.n))
    const explicados = Object.keys(s.marcas ?? {}).map(Number)
    const faltan = explicados.filter((n) => !medidos.has(n))
    if (faltan.length) mal(`${slug}/${s.id}: se explican los números ${faltan} pero no están en ${s.captura}`)
    for (const x of m.marcas) {
      if (x.x < 0 || x.y < 0 || x.x + x.w > 100.5 || x.y + x.h > 100.5) mal(`${s.captura}: la marca ${x.n} se sale de la captura`)
    }
  }
}

const app = leer('src/App.jsx')
if (!app.includes('path="/guia"') || !app.includes('path="/guia/:rol"')) mal('App.jsx ya no tiene las rutas /guia')
if (!leer('src/components/Sidebar.jsx').includes('urlDeGuia')) mal('el menú (Sidebar) perdió la entrada "Guía de uso"')

const visible = leer('src/guia/contenido.js') + leer('src/guia/Guia.jsx')
if (/innovamed|rcta/i.test(visible.replace(/^\s*(\/\/|\*).*$/gm, ''))) mal('la guía nombra al proveedor de recetas')

for (const f of fallas) console.log('  ✗', f)
console.log(fallas.length ? `FALLARON ${fallas.length}` : `TODO OK — ${Object.keys(GUIAS).length} guías, ${capturas} secciones con captura`)
process.exit(fallas.length ? 1 : 0)
