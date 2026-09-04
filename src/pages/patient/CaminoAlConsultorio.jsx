import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Map, Marker, Source, Layer } from 'react-map-gl/mapbox'
import 'mapbox-gl/dist/mapbox-gl.css'
import { ArrowLeft, NavigationArrow, MapPin, Car, PersonSimpleWalk, CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { consultationsService, perfilDelProfesional } from '../../services/consultationsService'
import { arrivalsService, enVentanaDeLlegada } from '../../services/arrivalsService'
import { getRoute, formatMeters, formatMinutes, externalMapsUrl, TRAVEL_MODES } from '../../lib/directions'
import { haversineKm } from '../../lib/geo'
import { toast } from '../../components/Toast'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN

/*
 * Cada cuánto se recalcula la ruta y cada cuánto se le publica al profesional.
 *
 * El navegador dispara `watchPosition` muchas veces por minuto; pedirle una
 * ruta a Mapbox en cada una sería gratis en dinero pero no en batería, y le
 * haría temblar el ETA al paciente. Se recalcula cuando el movimiento es real
 * (más de 80 m) o cuando pasó medio minuto — lo que llegue primero.
 */
const RECALCULO_METROS = 80
const RECALCULO_MS = 30_000
const PUBLICACION_MS = 20_000

/** Adentro de este radio el paciente ya está en la puerta. */
const RADIO_LLEGADA_METROS = 120

const ICONO_MODO = { driving: Car, walking: PersonSimpleWalk }

function Punto({ tono = 'brand' }) {
  return (
    <div className="relative flex items-center justify-center w-16 h-16 pointer-events-none">
      <div className={`absolute w-16 h-16 rounded-full animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite] ${tono === 'brand' ? 'bg-brand/25' : 'bg-brand-secondary/25'}`} />
      <div className={`w-5 h-5 rounded-full border-[3px] border-white shadow-lg relative z-10 ${tono === 'brand' ? 'bg-brand' : 'bg-brand-secondary'}`} />
    </div>
  )
}

function Consultorio() {
  return (
    <div className="flex flex-col items-center">
      <div className="w-11 h-11 bg-white rounded-full flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.18)] border-2 border-white">
        <MapPin className="w-6 h-6 text-brand" weight="fill" />
      </div>
      <div className="w-2 h-1.5 bg-black/20 rounded-[100%] mt-1 blur-[1px]" />
    </div>
  )
}

export default function CaminoAlConsultorio({ profile }) {
  const { consultationId } = useParams()
  const navigate = useNavigate()

  const [consultation, setConsultation] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [posicion, setPosicion] = useState(null)          // {lat, lng}
  const [errorUbicacion, setErrorUbicacion] = useState('')
  const [ruta, setRuta] = useState(null)                  // {coordinates, durationMin, distanceMeters}
  const [errorRuta, setErrorRuta] = useState('')
  const [modo, setModo] = useState('driving')
  const [llegado, setLlegado] = useState(false)

  const mapRef = useRef(null)
  const ultimoCalculo = useRef({ pos: null, at: 0 })
  const ultimaPublicacion = useRef(0)
  const encuadrado = useRef(false)

  useEffect(() => {
    if (!consultationId) return
    consultationsService.getById(consultationId)
      .then(setConsultation)
      .catch(() => toast.error('No pudimos cargar el turno'))
      .finally(() => setCargando(false))
  }, [consultationId])

  const perfilPro = perfilDelProfesional(consultation)
  const destino = useMemo(() => (
    perfilPro?.latitude != null && perfilPro?.longitude != null
      ? { lat: Number(perfilPro.latitude), lng: Number(perfilPro.longitude) }
      : null
  ), [perfilPro?.latitude, perfilPro?.longitude])

  const direccion = perfilPro?.address ?? null
  const proNombre = consultation?.professional?.fullName ?? 'tu profesional'
  const scheduledAt = consultation?.scheduledAt

  /* Seguimiento en vivo. Se corta solo al desmontar — no queda el GPS prendido. */
  useEffect(() => {
    if (!navigator.geolocation) {
      setErrorUbicacion('Este navegador no puede darnos tu ubicación')
      return
    }
    const id = navigator.geolocation.watchPosition(
      pos => {
        setErrorUbicacion('')
        setPosicion({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      err => setErrorUbicacion(
        err.code === err.PERMISSION_DENIED
          ? 'Necesitamos tu ubicación para trazar el camino. Activala en el candado de la barra de direcciones.'
          : 'No pudimos obtener tu ubicación',
      ),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  /* Recálculo de la ruta, con el freno de mano explicado arriba. */
  useEffect(() => {
    if (!posicion || !destino) return
    const ahora = Date.now()
    const previa = ultimoCalculo.current
    const movidoM = previa.pos ? haversineKm(previa.pos, posicion) * 1000 : Infinity
    const debeRecalcular = !previa.pos || movidoM > RECALCULO_METROS || ahora - previa.at > RECALCULO_MS
    if (!debeRecalcular) return

    ultimoCalculo.current = { pos: posicion, at: ahora }
    const ctrl = new AbortController()
    getRoute(posicion, destino, modo, ctrl.signal)
      .then(r => {
        if (r) { setRuta(r); setErrorRuta('') }
        else setErrorRuta('No encontramos un camino para esa opción')
      })
      .catch(e => { if (e.name !== 'AbortError') setErrorRuta('No pudimos calcular el camino') })
    return () => ctrl.abort()
  }, [posicion, destino, modo])

  /* Cambiar de modo recalcula ya, sin esperar a moverse. */
  useEffect(() => { ultimoCalculo.current = { pos: null, at: 0 } }, [modo])

  const distanciaDirectaM = useMemo(() => (
    posicion && destino ? haversineKm(posicion, destino) * 1000 : null
  ), [posicion, destino])

  /* Encuadre inicial: los dos puntos a la vez, no sólo el paciente. */
  useEffect(() => {
    if (encuadrado.current || !mapRef.current || !posicion || !destino) return
    mapRef.current.fitBounds(
      [[Math.min(posicion.lng, destino.lng), Math.min(posicion.lat, destino.lat)],
       [Math.max(posicion.lng, destino.lng), Math.max(posicion.lat, destino.lat)]],
      { padding: { top: 140, bottom: 260, left: 60, right: 60 }, duration: 900 },
    )
    encuadrado.current = true
  }, [posicion, destino])

  /*
   * Publicación al profesional. Sólo dentro de la ventana del turno: fuera de
   * ella el paciente ve su mapa igual, pero no se guarda su posición en ningún
   * lado. Es la diferencia entre "una herramienta para llegar" y "una app que
   * te sigue".
   */
  const compartiendo = enVentanaDeLlegada(scheduledAt) && !llegado
  useEffect(() => {
    if (!compartiendo || !posicion || !consultation || !profile?.id) return
    const ahora = Date.now()
    if (ahora - ultimaPublicacion.current < PUBLICACION_MS) return
    ultimaPublicacion.current = ahora
    arrivalsService.publicar({
      consultationId: consultation.id,
      patientId: profile.id,
      professionalId: consultation.professionalId,
      lat: posicion.lat,
      lng: posicion.lng,
      etaMinutes: ruta?.durationMin ?? null,
      distanceMeters: ruta?.distanceMeters ?? null,
      travelMode: modo,
    }).catch(() => {/* que falle una publicación no rompe la navegación */})
  }, [compartiendo, posicion, ruta, modo, consultation, profile?.id])

  /* Al salir de la pantalla se deja de compartir — nada queda latiendo. */
  useEffect(() => () => {
    if (consultationId) arrivalsService.dejarDeCompartir(consultationId).catch(() => {})
  }, [consultationId])

  const marcarLlegada = useCallback(async () => {
    setLlegado(true)
    try {
      if (posicion && consultation && profile?.id) {
        await arrivalsService.publicar({
          consultationId: consultation.id,
          patientId: profile.id,
          professionalId: consultation.professionalId,
          lat: posicion.lat,
          lng: posicion.lng,
          etaMinutes: 0,
          distanceMeters: 0,
          travelMode: modo,
          status: 'llegado',
        })
      }
      toast.success(`Le avisamos a ${proNombre} que ya llegaste`)
    } catch {
      toast.error('No pudimos avisar que llegaste')
    }
  }, [posicion, consultation, profile?.id, modo, proNombre])

  const cerca = distanciaDirectaM != null && distanciaDirectaM < RADIO_LLEGADA_METROS

  /* Sin coordenadas del consultorio no hay ruta posible: se dice, no se finge. */
  if (!cargando && !destino) {
    return (
      <div className="absolute inset-0 bg-bg-primary flex flex-col">
        <header className="flex items-center gap-3 px-5 pt-6 pb-4">
          <button onClick={() => navigate(-1)} className="w-10 h-10 rounded-full bg-white border border-border-default flex items-center justify-center">
            <ArrowLeft className="w-5 h-5 text-text-primary" />
          </button>
          <h1 className="text-[18px] font-bold text-text-primary">Cómo llegar</h1>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-3">
          <WarningCircle className="w-12 h-12 text-text-tertiary" />
          <p className="text-[15px] font-semibold text-text-primary">Todavía no tenemos la ubicación del consultorio</p>
          <p className="text-[13px] text-text-secondary">
            {direccion
              ? <>La dirección es <span className="font-semibold text-text-primary">{direccion}</span>, pero no está ubicada en el mapa.</>
              : <>{proNombre} todavía no cargó la dirección de su consultorio.</>}
          </p>
          {direccion && (
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(direccion)}`}
              target="_blank" rel="noopener noreferrer"
              className="mt-2 px-6 py-3 rounded-full bg-brand text-white font-bold text-[14px]"
            >
              Buscarla en Google Maps
            </a>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 bg-[#E5E3DF] overflow-hidden">
      {destino && (
        <Map
          ref={mapRef}
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={{ longitude: destino.lng, latitude: destino.lat, zoom: 14 }}
          mapStyle="mapbox://styles/mapbox/light-v11"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          attributionControl={{ compact: true }}
        >
          {ruta?.coordinates?.length > 1 && (
            <Source id="ruta" type="geojson" data={{ type: 'Feature', geometry: { type: 'LineString', coordinates: ruta.coordinates } }}>
              <Layer id="ruta-halo" type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{ 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9 }} />
              <Layer id="ruta-linea" type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{ 'line-color': '#7CB38B', 'line-width': 5 }} />
            </Source>
          )}

          <Marker longitude={destino.lng} latitude={destino.lat} anchor="bottom">
            <Consultorio />
          </Marker>

          {posicion && (
            <Marker longitude={posicion.lng} latitude={posicion.lat} anchor="center">
              <Punto tono={llegado ? 'coral' : 'brand'} />
            </Marker>
          )}
        </Map>
      )}

      {/* Volver */}
      <div className="absolute top-4 left-5 z-20 sm:top-6">
        <button
          onClick={() => navigate(-1)}
          className="w-11 h-11 rounded-full bg-white/90 backdrop-blur-[20px] border border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.1)] flex items-center justify-center active:scale-95 transition-transform"
          aria-label="Volver"
        >
          <ArrowLeft className="w-5 h-5 text-text-primary" />
        </button>
      </div>

      {/* Recentrar */}
      <div className="absolute top-4 right-5 z-20 sm:top-6">
        <button
          onClick={() => posicion && mapRef.current?.flyTo({ center: [posicion.lng, posicion.lat], zoom: 15, duration: 600 })}
          className="w-11 h-11 rounded-full bg-white/90 backdrop-blur-[20px] border border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.1)] flex items-center justify-center active:scale-95 transition-transform"
          aria-label="Centrar en mi ubicación"
        >
          <NavigationArrow className="w-5 h-5 text-brand" weight="fill" />
        </button>
      </div>

      {/* Panel inferior */}
      <div className="absolute inset-x-0 bottom-0 z-20 p-4 pb-6 sm:left-4 sm:bottom-6 sm:w-[380px] sm:p-0">
        <div className="bg-white/95 backdrop-blur-[20px] border border-white/80 rounded-[28px] shadow-[0_8px_30px_rgba(0,0,0,0.12)] p-5 flex flex-col gap-4">

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">
                {llegado ? 'Llegaste' : 'Camino al consultorio'}
              </p>
              <p className="text-[28px] font-black text-text-primary leading-tight">
                {llegado ? '¡Ya estás!' : formatMinutes(ruta?.durationMin)}
              </p>
              <p className="text-[13px] text-text-secondary mt-0.5 truncate">
                {llegado
                  ? `${proNombre} ya sabe que llegaste`
                  : <>{formatMeters(ruta?.distanceMeters ?? distanciaDirectaM)} · {direccion ?? proNombre}</>}
              </p>
            </div>
            {!llegado && (
              <div className="flex gap-1 bg-bg-primary rounded-full p-1 flex-shrink-0">
                {TRAVEL_MODES.map(m => {
                  const Icono = ICONO_MODO[m.id]
                  const activo = modo === m.id
                  return (
                    <button
                      key={m.id}
                      onClick={() => setModo(m.id)}
                      aria-label={m.label}
                      className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${activo ? 'bg-brand text-white' : 'text-text-tertiary'}`}
                    >
                      <Icono className="w-5 h-5" weight={activo ? 'fill' : 'regular'} />
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {compartiendo && !llegado && (
            <p className="text-[12px] text-text-secondary flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-brand animate-pulse" />
              {proNombre} está viendo cuánto te falta
            </p>
          )}

          {errorUbicacion && (
            <p className="text-[12px] text-danger">{errorUbicacion}</p>
          )}
          {!errorUbicacion && errorRuta && (
            <p className="text-[12px] text-text-secondary">{errorRuta}</p>
          )}

          <div className="flex flex-col gap-2">
            {!llegado && (
              <button
                onClick={marcarLlegada}
                disabled={!cerca}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-full font-bold text-[15px] text-white bg-brand hover:bg-brand-hover disabled:bg-gray-200 disabled:text-text-tertiary transition-all active:scale-95"
              >
                <CheckCircle className="w-5 h-5" weight="fill" />
                {cerca ? 'Ya llegué' : 'Avisar cuando llegues'}
              </button>
            )}
            <a
              href={externalMapsUrl(destino ?? { lat: 0, lng: 0 })}
              target="_blank" rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full font-bold text-[15px] text-brand border-2 border-brand hover:bg-brand/5 transition-all active:scale-95"
            >
              <NavigationArrow className="w-5 h-5" />
              Abrir en Google Maps
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
