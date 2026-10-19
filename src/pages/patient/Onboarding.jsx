import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { Check, ShieldCheck, IdentificationCard, FirstAid, Heartbeat, Phone, Buildings, User } from '@phosphor-icons/react'
import { profilesService } from '../../services/profilesService'
import FinanciadorPicker from '../../components/FinanciadorPicker'
import CoberturaSugeridaAviso from '../../components/CoberturaSugeridaAviso'
import FichaPacientePreview from '../../components/patient/FichaPacientePreview'
import { coberturaService } from '../../services/coberturaService'
import { precargarCobertura, avisoSinMatch, origenDeCobertura } from '../../lib/coberturaSugerida'
import { toast } from '../../components/Toast'
import { PATIENT_CONSENT_ITEMS } from '../../lib/consentItems'
import { OPCIONES_SEXO } from '../../lib/datosReceta'
import { normalizarDni, dniValido, MENSAJE_DNI_INVALIDO } from '../../lib/dni'
import { PASOS_PACIENTE, CONSENT_VERSION, completitudPaciente, onboardingBloqueante } from '../../lib/pacienteOnboarding'
import { authService } from '../../services/authService'
import { nombreDePila } from '../../lib/format'
import { track } from '../../utils/analytics'
import { referralService } from '../../services/referralService'

/**
 * Onboarding del paciente por pasos (2026-10-18) — la versión adaptada del
 * wizard del profesional: tracker con íconos, un paso por vez y, en desktop,
 * la ficha del paciente llenándose en vivo a la derecha.
 *
 * Los pasos y qué cuenta como "hecho" viven en `lib/pacienteOnboarding.js`
 * (los comparten la tarjeta del inicio y el super admin). Acá:
 *
 * - Un paciente que ya tiene datos entra en el PRIMER paso que le falta, con
 *   los anteriores tildados — no vuelve a tipear lo que ya cargó.
 * - Cada paso se guarda al apretar "Continuar", no al final: si cierra la
 *   pestaña a mitad de camino, lo cargado queda.
 * - Obligatorios (consentimiento, datos, cobertura) no tienen "Saltear".
 * - Paciente NUEVO (migración 206, `onboardingBloqueante`): no hay salida al
 *   inicio hasta terminar — sólo "Cerrar sesión". App.jsx lo devuelve acá si
 *   intenta entrar a cualquier /paciente/*. Si guardar el final falla, se
 *   muestra el error real y se queda en el paso para reintentar (si no, la
 *   guarda lo devolvería al wizard en loop).
 * - Paciente que ya existía: no se lo manda acá; si entra igual por la URL,
 *   puede salir ("Terminar después").
 *
 * Eventos de analytics: `step` cuenta el alta (Register.jsx) como paso 1, así
 * que el evento de cada paso del wizard es índice + 2 (spec de Henry).
 */

const ICONOS = {
  consentimiento: ShieldCheck,
  datos:          IdentificationCard,
  cobertura:      FirstAid,
  salud:          Heartbeat,
  emergencia:     Phone,
}

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const FINAL = PASOS_PACIENTE.length // índice de la pantalla "Listo"

const evento = i => ({ step: i + 2, step_name: PASOS_PACIENTE[i]?.key, flow: 'paciente' })

/**
 * Próximo paso que le falta después de `desde` (un paciente existente no pasa
 * por los que ya tiene completos). FINAL si no queda ninguno.
 */
const siguientePendiente = (perfil, desde) => {
  const i = completitudPaciente(perfil).pasos.findIndex((p, j) => j > desde && !p.done)
  return i === -1 ? FINAL : i
}

export default function PatientOnboarding({ profile, onProfileUpdate }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const estadoInicial = completitudPaciente(profile)

  // Arranca donde le falta. `?paso=cobertura` (desde la tarjeta del inicio o
  // el perfil) abre ese paso puntual.
  const [step, setStep] = useState(() => {
    const pedido = PASOS_PACIENTE.findIndex(p => p.key === searchParams.get('paso'))
    if (pedido >= 0) return pedido
    return estadoInicial.completados === estadoInicial.total ? 0 : estadoInicial.primerPendiente
  })
  const [saving, setSaving] = useState(false)
  const [destinoReferido, setDestinoReferido] = useState(null)

  const yaConsintio = !!profile?.consentimientoAt && profile?.consentimientoVersion === CONSENT_VERSION
  const [consents, setConsents] = useState(
    Object.fromEntries(PATIENT_CONSENT_ITEMS.map(item => [item.key, yaConsintio]))
  )
  const allConsented = PATIENT_CONSENT_ITEMS.every(item => consents[item.key])

  const [datos, setDatos] = useState({
    dni:       profile?.dni       || '',
    birthDate: profile?.birthDate || '',
    gender:    profile?.gender    || '',
  })
  const [salud, setSalud] = useState({
    heightCm:  profile?.heightCm  ?? '',
    weightKg:  profile?.weightKg  ?? '',
    bloodType: profile?.bloodType || '',
    allergies: profile?.allergies || '',
  })
  // Obra social del catálogo de Innovamed (RCTA) — nunca texto libre: la
  // receta electrónica necesita el idFinanciador, no el nombre escrito a mano.
  const [cobertura, setCobertura] = useState({
    coverageType:  profile?.coverageType  || null,
    financiadorId: profile?.financiadorId || null,
    insuranceName: profile?.insuranceName || '',
    insuranceNum:  profile?.insuranceNum  || '',
  })
  const [emergencia, setEmergencia] = useState({
    emergencyName:  profile?.emergencyName  || '',
    emergencyPhone: profile?.emergencyPhone || '',
    emergencyRel:   profile?.emergencyRel   || '',
  })

  // El paso alcanzado se registra al entrar a cada uno (migración 205: nunca
  // retrocede). Es lo que el super admin ve como "Llegó hasta …". Best-effort:
  // un registro que falla no frena al paciente.
  useEffect(() => {
    if (!profile?.id || step >= FINAL) return
    if ((profile.pacientePasoOnboarding ?? -1) >= step) return
    profilesService.update(profile.id, { pacientePasoOnboarding: step })
      .then(p => onProfileUpdate?.(p))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, profile?.id])

  // Obra social sugerida por DNI desde el listado de obras sociales. Se PRECARGA
  // sólo si el paciente no tenía nada cargado (lib/coberturaSugerida.js). Si
  // falla, el alta sigue igual.
  const [sugerida, setSugerida] = useState({ estado: null, id: null, nombre: null })
  const coberturaRef = useRef(cobertura)
  coberturaRef.current = cobertura
  const buscarCobertura = async () => {
    setSugerida({ estado: 'buscando', id: null, nombre: null })
    const r = await coberturaService.sugerida()
    const actual = coberturaRef.current
    const patch = precargarCobertura(actual, r)
    if (patch) setCobertura(prev => (precargarCobertura(prev, r) ? { ...prev, ...patch } : prev))
    const sinMatch = avisoSinMatch(actual, r)
    setSugerida({
      estado: patch ? 'precargada' : sinMatch ? 'sin_match' : null,
      id: patch ? patch.financiadorId : null,
      nombre: sinMatch,
    })
  }

  const guardar = async (cambios) => {
    const updated = await profilesService.update(profile.id, cambios)
    // Sin esto App.jsx sigue con el perfil viejo y el inicio muestra la
    // tarjeta de "te faltan datos" hasta recargar.
    onProfileUpdate?.(updated)
    return updated
  }

  const avanzar = async (cambios, extra = {}) => {
    setSaving(true)
    try {
      const updated = cambios ? await guardar(cambios) : profile
      track('sign_up_step_complete', { ...evento(step), ...extra })
      const siguiente = siguientePendiente(updated, step)
      if (siguiente === FINAL) await terminar(updated)
      else setStep(siguiente)
      return updated
    } catch (err) {
      track('sign_up_error', { ...evento(step), error_type: 'server_error' })
      toast.error(`No pudimos guardar: ${err.message}`)
      return null
    } finally {
      setSaving(false)
    }
  }

  // Tira si no pudo guardar la marca de fin: con el onboarding obligatorio esa
  // marca es la que destraba la plataforma, así que no se puede seguir sin ella.
  const terminar = async (perfil) => {
    await guardar({ onboardingCompletadoAt: new Date().toISOString() })
    track('sign_up_complete', { flow: 'paciente', profile_completed: completitudPaciente(perfil).obligatoriosCompletos })
    // Quien llegó por el link de un profesional termina en la ficha de ESE
    // profesional, no buscando de nuevo entre todos.
    const destino = await referralService.destinoDelReferido(perfil ?? profile)
    setDestinoReferido(destino)
    setStep(FINAL)
  }

  const irAlFinal = () => {
    if (destinoReferido) track('referral_post_onboarding_redirect', { flow: 'paciente' })
    navigate(destinoReferido ?? '/paciente/dashboard')
  }

  const saltear = async () => {
    track('sign_up_skip_step', evento(step))
    const siguiente = siguientePendiente(profile, step)
    if (siguiente !== FINAL) return setStep(siguiente)
    setSaving(true)
    try {
      await terminar(profile)
    } catch (err) {
      toast.error(`No pudimos guardar: ${err.message}. Probá de nuevo.`)
    } finally {
      setSaving(false)
    }
  }

  const cerrarSesion = async () => {
    try { await authService.logout() } finally { navigate('/') }
  }
  const bloqueado = onboardingBloqueante(profile)

  // ── Guardado por paso ──────────────────────────────────────────
  const guardarConsentimiento = () => avanzar(
    yaConsintio ? null : { consentimientoAt: new Date().toISOString(), consentimientoVersion: CONSENT_VERSION },
    { consent_datos_salud: consents.hipaa, consent_ley_25326: consents.ley25326, consent_acceso_medico: consents.equipo_tratante },
  )

  const guardarDatos = async () => {
    // Los tres los pide la receta electrónica (QBI156/206/224) y el registro
    // nacional de pacientes (migración 196). Descubrir que faltan recién en la
    // consulta es peor que pedirlos acá.
    if (!dniValido(datos.dni)) return toast.error(MENSAJE_DNI_INVALIDO)
    if (!datos.gender) return toast.error('Elegí tu sexo como figura en el DNI.')
    if (!datos.birthDate) return toast.error('Completá tu fecha de nacimiento.')
    const updated = await avanzar({ dni: normalizarDni(datos.dni), gender: datos.gender, birthDate: datos.birthDate })
    if (updated) buscarCobertura() // sin await: no frena el paso
  }

  const guardarCobertura = () => {
    if (!cobertura.coverageType) return toast.error('Elegí si tenés obra social o sos particular.')
    if (cobertura.coverageType === 'financiador' && !cobertura.financiadorId) {
      return toast.error('Buscá y elegí tu obra social o prepaga del listado.')
    }
    const esParticular = cobertura.coverageType === 'particular'
    return avanzar({
      coverageType:    cobertura.coverageType,
      financiadorId:   esParticular ? null : cobertura.financiadorId,
      insuranceName:   esParticular ? null : (cobertura.insuranceName || null),
      insuranceNum:    esParticular ? null : (cobertura.insuranceNum.trim() || null),
      coberturaOrigen: origenDeCobertura(cobertura, sugerida.id),
    })
  }

  const guardarSalud = () => {
    const h = salud.heightCm === '' ? null : Number(salud.heightCm)
    const w = salud.weightKg === '' ? null : Number(salud.weightKg)
    if (h != null && (!Number.isInteger(h) || h <= 0 || h >= 300)) return toast.error('La altura va en centímetros, entre 1 y 299 (ej: 165).')
    if (w != null && (w <= 0 || w >= 700)) return toast.error('El peso va en kilos, entre 1 y 699.')
    return avanzar({
      heightCm: h, weightKg: w,
      bloodType: salud.bloodType || null,
      allergies: salud.allergies.trim() || null,
    }, { has_allergies: !!salud.allergies.trim() })
  }

  const guardarEmergencia = () => avanzar({
    emergencyName:  emergencia.emergencyName.trim()  || null,
    emergencyPhone: emergencia.emergencyPhone.trim() || null,
    emergencyRel:   emergencia.emergencyRel.trim()   || null,
  })

  const GUARDAR = [guardarConsentimiento, guardarDatos, guardarCobertura, guardarSalud, guardarEmergencia]

  // Lo que se ve en vivo en la ficha: lo guardado + lo que está tipeando.
  const borrador = { ...profile, ...datos, ...salud, ...cobertura, ...emergencia }
  const hechos = completitudPaciente(profile).pasos
  const paso = PASOS_PACIENTE[step]

  // ── Pantalla final ─────────────────────────────────────────────
  if (step === FINAL) {
    return (
      <div className="min-h-screen bg-bg-primary grid lg:grid-cols-2">
        <div className="py-10 px-4 flex items-center">
          <div className="max-w-lg mx-auto w-full text-center lg:text-left">
            <div className="w-14 h-14 rounded-full bg-brand-muted text-brand flex items-center justify-center mb-6 mx-auto lg:mx-0">
              <Check className="h-7 w-7" weight="bold" />
            </div>
            <h1 className="page-title-lg text-text-primary">
              Listo{nombreDePila(profile?.fullName, '') ? `, ${nombreDePila(profile.fullName, '')}` : ''}
            </h1>
            <p className="text-text-secondary mt-3 text-base">
              Tu perfil quedó cargado. Lo podés cambiar cuando quieras desde Perfil.
            </p>
            <div className="lg:hidden mt-8 text-left">
              <FichaPacientePreview paciente={borrador} pasoActivo={null} compacta />
            </div>
            <button onClick={irAlFinal} className="btn-primary mt-8 w-full sm:w-auto px-8">
              {destinoReferido ? 'Seguir con tu profesional' : 'Ir al inicio'}
            </button>
          </div>
        </div>
        <div className="hidden lg:flex lg:sticky lg:top-0 lg:h-screen lg:self-start bg-bg-secondary p-8">
          <FichaPacientePreview paciente={borrador} pasoActivo={null} />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg-primary grid lg:grid-cols-2">
      {/* Izquierda — el paso */}
      <div className="py-10 px-4 overflow-y-auto">
        <div className="max-w-lg mx-auto">

          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="page-title-lg text-text-primary">Completá tu perfil</h1>
              <p className="text-text-secondary mt-1.5 text-base">
                Paso {step + 1} de {PASOS_PACIENTE.length} — {paso.corto}
              </p>
            </div>
            {/* Paciente nuevo: sin salida al inicio hasta terminar (migración 206). */}
            {bloqueado ? (
              <button type="button" onClick={cerrarSesion} className="text-sm text-text-tertiary hover:text-text-secondary whitespace-nowrap mt-2">
                Cerrar sesión
              </button>
            ) : (
              <Link to="/paciente/dashboard" className="text-sm text-text-tertiary hover:text-text-secondary whitespace-nowrap mt-2">
                Terminar después
              </Link>
            )}
          </div>

          {/* Tracker — los pasos ya hechos (por dato cargado, no por orden) se
              ven tildados y se pueden reabrir. */}
          <div className="flex items-center mb-8">
            {PASOS_PACIENTE.map((s, i) => {
              const Icon = ICONOS[s.key]
              const done = hechos[i]?.done && i !== step
              const current = i === step
              return (
                <div key={s.key} className="flex items-center flex-1 last:flex-none">
                  <button
                    type="button"
                    onClick={() => (done || i < step) && setStep(i)}
                    aria-label={s.corto}
                    className={`flex flex-col items-center gap-1 ${done || i < step ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors border-2 ${
                      done      ? 'bg-brand border-brand text-white'
                      : current ? 'bg-white border-brand text-brand'
                      : 'bg-white border-border-default text-text-tertiary'
                    }`}>
                      {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                    </div>
                    <span className={`text-xs font-medium hidden sm:block ${current ? 'text-brand' : done ? 'text-text-secondary' : 'text-text-tertiary'}`}>
                      {s.corto}
                    </span>
                  </button>
                  {i < PASOS_PACIENTE.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-1 mb-0 sm:mb-4 transition-colors ${hechos[i]?.done ? 'bg-brand' : 'bg-border-default'}`} />
                  )}
                </div>
              )
            })}
          </div>

          <div className="card space-y-5">
            <div className="flex items-baseline gap-3">
              <h2 className="font-serif font-light text-2xl text-text-primary">{paso.titulo}</h2>
              {!paso.obligatorio && <span className="text-sm text-text-tertiary">Opcional</span>}
            </div>

            {/* ── Consentimiento ─────────────────────────────── */}
            {paso.key === 'consentimiento' && (
              <>
                <p className="text-sm text-text-secondary">
                  Necesitamos tu consentimiento para poder atenderte en Healthier. El detalle completo está en los{' '}
                  <Link to="/terminos" target="_blank" className="text-brand font-medium hover:underline">Términos y Condiciones</Link>.
                </p>
                <div className="border border-border-default rounded-xl p-4 space-y-4 bg-bg-primary">
                  {PATIENT_CONSENT_ITEMS.map(item => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setConsents(p => ({ ...p, [item.key]: !p[item.key] }))}
                      className="flex items-start gap-3 w-full text-left"
                    >
                      <span className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors ${
                        consents[item.key] ? 'bg-brand border-brand' : 'border-border-default'
                      }`}>
                        {consents[item.key] && <Check className="h-3 w-3 text-white" weight="bold" />}
                      </span>
                      <span>
                        <span className="text-sm font-semibold text-text-primary block">{item.title}</span>
                        <span className="text-sm text-text-secondary leading-relaxed">{item.desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* ── Tus datos ──────────────────────────────────── */}
            {paso.key === 'datos' && (
              <>
                <p className="text-sm text-text-secondary">Los pide la receta electrónica para que te puedan recetar.</p>
                <div>
                  <label className="form-label">DNI</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={datos.dni}
                    onChange={e => setDatos(p => ({ ...p, dni: e.target.value }))}
                    onBlur={() => setDatos(p => ({ ...p, dni: normalizarDni(p.dni) }))}
                    placeholder="Sin puntos, ej: 30111222"
                    className="form-input"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Fecha de nacimiento</label>
                    <input
                      type="date"
                      value={datos.birthDate}
                      onChange={e => setDatos(p => ({ ...p, birthDate: e.target.value }))}
                      className="form-input"
                      max={new Date().toISOString().split('T')[0]}
                    />
                  </div>
                  <div>
                    <label className="form-label">Sexo, como figura en el DNI</label>
                    <select
                      value={datos.gender}
                      onChange={e => setDatos(p => ({ ...p, gender: e.target.value }))}
                      className="form-select"
                    >
                      <option value="">Elegí</option>
                      {OPCIONES_SEXO.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                      {/* 'prefiero_no_decir' (del alta vieja) se muestra para no
                          perderlo, pero no se ofrece: el DNI dice F, M o X. */}
                      {datos.gender === 'prefiero_no_decir' && <option value="prefiero_no_decir">Prefiero no decir</option>}
                    </select>
                  </div>
                </div>
              </>
            )}

            {/* ── Cobertura ──────────────────────────────────── */}
            {paso.key === 'cobertura' && (
              <>
                <CoberturaSugeridaAviso
                  estado={sugerida.estado === 'precargada' && cobertura.financiadorId !== sugerida.id ? null : sugerida.estado}
                  nombre={sugerida.nombre}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { value: 'financiador', label: 'Tengo obra social o prepaga', desc: 'Las recetas salen con tu cobertura', Icon: Buildings },
                    { value: 'particular',  label: 'Particular',                 desc: 'Sin obra social',                    Icon: User },
                  ].map(({ value, label, desc, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setCobertura(p => value === 'particular'
                        ? { coverageType: 'particular', financiadorId: null, insuranceName: '', insuranceNum: '' }
                        : { ...p, coverageType: 'financiador' })}
                      className={`text-left p-4 rounded-2xl border-2 transition-colors ${
                        cobertura.coverageType === value
                          ? 'border-brand bg-brand-muted'
                          : 'border-border-default bg-bg-primary hover:border-brand/40'
                      }`}
                    >
                      <Icon className={`h-6 w-6 mb-2 ${cobertura.coverageType === value ? 'text-brand' : 'text-text-tertiary'}`} />
                      <span className="block text-base font-semibold text-text-primary">{label}</span>
                      <span className="block text-sm text-text-secondary mt-0.5">{desc}</span>
                    </button>
                  ))}
                </div>
                {cobertura.coverageType === 'financiador' && (
                  <FinanciadorPicker
                    sinOpciones
                    coverageType={cobertura.coverageType}
                    financiadorId={cobertura.financiadorId}
                    financiadorName={cobertura.insuranceName}
                    affiliateNumber={cobertura.insuranceNum}
                    onChange={v => setCobertura({
                      coverageType:  v.coverageType,
                      financiadorId: v.financiadorId,
                      insuranceName: v.financiadorName,
                      insuranceNum:  v.affiliateNumber,
                    })}
                  />
                )}
              </>
            )}

            {/* ── Salud ──────────────────────────────────────── */}
            {paso.key === 'salud' && (
              <>
                <p className="text-sm text-text-secondary">Le sirve a quien te atienda. Podés completarlo después.</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Altura <span className="text-text-tertiary font-normal">cm</span></label>
                    <input type="number" inputMode="numeric" min="50" max="250" value={salud.heightCm}
                      onChange={e => setSalud(p => ({ ...p, heightCm: e.target.value }))} className="form-input" placeholder="Ej: 170" />
                  </div>
                  <div>
                    <label className="form-label">Peso <span className="text-text-tertiary font-normal">kg</span></label>
                    <input type="number" inputMode="decimal" min="1" max="500" step="0.1" value={salud.weightKg}
                      onChange={e => setSalud(p => ({ ...p, weightKg: e.target.value }))} className="form-input" placeholder="Ej: 70" />
                  </div>
                </div>
                <div>
                  <label className="form-label">Grupo sanguíneo</label>
                  <select value={salud.bloodType} onChange={e => setSalud(p => ({ ...p, bloodType: e.target.value }))} className="form-select">
                    <option value="">Elegí</option>
                    {BLOOD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    <option value="desconocido">No sé</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Alergias conocidas</label>
                  <textarea value={salud.allergies} onChange={e => setSalud(p => ({ ...p, allergies: e.target.value }))}
                    rows={3} className="form-textarea" placeholder="Ej: penicilina, mariscos, látex…" />
                </div>
              </>
            )}

            {/* ── Emergencia ─────────────────────────────────── */}
            {paso.key === 'emergencia' && (
              <>
                <p className="text-sm text-text-secondary">A quién avisamos si te pasa algo durante una atención.</p>
                <div>
                  <label className="form-label">Nombre completo</label>
                  <input type="text" value={emergencia.emergencyName}
                    onChange={e => setEmergencia(p => ({ ...p, emergencyName: e.target.value }))} className="form-input" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Teléfono</label>
                    <input type="tel" value={emergencia.emergencyPhone}
                      onChange={e => setEmergencia(p => ({ ...p, emergencyPhone: e.target.value }))} className="form-input" />
                  </div>
                  <div>
                    <label className="form-label">Vínculo</label>
                    <input type="text" value={emergencia.emergencyRel}
                      onChange={e => setEmergencia(p => ({ ...p, emergencyRel: e.target.value }))} className="form-input" placeholder="Mamá, pareja…" />
                  </div>
                </div>
              </>
            )}

            <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
              {step > 0 && (
                <button type="button" onClick={() => setStep(step - 1)} className="btn-secondary sm:flex-1">
                  Volver
                </button>
              )}
              <button
                type="button"
                onClick={GUARDAR[step]}
                disabled={saving || (paso.key === 'consentimiento' && !allConsented)}
                className="btn-primary sm:flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'Guardando…' : 'Continuar'}
              </button>
            </div>
          </div>

          {!paso.obligatorio && (
            <button
              type="button"
              onClick={saltear}
              disabled={saving}
              className="mt-4 w-full text-center text-sm text-text-tertiary hover:text-text-secondary transition-colors"
            >
              Saltear por ahora
            </button>
          )}
        </div>
      </div>

      {/* Derecha — la ficha en vivo. Sticky para que no se estire con el form. */}
      <div className="hidden lg:flex lg:sticky lg:top-0 lg:h-screen lg:self-start bg-bg-secondary p-8">
        <FichaPacientePreview paciente={borrador} pasoActivo={paso.key} />
      </div>
    </div>
  )
}
