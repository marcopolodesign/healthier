/**
 * La dirección del S.O.S. (migración 211, Mateo 2026-10-22: "GPS + dirección
 * escrita"). Puerto 1:1 de `mobile/src/lib/direccionEmergencia.ts` — si cambia
 * una regla acá, cambia allá.
 *
 *  - Se precarga con una dirección guardada si está cerca del GPS (trae piso y
 *    referencias); si no, con la del GPS por geocodificación inversa; sin GPS,
 *    con la guardada principal.
 *  - El punto del mapa sale de la dirección confirmada si el paciente la
 *    escribió o eligió (geocodificada); si no la tocó, del GPS.
 *  - Nada de esto frena una emergencia: cada llamada a Mapbox tiene tope de
 *    tiempo y, si falla, se sigue con el GPS y el texto tal cual.
 */
import { haversineKm } from './geo'

const TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
export const TOPE_GEOCODIFICACION_MS = 4000
export const RADIO_GUARDADA_M = 200
export const DIFERENCIA_AVISO_M = 300
export const LARGO_MAX = { direccion: 300, piso: 60, referencias: 500 }

function conTope(promesa, ms = TOPE_GEOCODIFICACION_MS) {
  return Promise.race([promesa, new Promise(r => setTimeout(() => r(null), ms))]).catch(() => null)
}

const metros = (a, b) => {
  const km = haversineKm(a, b)
  return km == null ? null : km * 1000
}

/** Punto → "Calle 123, Barrio". `null` si Mapbox no la encuentra. */
export async function direccionDelPunto(p) {
  if (!TOKEN || !p) return null
  return conTope((async () => {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${p.lng},${p.lat}.json`
      + `?types=address&language=es&limit=1&access_token=${TOKEN}`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = await res.json()
    const f = json?.features?.[0]
    if (!f) return null
    const barrio = (f.context ?? []).find(c => c.id?.startsWith('neighborhood') || c.id?.startsWith('locality'))
    const calle = f.address ? `${f.text} ${f.address}` : f.text
    return barrio?.text ? `${calle}, ${barrio.text}` : (calle ?? null)
  })())
}

/** Dirección escrita → punto, sesgado hacia el GPS. `null` si no la ubica. */
export async function geocodificarDireccion(texto, cerca) {
  const q = texto?.trim()
  if (!TOKEN || !q || q.length < 4) return null
  const params = new URLSearchParams({
    access_token: TOKEN, country: 'ar', language: 'es', limit: '1', types: 'address,poi',
    ...(cerca ? { proximity: `${cerca.lng},${cerca.lat}` } : {}),
  })
  return conTope((async () => {
    const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?${params}`)
    if (!res.ok) return null
    const json = await res.json()
    const c = json?.features?.[0]?.center
    return Array.isArray(c) && c.length === 2 ? { lat: Number(c[1]), lng: Number(c[0]) } : null
  })())
}

/** Lo que se precarga en la card. `guardadas`: `{ etiqueta, direccion, pisoDepto, referencias, lat, lng }`. */
export async function direccionPrecargada(gps, guardadas) {
  const desdeGuardada = (g, punto) => ({
    direccion: g.direccion, piso: g.pisoDepto ?? '', referencias: g.referencias ?? '',
    fuente: 'guardada', etiqueta: g.etiqueta ?? null, punto,
  })
  if (gps) {
    const cercana = guardadas.find(g => g.lat != null && g.lng != null && metros(gps, { lat: g.lat, lng: g.lng }) <= RADIO_GUARDADA_M)
    if (cercana) return desdeGuardada(cercana, { lat: cercana.lat, lng: cercana.lng })
    const texto = await direccionDelPunto(gps)
    return { direccion: texto ?? '', piso: '', referencias: '', fuente: texto ? 'gps' : 'ninguna', punto: gps }
  }
  const principal = guardadas[0]
  if (principal) return desdeGuardada(principal, principal.lat != null && principal.lng != null ? { lat: principal.lat, lng: principal.lng } : null)
  return { direccion: '', piso: '', referencias: '', fuente: 'ninguna', punto: null }
}

/** La etiqueta gris debajo de la dirección (copy revisado por Felipe). */
export function etiquetaFuente(d, buscando, conGps) {
  if (buscando) return 'Buscando tu ubicación…'
  if (!d) return null
  switch (d.fuente) {
    case 'gps': return 'Según tu ubicación · revisá la altura'
    case 'guardada': return conGps && d.etiqueta ? `${d.etiqueta} · tu dirección guardada` : 'Tu dirección guardada'
    case 'escrita': return 'Escrita por vos'
    default: return null
  }
}

/** Si la dirección es del paciente y no tiene punto, se la busca; si no aparece, `sinUbicar`. */
export async function conPunto(d, gps) {
  if (d.punto || d.sinUbicar || (d.fuente !== 'escrita' && d.fuente !== 'guardada') || !d.direccion.trim()) return d
  const punto = await geocodificarDireccion(d.direccion, gps)
  return { ...d, punto, sinUbicar: !punto }
}

/** Las columnas de `emergencies` (snake_case). */
export function columnasDeUbicacion(gps, d) {
  // Sólo la dirección del paciente (escrita o guardada) manda sobre el GPS.
  const usarDireccion = !!d && (d.fuente === 'escrita' || d.fuente === 'guardada') && !!d.punto
  const punto = usarDireccion ? d.punto : gps
  return {
    patient_latitude: punto?.lat ?? null,
    patient_longitude: punto?.lng ?? null,
    direccion: d?.direccion.trim().slice(0, LARGO_MAX.direccion) || null,
    direccion_piso: d?.piso.trim().slice(0, LARGO_MAX.piso) || null,
    direccion_referencias: d?.referencias.trim().slice(0, LARGO_MAX.referencias) || null,
    gps_latitude: gps?.lat ?? null,
    gps_longitude: gps?.lng ?? null,
    ubicacion_origen: punto ? (usarDireccion ? 'direccion' : 'gps') : null,
  }
}

/** Pedido que ya existe: no borrar el punto ni el GPS que tenía si esta vez no hay. */
export function sinPisarPunto(cols) {
  const c = { ...cols }
  if (c.patient_latitude == null) { delete c.patient_latitude; delete c.patient_longitude; delete c.ubicacion_origen }
  if (c.gps_latitude == null) { delete c.gps_latitude; delete c.gps_longitude }
  return c
}

/** "Av. Libertador 7766, Núñez · 4 B" */
export function direccionCorta(e) {
  if (!e?.direccion) return null
  return e.direccionPiso ? `${e.direccion} · ${e.direccionPiso}` : e.direccion
}

/** Metros entre el GPS crudo y el punto usado, si el punto salió de la dirección. */
export function distanciaGpsDireccion(e) {
  if (e?.ubicacionOrigen !== 'direccion' || e.gpsLatitude == null || e.patientLatitude == null) return null
  return metros(
    { lat: Number(e.gpsLatitude), lng: Number(e.gpsLongitude) },
    { lat: Number(e.patientLatitude), lng: Number(e.patientLongitude) },
  )
}
