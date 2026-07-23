import { supabase } from './supabase'

// `uploadDocument()` (professionalService.js) historically stored the result of
// `getPublicUrl()` even for private buckets (professional-docs, patient-docs) —
// that call always succeeds but the resulting URL 404s ("Bucket not found") when
// actually fetched, since Supabase only serves the public object path for public
// buckets. Existing DB rows already hold these broken pseudo-public URLs, so this
// extracts the real object path from either a stored path or a stored pseudo-public
// URL, then mints a fresh signed URL — private buckets need one per read, not once
// at upload time, since signed URLs expire.
export async function getSignedDocUrl(bucket, storedValue, expiresIn = 3600) {
  if (!storedValue) return null

  const marker = `/object/public/${bucket}/`
  const markerIndex = storedValue.indexOf(marker)
  const path = markerIndex >= 0 ? storedValue.slice(markerIndex + marker.length) : storedValue

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn)
  if (error) {
    console.error(`getSignedDocUrl failed for ${bucket}/${path}:`, error)
    return null
  }
  return data.signedUrl
}
