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
  })
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    {
      signal,
      headers: {
        'User-Agent': 'Healthier-MVP/1.0 (mateoaldao@gmail.com)',
        'Accept-Language': 'es',
      },
    }
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
 */
export function variantesDeDireccion(direccion) {
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
  return [...new Set(variantes.filter(v => v.length >= 3))]
}

// Geocode a single address string — returns { lat, lng } or null.
export async function geocodeAddress(address) {
  if (!address || address.trim().length < 3) return null
  for (const q of variantesDeDireccion(address)) {
    try {
      const results = await searchAddresses(q)
      if (results.length > 0) return { lat: results[0].lat, lng: results[0].lng }
    } catch {
      return null
    }
  }
  return null
}

// Nominatim reverse geocode — returns a short street address string.
export async function reverseGeocode(lat, lng) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
    { headers: { 'User-Agent': 'Healthier-MVP/1.0 (mateoaldao@gmail.com)' } }
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
