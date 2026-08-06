const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.82
const SKIP_BELOW_BYTES = 300 * 1024 // already small enough, not worth re-encoding
const MIN_FACE_DIMENSION = 200 // px — bajo esto es poco probable que se distinga una cara

// Downscales + re-encodes an image file client-side before upload — phone
// photos (avatars, DNI/título shot with a camera) routinely come in at
// 5-10MB, which is wasted storage and slow to upload for no visible gain at
// the sizes these actually render at. Canvas-based, no new dependency.
// PDFs and non-image files pass through untouched.
export async function compressImage(file) {
  if (!file || !file.type?.startsWith('image/')) return file
  if (file.size < SKIP_BELOW_BYTES) return file

  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return file

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  if (!blob || blob.size >= file.size) return file // didn't actually help — keep original

  const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg'
  return new File([blob], newName, { type: 'image/jpeg' })
}

// Chequeo blando para fotos de perfil: no detecta caras (no hay librería de
// visión en el proyecto), sólo avisa cuando la imagen es tan chica que es
// poco probable que se distinga una cara con claridad. Nunca bloquea la
// subida — es una sugerencia, el profesional decide si la cambia o no.
export async function isLikelyTooSmallForFace(file) {
  if (!file || !file.type?.startsWith('image/')) return false
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return false
  const tooSmall = bitmap.width < MIN_FACE_DIMENSION || bitmap.height < MIN_FACE_DIMENSION
  bitmap.close?.()
  return tooSmall
}
