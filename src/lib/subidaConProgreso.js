import { supabase } from './supabase'

/** Lo que aceptan `professional-docs` y `patient-docs` en Supabase Storage. */
export const LIMITE_BUCKET_BYTES = 10 * 1024 * 1024

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
  // Cortarlo acá le ahorra a la persona subir 15 MB por una conexión de
  // teléfono para que el servidor lo rechace al final. El mismo texto que
  // daría el 413, pero al instante.
  if (blob.size > LIMITE_BUCKET_BYTES) {
    const e = new Error(`Ese archivo pesa ${(blob.size / 1024 / 1024).toFixed(1)} MB y el máximo que podemos guardar son 10 MB. Mandá una versión más liviana o sacale una foto.`)
    e.noReintentar = true
    throw e
  }
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
      reject(errorDeSubida(xhr))
    }
    xhr.onerror = () => reject(new Error('Se cortó la conexión antes de terminar de subirlo.'))
    xhr.onabort = () => reject(new Error('Se canceló la subida.'))
    xhr.ontimeout = () => reject(new Error('Tardó demasiado y se cortó. Probá de nuevo con mejor señal.'))

    xhr.send(blob)
  })
}

/**
 * El texto que va a leer el profesional, y si tiene sentido reintentar.
 *
 * 🔴 **El status HTTP de Storage miente** (2026-09-15). Un archivo más grande
 * que el límite del bucket vuelve con **HTTP 400** y el 413 real metido
 * *adentro del JSON*:
 *
 *     HTTP/1.1 400
 *     {"statusCode":"413","error":"Payload too large",
 *      "message":"The object exceeded the maximum allowed size",
 *      "code":"EntityTooLarge"}
 *
 * Comprobado contra el bucket de staging con un PDF de 12 MB. Por eso el código
 * de verdad se lee del cuerpo, no de `xhr.status`. Mirando sólo el status, un
 * archivo demasiado grande caía en el cajón de "error raro, reintentá" — y
 * `conReintento` lo mandaba **tres veces enteras**, cada una llenando la barra
 * hasta 100% para volver a empezar. Es lo que reportó Mateo probando en staging
 * con un PDF grande: "llega a 100 y vuelve a empezar".
 */
function errorDeSubida(xhr) {
  let cuerpo = {}
  try { cuerpo = JSON.parse(xhr.responseText || '{}') } catch { /* no era JSON */ }
  const codigo = Number(cuerpo.statusCode) || xhr.status

  const err = new Error(texto(codigo, cuerpo, xhr.status))
  // Ninguno de estos mejora reintentando: el archivo es el que es y la sesión
  // no se arregla sola. Reintentar sólo repite la subida entera.
  err.noReintentar = [413, 415, 401, 403].includes(codigo)
  return err
}

function texto(codigo, cuerpo, status) {
  if (codigo === 413) return 'Ese archivo pesa más de 10 MB, que es el máximo que podemos guardar. Mandá una versión más liviana o sacale una foto.'
  if (codigo === 415) return 'No podemos guardar ese formato. Mandalo como PDF o como foto JPG o PNG.'
  if (codigo === 401 || codigo === 403) return 'Se venció tu sesión. Volvé a entrar y subilo de nuevo.'
  if (cuerpo.message || cuerpo.error) return `No pudimos guardarlo: ${cuerpo.message || cuerpo.error}`
  return `No pudimos guardarlo (error ${status}). Probá de nuevo.`
}
