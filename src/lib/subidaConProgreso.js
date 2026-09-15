import { supabase } from './supabase'

/**
 * Sube un Blob a Supabase Storage **informando el porcentaje** mientras viaja.
 *
 * ── Por qué no alcanza con `supabase.storage.upload()` ──────────────────────
 * El cliente de Supabase sube con `fetch`, y `fetch` **no tiene eventos de
 * progreso de subida**: no hay forma de saber cuántos bytes salieron hasta que
 * la respuesta vuelve entera. Por eso acá se habla directo con el endpoint REST
 * de Storage usando `XMLHttpRequest`, que sí expone `upload.onprogress`.
 *
 * Es el mismo endpoint y los mismos headers que usa el cliente por dentro
 * (`POST /storage/v1/object/{bucket}/{path}` con `x-upsert`), así que las
 * políticas de RLS del bucket siguen aplicando igual: va el access token de la
 * sesión, no la service role.
 *
 * ── Por qué importa acá ─────────────────────────────────────────────────────
 * Un título escaneado son varios MB, y desde el teléfono del profesional eso
 * puede tardar. Sin porcentaje, "Subiendo…" y "se colgó" se ven idénticos —
 * y quien no sabe cuál de los dos es, cierra la pestaña. Que es exactamente
 * cómo se pierde un legajo a medio cargar.
 *
 * @param {string} bucket
 * @param {string} path         — ruta dentro del bucket, sin barra inicial.
 * @param {Blob}   blob         — ya leído y validado; ver `archivoSubible.js`.
 * @param {string} contentType
 * @param {(fraccion: number) => void} [onProgress] — 0 a 1.
 * @returns {Promise<void>}
 */
export async function subirConProgreso(bucket, path, blob, contentType, onProgress) {
  const base = import.meta.env.VITE_SUPABASE_URL || ''
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token || anon

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const url = `${base}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`
    xhr.open('POST', url, true)
    xhr.setRequestHeader('authorization', `Bearer ${token}`)
    xhr.setRequestHeader('apikey', anon)
    xhr.setRequestHeader('content-type', contentType)
    // Igual que `upsert: true` del cliente: reemplaza el archivo anterior en vez
    // de responder 409. Reintentar una subida tiene que ser barato.
    xhr.setRequestHeader('x-upsert', 'true')

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    // Los bytes ya salieron; lo que falta es que Storage conteste. Se avisa el
    // 100% para que la barra no se quede clavada en 98 mientras espera.
    xhr.upload.onload = () => onProgress?.(1)

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { resolve(); return }
      reject(new Error(mensajeDeError(xhr)))
    }
    xhr.onerror = () => reject(new Error('Se cortó la conexión antes de terminar de subirlo.'))
    xhr.onabort = () => reject(new Error('Se canceló la subida.'))
    xhr.ontimeout = () => reject(new Error('Tardó demasiado y se cortó. Probá de nuevo con mejor señal.'))

    xhr.send(blob)
  })
}

/**
 * El texto que va a leer el profesional. Storage contesta JSON con su propio
 * mensaje en inglés; los dos casos que de verdad pasan tienen traducción propia
 * porque además dicen qué hacer.
 */
function mensajeDeError(xhr) {
  if (xhr.status === 413) return 'Ese archivo pesa más de 10 MB. Mandá una versión más liviana o sacale una foto.'
  if (xhr.status === 415) return 'No podemos guardar ese formato. Mandalo como PDF o como foto JPG o PNG.'
  if (xhr.status === 401 || xhr.status === 403) return 'Se venció tu sesión. Volvé a entrar y subilo de nuevo.'
  try {
    const { message, error } = JSON.parse(xhr.responseText || '{}')
    if (message || error) return `No pudimos guardarlo: ${message || error}`
  } catch { /* la respuesta no era JSON */ }
  return `No pudimos guardarlo (error ${xhr.status}). Probá de nuevo.`
}
