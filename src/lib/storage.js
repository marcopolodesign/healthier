import { supabase } from './supabase'

// `uploadDocument()` (professionalService.js) historically stored the result of
// `getPublicUrl()` even for private buckets (professional-docs, patient-docs) —
// that call always succeeds but the resulting URL 404s ("Bucket not found") when
// actually fetched, since Supabase only serves the public object path for public
// buckets. Existing DB rows already hold these broken pseudo-public URLs, so this
// extracts the real object path from either a stored path or a stored pseudo-public
// URL, then mints a fresh signed URL — private buckets need one per read, not once
// at upload time, since signed URLs expire.
/**
 * El path del objeto dentro del bucket, venga guardado como path o como una de
 * esas pseudo-URLs públicas. Exportado porque además de firmar hace falta para
 * mandarle el path a una Edge Function que baja el archivo del lado del servidor.
 */
export function extraerPathDeStorage(bucket, storedValue) {
  if (!storedValue) return null
  // También los links firmados (`/object/sign/…?token=…`) que guarda la app en
  // `medical_documents.file_url`: sin esto la web intentaba firmar la URL entera.
  for (const tipo of ['public', 'sign']) {
    const marker = `/object/${tipo}/${bucket}/`
    const i = storedValue.indexOf(marker)
    if (i < 0) continue
    const path = storedValue.slice(i + marker.length).split('?')[0]
    if (tipo === 'public') return path
    try { return decodeURIComponent(path) } catch { return path }
  }
  return storedValue
}

export async function getSignedDocUrl(bucket, storedValue, expiresIn = 3600) {
  if (!storedValue) return null

  const path = extraerPathDeStorage(bucket, storedValue)

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn)
  if (error) {
    console.error(`getSignedDocUrl failed for ${bucket}/${path}:`, error)
    // Un link ya firmado (lo que guarda la app) sirve tal cual mientras no
    // venza — es el caso del profesional con archivos que la app subió a la
    // raíz de la carpeta del paciente, donde su policy de storage no llega.
    return storedValue.includes(`/object/sign/${bucket}/`) ? storedValue : null
  }
  return data.signedUrl
}
