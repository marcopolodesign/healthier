// ── A dónde va el usuario apenas termina de registrarse ─────────────────────
//
// El alta tiene dos navegaciones compitiendo por el mismo momento:
//
//   1. La página de registro, que al terminar hace `navigate('/…/onboarding')`.
//   2. `AuthRedirectHandler` en App.jsx, que manda al dashboard del rol a
//      cualquiera que esté logueado parado en `/registro`, `/login`, etc.
//
// El `signUp` de Supabase deja la sesión iniciada de una, así que (2) puede
// dispararse **mientras** la página de registro todavía está esperando el
// `login()` que viene después. Cuando eso pasa, el componente se desmonta y su
// `navigate` posterior no hace nada: el usuario queda en el dashboard sin haber
// visto el onboarding. Es una carrera, por eso aparecía "a veces" y depende del
// navegador (reportado en Safari, 2026-08-06).
//
// La solución es que las dos rutas de navegación coincidan en el destino en vez
// de competir: la página de registro deja acá su intención antes de crear la
// cuenta, y el que llegue primero la respeta.
const KEY = 'healthier:post_signup_redirect'

// La marca vale para el alta que se está haciendo ahora, no para siempre. Si el
// registro falla a mitad de camino la marca queda escrita, y sin vencimiento el
// próximo login normal en esa misma pestaña terminaría en el onboarding.
const VALIDEZ_MS = 60_000

export function marcarDestinoPostRegistro(path) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path, ts: Date.now() }))
  } catch { /* modo privado: sin marca, sigue funcionando el navigate directo */ }
}

/** Devuelve el destino pendiente (y lo consume). `null` si no hay o si venció. */
export function tomarDestinoPostRegistro() {
  try {
    const crudo = sessionStorage.getItem(KEY)
    if (!crudo) return null
    sessionStorage.removeItem(KEY)
    const { path, ts } = JSON.parse(crudo)
    return Date.now() - ts < VALIDEZ_MS ? path : null
  } catch {
    return null
  }
}
