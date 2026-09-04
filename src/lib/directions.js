/**
 * Rutas para llegar al consultorio — Mapbox Directions API.
 *
 * El token es el mismo `pk.` público que ya usa el mapa de profesionales
 * (`InteractiveMap.jsx`): es de cliente por diseño, no hay nada que esconder.
 *
 * Devuelve siempre metros y minutos ya redondeados, para que ni la web ni la
 * app tengan que acordarse de que la API contesta en segundos.
 */

const TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN

/** Perfiles que ofrecemos al paciente. La API tiene más; estos dos alcanzan. */
export const TRAVEL_MODES = [
  { id: 'driving', label: 'En auto' },
  { id: 'walking', label: 'Caminando' },
]

/**
 * Ruta entre dos puntos.
 *
 * @param {{lat:number,lng:number}} from  dónde está el paciente
 * @param {{lat:number,lng:number}} to    el consultorio
 * @param {'driving'|'walking'} mode
 * @param {AbortSignal} [signal]
 * @returns {Promise<{coordinates:[number,number][], durationMin:number, distanceMeters:number}|null>}
 *          `null` cuando Mapbox no encuentra ruta (p. ej. el paciente está en
 *          otra ciudad y pidió "caminando"). Nunca inventa una recta.
 */
export async function getRoute(from, to, mode = 'driving', signal) {
  if (!TOKEN || !from || !to) return null
  const profile = mode === 'walking' ? 'walking' : 'driving'
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}` +
    `?geometries=geojson&overview=full&language=es&access_token=${TOKEN}`

  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Mapbox Directions ${res.status}`)
  const json = await res.json()
  const route = json?.routes?.[0]
  if (!route) return null

  return {
    coordinates: route.geometry?.coordinates ?? [],
    durationMin: Math.max(1, Math.round(route.duration / 60)),
    distanceMeters: Math.round(route.distance),
  }
}

/** "1,2 km" / "350 m" — la unidad que un porteño espera leer. */
export function formatMeters(meters) {
  if (meters == null) return '—'
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`
}

/** "8 min" / "1 h 5 min" */
export function formatMinutes(min) {
  if (min == null) return '—'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

/**
 * Miniatura del mapa sin cargar Mapbox GL — la Static Images API, misma que
 * usa el dashboard del paciente. Sirve para las tarjetas de lista, donde
 * montar un mapa interactivo por cada turno sería un despropósito.
 */
export function staticMapUrl({ lat, lng }, { width = 640, height = 260, zoom = 14 } = {}) {
  if (!TOKEN || lat == null || lng == null) return null
  const pin = `pin-l-hospital+7CB38B(${lng},${lat})`
  return (
    `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/${pin}/` +
    `${lng},${lat},${zoom},0/${width}x${height}@2x` +
    `?access_token=${TOKEN}&attribution=false&logo=false`
  )
}

/** Handoff a la app de mapas del sistema, como ya hace `/profesional/emergencias`. */
export function externalMapsUrl({ lat, lng }) {
  return `https://maps.google.com/?q=${lat},${lng}&navigate=yes`
}
