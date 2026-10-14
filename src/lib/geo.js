// Great-circle distance in km between two { lat, lng } points.
// Returns null when either point is missing coordinates — callers must treat
// null as "unknown" and hide the distance rather than invent one.
export function haversineKm(a, b) {
  if (!a || !b) return null
  const lat1 = a.lat ?? a.latitude
  const lng1 = a.lng ?? a.longitude
  const lat2 = b.lat ?? b.latitude
  const lng2 = b.lng ?? b.longitude
  if ([lat1, lng1, lat2, lng2].some(v => v == null || Number.isNaN(Number(v)))) return null

  const R = 6371
  const toRad = deg => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Human-readable distance in es-AR. Returns null for unknown distances so the
// caller can omit the phrase entirely instead of rendering a placeholder.
export function formatDistance(km) {
  if (km == null || Number.isNaN(km)) return null
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km.toFixed(1).replace('.', ',')} km`
}

// Nominatim pide un pedido por segundo; pasado eso bloquea la IP un rato y el
// browser lo ve como "Failed to fetch" (sin CORS), igual que una dirección que
// no existe. Autocompletar + guardar en ráfaga lo disparaba y la dirección
// quedaba "sin ubicar" por un bloqueo, no por la dirección (2026-10-14, probado
// en staging). Todos los pedidos de la página hacen cola acá.
// Node (scripts y tests) sí tiene que identificarse; el browser no puede ni debe.
const HEADERS_SERVIDOR = typeof window === 'undefined'
  ? { 'User-Agent': 'Healthier-MVP/1.0 (mateoaldao@gmail.com)' }
  : undefined
const ESPERA_NOMINATIM_MS = 1100
let ultimoPedido = 0
let cola = Promise.resolve()
const abortado = () => new DOMException('Aborted', 'AbortError')

/**
 * Cola en serie: cada pedido sale 1,1 s después del anterior. Un pedido
 * cancelado (el autocompletado cancela el de cada tecla) sale de la cola sin
 * reservar ni hacer esperar a nadie — si reservara turno, tipear 70 letras
 * dejaba el guardado esperando un minuto (visto en staging).
 */
function turnoNominatim(signal) {
  const mio = cola.then(async () => {
    if (signal?.aborted) throw abortado()
    const espera = ultimoPedido + ESPERA_NOMINATIM_MS - Date.now()
    if (espera > 0) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, espera)
        signal?.addEventListener('abort', () => { clearTimeout(t); reject(abortado()) }, { once: true })
      })
    }
    ultimoPedido = Date.now()
  })
  cola = mio.catch(() => {})
  return mio
}

// Nominatim address autocomplete — Argentine addresses only.
// Returns [{ displayName, lat, lng }]
export async function searchAddresses(query, signal) {
  if (!query || query.trim().length < 3) return []
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    countrycodes: 'ar',
    limit: '5',
    addressdetails: '1',
    // Por query y no por header: un header propio (User-Agent) vuelve el pedido
    // "no simple" para CORS, el browser manda un preflight y Nominatim lo rechaza
    // a ratos — "Failed to fetch" en 20 ms, que se leía como "no existe"
    // (staging, 2026-10-14). Nominatim identifica al sitio por el Referer.
    'accept-language': 'es',
  })
  await turnoNominatim(signal)
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    { signal, headers: HEADERS_SERVIDOR }
  )
  if (!res.ok) return []
  const data = await res.json()
  return data.map(item => ({
    displayName: item.display_name,
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
  }))
}

/**
 * Versiones de una dirección tipeada a mano para probar contra Nominatim, que
 * es estricto: "Arenales 3709 1A Palermo" no aparece y "Arenales 3709,
 * Palermo" sí. Se prueban en orden y todas salen de la misma dirección — no se
 * inventa nada (2026-09-30, con las direcciones reales que no se ubicaban).
 *
 * Cada candidata es `{ q, exigir? }`. `exigir` es una zona de la misma
 * dirección (barrio, localidad) que tiene que aparecer en el resultado: las
 * versiones recortadas ("Zárate 99, Villa Progreso", sin la localidad) podrían
 * caer en otra ciudad si Nominatim devolviera cualquier "Zárate 99", y una
 * ubicación equivocada es peor que ninguna.
 */
const CP_AR = /^(?:[A-Z]\d{4}[A-Z]{3}|CP\.?\s*\d{4}|\d{4})$/i
const PAIS_O_PROVINCIA = /^(?:argentina|república argentina|republica argentina|provincia de buenos aires)$|\bprovince\b$/i

/** Sin acentos ni mayúsculas, para comparar zonas. */
export const sinAcentos = t =>
  String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Parte la dirección en calle + zonas, quitando lo que Google Places agrega y
 * Nominatim no entiende: el CP ("B1502HQG", "CP 1502", "1502"), "Buenos Aires
 * Province", "Argentina". Entiende el nombre doble de las calles numeradas del
 * conurbano ("Calle 99 - Zárate Villa Progreso" = "Zárate 99" en el barrio
 * Villa Progreso).
 */
export function partesDeDireccion(direccion) {
  const partes = String(direccion ?? '')
    .split(',')
    .map((p, i) => {
      const t = p.replace(/\s+/g, ' ').trim()
      if (i === 0) return t
      // "Cdad. Autónoma de Buenos Aires" es "Buenos Aires" para Nominatim.
      return t.replace(/^[A-Z]\d{4}[A-Z]{3}\s+/, '').replace(/^(?:cdad|ciudad)\.?\s+aut[oó]noma de buenos aires$/i, 'Buenos Aires')
    })
    .filter((p, i) => p && (i === 0 || (!CP_AR.test(p) && !PAIS_O_PROVINCIA.test(p))))
  if (partes.length === 0) return { calles: [], zonas: [] }
  const [calle, ...resto] = partes
  const doble = calle.match(/^(?:calle|cl\.?)?\s*(\d{1,4})\s*[-–—]\s*(.+)$/i)
  if (!doble) return { calles: [calle], zonas: resto }
  const [, numero, nombres] = doble
  const palabras = nombres.split(/\s+/)
  const calles = []
  const zonas = []
  // "Zárate Villa Progreso": el nombre es la primera palabra y lo demás el
  // barrio; si el nombre fuera de dos palabras ("Doctor Zárate"), el segundo intento.
  for (let k = 1; k <= (palabras.length >= 4 ? 2 : 1); k++) {
    calles.push(`${palabras.slice(0, k).join(' ')} ${numero}`)
    zonas.push(palabras.slice(k).join(' '))
  }
  return { calles, zonas, resto, doble: true }
}

export function candidatasDeDireccion(direccion) {
  const original = direccion?.trim() ?? ''
  const normalizada = original
    .replace(/\bGral\.?\s/gi, 'General ')
    .replace(/\bPte\.?\s/gi, 'Presidente ')
    // piso / depto / oficina hasta la próxima coma
    .replace(/\s*\b(piso|p\.|dto\.?|depto\.?|departamento|of\.?|oficina|local)\s*[^,]*/gi, '')
    // "3709 1A" / "3709 4° B": la unidad pegada a la altura
    .replace(/(\d{2,5})\s+\d{0,2}\s*°?\s*[A-Za-z]\b/, '$1')
    // "Arenales 3709 Palermo" → "Arenales 3709, Palermo"
    .replace(/(\D\s\d{2,5})\s+(?=[A-Za-zÁÉÍÓÚáéíóúÑñ])/, '$1, ')
    // "Ramallo Buenos Aires" → "Ramallo, Buenos Aires"
    .replace(/([^,\s])\s+(Buenos Aires|CABA|Capital Federal)\s*$/i, '$1, $2')
    .replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').replace(/[.,\s]+$/, '')
  const variantes = [original, normalizada, normalizada.split(',').slice(0, 2).join(',').trim()]
  if (!/buenos aires|caba|capital federal/i.test(normalizada)) variantes.push(`${normalizada}, Buenos Aires`)
  const candidatas = [...new Set(variantes.filter(v => v.length >= 3))].map(q => ({ q }))

  // Las de abajo recortan la dirección, así que exigen su zona en el resultado.
  const { calles, zonas, doble, resto } = partesDeDireccion(original)
  const agregar = (q, exigir) => {
    if (q.length >= 3 && !candidatas.some(c => c.q === q)) candidatas.push(exigir ? { q, exigir } : { q })
  }
  if (doble) {
    calles.forEach((calle, i) => {
      const barrio = zonas[i]
      if (!barrio) return
      if (resto.length) agregar(`${calle}, ${barrio}, ${resto[0]}`)
      agregar(`${calle}, ${barrio}`, barrio)
    })
    calles.forEach(calle => resto.forEach(z => agregar(`${calle}, ${z}`, z)))
  } else if (calles[0]) {
    // La misma dirección sin CP / provincia, y con cada zona por separado
    // (localidad o partido) — nunca con una que no esté escrita.
    const limpia = [calles[0], ...zonas].join(', ')
    if (zonas.length) agregar(limpia)
    zonas.forEach(z => agregar(`${calles[0]}, ${z}`, z))
  }
  return candidatas.slice(0, 8)
}

export function variantesDeDireccion(direccion) {
  return candidatasDeDireccion(direccion).map(c => c.q)
}

// Geocode a single address string — returns { lat, lng } or null.
// El ritmo de Nominatim lo cuida `turnoNominatim`; un pedido que falla por red
// (bloqueo momentáneo) se reintenta una vez antes de pasar a la siguiente.
export async function geocodeAddress(address) {
  if (!address || address.trim().length < 3) return null
  for (const { q, exigir } of candidatasDeDireccion(address)) {
    let results = null
    for (let intento = 0; intento < 2 && results === null; intento++) {
      try {
        results = await searchAddresses(q)
      } catch {
        await new Promise(r => setTimeout(r, 2500))
      }
    }
    if (!results) continue
    const hit = exigir
      ? results.find(r => sinAcentos(r.displayName).includes(sinAcentos(exigir)))
      : results[0]
    if (hit) return { lat: hit.lat, lng: hit.lng }
  }
  return null
}

// Nominatim reverse geocode — returns a short street address string.
export async function reverseGeocode(lat, lng) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
  )
  if (!res.ok) return null
  const data = await res.json()
  const street = data.address?.road || data.address?.suburb || data.address?.city || null
  const num = data.address?.house_number ? ` ${data.address.house_number}` : ''
  return street ? `${street}${num}` : null
}

/**
 * La dirección del profesional con sus coordenadas, geocodificándola si el
 * que la cargó la tipeó sin elegir una sugerencia (`AddressAutocomplete` pone
 * lat/lng en null al tipear). Sin coordenadas el profesional no aparece en el
 * mapa del paciente, así que cada lugar donde se guarda la dirección pasa por
 * acá (perfil del profesional y super admin, 2026-09-30).
 *
 * Si no se puede ubicar, devuelve la dirección con lat/lng en null: la
 * dirección igual sirve para recetar, y el aviso del panel le pide revisarla.
 */
export async function conCoordenadas({ address, latitude = null, longitude = null }) {
  const limpia = address?.trim() || null
  if (!limpia) return { address: null, latitude: null, longitude: null }
  if (latitude != null && longitude != null) return { address: limpia, latitude, longitude }
  const geo = await geocodeAddress(limpia)
  return { address: limpia, latitude: geo?.lat ?? null, longitude: geo?.lng ?? null }
}
