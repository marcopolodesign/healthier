import { useEffect, useRef, useState } from 'react'
import { emergencyTrackingService } from '../services/emergencyTrackingService'
import { getRoute } from '../lib/directions'
import { haversineKm } from '../lib/geo'

/**
 * El profesional despachado comparte dónde está mientras va hacia el paciente.
 * Espejo de lo que hace `consultation/camino` del lado del paciente, con los
 * mismos frenos y por el mismo motivo: el GPS dispara muchas veces por minuto
 * y pedir una ruta en cada una gasta batería y le hace temblar el ETA a quien
 * lo está mirando. La diferencia es que acá el que mira tiene una emergencia,
 * así que se publica más seguido.
 *
 * Mismos números que la app (`mobile/app/(pro)/emergencia.tsx`): si cambian
 * acá, cambian allá.
 */
const RECALCULO_METROS = 80
const RECALCULO_MS = 30_000
const PUBLICACION_MS = 10_000

/**
 * @param {object}  args
 * @param {boolean} args.activo           sólo se comparte cuando el profesional dijo que va en camino
 * @param {string}  args.emergencyId
 * @param {string}  args.professionalId
 * @param {string}  args.patientId
 * @param {{lat:number,lng:number}|null} args.destino  dónde está el paciente
 */
export function useCompartirUbicacionEmergencia({ activo, emergencyId, professionalId, patientId, destino }) {
  const [posicion, setPosicion] = useState(null)
  const [ruta, setRuta] = useState(null)
  const [error, setError] = useState('')

  const ultimoCalculo = useRef({ pos: null, at: 0 })
  const ultimaPublicacion = useRef({ at: 0, eta: undefined })

  /* Seguimiento del GPS. Se corta al desactivarse: nada queda latiendo. */
  useEffect(() => {
    if (!activo) return
    if (!navigator.geolocation) {
      setError('Este navegador no puede compartir tu ubicación. Abrí la app para que el paciente te vea.')
      return
    }
    const id = navigator.geolocation.watchPosition(
      pos => {
        setError('')
        setPosicion({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      () => setError('Sin permiso de ubicación el paciente no puede ver dónde estás.'),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [activo])

  /* Recálculo de la ruta, con el freno explicado arriba. */
  useEffect(() => {
    if (!activo || !posicion || !destino) return
    const ahora = Date.now()
    const previa = ultimoCalculo.current
    const movidoM = previa.pos ? haversineKm(previa.pos, posicion) * 1000 : Infinity
    if (previa.pos && movidoM <= RECALCULO_METROS && ahora - previa.at <= RECALCULO_MS) return

    ultimoCalculo.current = { pos: posicion, at: ahora }
    const ctrl = new AbortController()
    getRoute(posicion, destino, 'driving', ctrl.signal)
      .then(r => { if (r) setRuta(r) })
      .catch(() => {/* sin ruta se publica igual la posición cruda */})
    return () => ctrl.abort()
  }, [activo, posicion, destino])

  /*
   * Publicación. El freno es por tiempo, PERO un ETA nuevo pasa igual: la ruta
   * llega después que la primera posición, y con el freno a secas el paciente
   * veía "en camino" sin ningún minuto hasta la publicación siguiente.
   */
  useEffect(() => {
    if (!activo || !posicion || !emergencyId || !professionalId || !patientId) return
    const ahora = Date.now()
    const previa = ultimaPublicacion.current
    const etaNuevo = ruta?.durationMin ?? null
    if (ahora - previa.at < PUBLICACION_MS && etaNuevo === previa.eta) return
    ultimaPublicacion.current = { at: ahora, eta: etaNuevo }
    emergencyTrackingService.publicar({
      emergencyId,
      professionalId,
      patientId,
      lat: posicion.lat,
      lng: posicion.lng,
      etaMinutes: ruta?.durationMin ?? null,
      distanceMeters: ruta?.distanceMeters ?? null,
    }).catch(() => {/* una publicación perdida no rompe el traslado */})
  }, [activo, posicion, ruta, emergencyId, professionalId, patientId])

  return { posicion, ruta, error, compartiendo: activo && !!posicion && !error }
}

export default useCompartirUbicacionEmergencia
