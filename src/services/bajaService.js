import { supabase } from '../lib/supabase'

// Baja lógica y reactivación de cuentas (migración 188). Las dos Edge
// Functions se llaman con fetch y no con supabase.functions.invoke() para que
// el error real del body llegue a la pantalla (mismo motivo que
// adminService.impersonate).
async function llamar(funcion, body, { conSesion = false } = {}) {
  const headers = { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY }
  if (conSesion) {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  }
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${funcion}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({ error: `Respuesta inválida (HTTP ${res.status})` }))
  return { ok: res.ok, status: res.status, json }
}

export const bajaService = {
  /** Super admin: da de baja (nunca borra). Devuelve `{ resultados: [{ id, ok, error? }] }`. */
  async darDeBaja(ids) {
    const { ok, status, json } = await llamar('dar-de-baja-usuario', { ids }, { conSesion: true })
    if (!ok && !json?.resultados) throw new Error(json?.error || `HTTP ${status}`)
    return json
  },

  /** ¿Este mail tiene una cuenta dada de baja que se puede recuperar? */
  async estaDadoDeBaja(email) {
    const { ok, json } = await llamar('reactivar-cuenta', { accion: 'consultar', email })
    // Si el chequeo falla, el registro sigue como siempre: no se le traba el
    // alta a nadie por esta consulta.
    return ok && json?.dadoDeBaja === true
  },

  async pedirReactivacion(email) {
    const { ok, status, json } = await llamar('reactivar-cuenta', { accion: 'solicitar', email })
    if (!ok) throw new Error(json?.error || `HTTP ${status}`)
  },

  /** Devuelve el mail de la cuenta recuperada, para iniciar sesión con él. */
  async confirmarReactivacion(token, password) {
    const { ok, status, json } = await llamar('reactivar-cuenta', { accion: 'confirmar', token, password })
    if (!ok) throw new Error(json?.error || `HTTP ${status}`)
    return json.email
  },
}
