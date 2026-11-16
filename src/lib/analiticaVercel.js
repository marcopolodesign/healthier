// Vercel Web Analytics recibe la URL de cada página vista. Antes de mandarla se
// le sacan ids y query strings: un id de consulta o de profesional en la ruta,
// o un token/mail en la query, no tienen que salir a un tercero (datos de
// salud). Quedan rutas agrupables tipo /paciente/turno-confirmado/:id.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const NUMERO_LARGO = /\/\d{4,}(?=\/|$)/g

export function limpiarUrl(url) {
  try {
    const u = new URL(url)
    u.search = ''
    u.hash = ''
    u.pathname = u.pathname.replace(UUID, ':id').replace(NUMERO_LARGO, '/:n')
    return u.toString()
  } catch {
    return null
  }
}

export function sinDatosEnUrl(event) {
  const url = limpiarUrl(event.url)
  return url ? { ...event, url } : null
}
