// Manejo mínimo del simulador de iOS para las capturas de la app, con idb.
// Las marcas se miden con el árbol de accesibilidad (`idb ui describe-all`),
// igual que en la web se miden con el DOM: nunca a ojo.
//
// También sirve suelto, para ir probando a mano:
//   node scripts/guia/simulador.mjs ver                # qué textos hay en pantalla
//   node scripts/guia/simulador.mjs tocar "Turnos"     # toca el elemento con ese texto
//   node scripts/guia/simulador.mjs escribir "hola"
//   node scripts/guia/simulador.mjs foto /tmp/x.png
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const SIM = process.env.GUIA_SIM || '58D25B9E-45E8-40E4-9C71-17F63F6E3ED2'
const idb = (...a) => execFileSync('idb', [...a, '--udid', SIM], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 })
export const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

/** Todos los elementos accesibles con su texto y su caja, en puntos. */
export function elementos() {
  const json = JSON.parse(idb('ui', 'describe-all', '--json', '--nested'))
  const out = []
  const recorrer = (n) => {
    const texto = [n.AXLabel, n.AXValue, n.title].filter(Boolean).join(' ').trim()
    if (n.frame) out.push({ texto, tipo: n.type || n.role, ...n.frame })
    for (const h of n.children ?? []) recorrer(h)
  }
  for (const n of Array.isArray(json) ? json : [json]) recorrer(n)
  return out
}

/** El elemento más chico cuyo texto coincide (string = contiene, o RegExp). */
export function buscar(patron, { todos = false } = {}) {
  const pasa = (t) => (patron instanceof RegExp ? patron.test(t) : t.toLowerCase().includes(String(patron).toLowerCase()))
  const hay = elementos().filter((e) => e.texto && pasa(e.texto) && e.width > 2 && e.height > 2)
  hay.sort((a, b) => a.width * a.height - b.width * b.height)
  return todos ? hay : hay[0] ?? null
}

export async function tocar(patron, ms = 1200) {
  const e = typeof patron === 'object' && 'x' in patron ? patron : buscar(patron)
  if (!e) throw new Error(`no encontré "${patron}" en la pantalla`)
  idb('ui', 'tap', String(Math.round(e.x + e.width / 2)), String(Math.round(e.y + e.height / 2)))
  await esperar(ms)
}
export async function tocarEn(x, y, ms = 1000) { idb('ui', 'tap', String(x), String(y)); await esperar(ms) }
export async function escribir(texto, ms = 500) { idb('ui', 'text', texto); await esperar(ms) }
export async function deslizar(x1, y1, x2, y2, ms = 900) { idb('ui', 'swipe', String(x1), String(y1), String(x2), String(y2), '--duration', '0.4'); await esperar(ms) }
export function abrirUrl(url) { execFileSync('xcrun', ['simctl', 'openurl', SIM, url]) }
export function foto(ruta) { execFileSync('xcrun', ['simctl', 'io', SIM, 'screenshot', '--type=png', ruta], { stdio: 'ignore' }) }
/** Tamaño de la pantalla en puntos (el de la ventana más grande del árbol). */
export function pantalla() {
  const e = elementos().sort((a, b) => b.width * b.height - a.width * a.height)[0]
  return { ancho: Math.round(e.width), alto: Math.round(e.height) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2)
  if (cmd === 'ver') for (const e of elementos().filter((e) => e.texto)) console.log(`${Math.round(e.x)},${Math.round(e.y)} ${Math.round(e.width)}x${Math.round(e.height)}  ${e.texto.slice(0, 70)}`)
  else if (cmd === 'tocar') await tocar(/^\/.*\/$/.test(arg) ? new RegExp(arg.slice(1, -1)) : arg)
  else if (cmd === 'escribir') await escribir(arg)
  else if (cmd === 'foto') foto(arg)
  else if (cmd === 'url') abrirUrl(arg)
}
