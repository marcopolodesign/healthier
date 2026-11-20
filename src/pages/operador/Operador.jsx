import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, HourglassMedium, WarningCircle } from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'
import { operadorService, KEY_INGRESO } from '../../services/operadorService'
import { dniValido, normalizarDni } from '../../lib/dni'
import Turno from './Turno'
import { Pantalla, Eyebrow, Titulo, Centrado, Boton, Campo, Cargando, Aviso } from './ui'

/**
 * Pantalla del operador de emergencias de Medizin (web, mobile-first, standalone).
 * Paridad con la app. Una cuenta operadorN (emergency_crew) entra así:
 *
 *   DNI → `operador-modo`
 *     · 'pendiente'  → espera la aprobación del despacho (Realtime + sondeo)
 *     · 'profesional'→ setSession: la cuenta atiende COMO ese profesional
 *     · 'registro'   → nombre + selfie → registrar_operador_del_dia
 *   y después, el turno (guardia → en camino → llegué → cierre → terminar turno).
 *
 * Con la sesión del profesional puesta, el rol pasa a `professional` y esta misma
 * pantalla sigue (la ruta admite los dos roles); sin `estoy_en_modo_operador`
 * un profesional común no se queda acá.
 */
const SONDEO_MS = 4000

export default function Operador({ profile }) {
  const navigate = useNavigate()
  const comoProfesional = profile?.role === 'professional'
  const [fase, setFase] = useState('cargando') // cargando | dni | espera | rechazado | registro | turno
  const [dni, setDni] = useState('')
  const [ingresoId, setIngresoId] = useState(null)
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [registro, setRegistro] = useState(null)

  // ── Dónde está parada esta cuenta ──────────────────────────────────────────
  useEffect(() => {
    let vivo = true
    ;(async () => {
      if (comoProfesional) {
        if (await operadorService.estoyEnModoOperador()) { if (vivo) setFase('turno') }
        else if (vivo) navigate('/profesional/dashboard', { replace: true })
        return
      }
      const [esOp, hoy] = await Promise.all([operadorService.esOperador(profile.id), operadorService.registroDeHoy(profile.id)])
      if (!esOp) {
        // Chofer / enfermero: su pantalla es la de siempre.
        if (vivo) navigate('/profesional/emergencias', { replace: true })
        return
      }
      if (!vivo) return
      if (hoy) { setRegistro(hoy); setFase('turno'); return }
      let guardado = null
      try { guardado = window.sessionStorage.getItem(KEY_INGRESO) } catch { /* sin storage */ }
      if (guardado) { setIngresoId(guardado); setFase('espera') } else setFase('dni')
    })().catch(e => { if (vivo) { setError(e?.message || 'No pudimos cargar tu turno'); setFase('dni') } })
    return () => { vivo = false }
  }, [profile.id, comoProfesional, navigate])

  const guardarIngreso = (id) => {
    setIngresoId(id)
    try { id ? window.sessionStorage.setItem(KEY_INGRESO, id) : window.sessionStorage.removeItem(KEY_INGRESO) } catch { /* sin storage */ }
  }

  // ── 1 · DNI ────────────────────────────────────────────────────────────────
  const pedir = async (e) => {
    e?.preventDefault()
    setTrabajando(true); setError('')
    try {
      const r = await operadorService.pedirIngreso(normalizarDni(dni))
      if (r.modo === 'pendiente') { guardarIngreso(r.ingreso_id); setFase('espera') }
      else setFase('registro')
    } catch (err) {
      setError(err.message)
    } finally {
      setTrabajando(false)
    }
  }

  // ── 2 · Espera de la aprobación ────────────────────────────────────────────
  const sondear = useCallback(async (id) => {
    try {
      const r = await operadorService.consultarIngreso(id)
      if (r.modo === 'profesional') {
        guardarIngreso(null)
        // Desde acá la cuenta ES el profesional: App.jsx se entera por SIGNED_IN y repinta con su rol.
        const { error: err } = await supabase.auth.setSession({ access_token: r.session.access_token, refresh_token: r.session.refresh_token })
        if (err) throw err
        setFase('cargando')
      } else if (r.modo !== 'pendiente') {
        guardarIngreso(null)
        setMensaje(r.modo === 'rechazado'
          ? (r.motivo ? `El despacho no aprobó el ingreso: ${r.motivo}` : 'El despacho no aprobó el ingreso.')
          : 'El pedido venció sin respuesta del despacho. Volvé a pedirlo.')
        setFase('rechazado')
      }
    } catch (err) {
      // 409 ("ya se retiró"), 404, etc.: el mensaje real, y se puede reintentar.
      guardarIngreso(null); setMensaje(err.message); setFase('rechazado')
    }
  }, [])

  const enSondeo = useRef(false)
  useEffect(() => {
    if (fase !== 'espera' || !ingresoId) return
    const una = async () => {
      if (enSondeo.current) return
      enSondeo.current = true
      try { await sondear(ingresoId) } finally { enSondeo.current = false }
    }
    una()
    const timer = setInterval(una, SONDEO_MS)
    // Realtime: apenas el despacho decide, se consulta sin esperar el sondeo.
    const canal = supabase.channel(`operador-ingreso-${ingresoId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'operador_ingresos', filter: `id=eq.${ingresoId}` }, una)
      .subscribe()
    return () => { clearInterval(timer); supabase.removeChannel(canal) }
  }, [fase, ingresoId, sondear])

  const cancelarEspera = () => { guardarIngreso(null); setFase('dni') }

  if (fase === 'cargando') return <Cargando />
  if (fase === 'turno') return <Turno profile={profile} comoProfesional={comoProfesional} registro={registro} />

  if (fase === 'espera') {
    return (
      <Pantalla pie={<Boton color="claro" onClick={cancelarEspera}>Cancelar</Boton>}>
        <Centrado icono={<span className="w-24 h-24 rounded-full bg-white flex items-center justify-center"><HourglassMedium className="w-12 h-12 text-text-primary animate-pulse" /></span>}
          sub="Apenas lo apruebe, entrás solo. No cierres esta pantalla.">Esperando que el despacho confirme</Centrado>
      </Pantalla>
    )
  }

  if (fase === 'rechazado') {
    return (
      <Pantalla pie={<Boton onClick={() => { setMensaje(''); setFase('dni') }}>Volver a intentar</Boton>}>
        <Centrado icono={<WarningCircle className="w-14 h-14 text-danger" />} sub={mensaje}>No pudimos entrar</Centrado>
      </Pantalla>
    )
  }

  if (fase === 'registro') {
    return <RegistroDelDia profile={profile} dniInicial={dni} onListo={(r) => { setRegistro(r); setFase('turno') }} onVolver={() => setFase('dni')} />
  }

  // fase === 'dni'
  return (
    <Pantalla pie={<Boton onClick={pedir} cargando={trabajando} disabled={!dniValido(dni)} testid="dni-continuar">Continuar</Boton>}>
      <Eyebrow estado="Turno de hoy" />
      <Titulo sub="Una vez por día. Con tu DNI sabemos quién sale.">¿Quién sale hoy?</Titulo>
      <form onSubmit={pedir} className="flex flex-col gap-4">
        <Campo id="dni" etiqueta="DNI" inputMode="numeric" autoComplete="off" placeholder="Sólo números" value={dni}
          onChange={e => setDni(e.target.value.replace(/\D/g, '').slice(0, 8))} ayuda="Lo ve sólo el despacho." />
      </form>
      {error && <Aviso testid="error-dni">{error}</Aviso>}
    </Pantalla>
  )
}

// ── 3 · Registro del día: nombre + selfie ─────────────────────────────────────
function RegistroDelDia({ profile, dniInicial, onListo, onVolver }) {
  const [nombre, setNombre] = useState('')
  const [foto, setFoto] = useState(null)
  const [vista, setVista] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)

  useEffect(() => () => { if (vista) URL.revokeObjectURL(vista) }, [vista])

  const elegir = (file) => {
    if (!file) return
    setFoto(file)
    setVista(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file) })
  }

  const listo = async () => {
    setGuardando(true); setError('')
    try {
      await operadorService.registrar({ nombre, dni: dniInicial, foto, profileId: profile.id })
      onListo({ nombre: nombre.trim() })
    } catch (e) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Pantalla pie={<Boton color="rojo" onClick={listo} cargando={guardando} disabled={nombre.trim().length < 3 || !foto} testid="registro-listo">Listo, salir</Boton>}>
      <button type="button" onClick={onVolver} className="self-start min-h-11 text-text-secondary">‹ Volver</button>
      <Eyebrow estado="Registro del día" />
      <Titulo sub="Una vez por día. El paciente ve tu nombre y tu foto.">¿Quién sale hoy?</Titulo>
      <input ref={input} type="file" accept="image/*" capture="user" className="hidden" data-testid="selfie" onChange={e => elegir(e.target.files?.[0])} />
      <button type="button" onClick={() => input.current?.click()} className="flex items-center gap-5 text-left min-h-24">
        <span className="w-24 h-24 shrink-0 rounded-full bg-white overflow-hidden flex items-center justify-center">
          {vista ? <img src={vista} alt="Tu selfie" className="w-full h-full object-cover" /> : <Camera className="w-9 h-9 text-text-secondary" />}
        </span>
        <span>
          <span className="block text-xl font-semibold text-text-primary">{vista ? 'Cambiar selfie' : 'Sacate una selfie'}</span>
          <span className="block text-text-secondary">Con la cara a la vista</span>
        </span>
      </button>
      <Campo id="nombre" etiqueta="Nombre y apellido" autoComplete="off" value={nombre} onChange={e => setNombre(e.target.value)} maxLength={120} />
      <p className="text-sm text-text-secondary">DNI {dniInicial}. Lo ve sólo el despacho.</p>
      {error && <Aviso testid="error-registro">{error}</Aviso>}
    </Pantalla>
  )
}
