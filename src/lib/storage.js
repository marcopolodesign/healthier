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
  const marker = `/object/public/${bucket}/`
  const i = storedValue.indexOf(marker)
  return i >= 0 ? storedValue.slice(i + marker.length) : storedValue
}

export async function getSignedDocUrl(bucket, storedValue, expiresIn = 3600) {
  if (!storedValue) return null

  const path = extraerPathDeStorage(bucket, storedValue)

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn)
  if (error) {
    console.error(`getSignedDocUrl failed for ${bucket}/${path}:`, error)
    return null
  }
  return data.signedUrl
}
