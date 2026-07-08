// Meters per pixel at a given zoom level for a given latitude
function metersPerPixel(lat, zoom) {
  return (156543.03 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom)
}

// Project a professional's real lat/lng onto the iframe overlay pixel grid.
// Returns { x, y } offset in pixels relative to the user's position (center).
// zoom must match the Google Maps iframe zoom parameter (currently 15).
export function latLngToPixel(user, pro, zoom = 15) {
  const mpp = metersPerPixel(user.lat, zoom)
  const dLat = (pro.latitude - user.lat) * 111320
  const dLng =
    (pro.longitude - user.lng) *
    111320 *
    Math.cos((user.lat * Math.PI) / 180)
  return { x: dLng / mpp, y: -dLat / mpp }
}

// Inverse of latLngToPixel — reconstructs an approximate { lat, lng } from a
// pixel offset relative to a reference point (usually the user's location).
// Used to place real markers on an interactive map (Leaflet) when the only
// data available is a legacy pixel offset (e.g. from a fallback slot).
export function pixelToLatLng(user, { x, y }, zoom = 15) {
  const mpp = metersPerPixel(user.lat, zoom)
  const dLat = (-y * mpp) / 111320
  const dLng = (x * mpp) / (111320 * Math.cos((user.lat * Math.PI) / 180))
  return { lat: user.lat + dLat, lng: user.lng + dLng }
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

// Geocode a single address string — returns { lat, lng } or null.
export async function geocodeAddress(address) {
  if (!address || address.trim().length < 3) return null
  try {
    const results = await searchAddresses(address)
    return results.length > 0 ? { lat: results[0].lat, lng: results[0].lng } : null
  } catch {
    return null
  }
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
