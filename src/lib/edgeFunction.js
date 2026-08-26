import { supabase } from './supabase'

/**
 * Get the current authenticated session's access token.
 * Returns null when there is no active session (avoids throwing).
 */
export async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

/**
 * Call a Supabase Edge Function with a JSON body (POST).
 * `path` may include a query string (e.g. 'mp-connect?action=disconnect').
 * Returns the parsed JSON response or throws a structured error.
 *
 * Functions that respond with `{ data, error }` directly get that envelope
 * unwrapped so callers always get the inner payload. Functions that return a
 * flat object pass through unchanged.
 */
export async function callEdgeFunction(path, body, token) {
  const accessToken = token ?? await getAccessToken()
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${path}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    }
  )
  const json = await res.json().catch(() => ({ error: 'invalid_response' }))
  if (!res.ok) {
    throw new Error(json?.error ?? json?.message ?? `HTTP ${res.status}`)
  }
  if (json && typeof json === 'object' && ('data' in json || 'error' in json)) {
    if (json.error) throw new Error(json.error)
    return json.data
  }
  return json
}
