/**
 * Genera public/og.jpg — la imagen que se ve al compartir el link en WhatsApp,
 * Instagram, LinkedIn, Slack, iMessage y Twitter/X.
 *
 *   node scripts/gen-og-image.mjs
 *
 * La plantilla es scripts/og-template.html: para cambiar el texto o la foto se
 * edita ahí y se vuelve a correr esto. 1200x630 es la medida canónica de Open
 * Graph — Facebook/WhatsApp recortan cualquier otra relación.
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const aca = path.dirname(fileURLToPath(import.meta.url))
const plantilla = path.join(aca, 'og-template.html')
const salida = path.join(aca, '..', 'public', 'og.jpg')

const ANCHO = 1200
const ALTO = 630

const navegador = await chromium.launch()
// deviceScaleFactor queda en 1 a propósito: el screenshot sale exactamente de
// 1200x630. Con 2 el clip también se duplica y el archivo sale de 2400x1260 y
// ~330 KB — WhatsApp deja de mostrar la miniatura pasados los ~300 KB.
const pagina = await navegador.newPage({
  viewport: { width: ANCHO, height: ALTO },
  deviceScaleFactor: 1,
})

await pagina.goto(`file://${plantilla}`)
await pagina.evaluate(() => document.fonts.ready)

await pagina.screenshot({
  path: salida,
  type: 'jpeg',
  quality: 90,
  clip: { x: 0, y: 0, width: ANCHO, height: ALTO },
})

await navegador.close()
console.log(`✓ ${path.relative(process.cwd(), salida)}`)
