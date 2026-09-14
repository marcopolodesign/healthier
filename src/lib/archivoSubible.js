/**
 * Convierte lo que devuelve un `<input type=file>` en algo que Supabase Storage
 * pueda aceptar de verdad — y si no se puede, falla ACÁ, con un texto que le
 * dice a la persona qué hacer.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * Pasar el `File` derecho a `supabase.storage.upload()` parece lo obvio y es lo
 * que rompió el alta de tres profesionales reales. El `File` que da el picker de
 * iOS o de Android **no siempre tiene los bytes del otro lado**: si se eligió
 * desde iCloud Drive o Google Drive y el archivo no está bajado al teléfono, el
 * handle existe, `file.size` puede ser correcto, y recién cuando el browser va a
 * leerlo para armar el body del POST se queda sin datos. Dos síntomas, los dos
 * vistos en producción el 2026-09-14:
 *
 *   • **iPhone (Safari 26, `dni.pdf`)** — el POST sale con el `Content-Length`
 *     declarado, el body se corta antes, y Storage contesta **400** y borra el
 *     objeto a medio subir (`ObjectAdminDelete` en los logs). Seis intentos
 *     seguidos, todos 400, mientras el título y la matrícula elegidos desde la
 *     galería en el mismo minuto subieron 200.
 *   • **Android** — sube **0 bytes con 200**. Es el peor de los dos: el legajo
 *     queda marcado con el documento presente, la URL existe, y el revisor abre
 *     un PDF en blanco. Le pasó a Paula Belén Ocampo (título y matrícula) y a
 *     Ana Luiza Carvalho (los tres documentos).
 *
 * Leer el archivo a memoria primero convierte las dos en un error inmediato y
 * legible, antes de tocar la red. Un documento del legajo topea en 10 MB, así
 * que tenerlo un momento en memoria no es un problema.
 *
 * ── Y el tipo de contenido ──────────────────────────────────────────────────
 * Los buckets del legajo sólo aceptan `application/pdf`, `image/jpeg` y
 * `image/png`. Cuando el archivo viene de un gestor de archivos, `file.type`
 * llega **vacío**, el cliente manda `application/octet-stream` y Storage
 * responde **415 `invalid_mime_type`** aunque el archivo sea un PDF perfecto.
 * Por eso el tipo se resuelve por extensión cuando el browser no lo declara, y
 * se manda explícito en el upload.
 */

const POR_EXTENSION = {
  pdf:  'application/pdf',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
  webp: 'image/webp',
}

/** Un error que no tiene sentido reintentar: el archivo no va a mejorar solo. */
export class ArchivoIlegible extends Error {
  constructor(message) {
    super(message)
    this.name = 'ArchivoIlegible'
    this.noReintentar = true
  }
}

const AVISO_NUBE =
  'Suele pasar cuando se elige desde Drive o iCloud y el archivo no está bajado ' +
  'al teléfono: bajalo primero y volvé a elegirlo, o sacale una foto.'

export function extensionDe(file) {
  const punto = (file?.name || '').lastIndexOf('.')
  return punto > 0 ? file.name.slice(punto + 1).toLowerCase() : ''
}

/**
 * El tipo con el que se va a guardar. `file.type` manda si el browser lo
 * declaró; si no, la extensión. Los tipos que el bucket permite se pasan en
 * `permitidos` para poder rechazar un HEIC de iPhone con un texto útil en vez de
 * dejar que Storage tire un 415 anónimo.
 */
export function tipoDe(file, permitidos = null) {
  const ext = extensionDe(file)
  const declarado = (file?.type || '').toLowerCase()
  const candidato = POR_EXTENSION[ext] || ''
  // `application/octet-stream` es lo que manda un gestor de archivos cuando no
  // sabe qué es: no es un tipo, es la ausencia de uno.
  const tipo = (declarado && declarado !== 'application/octet-stream')
    ? declarado
    : candidato
  if (!tipo) {
    throw new ArchivoIlegible(
      'No pudimos reconocer ese archivo. Mandalo como PDF o como foto JPG o PNG.',
    )
  }
  if (permitidos && !permitidos.includes(tipo)) {
    throw new ArchivoIlegible(
      `No podemos guardar archivos ${ext ? `.${ext}` : 'de ese tipo'}. ` +
      'Mandalo como PDF o como foto JPG o PNG.',
    )
  }
  return tipo
}

/**
 * Lee el archivo completo y devuelve `{ blob, contentType }` listo para
 * `supabase.storage.upload()`. Tira `ArchivoIlegible` —que `conReintento` no
 * reintenta— cuando el archivo está vacío, no se puede leer, o se lee corto.
 */
export async function aBlobSubible(file, permitidos = null) {
  if (!file) throw new ArchivoIlegible('No hay ningún archivo elegido.')
  const contentType = tipoDe(file, permitidos)

  if (file.size === 0) {
    throw new ArchivoIlegible(`Ese archivo llegó vacío (0 KB). ${AVISO_NUBE}`)
  }

  let bytes
  try {
    bytes = await file.arrayBuffer()
  } catch {
    throw new ArchivoIlegible(`No pudimos leer ese archivo desde tu teléfono. ${AVISO_NUBE}`)
  }

  if (bytes.byteLength === 0) {
    throw new ArchivoIlegible(`Ese archivo llegó vacío (0 KB). ${AVISO_NUBE}`)
  }
  // El caso del iPhone: el handle declara un tamaño que los bytes no tienen.
  // Sin este chequeo el POST sale igual y Storage lo rechaza con un 400 que no
  // le dice nada a nadie.
  if (file.size && bytes.byteLength < file.size) {
    throw new ArchivoIlegible(`Ese archivo se cortó al leerlo. ${AVISO_NUBE}`)
  }

  return { blob: new Blob([bytes], { type: contentType }), contentType }
}

/** Lo que aceptan `professional-docs` y `patient-docs`. */
export const TIPOS_DOCUMENTO = ['application/pdf', 'image/jpeg', 'image/png']
/** Lo que acepta el bucket `avatars`. */
export const TIPOS_AVATAR = ['image/jpeg', 'image/png', 'image/webp']
