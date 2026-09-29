import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

if (import.meta.env.DEV) {
  console.log('Supabase Init:', {
    url: supabaseUrl,
    hasAnonKey: !!anonKey,
  })
}

export const supabase = createClient(supabaseUrl, anonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
})

/**
 * La sesión del WebView de la app se perdía sola (2026-09-28, iPhone de
 * Mateo en `/profesional/atencion/:id`): entraba con sesión, y a los ~15 s
 * todo salía como anónimo —el borrador de la consulta y "Guardar en la HC"
 * fallaban en silencio— sin que nadie la hubiera cerrado ni la base la
 * hubiera revocado. No se pudo reproducir fuera de iOS.
 *
 * Por eso se guarda en memoria la última sesión válida de esta pestaña y,
 * antes de escribir datos clínicos, `asegurarSesion()` la repone si
 * desapareció. Reponerla pasa igual por el servidor (`setSession` valida el
 * token contra Auth), así que una sesión cerrada o revocada de verdad no
 * vuelve. Un "Cerrar sesión" a propósito la olvida primero (`olvidarSesion`).
 *
 * El callback es síncrono a propósito: adentro de `onAuthStateChange` no se
 * puede esperar a Supabase (deadlock del candado de sesión, ver App.jsx).
 */
let ultimaSesion = null
supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.access_token && session?.refresh_token) {
    ultimaSesion = { access_token: session.access_token, refresh_token: session.refresh_token }
  }
})

export function olvidarSesion() {
  ultimaSesion = null
}

export class SesionCerradaError extends Error {
  constructor() {
    super('Se cerró tu sesión y no se guardó. Volvé a entrar y probá de nuevo.')
    this.name = 'SesionCerradaError'
  }
}

export async function asegurarSesion() {
  const { data: { session } } = await supabase.auth.getSession()
  if (session) return session
  if (ultimaSesion) {
    const { data, error } = await supabase.auth.setSession(ultimaSesion)
    if (!error && data?.session) return data.session
    ultimaSesion = null
  }
  throw new SesionCerradaError()
}

/**
 * El motivo real de un error de escritura, en castellano. Un anónimo que
 * choca con la RLS devuelve "new row violates row-level security policy"
 * (401) o, en un update con `.single()`, "Cannot coerce the result to a
 * single JSON object" (406) — ninguno le dice nada al médico.
 */
export function mensajeDeError(err) {
  if (!err) return 'Error desconocido'
  if (err instanceof SesionCerradaError) return err.message
  if (err.code === '42501' || err.status === 401) {
    return 'No tenés permiso para guardar esto (¿se cerró tu sesión?). Volvé a entrar y probá de nuevo.'
  }
  if (err.code === 'PGRST116') {
    return 'No se encontró la consulta o ya no tenés permiso para editarla (¿se cerró tu sesión?).'
  }
  return err.message || String(err)
}

export const getCurrentUser = async () => {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export const isAuthenticated = async () => {
  const { data: { session } } = await supabase.auth.getSession()
  return !!session
}

// Convert snake_case to camelCase
export const toCamelCase = (obj) => {
  if (Array.isArray(obj)) return obj.map(toCamelCase)
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).reduce((acc, key) => {
      const camelKey = key.replace(/_([a-z])/g, (_, l) => l.toUpperCase())
      acc[camelKey] = toCamelCase(obj[key])
      return acc
    }, {})
  }
  return obj
}

// Convert camelCase to snake_case
export const toSnakeCase = (obj) => {
  if (Array.isArray(obj)) return obj.map(toSnakeCase)
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).reduce((acc, key) => {
      const snakeKey = key.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`)
      acc[snakeKey] = toSnakeCase(obj[key])
      return acc
    }, {})
  }
  return obj
}

export default supabase
