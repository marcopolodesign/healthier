#!/usr/bin/env node
/**
 * Registra el logo de Healthier en el servicio de recetas electrónicas, para
 * que salga impreso arriba al centro de cada receta.
 *
 *   node scripts/registrar-logo-receta.mjs homologacion
 *   node scripts/registrar-logo-receta.mjs produccion     # 🔴 afecta TODAS las recetas reales
 *   node scripts/registrar-logo-receta.mjs homologacion --ver
 *   node scripts/registrar-logo-receta.mjs homologacion --borrar
 *
 * ── Por qué esto existe, y por qué NO se manda el logo en cada receta ────────
 *
 * Hasta el 2026-09-11 el logo viajaba en `subemisor.logoBase64` dentro del
 * payload de cada emisión, y **nunca se imprimió ni una vez**: el servicio
 * contestaba `400 QBI147 — DEBE INGRESAR NOMBRE, CUIT Y DIRECCIÓN DEL
 * SUBEMISOR` (mandábamos un subemisor con logo y sin identificarlo), y el
 * reintento de `rcta-issue` salvaba la emisión sacándolo. O sea: la receta
 * salía bien, sin logo, y sin que nada avisara. No se detectó antes porque
 * hasta ese día no se había emitido ninguna receta real.
 *
 * Además `subemisor` nunca fue el campo correcto — el contrato lo define como
 * "una organización que está usando el cliente app para prescribir, por ej. una
 * sucursal de una cadena de clínicas". Healthier **es** el cliente app.
 *
 * El mecanismo correcto es registrar el logo UNA vez por ambiente. Verificado
 * emitiendo contra homologación el 2026-09-11: sale arriba al centro, a color,
 * con el payload limpio.
 *
 * ── El archivo ──────────────────────────────────────────────────────────────
 *
 * `scripts/logo-receta.png` — el wordmark de `src/components/common/
 * CompanyLogo.jsx` rasterizado a 600×129. El verde NO es el `#7CB38B` de la
 * marca sino `#4A6B53`: el de marca es un sage claro que sobre papel queda
 * lavado y en la fotocopia de una farmacia casi desaparece. Es el mismo tono,
 * oscurecido hasta que aguanta el blanco y negro. 600px es el mínimo para que
 * se vea nítido a 300dpi en los ~130 puntos de ancho que le da el PDF.
 *
 * Para regenerarlo desde el SVG (hace falta ImageMagick):
 *   magick -background white -density 400 logo.svg -resize 600x -strip PNG8:scripts/logo-receta.png
 *
 * ── Qué NO se puede brandear ────────────────────────────────────────────────
 *
 * La plantilla del PDF es del proveedor y esta imagen es el único lever que
 * existe. No hay campo de color de cabecera, tipografía ni estilo. `leyenda`,
 * `informacionAdicional`, `horario`, `diasAtencion`, `datosContacto` y
 * `nombreConsultorio` se aceptan en el request y no se imprimen — probados uno
 * por uno contra el endpoint de preview.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const aca = dirname(fileURLToPath(import.meta.url))

const leerEnv = ruta => Object.fromEntries(
  readFileSync(ruta, 'utf8').split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

const ENTORNO = process.argv[2]
const VER = process.argv.includes('--ver')
const BORRAR = process.argv.includes('--borrar')

if (!['homologacion', 'produccion'].includes(ENTORNO)) {
  console.error('uso: node scripts/registrar-logo-receta.mjs <homologacion|produccion> [--ver|--borrar]')
  process.exit(1)
}

// Las credenciales de producción NO están en ningún `.env` del repo: viven en
// los secrets de Supabase, porque ese token firma recetas médicas legalmente
// válidas. Para correr esto contra producción hay que exportarlas a mano.
let URL_BASE, TOKEN, APP_ID
if (ENTORNO === 'produccion') {
  ({ RCTA_API_URL: URL_BASE, RCTA_API_KEY: TOKEN, RCTA_CLIENT_APP_ID: APP_ID } = process.env)
  if (!URL_BASE || !TOKEN || !APP_ID) {
    console.error(
      'Faltan las credenciales de producción. Sacalas de los secrets de Supabase del proyecto de prod y exportalas:\n' +
      '  export RCTA_API_URL=... RCTA_API_KEY=... RCTA_CLIENT_APP_ID=...',
    )
    process.exit(1)
  }
  if (URL_BASE.includes('hml')) {
    console.error(`RCTA_API_URL apunta a homologación (${URL_BASE}) — no es producción.`)
    process.exit(1)
  }
} else {
  const env = leerEnv(resolve(aca, '..', '.env'))
  ;({ RCTA_API_URL: URL_BASE, RCTA_API_KEY: TOKEN, RCTA_CLIENT_APP_ID: APP_ID } = env)
  if (!URL_BASE?.includes('hml')) {
    console.error(`El .env local no apunta a homologación (${URL_BASE}). Abortando por las dudas.`)
    process.exit(1)
  }
}

const clienteAppId = Number(APP_ID)
// 0 = el logo por defecto, el que aplica a cualquier financiador. El contrato
// permite uno distinto por obra social; no lo usamos.
const idFinanciador = 0
const ENDPOINT = `${URL_BASE}/apirecipe/admin/Logo`

console.log(`Entorno: ${ENTORNO} · ${URL_BASE} · clienteAppId ${clienteAppId}`)

if (VER || BORRAR) {
  const cuerpo = JSON.stringify({ clienteAppId, idFinanciador })
  if (BORRAR) {
    const r = await fetch(ENDPOINT, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: cuerpo,
    })
    console.log('DELETE →', r.status, await r.text())
    process.exit(r.ok ? 0 : 1)
  }
  // El GET de este endpoint lleva el cuerpo en el request — el contrato es así.
  // `fetch` no lo permite ("Request with GET/HEAD method cannot have body"), de
  // ahí el curl.
  const salida = execFileSync('curl', [
    '-sS', '-X', 'GET', ENDPOINT,
    '-H', `Authorization: Bearer ${TOKEN}`,
    '-H', 'Content-Type: application/json',
    '--data', cuerpo,
  ]).toString()
  console.log('GET →', salida)
  process.exit(salida.includes('"error"') ? 1 : 0)
}

const png = readFileSync(resolve(aca, 'logo-receta.png'))
const fd = new FormData()
fd.append('ClienteAppId', String(clienteAppId))
fd.append('IdFinanciador', String(idFinanciador))
// `Posicion` 1 = arriba al centro. Es lo que pidió Mateo y lo verificado.
fd.append('Posicion', '1')
fd.append('ImagenLogo', new Blob([png], { type: 'image/png' }), 'healthier.png')

const r = await fetch(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: fd })
const txt = await r.text()
console.log('POST →', r.status, txt)
if (!r.ok) process.exit(1)
console.log('\nListo. Emitir una receta y mirar el PDF para confirmar que el logo sale arriba al centro.')
