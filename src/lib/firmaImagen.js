/**
 * Las dos operaciones de imagen que necesita la firma de la receta.
 *
 * ── Por qué recortar ────────────────────────────────────────────────────────
 * El bloque "FIRMA Y SELLO" del PDF de la receta es chico: el servicio dibuja
 * la imagen en unos 90×25 puntos. Si el PNG llega con márgenes en blanco —y un
 * canvas de firma es casi todo margen— esos márgenes se escalan junto con el
 * trazo y la firma termina como una rayita ilegible. Recortando al trazo, el
 * mismo espacio lo ocupa la firma entera. Medido contra el preview real de
 * recetas el 2026-09-11.
 *
 * ── Por qué limpiar la foto ─────────────────────────────────────────────────
 * "Sacale una foto a tu firma en un papel" produce una imagen gris, con sombra
 * y con el papel lejos del blanco. Puesta tal cual sobre la receta se ve un
 * recuadro sucio. Un umbral fijo no alcanza porque la sombra hace que medio
 * papel sea más oscuro que la tinta del otro medio; por eso se estima el fondo
 * con un desenfoque grande y se marca como tinta lo que está más oscuro que su
 * propio entorno.
 */

/** Máximo lado de la imagen con la que se trabaja — arriba de esto es peso al pedo. */
const MAX_LADO = 1400

/** Cuánto más oscuro que su entorno tiene que ser un píxel para contar como tinta (0–255). */
const DELTA_TINTA = 26

/** Margen en píxeles que se deja alrededor del trazo al recortar. */
const MARGEN = 8

function nuevoCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/**
 * Recorta el canvas a la caja que ocupa el trazo, sobre fondo blanco.
 * Devuelve `null` si no hay nada dibujado.
 * @param {HTMLCanvasElement} canvas
 * @returns {{ canvas: HTMLCanvasElement, ancho: number, alto: number } | null}
 */
export function recortarAlTrazo(canvas) {
  const { width: w, height: h } = canvas
  if (!w || !h) return null
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const { data } = ctx.getImageData(0, 0, w, h)

  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const alpha = data[i + 3]
      if (alpha < 16) continue
      // Un píxel casi blanco es papel, no trazo — pasa cuando la firma viene de
      // una foto ya aplanada sobre blanco.
      const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114)
      if (lum > 240) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null

  minX = Math.max(0, minX - MARGEN)
  minY = Math.max(0, minY - MARGEN)
  maxX = Math.min(w - 1, maxX + MARGEN)
  maxY = Math.min(h - 1, maxY + MARGEN)

  const ancho = maxX - minX + 1
  const alto = maxY - minY + 1
  const salida = nuevoCanvas(ancho, alto)
  const sctx = salida.getContext('2d')
  // Fondo blanco explícito: el PDF de la receta no compone transparencia y una
  // firma con alpha llega como un rectángulo negro.
  sctx.fillStyle = '#ffffff'
  sctx.fillRect(0, 0, ancho, alto)
  sctx.drawImage(canvas, minX, minY, ancho, alto, 0, 0, ancho, alto)
  return { canvas: salida, ancho, alto }
}

/** Desenfoque de caja sobre un array de luminancia — estimador del fondo. */
function desenfocar(lum, w, h, radio) {
  const horiz = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    let suma = 0
    const fila = y * w
    for (let x = -radio; x <= radio; x++) suma += lum[fila + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      horiz[fila + x] = suma / (radio * 2 + 1)
      const sale = fila + Math.min(w - 1, Math.max(0, x - radio))
      const entra = fila + Math.min(w - 1, Math.max(0, x + radio + 1))
      suma += lum[entra] - lum[sale]
    }
  }
  const salida = new Float32Array(w * h)
  for (let x = 0; x < w; x++) {
    let suma = 0
    for (let y = -radio; y <= radio; y++) suma += horiz[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      salida[y * w + x] = suma / (radio * 2 + 1)
      const sale = Math.min(h - 1, Math.max(0, y - radio)) * w + x
      const entra = Math.min(h - 1, Math.max(0, y + radio + 1)) * w + x
      suma += horiz[entra] - horiz[sale]
    }
  }
  return salida
}

/**
 * Convierte la foto de una firma en papel en tinta negra sobre blanco, recortada
 * al trazo. Devuelve `null` si no encontró trazo (foto en blanco, o toda oscura).
 * @param {HTMLImageElement} img
 */
export function limpiarFoto(img) {
  const escala = Math.min(1, MAX_LADO / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * escala))
  const h = Math.max(1, Math.round(img.naturalHeight * escala))

  const base = nuevoCanvas(w, h)
  const bctx = base.getContext('2d', { willReadFrequently: true })
  bctx.fillStyle = '#ffffff'
  bctx.fillRect(0, 0, w, h)
  bctx.drawImage(img, 0, 0, w, h)

  const imagen = bctx.getImageData(0, 0, w, h)
  const px = imagen.data
  const lum = new Float32Array(w * h)
  for (let i = 0, p = 0; p < lum.length; i += 4, p++) {
    lum[p] = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114
  }

  // Radio grande a propósito: tiene que ser mucho mayor que el grosor del trazo
  // para que el trazo no se "vea a sí mismo" en su propio fondo estimado.
  const fondo = desenfocar(lum, w, h, Math.max(8, Math.round(Math.max(w, h) / 40)))

  let hayTinta = false
  for (let i = 0, p = 0; p < lum.length; i += 4, p++) {
    const esTinta = lum[p] < fondo[p] - DELTA_TINTA
    const v = esTinta ? 0 : 255
    px[i] = px[i + 1] = px[i + 2] = v
    px[i + 3] = 255
    if (esTinta) hayTinta = true
  }
  if (!hayTinta) return null

  bctx.putImageData(imagen, 0, 0)
  return recortarAlTrazo(base)
}
