import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, CheckCircle, NavigationArrow, Phone, Stethoscope, SignOut, Broadcast } from '@phosphor-icons/react'
import { emergencyService, EMERGENCY_TERMINAL_STATUSES, sintomasDeEmergencia } from '../../services/emergencyService'
import { dispatchService } from '../../services/dispatchService'
import { emergencyTrackingService } from '../../services/emergencyTrackingService'
import { ordenTrasladoService, TIPOS_FOTO_ORDEN } from '../../services/ordenTrasladoService'
import { operadorService } from '../../services/operadorService'
import { useCompartirUbicacionEmergencia } from '../../hooks/useCompartirUbicacionEmergencia'
import { formatMeters, formatMinutes } from '../../lib/directions'
import { faltaParaCerrar } from '../../components/emergencias/CierreDesenlace'
import { toast } from '../../components/Toast'
import { Pantalla, Eyebrow, Titulo, Centrado, Seccion, Tarjeta, Boton, Cargando, Aviso } from './ui'

/**
 * El turno del operador, una vez entrado: guardia → en camino → llegué → cierre.
 * Sirve a las dos formas de entrar (registro del día, o como el profesional de
 * la lista): la emergencia le llega por `professional_id` igual en las dos.
 * NO muestra ganancias, verificación ni Mercado Pago, y el cierre no toca
 * `mp-capture`: el cobro va a la cuenta del prestador, no pasa por acá.
 */
export default function Turno({ profile, comoProfesional, registro }) {
  const navigate = useNavigate()
  const [emergency, setEmergency] = useState(undefined)
  const [actualizando, setActualizando] = useState(false)
  const [cerrando, setCerrando] = useState(false)
  const [atencion, setAtencion] = useState(null)
  const [saliendo, setSaliendo] = useState(false)

  // ── Carga + Realtime (mismo criterio que la pantalla de la tripulación) ──
  useEffect(() => {
    if (!profile?.id) return
    let vivo = true
    let cortarUna = () => {}
    let suscripta = false
    const alCambiar = (updated) => {
      if (EMERGENCY_TERMINAL_STATUSES.includes(updated.status)) {
        // Terminó: se suelta esa emergencia y el sondeo vuelve a buscar la siguiente.
        cortarUna(); suscripta = false; setEmergency(null)
        return
      }
      setEmergency(prev => {
        if (prev?.id !== updated.id) {
          emergencyService.getById(updated.id).then(e => vivo && setEmergency(e)).catch(() => {})
          return updated
        }
        return { ...prev, ...updated }
      })
    }
    // Sondeo de respaldo cada 8 s en guardia: si el cambio de asignación llega antes de que
    // el canal esté suscripto (o la cuenta es un profesional prestado, sin móvil propio),
    // Realtime solo no alcanza. Al encontrar una emergencia se suscribe a ella.
    const adoptar = (e) => {
      if (!vivo || !e?.id) return
      setEmergency(prev => prev ?? e)
      if (!suscripta) { suscripta = true; cortarUna = emergencyService.suscribirUna(e.id, alCambiar) }
    }
    emergencyService.getActiveParaTripulacion(profile.id)
      .then(e => { if (vivo) { setEmergency(prev => prev ?? e ?? null); adoptar(e) } })
      .catch(err => { toast.error(err?.message || 'No pudimos cargar la emergencia'); if (vivo) setEmergency(prev => prev ?? null) })
    const sondeo = setInterval(() => {
      if (suscripta) return
      emergencyService.getActiveParaTripulacion(profile.id).then(adoptar).catch(() => {})
    }, 8000)

    const cortarPropia = emergencyService.subscribe(profile.id, alCambiar)
    let cortarTripulacion = () => {}
    dispatchService.misAmbulancias(profile.id)
      .then(cs => {
        const ids = cs.map(c => c.ambulance?.id).filter(Boolean)
        if (vivo && ids.length) cortarTripulacion = emergencyService.suscribirTripulacion(ids, alCambiar)
      })
      .catch(() => {})
    return () => { vivo = false; clearInterval(sondeo); cortarPropia(); cortarTripulacion(); cortarUna() }
  }, [profile?.id])

  // Sin emergencia no hay cierre abierto (la cerró otro teléfono o el despacho).
  useEffect(() => { if (!emergency) setCerrando(false) }, [emergency])

  // Filas `dispatched` viejas (antes de la 240): ya está asignada, se pasa sola a "en camino".
  useEffect(() => {
    if (emergency?.status !== 'dispatched' || !emergency?.id) return
    emergencyService.updateStatus(emergency.id, 'in_transit')
      .then(f => setEmergency(prev => ({ ...(prev ?? {}), ...f })))
      .catch(() => {})
  }, [emergency?.id, emergency?.status])

  // Como profesional puede haber abierto la atención clínica (receta): se mira al llegar.
  useEffect(() => {
    if (!comoProfesional || emergency?.status !== 'arrived' || !emergency?.id) return
    let vivo = true
    emergencyService.getAtencion(emergency.id).then(a => vivo && setAtencion(a)).catch(() => {})
    return () => { vivo = false }
  }, [comoProfesional, emergency?.id, emergency?.status])

  const destino = emergency?.patientLatitude != null && emergency?.patientLongitude != null
    ? { lat: Number(emergency.patientLatitude), lng: Number(emergency.patientLongitude) }
    : null
  const seguimiento = useCompartirUbicacionEmergencia({
    activo: emergency?.status === 'in_transit',
    emergencyId: emergency?.id,
    professionalId: profile?.id,
    patientId: emergency?.patientId,
    destino,
  })

  const llegue = async () => {
    setActualizando(true)
    try {
      await emergencyService.updateStatus(emergency.id, 'arrived')
      setEmergency(prev => ({ ...prev, status: 'arrived' }))
      if (seguimiento.posicion) {
        emergencyTrackingService.publicar({
          emergencyId: emergency.id, professionalId: profile.id, patientId: emergency.patientId,
          lat: seguimiento.posicion.lat, lng: seguimiento.posicion.lng,
          etaMinutes: 0, distanceMeters: 0, status: 'llegado',
        }).catch(() => {})
      }
    } catch (e) {
      toast.error(e?.message || 'No pudimos avisar que llegaste')
    } finally {
      setActualizando(false)
    }
  }

  const atender = async () => {
    setActualizando(true)
    try {
      const consultaId = await emergencyService.iniciarAtencion(emergency.id)
      navigate(`/profesional/atencion/${consultaId}`)
    } catch (e) {
      toast.error(e?.message || 'No pudimos abrir la atención')
      setActualizando(false)
    }
  }

  const terminarTurno = async () => {
    setSaliendo(true)
    const { error } = await operadorService.terminarTurno()
    if (error) toast.error(error.message || 'No pudimos cerrar el turno en el servidor, pero cerramos tu sesión.')
    // Recarga completa: se va con la sesión (y lo que haya quedado en memoria).
    window.location.replace('/login')
  }

  if (emergency === undefined) return <Cargando />

  // ── 1 · Guardia ───────────────────────────────────────────────────────────
  if (!emergency) {
    return (
      <Pantalla pie={<Boton color="claro" icono={<SignOut className="w-6 h-6" />} onClick={terminarTurno} cargando={saliendo} testid="terminar-turno">Terminar turno</Boton>}>
        <Centrado
          icono={<span className="w-24 h-24 rounded-full bg-brand-light flex items-center justify-center"><CheckCircle className="w-12 h-12 text-brand-hover" weight="fill" /></span>}
          sub={comoProfesional ? `Atendés como ${profile?.fullName ?? 'el profesional'}.` : registro?.nombre ? `Hoy sale ${registro.nombre}.` : null}
          extra={<p className="flex items-center gap-2 text-text-secondary"><span className="w-2.5 h-2.5 rounded-full bg-brand animate-pulse" /> Esperando emergencia</p>}>
          En guardia
        </Centrado>
      </Pantalla>
    )
  }

  const sintomas = sintomasDeEmergencia(emergency)
  const paciente = emergency.patient?.fullName
  const telefono = emergency.patient?.phone
  const direccion = emergency.direccion || (destino ? `${destino.lat.toFixed(5)}, ${destino.lng.toFixed(5)}` : 'Ubicación no disponible')
  const sub = [emergency.direccionPiso, emergency.direccionReferencias].filter(Boolean).join(' · ')
  const mapsUrl = destino ? `https://maps.google.com/?q=${destino.lat},${destino.lng}&navigate=yes` : null

  // ── 2 · En camino ─────────────────────────────────────────────────────────
  if (emergency.status === 'in_transit' || emergency.status === 'dispatched') {
    return (
      <Pantalla pie={<Boton onClick={llegue} cargando={actualizando} testid="llegue">Llegué</Boton>}>
        <Eyebrow codigo={emergency.triageCode} despacho={emergency.dispatchCode} estado="En camino" />
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl leading-tight text-text-primary break-words" data-testid="direccion">{direccion}</h1>
          <p className="text-base text-text-secondary">
            {sub && <>{sub} · </>}
            {mapsUrl
              ? <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-danger font-semibold inline-flex items-center gap-1" data-testid="abrir-maps"><NavigationArrow className="w-4 h-4" weight="fill" />Abrir en Maps</a>
              : 'Sin coordenadas'}
          </p>
        </div>

        <Tarjeta className="flex items-center gap-6">
          {seguimiento.ruta ? (
            <>
              <div><p className="text-3xl text-text-primary">{formatMinutes(seguimiento.ruta.durationMin)}</p><p className="text-sm text-text-secondary">en auto</p></div>
              <div><p className="text-3xl text-text-primary">{formatMeters(seguimiento.ruta.distanceMeters)}</p><p className="text-sm text-text-secondary">de distancia</p></div>
            </>
          ) : (
            <p className="flex items-center gap-2 text-text-secondary"><Broadcast className="w-5 h-5" />{seguimiento.error || 'Buscando tu ubicación…'}</p>
          )}
        </Tarjeta>

        <Seccion titulo="Qué le pasa">
          {sintomas.length
            ? <div className="flex flex-wrap gap-2">{sintomas.map(s => <span key={s} className="rounded-full bg-white px-4 py-3 text-base text-text-primary">{s}</span>)}</div>
            : <p className="text-text-secondary">Sin síntomas registrados. Llamá al paciente.</p>}
        </Seccion>

        <Seccion titulo="Paciente">
          <Tarjeta className="flex items-center justify-between gap-3">
            <p className="text-xl font-semibold text-text-primary break-words">{paciente ?? 'Paciente'}</p>
            {telefono && (
              <a href={`tel:${telefono}`} aria-label="Llamar al paciente" className="w-14 h-14 shrink-0 rounded-full bg-bg-primary flex items-center justify-center text-text-primary">
                <Phone className="w-6 h-6" />
              </a>
            )}
          </Tarjeta>
        </Seccion>
      </Pantalla>
    )
  }

  // ── 4 · Cierre ────────────────────────────────────────────────────────────
  if (cerrando) {
    return (
      <Cierre
        emergency={emergency}
        atencionCerrada={atencion?.status === 'completed'}
        onVolver={() => setCerrando(false)}
        onCerrada={() => { setCerrando(false); setEmergency(null) }}
      />
    )
  }

  // ── 3 · Llegué ────────────────────────────────────────────────────────────
  return (
    <Pantalla pie={<Boton color="rojo" onClick={() => setCerrando(true)} testid="ir-a-cierre">Cerrar la emergencia</Boton>}>
      <Eyebrow codigo={emergency.triageCode} despacho={emergency.dispatchCode} estado="En el lugar" />
      <Titulo>{paciente ?? 'Paciente'}</Titulo>
      <Seccion titulo="Síntomas">
        {sintomas.length
          ? <Tarjeta className="flex flex-col gap-3">{sintomas.map(s => <p key={s} className="text-lg text-text-primary">{s}</p>)}</Tarjeta>
          : <p className="text-text-secondary">Sin síntomas registrados.</p>}
      </Seccion>
      {telefono && (
        <a href={`tel:${telefono}`} className="min-h-14 rounded-full bg-white text-text-primary font-semibold flex items-center justify-center gap-2">
          <Phone className="w-5 h-5" /> Llamar al paciente
        </a>
      )}
      {comoProfesional && atencion?.status !== 'completed' && (
        <Boton color="claro" icono={<Stethoscope className="w-6 h-6" />} onClick={atender} cargando={actualizando} testid="atender">
          {atencion ? 'Seguir la atención (receta)' : 'Atender al paciente (receta)'}
        </Boton>
      )}
    </Pantalla>
  )
}

// ── Cierre: cómo terminó + (traslado) foto de recepción + diagnóstico ─────────
function Cierre({ emergency, atencionCerrada, onVolver, onCerrada }) {
  const [cierre, setCierre] = useState({ desenlace: null, institucion: '', orden: null })
  const [diagnostico, setDiagnostico] = useState('')
  const [nota, setNota] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [vista, setVista] = useState(null)
  const camara = useRef(null)

  // Si ya había una recepción subida (se recargó la página), se retoma.
  useEffect(() => () => { if (vista?.startsWith('blob:')) URL.revokeObjectURL(vista) }, [vista])

  useEffect(() => {
    let vivo = true
    ordenTrasladoService.listar(emergency.id).then(async lista => {
      const ultima = lista.find(d => d.tipo === 'orden_traslado')
      if (!vivo || !ultima) return
      setCierre(prev => (prev.orden ? prev : { desenlace: 'traslado', institucion: ultima.institucion ?? '', orden: ultima }))
      const url = await ordenTrasladoService.urlFoto(ultima.fotoPath).catch(() => null)
      if (vivo && url) setVista(url)
    }).catch(() => {})
    return () => { vivo = false }
  }, [emergency.id])

  const subir = async (file) => {
    if (!file) return
    setSubiendo(true); setError('')
    try {
      const orden = await ordenTrasladoService.subir(emergency.id, file, { institucion: cierre.institucion })
      setVista(URL.createObjectURL(file))
      setCierre(prev => ({ ...prev, orden }))
    } catch (e) {
      setError(e?.message || 'No pudimos subir la foto.')
    } finally {
      setSubiendo(false)
      if (camara.current) camara.current.value = ''
    }
  }

  const falta = faltaParaCerrar(cierre) || (!atencionCerrada && !diagnostico.trim() ? 'Falta el diagnóstico' : '')

  const cerrar = async () => {
    setGuardando(true); setError('')
    try {
      // La base exige la atención cerrada o el diagnóstico (migración 245): el diagnóstico y la
      // nota para el despacho tienen su propia columna; `cierre_sin_atencion` queda para
      // los cierres sin atención, y el cobro de la emergencia lo hace el servidor al cerrar.
      await emergencyService.cerrar(emergency.id, { desenlace: cierre.desenlace, diagnostico, nota })
      await emergencyTrackingService.dejarDeCompartir(emergency.id).catch(() => {})
      onCerrada()
    } catch (e) {
      setError(e?.message || 'No pudimos cerrar la emergencia')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Pantalla pie={
      <>
        {falta && <p className="text-center text-sm text-text-secondary" data-testid="falta-cierre">{falta}</p>}
        <Boton color="rojo" onClick={cerrar} cargando={guardando} disabled={!!falta || subiendo} testid="cerrar-emergencia">Cerrar la emergencia</Boton>
      </>
    }>
      <button type="button" onClick={onVolver} className="self-start min-h-11 text-text-secondary">‹ Volver</button>
      <Eyebrow codigo={emergency.triageCode} despacho={emergency.dispatchCode} estado="Cierre" />
      <Titulo>¿Cómo terminó?</Titulo>

      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Cómo terminó">
        {[['en_el_lugar', 'En el lugar'], ['traslado', 'Trasladado']].map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={cierre.desenlace === id}
            onClick={() => setCierre(prev => ({ ...prev, desenlace: id }))}
            className={`min-h-16 rounded-3xl text-lg font-semibold ${cierre.desenlace === id ? 'bg-midnight text-white' : 'bg-white text-text-secondary'}`}>
            {label}
          </button>
        ))}
      </div>

      {cierre.desenlace === 'traslado' && (
        <section className="flex flex-col gap-3">
          <label htmlFor="institucion" className="text-base font-semibold text-text-primary">Institución que lo recibe</label>
          <input id="institucion" value={cierre.institucion} maxLength={200} disabled={!!cierre.orden || subiendo}
            onChange={e => setCierre(prev => ({ ...prev, institucion: e.target.value }))}
            placeholder="Hospital, clínica o sanatorio"
            className="w-full min-h-14 rounded-2xl bg-white px-5 text-lg placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand" />
          <h2 className="text-base font-semibold text-text-primary">Foto de recepción</h2>
          <input ref={camara} type="file" accept={TIPOS_FOTO_ORDEN.join(',')} capture="environment" className="hidden" data-testid="foto-recepcion"
            onChange={e => subir(e.target.files?.[0])} />
          {cierre.orden ? (
            <div className="flex flex-col gap-2">
              {vista && <img src={vista} alt="Recepción del traslado" className="w-full max-h-72 object-contain rounded-3xl bg-white" />}
              <div className="flex justify-between text-sm text-text-secondary">
                <span data-testid="recepcion-subida">Subida · {new Date(cierre.orden.subidaAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                <button type="button" className="text-danger font-semibold" onClick={() => setCierre(prev => ({ ...prev, orden: null }))}>Cambiar foto</button>
              </div>
            </div>
          ) : (
            <Boton color="claro" icono={<Camera className="w-6 h-6" />} cargando={subiendo} disabled={!cierre.institucion.trim()} onClick={() => camara.current?.click()}>
              Sacar foto de la recepción
            </Boton>
          )}
          <p className="text-sm text-text-secondary">Firmada y sellada por vos y por la institución.</p>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <label htmlFor="diagnostico" className="text-base font-semibold text-text-primary">Diagnóstico</label>
        <textarea id="diagnostico" rows={3} maxLength={1000} value={diagnostico} onChange={e => setDiagnostico(e.target.value)}
          placeholder="En tus palabras"
          className="w-full rounded-2xl bg-white px-5 py-4 text-lg placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand" />
        <label htmlFor="nota" className="text-base font-semibold text-text-primary">Nota para el despacho</label>
        <textarea id="nota" rows={2} maxLength={1000} value={nota} onChange={e => setNota(e.target.value)}
          placeholder="Opcional"
          className="w-full rounded-2xl bg-white px-5 py-4 text-lg placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand" />
      </section>
      {error && <Aviso testid="error-cierre">{error}</Aviso>}
    </Pantalla>
  )
}
