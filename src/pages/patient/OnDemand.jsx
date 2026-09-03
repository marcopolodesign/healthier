import { useState, useEffect, useRef } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, VideoCamera, Clock, CircleNotch, Check, ShieldCheck, CreditCard, Warning,
  ArrowClockwise,
} from '@phosphor-icons/react'
import { toast } from '../../components/Toast'
import { professionalService, ON_DEMAND_PRESENCE_TTL_MS } from '../../services/professionalService'
import { consultationsService } from '../../services/consultationsService'
import { mpService } from '../../services/mpService'
import PatientSheet from '../../components/patient/PatientSheet'
import SavedCardSelector from '../../components/payment/SavedCardSelector'
import MercadoPagoMark from '../../components/icons/MercadoPagoMark'
import { buildPool, isPayable } from '../../lib/onDemandPool'
import { explicarPagoMP } from '../../lib/mercadoPago'
import { useVerticales } from '../../hooks/useVerticales'
import { useEspecialidades } from '../../hooks/useEspecialidades'
import { track, getPaymentMethod, buildConsultaItem } from '../../utils/analytics'

// Real 10:00 pre-authorization window (spec Sección D1.3/D1.4) — mirrors the
// mp-capture `sweep` cron's own 10-minute cutoff, which is the server-side
// backstop if this client-side timer is lost (tab closed, app killed, etc).
// 4 minutos (Mateo, 2026-07-31). Eran 10: nadie con fiebre espera 10 minutos
// mirando una cuenta regresiva, y con pocos médicos lo que importa es fallar
// rápido al siguiente, no esperar mucho al primero.
const AUTH_WINDOW_SECONDS = 4 * 60

/**
 * Techo total de espera desde que se creó la consulta, sumando todos los
 * "Necesito más tiempo". Existe porque cada minuto de espera es plata del
 * paciente retenida en su tarjeta: extender es decisión suya, pero no puede ser
 * infinito. El barrido de `mp-capture` tiene su propio tope, más holgado, para
 * que el servidor nunca cancele antes que la pantalla.
 */
const MAX_WAIT_SECONDS = 20 * 60

function formatCountdown(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function OnDemand({ profile }) {
  const { vertical: verticalId } = useParams()
  // `?pro=<userId>` — llamada directa a un profesional puntual, en vez del pool
  // de la especialidad (2026-08-21, tarjeta "tu médico de cabecera" del
  // dashboard). Ver el armado del pool más abajo, en el Step 1.
  const [searchParams] = useSearchParams()
  const direccionamientoDirecto = searchParams.get('pro')
  const navigate = useNavigate()
  // Habilitación y precio salen de `vertical_settings`, no del código.
  const { verticalesById, cargando: cargandoVerticales } = useVerticales()
  const { porSlug, porVertical } = useEspecialidades()
  const vertical = verticalesById[verticalId]
  const cardSelectorRef = useRef(null)
  const countdownRef = useRef(null)

  // phase: 'searching' → 'no_match' | 'checkout' → 'assigned'
  const [phase, setPhase] = useState('searching')
  // Pool completo de profesionales elegibles, ya rotado, + el índice actual.
  // Lo que sobra del pool es la cola de failover cuando uno no se conecta.
  const [proPool, setProPool] = useState([])
  const [poolIndex, setPoolIndex] = useState(0)
  const matchedPro = proPool[poolIndex] ?? null
  const [consultationId, setConsultationId] = useState(null)

  // Real MP checkout — same saved-card / new-card patterns as PaymentPage,
  // but always authorizeOnly (pre-auth hold) and credit-card only, no credits.
  const [publicKey, setPublicKey] = useState(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [selectedCardId, setSelectedCardId] = useState(null)
  const [addCardMode, setAddCardMode] = useState(false)
  // Lo último que dijo Mercado Pago cuando un cobro no salió: se muestra fijo en
  // pantalla (no un toast que se va solo) hasta que el paciente hace otra cosa.
  const [errorPago, setErrorPago] = useState(null)
  const [paying, setPaying] = useState(false)

  // Post-authorization countdown + cancel.
  //
  // La cuenta regresiva se deriva de un vencimiento absoluto (`deadlineAt`), no
  // de un contador que se decrementa: un contador en memoria mentía cada vez que
  // el navegador suspendía la pestaña (vuelve con el mismo número que dejó,
  // aunque hayan pasado tres minutos) y se perdía entero con un refresh. El
  // vencimiento además vive en la base (`ondemand_wait_until`), que es lo que
  // permite rehidratar la pantalla.
  const [deadlineAt, setDeadlineAt] = useState(null)
  const [secondsLeft, setSecondsLeft] = useState(AUTH_WINDOW_SECONDS)
  const [cancelling, setCancelling] = useState(false)
  // `created_at` de la consulta viva: el techo de MAX_WAIT_SECONDS se mide
  // desde ahí, no desde que se montó la pantalla.
  const [waitStartedAt, setWaitStartedAt] = useState(null)
  const [extending, setExtending] = useState(false)

  // Checkout exit guard — back arrow (or any other exit affordance) opens this
  // confirm sheet instead of navigating away immediately (Mateo, 2026-07-27).
  const [showExitConfirm, setShowExitConfirm] = useState(false)

  const isDemoMode = !configLoading && !publicKey
  // El paciente tiene la videollamada bonificada (profiles.payment_exempt,
  // migración 135) — se salta el paygate de MP entero, la consulta nace
  // marcada `payment_status: 'exempt'` en vez de pasar por mp-payment.
  const paymentExempt = Boolean(profile?.paymentExempt)
  // Falta elegir tarjeta y hace falta una. Ni el modo demo ni el paciente
  // bonificado tocan Mercado Pago, así que a ellos no se les puede pedir.
  //
  // 🔴 Estaba usada en el CTA pero nunca declarada: la pantalla entera de
  // consulta inmediata tiraba `missingCard is not defined` al llegar al checkout
  // y el paciente veía "Algo salió mal" en vez del profesional que ya tenía
  // asignado. Se coló al reemplazar la expresión inline por esta variable.
  const missingCard = !isDemoMode && !paymentExempt && !selectedCardId

  const IconComp = vertical?.icon
  // El precio lo fija la vertical y pisa el del profesional (Mateo, 2026-07-31).
  // Antes salía de `matchedPro.priceVideo ?? sessionPrice`, así que el paciente
  // pagaba distinto según a quién le tocara.
  const price = vertical?.onDemandPrice ?? null
  const proName = matchedPro?.profiles?.fullName || 'Profesional'
  const proAvatar = matchedPro?.profiles?.avatarUrl || null
  const proRating = matchedPro?.averageRating ? String(matchedPro.averageRating) : '—'
  const proSpecialty = matchedPro ? (porSlug[matchedPro.specialty] || vertical?.nombre) : vertical?.nombre

  // ── Guard — unknown/coming-soon vertical redirects home. Runs as an effect
  // (not a conditional early-return before hooks) so every hook below is
  // still called on every render, per the rules of hooks. ──────────────────
  useEffect(() => {
    if (cargandoVerticales) return
    if (!vertical || vertical.comingSoon) navigate('/paciente/dashboard')
  }, [vertical, cargandoVerticales, navigate])

  // ── DB write helper — creates the consultation the first time it's needed
  // (when the patient commits to pay), never before. Cached so retries and
  // the new-card Brick's own submit reuse the same booking (State Resilience
  // convention: DB write before confirmation UI, never only on completion). ─
  const ensureConsultation = async () => {
    if (consultationId) return consultationId
    const created = await consultationsService.create({
      patientId:      profile.id,
      professionalId: matchedPro.userId,
      vertical:       verticalId,
      modality:       'video',
      /*
       * Nace `pending`, NO `confirmed`.
       *
       * Nacía confirmada antes de intentar el cobro, así que un pago rechazado
       * dejaba igual una consulta confirmada: el 2026-07-31 MP rechazó por
       * `cc_rejected_high_risk` y el paciente se quedó con el banner "Continuar
       * con tu turno" en el inicio y con la videollamada abierta, gratis.
       *
       * La confirma `mp-payment` cuando MP autoriza de verdad (ver
       * `confirmedPatch`), que es lo mismo que ya hace un turno agendado.
       */
      status:         'pending',
      isOnDemand:     true,
      priceAtBooking: price,
      scheduledAt:    new Date().toISOString(),
      // Bonificada: nace ya marcada `exempt`, sin el viaje de ida y vuelta
      // extra de crear y después actualizar.
      ...(paymentExempt ? { paymentStatus: 'exempt' } : {}),
    })
    setConsultationId(created.id)
    return created.id
  }

  // ── Authorization succeeded → mostrar la ventana, SIN avisarle al profesional ─
  // El aviso salía acá, en el momento de autorizar el pago: el profesional
  // recibía "entrá ahora" mientras el paciente todavía no había contestado una
  // sola pregunta. Ahora el único disparador es que el paciente toque "Iniciar
  // consulta" en la sala, después de la pre-consulta (ver WaitingRoom).
  const handleAuthorized = async (id) => {
    const deadline = Date.now() + AUTH_WINDOW_SECONDS * 1000
    setWaitStartedAt(prev => prev ?? Date.now())
    aplicarVencimiento(deadline)
    setPhase('assigned')
    // El vencimiento va a la base para que sobreviva a un refresh y para que el
    // barrido del servidor no cancele la reserva antes de tiempo. Si esta
    // escritura falla, la pantalla sigue andando con el vencimiento en memoria
    // (el comportamiento viejo) — no vale la pena bloquear una consulta médica
    // por no poder guardar un timestamp.
    try {
      await consultationsService.update(id, { ondemandWaitUntil: new Date(deadline).toISOString() })
    } catch (err) {
      console.error('[OnDemand] no se pudo guardar el vencimiento de espera:', err)
    }
  }

  /** Deja el vencimiento y el contador en hora, en un solo lugar. */
  const aplicarVencimiento = (deadlineMs) => {
    setDeadlineAt(deadlineMs)
    setSecondsLeft(Math.max(0, Math.round((deadlineMs - Date.now()) / 1000)))
  }

  // ── "Necesito más tiempo" — extiende la espera sin tocar la reserva ──────────
  // No re-autoriza nada: la retención en la tarjeta ya está hecha y sigue viva,
  // lo único que se mueve es hasta cuándo esperamos antes de soltarla. Por eso
  // extender es instantáneo y no vuelve a pasar por el checkout.
  const handleMoreTime = async () => {
    if (extending || !consultationId) return
    const desde = waitStartedAt ?? Date.now()
    const techo = desde + MAX_WAIT_SECONDS * 1000
    if (Date.now() >= techo) {
      toast.info('Ya esperamos todo lo que podemos retener el pago. Probá con otro profesional.')
      return
    }
    setExtending(true)
    const deadline = Math.min(Date.now() + AUTH_WINDOW_SECONDS * 1000, techo)
    try {
      await consultationsService.update(consultationId, {
        ondemandWaitUntil: new Date(deadline).toISOString(),
      })
      aplicarVencimiento(deadline)
      setPhase('assigned')
      track('ondemand_wait_extended', { value: price, currency: 'ARS', flow: 'paciente' })
    } catch (err) {
      toast.error(err?.message || 'No pudimos extender la espera. Probá de nuevo.')
    } finally {
      setExtending(false)
    }
  }

  // ── Cancelar (patient-initiated abandonment) — releases the hold, no charge ──
  const handleCancel = async () => {
    if (cancelling) return
    setCancelling(true)
    clearInterval(countdownRef.current)
    if (consultationId) {
      const { error } = await mpService.cancelAuthorization(consultationId)
      if (error) console.error('[OnDemand] cancel-auth failed:', error)
    }
    toast.info('No se te cobró nada — la reserva en tu tarjeta se libera sola.')
    navigate('/paciente/dashboard')
  }

  // ── Venció la ventana sin que el profesional se conectara ────────────────────
  // Antes se liberaba la autorización acá mismo y el paciente se enteraba
  // después, con la reserva ya soltada: si quería seguir esperando cinco
  // minutos más tenía que volver al checkout y autorizar de nuevo, con el
  // riesgo de un segundo rechazo antifraude por reintentar la misma tarjeta.
  //
  // Ahora vencer no decide nada: se para el reloj y se pregunta. La reserva
  // sigue viva mientras el paciente elige, y sólo se suelta si él lo pide (o si
  // se va y la agarra el barrido del servidor).
  const handleTimeout = async () => {
    clearInterval(countdownRef.current)
    setPhase('timeout')
  }

  // Reintentar con el siguiente del pool, desde cero: se libera la reserva de
  // este profesional y la próxima autorización crea una consulta nueva.
  const handleTryNextPro = async () => {
    if (consultationId) {
      const { error } = await mpService.cancelAuthorization(consultationId)
      if (error) console.error('[OnDemand] cancel-auth al cambiar de profesional falló:', error)
    }
    setDeadlineAt(null)
    setWaitStartedAt(null)
    setConsultationId(null)
    setSelectedCardId(null)
    setAddCardMode(false)
    setSecondsLeft(AUTH_WINDOW_SECONDS)
    setPoolIndex(i => i + 1)
    setPhase('checkout')
  }

  // `id` is threaded through explicitly (never read back from `consultationId`
  // state) because `ensureConsultation()`'s `setConsultationId` call hasn't
  // committed yet within the same handler execution — reading the state var
  // right after awaiting it would race and still see the pre-creation `null`.
  const consultaItem = () => buildConsultaItem({
    id: `consulta_${vertical.id}`, name: `Consulta inmediata — Tele-${vertical.nombre}`, category: 'ondemand', price,
  })

  const finishPayment = async ({ data, error }, id, paymentMethod = 'saved_card') => {
    // Un error de la función igual trae el motivo de MP adentro de `data`: se
    // usa para explicar, en vez de tirar un mensaje técnico a la pantalla.
    if (error && !data) throw new Error(error)
    if (data?.status === 'authorized' || data?.status === 'approved' || data?.approved) {
      setErrorPago(null)
      track('purchase', {
        transaction_id: id, value: price, currency: 'ARS',
        payment_method: paymentMethod, items: consultaItem(),
        flow: 'paciente',
      })
      await handleAuthorized(id)
    } else {
      // Lo que MP contestó de verdad, traducido — antes acá salía siempre
      // "No pudimos autorizar el pago. Probá con otra tarjeta", que además a
      // veces era el consejo equivocado.
      const explicacion = explicarPagoMP({ status: data?.status, statusDetail: data?.statusDetail })
      setErrorPago(explicacion)
      track('payment_error', {
        error_type: explicacion.enRevision ? 'pending' : 'declined',
        error_code: explicacion.codigo ?? undefined,
        value: price, currency: 'ARS',
        flow: 'paciente',
      })
    }
  }

  // ── "Pagar e iniciar consulta" — demo bypass or a previously-saved card ───────
  const handlePay = async () => {
    if (paying || addCardMode || !matchedPro) return
    if (!profile?.id) { toast.error('Faltan datos para continuar'); return }

    track('begin_checkout', { value: price, currency: 'ARS', items: consultaItem(), flow: 'paciente' })

    if (paymentExempt) {
      setPaying(true)
      try {
        const id = await ensureConsultation()
        toast.success('Consulta bonificada — sin cargo para tu cuenta')
        await handleAuthorized(id)
      } catch (err) {
        toast.error(err?.message || 'Error al iniciar la consulta')
      } finally {
        setPaying(false)
      }
      return
    }

    if (isDemoMode) {
      setPaying(true)
      try {
        const id = await ensureConsultation()
        toast.success('Reserva de demostración autorizada')
        await handleAuthorized(id)
      } catch (err) {
        toast.error(err?.message || 'Error al iniciar la consulta')
      } finally {
        setPaying(false)
      }
      return
    }

    if (!selectedCardId) return
    setPaying(true)
    try {
      const id = await ensureConsultation()
      const chargeInfo = await cardSelectorRef.current?.getSavedCardCharge()
      const paymentType = getPaymentMethod(chargeInfo)
      track('add_payment_info', { payment_type: paymentType, value: price, currency: 'ARS', flow: 'paciente' })
      const result = await mpService.createPayment({
        consultationId: id,
        ...chargeInfo,
        authorizeOnly: true,
        description: `Consulta inmediata — Tele-${vertical.nombre}`,
      })
      await finishPayment(result, id, paymentType)
    } catch (err) {
      // Incluye el CVV mal puesto de la tarjeta guardada, que ya trae su propio
      // mensaje desde SavedCardSelector.
      setErrorPago({
        motivo: err?.message || 'No pudimos procesar el pago.',
        accion: 'Revisá los datos y volvé a intentar.',
        reintentable: true,
      })
    } finally {
      setPaying(false)
    }
  }

  // ── "Pagar con una tarjeta nueva" Brick's own submit button ───────────────────
  const handleNewCardCharge = async (chargeInfo) => {
    const paymentType = getPaymentMethod(chargeInfo)
    track('begin_checkout', { value: price, currency: 'ARS', items: consultaItem(), flow: 'paciente' })
    track('add_payment_info', { payment_type: paymentType, value: price, currency: 'ARS', flow: 'paciente' })

    setPaying(true)
    try {
      const id = await ensureConsultation()
      const result = await mpService.createPayment({
        consultationId: id,
        ...chargeInfo,
        authorizeOnly: true,
        description: `Consulta inmediata — Tele-${vertical.nombre}`,
      })
      await finishPayment(result, id, paymentType)
    } catch (err) {
      // Hasta acá sólo llegan fallas que no son un "no" de MP (red, sesión,
      // función caída). Se muestran en el mismo lugar que el resto, para que el
      // paciente nunca se quede sin explicación.
      setErrorPago({
        motivo: err?.message || 'No pudimos procesar el pago.',
        accion: 'Revisá tu conexión y volvé a intentar.',
        reintentable: true,
      })
    } finally {
      setPaying(false)
    }
  }

  // ── Step 1: match a real, payable professional — real price required ─────────
  useEffect(() => {
    if (cargandoVerticales || !vertical || vertical.comingSoon) return
    let cancelled = false

    mpService.getPaymentPlatformConfig().then(({ data }) => {
      if (!cancelled) { setPublicKey(data?.publicKey ?? null); setConfigLoading(false) }
    })

    const slugs = porVertical[verticalId] || []
    const primarySlug = slugs[0]

    // Sin fallback a `search({ specialty })` a secas: ese catch hacía que un
    // error de red terminara matcheando contra TODOS los profesionales de la
    // especialidad, incluidos los que nunca se anotaron a on-demand. Un fallo
    // de lectura ahora es "no hay nadie", que es lo honesto.
    const fetchPoolDeLaEspecialidad = () => primarySlug
      // `onlyLive` existía y nunca se pasaba: entraban al pool médicos que habían
      // tildado el switch hacía meses. Ahora "vivo" es haberlo declarado en la
      // última hora, no tener una pestaña abierta.
      ? professionalService.search({ specialty: primarySlug, onDemand: true, onlyLive: true }).catch(() => null)
      : Promise.resolve([])

    /*
     * `?pro=<userId>` — se llama a ESE profesional puntual, no al pool de la
     * especialidad entera. `getByUserId` no aplica ninguno de los filtros que
     * sí aplica `search()` (verificado, activo, on-demand, presencia viva), así
     * que se re-chequean acá a mano. Si no pasa alguno — se desconectó, dejó de
     * estar on-demand, etc. — se cae al pool normal de la especialidad en vez
     * de dejar al paciente sin nada: el link se lo mandó un profesional
     * puntual, pero la promesa es "atenderte ahora", no "esperar a que
     * vuelva a conectarse".
     */
    const fetchPros = direccionamientoDirecto
      ? professionalService.getByUserId(direccionamientoDirecto).then(pro => {
          const especialidadCoincide = !primarySlug || pro?.specialty === primarySlug
          const elegible = pro?.isVerified && pro?.isActive && pro?.isOnDemand && especialidadCoincide
            && pro?.onDemandLastSeenAt && (Date.now() - new Date(pro.onDemandLastSeenAt).getTime()) < ON_DEMAND_PRESENCE_TTL_MS
            && isPayable(pro)
          if (elegible) return [pro]
          return fetchPoolDeLaEspecialidad()
        }).catch(() => fetchPoolDeLaEspecialidad())
      : fetchPoolDeLaEspecialidad()

    /*
     * Antes de ofrecer el checkout hay que preguntar si el paciente ya pagó.
     *
     * Un refresh en la pantalla de espera perdía todo el estado y lo devolvía a
     * "Pagar e iniciar consulta" con la retención ya hecha en su tarjeta: el
     * camino directo a autorizar dos veces la misma consulta. Ahora la espera se
     * rehidrata desde la base — profesional, consulta y vencimiento — y el
     * checkout ni se muestra.
     */
    const rehidratarEspera = async () => {
      const viva = await consultationsService.getLiveOnDemand(profile?.id)
      // Sólo se rehidrata la espera de ESTA vertical: si tiene una consulta viva
      // de otra especialidad, esta pantalla no es la que la tiene que mostrar.
      if (!viva || viva.vertical !== verticalId) return false

      const pro = await professionalService.getByUserId(viva.professionalId)
      if (!pro) return false

      const creada = new Date(viva.createdAt).getTime()
      const vence = viva.ondemandWaitUntil
        ? new Date(viva.ondemandWaitUntil).getTime()
        : creada + AUTH_WINDOW_SECONDS * 1000

      if (cancelled) return null
      setConsultationId(viva.id)
      setWaitStartedAt(creada)
      aplicarVencimiento(vence)
      // Vencida mientras estaba cerrada: se le pregunta si quiere seguir
      // esperando en vez de decidir por él. La reserva sigue viva.
      setPhase(vence > Date.now() ? 'assigned' : 'timeout')
      return pro
    }

    Promise.all([rehidratarEspera().catch(() => null), fetchPros]).then(([proEnEspera, prosRaw]) => {
      if (cancelled) return

      // Rehidratada: el profesional que ya tiene la reserva va primero, y detrás
      // queda el resto del pool como cola de failover para "probar con otro".
      if (proEnEspera) {
        const resto = buildPool(prosRaw ?? []).filter(p => p.userId !== proEnEspera.userId)
        setProPool([proEnEspera, ...resto])
        setPoolIndex(0)
        return
      }

      if (prosRaw === null) { setPhase('search_error'); return }

      // Filtrado por cobrabilidad + rotación — ver src/lib/onDemandPool.js
      const rotated = buildPool(prosRaw)
      setProPool(rotated)
      setPoolIndex(0)
      setPhase(rotated.length ? 'checkout' : 'no_match')
    })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vertical, verticalId, cargandoVerticales, profile?.id, porVertical, direccionamientoDirecto])

  // ── Step 4: cuenta regresiva contra el vencimiento absoluto ──────────────────
  // Se recalcula contra el reloj en cada tick en vez de restar 1: así una
  // pestaña suspendida vuelve mostrando lo que realmente falta, y no el número
  // que había quedado congelado.
  useEffect(() => {
    if (phase !== 'assigned' || !deadlineAt) return
    const tick = () => {
      const restante = Math.max(0, Math.round((deadlineAt - Date.now()) / 1000))
      setSecondsLeft(restante)
      if (restante === 0) {
        clearInterval(countdownRef.current)
        handleTimeout()
      }
    }
    tick()
    countdownRef.current = setInterval(tick, 1000)
    return () => clearInterval(countdownRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, deadlineAt])

  if (cargandoVerticales) return null
  if (!vertical || vertical.comingSoon) return null

  // Vertical habilitada pero sin precio cargado: no se puede cobrar, y crear la
  // consulta con `priceAtBooking` en null rompe mp-payment más adelante ("no
  // valid price_at_booking"). Se corta acá, antes de tocar la tarjeta.
  if (!price) {
    return (
      <div className="absolute inset-0 bg-white z-[100] flex flex-col items-center justify-center p-6 animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
          {IconComp && <IconComp className="w-8 h-8 text-gray-400" />}
        </div>
        <h2 className="text-[22px] font-black text-gray-900 mb-2 text-center">No disponible por ahora</h2>
        <p className="text-gray-500 font-medium text-[15px] text-center mb-8">
          {vertical.nombre} todavía no tiene un precio de consulta inmediata configurado.
        </p>
        <button onClick={() => navigate('/paciente/dashboard')} className="bg-brand text-white px-8 py-3 rounded-[16px] font-bold">Volver al inicio</button>
      </div>
    )
  }

  // ── No professional available ──────────────────────────────────────────────
  if (phase === 'no_match') {
    return (
      <div className="absolute inset-0 bg-white z-[100] flex flex-col items-center justify-center p-6 animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
          <IconComp className="w-8 h-8 text-gray-400" />
        </div>
        <h2 className="text-[22px] font-black text-gray-900 mb-2 text-center">Sin disponibilidad</h2>
        <p className="text-gray-500 font-medium text-[15px] text-center mb-8">No hay profesionales de {vertical.nombre} disponibles ahora.</p>
        <button onClick={() => navigate('/paciente/dashboard')} className="bg-brand text-white px-8 py-3 rounded-[16px] font-bold">Volver al inicio</button>
      </div>
    )
  }

  // ── La lectura de profesionales falló ──────────────────────────────────────
  // Estado propio en vez de degradar en silencio a "no hay nadie": un error de
  // red y una agenda vacía son cosas distintas y el paciente merece reintentar.
  if (phase === 'search_error') {
    return (
      <div className="absolute inset-0 bg-white z-[100] flex flex-col items-center justify-center p-6 animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
          <IconComp className="w-8 h-8 text-gray-400" />
        </div>
        <h2 className="text-[22px] font-black text-gray-900 mb-2 text-center">No pudimos buscar profesionales</h2>
        <p className="text-gray-500 font-medium text-[15px] text-center mb-8">Revisá tu conexión y probá de nuevo.</p>
        <button onClick={() => window.location.reload()} className="bg-brand text-white px-8 py-3 rounded-[16px] font-bold mb-3">Reintentar</button>
        <button onClick={() => navigate('/paciente/dashboard')} className="text-gray-500 font-bold text-[15px] py-2">Volver al inicio</button>
      </div>
    )
  }

  // ── Venció la ventana sin que el profesional se conectara ──────────────────
  // La reserva sigue viva hasta que el paciente decida: puede esperar más (sin
  // volver a pasar por el checkout), cambiar de profesional o irse.
  if (phase === 'timeout') {
    const hayOtro = poolIndex + 1 < proPool.length
    const puedeEsperarMas = !waitStartedAt || Date.now() < waitStartedAt + MAX_WAIT_SECONDS * 1000
    return (
      <div className="absolute inset-0 bg-white z-[100] overflow-y-auto animate-fade-in">
        <div className="min-h-full flex flex-col items-center justify-center p-6">
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
            <Clock className="w-8 h-8 text-gray-400" />
          </div>
          <h2 className="text-[22px] font-black text-gray-900 mb-2 text-center">{proName} todavía no se conectó</h2>
          <p className="text-gray-500 font-medium text-[15px] text-center mb-2">
            {puedeEsperarMas
              ? 'Todavía no te cobramos nada. La reserva en tu tarjeta sigue tomada mientras decidís.'
              : 'Todavía no te cobramos nada. No podemos seguir reteniendo el pago más tiempo.'}
          </p>
          <p className="text-gray-500 font-medium text-[15px] text-center mb-8">
            {hayOtro
              ? 'Podés esperarlo un rato más o probar con otro profesional disponible.'
              : 'Por ahora no hay otro profesional disponible en esta especialidad.'}
          </p>
          {puedeEsperarMas && (
            <button
              onClick={handleMoreTime}
              disabled={extending}
              className="bg-brand text-white px-8 py-3 rounded-[16px] font-bold mb-3 flex items-center gap-2 disabled:opacity-50"
            >
              {extending && <CircleNotch className="w-4 h-4 animate-spin" />}
              Necesito más tiempo
            </button>
          )}
          {hayOtro && (
            <button
              onClick={handleTryNextPro}
              className={`px-8 py-3 rounded-[16px] font-bold mb-3 ${puedeEsperarMas ? 'bg-gray-50 text-gray-600 hover:bg-gray-100' : 'bg-brand text-white'}`}
            >
              Probar con otro profesional
            </button>
          )}
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="text-gray-500 font-bold text-[15px] py-2 disabled:opacity-50"
          >
            {cancelling ? 'Liberando la reserva...' : 'Cancelar y volver al inicio'}
          </button>
        </div>
      </div>
    )
  }

  // ── Assigned — pre-auth succeeded, real countdown running ──────────────────
  if (phase === 'assigned') {
    const urgent = secondsLeft <= 60
    return (
      <div className="absolute inset-0 bg-bg-primary z-[100] flex flex-col items-center justify-between p-6 animate-fade-in overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1/2 bg-brand-muted/30 rounded-b-[100px]" />
        <div className="w-full max-w-md mx-auto flex justify-end pt-8 relative z-10">
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="w-10 h-10 bg-white border border-gray-100 rounded-full flex items-center justify-center shadow-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50"
          >
            {cancelling ? <CircleNotch className="w-4 h-4 animate-spin" /> : '✕'}
          </button>
        </div>
        <div className="flex flex-col items-center relative z-10 w-full max-w-md mx-auto mt-4">
          <div className="bg-emerald-50 text-emerald-700 px-4 py-1.5 rounded-full text-[11px] font-black tracking-widest uppercase mb-6 shadow-sm flex items-center gap-2 border border-emerald-100">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" /> Profesional Asignado
          </div>
          <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-white shadow-lg mb-6 bg-gray-100 flex items-center justify-center">
            {proAvatar
              ? <img src={proAvatar} alt={proName} className="w-full h-full object-cover" />
              : <span className="text-4xl font-black text-gray-400">{proName[0]}</span>
            }
          </div>
          <h2 className="text-[30px] font-black text-gray-900 leading-none mb-2 text-center">{proName}</h2>
          <p className="text-gray-500 font-bold text-[15px] mb-4 text-center uppercase tracking-wider">{proSpecialty}</p>
          <div className="flex items-center gap-2 bg-[#F8FAFC] px-4 py-2 rounded-xl border border-gray-100">
            <span className="text-yellow-400">★</span>
            <span className="font-bold text-[14px] text-gray-900">{proRating} Excelencia</span>
          </div>
        </div>
        <div className="w-full max-w-md mx-auto bg-white rounded-[32px] p-6 shadow-[0_0_40px_rgba(0,0,0,0.06)] border border-gray-100 relative z-10 mt-auto">
          <div className={`flex items-center gap-4 mb-6 p-4 rounded-[20px] border ${urgent ? 'bg-red-50 border-red-200' : 'bg-brand-muted/40 border-brand/20'}`}>
            <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm shrink-0">
              <Clock className={`w-5 h-5 ${urgent ? 'text-red-500' : 'text-brand'}`} />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-bold text-gray-900 text-[15px] mb-1">Pago autorizado — falta un paso</h4>
              <p className="text-gray-500 text-[13px] leading-snug">Contanos qué te pasa y avisale a {proName} que estás listo. Si se acaba el tiempo te preguntamos si querés seguir esperando.</p>
            </div>
            <span className={`font-mono font-black text-[22px] tabular-nums shrink-0 ${urgent ? 'text-red-600' : 'text-gray-900'}`}>
              {formatCountdown(secondsLeft)}
            </span>
          </div>
          <button
            data-testid="enter-call-btn"
            onClick={() => navigate(consultationId ? `/paciente/sala-espera/${consultationId}` : '/paciente/videollamada/1')}
            className="w-full bg-brand text-white py-4 rounded-[20px] font-bold text-[17px] shadow-md hover:bg-brand-hover active:scale-95 transition-all flex justify-center items-center gap-3 mb-4"
          >
            <VideoCamera className="w-5 h-5" /> Continuar
          </button>
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="w-full bg-gray-50 text-gray-500 py-3.5 rounded-[16px] font-bold text-[15px] flex justify-center items-center gap-2 hover:bg-gray-100 disabled:opacity-50"
          >
            {cancelling ? <CircleNotch className="w-4 h-4 animate-spin" /> : null}
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  // ── Searching ───────────────────────────────────────────────────────────────
  if (phase === 'searching') {
    return (
      <div className="absolute inset-0 bg-white z-[100] flex flex-col items-center justify-center animate-fade-in">
        <div className="max-w-md mx-auto w-full flex flex-col items-center">
          <div className="relative w-40 h-40 flex items-center justify-center mb-8">
            <div className="absolute inset-0 border-2 border-brand/20 rounded-full animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" />
            <div className="w-20 h-20 rounded-full flex items-center justify-center z-10 border-2 border-blue-100" style={{ backgroundColor: vertical.bg }}>
              <IconComp className="w-8 h-8" style={{ color: vertical.color }} />
            </div>
          </div>
          <h2 className="text-[24px] font-black mb-2 text-gray-900">Buscando profesional...</h2>
          <p className="text-gray-500 font-medium text-[15px]">Analizando perfiles disponibles.</p>
        </div>
      </div>
    )
  }

  // ── Checkout — real matched professional, real price, real MP pre-auth ───────
  // Full-height screen (not a sheet/overlay) — a sticky header with a back
  // arrow gated behind a confirm sheet is the only way out until payment
  // succeeds, since abandoning here means losing the matched professional.
  return (
    <div className="absolute inset-0 bg-bg-primary z-[100] flex flex-col animate-fade-in">
      <div className="flex items-center gap-3 px-4 pt-6 pb-4 sm:px-6 sm:pt-8 flex-shrink-0">
        <button
          onClick={() => setShowExitConfirm(true)}
          className="w-11 h-11 bg-white border border-gray-100 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50 shrink-0"
        >
          <ArrowLeft className="h-5 w-5 text-gray-900" />
        </button>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: vertical.bg }}>
          <IconComp className="h-5 w-5" style={{ color: vertical.color }} />
        </div>
        <h1 className="text-[20px] sm:text-[22px] font-light tracking-tight text-gray-900 leading-none">Tele-{vertical.nombre}</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-10">
        <div className="w-full sm:max-w-lg mx-auto">
          {/* Real matched professional + real price (spec D1.1) */}
          <div className="flex items-center gap-4 mb-4 p-4 bg-[#F8FAFC] rounded-[24px] border border-gray-200">
            <div className="w-14 h-14 rounded-full overflow-hidden shrink-0 bg-white border border-gray-100 flex items-center justify-center">
              {proAvatar
                ? <img src={proAvatar} alt={proName} className="w-full h-full object-cover" />
                : <span className="text-xl font-black text-gray-400">{proName[0]}</span>
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-[16px] text-gray-900 truncate">{proName}</p>
              <p className="text-[13px] text-gray-500 flex items-center gap-1 flex-wrap">
                {proSpecialty} · <Clock className="h-3.5 w-3.5" /> Espera hasta {AUTH_WINDOW_SECONDS / 60} min
              </p>
            </div>
            <p className="font-black text-[22px] text-gray-900 shrink-0">
              {paymentExempt ? 'Bonificado' : price != null ? `$${price.toLocaleString('es-AR')}` : '—'}
            </p>
          </div>

          {/* Método de pago */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Método de Pago</p>
              {isDemoMode && (
                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wide">DEMO</span>
              )}
              {paymentExempt && (
                <span className="px-2 py-0.5 rounded-full bg-brand-muted text-brand text-[10px] font-bold uppercase tracking-wide">Bonificado</span>
              )}
            </div>
            {isDemoMode ? (
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-amber-200 bg-amber-50">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-amber-100">
                  <CreditCard size={18} weight="fill" className="text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-gray-900">Pago de demostración</p>
                  <p className="text-[11px] text-gray-400">Sin cargo real — VITE_MP_PUBLIC_KEY no está configurada</p>
                </div>
              </div>
            ) : paymentExempt ? (
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-brand/30 bg-brand-muted">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-white">
                  <ShieldCheck size={18} weight="fill" className="text-brand" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-gray-900">Consulta bonificada</p>
                  <p className="text-[11px] text-gray-400">Sin cargo para tu cuenta</p>
                </div>
              </div>
            ) : (
              <SavedCardSelector
                ref={cardSelectorRef}
                selectedCardId={selectedCardId}
                // Elegir otra tarjeta es un intento nuevo: si no se limpia,
                // el CTA se queda en "Reintentar el pago" y el cartel rojo
                // sigue hablando de una tarjeta que ya no es la seleccionada.
                onCardSelected={id => { setErrorPago(null); setSelectedCardId(id) }}
                publicKey={publicKey}
                payerEmail={profile?.email ?? ''}
                amount={price ?? undefined}
                disabled={paying}
                onNewCardCharge={handleNewCardCharge}
                onAddCardModeChange={next => { if (next) setErrorPago(null); setAddCardMode(next) }}
              />
            )}
          </div>

          {/* Qué pasó con el último intento de pago.
              Fijo en pantalla, no un toast: cuando MP rechaza, el paciente se
              quedaba mirando un botón gris sin ninguna explicación (Mateo,
              2026-07-31). Dice el motivo real de MP, qué puede hacer, y el
              código por si termina hablando con soporte. */}
          {errorPago && (
            <div className="mb-4 p-4 rounded-[20px] border border-danger/30 bg-danger/5" role="alert">
              <div className="flex items-start gap-3">
                <Warning className="w-5 h-5 text-danger shrink-0 mt-0.5" weight="fill" />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-gray-900 leading-snug">{errorPago.motivo}</p>
                  {errorPago.accion && (
                    <p className="text-[13px] text-gray-600 leading-snug mt-1">{errorPago.accion}</p>
                  )}
                  <div className="flex items-center gap-3 mt-3">
                    <button
                      type="button"
                      onClick={() => { setErrorPago(null); setAddCardMode(true) }}
                      className="text-[13px] font-semibold text-brand underline underline-offset-2"
                    >
                      Probar con otra tarjeta
                    </button>
                    {errorPago.codigo && (
                      <span className="text-[11px] text-gray-400 font-mono truncate">{errorPago.codigo}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Pre-auth explanation — no charge until the consultation ends (moved below
              Método de Pago per Mateo, 2026-07-27) */}
          {!paymentExempt && (
            <div className="flex items-start gap-3 mb-3 p-4 bg-brand-muted/30 rounded-[20px] border border-brand/20">
              <ShieldCheck className="w-5 h-5 text-brand shrink-0 mt-0.5" weight="fill" />
              <p className="text-[13px] text-gray-600 leading-snug">
                El pago se hará efectivo una vez que finalices tu consulta. Healthier no guarda tus datos, utilizamos Mercado Pago para mayor seguridad.
              </p>
            </div>
          )}

          {/* Credit-card-only notice (spec: v1 solo tarjeta de crédito) — MP-branded copy */}
          {!isDemoMode && !paymentExempt && (
            <div className="flex items-start gap-3 mb-6 p-4 bg-amber-50 rounded-[20px] border border-amber-200">
              <MercadoPagoMark className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-[13px] text-amber-700 leading-snug">
                Compra protegida y solo válida con tarjeta de crédito a través de Mercado Pago.
              </p>
            </div>
          )}

          {/* CTA — hidden while the "new card" Brick's own submit button is active */}
          {!addCardMode && (
            <button
              onClick={handlePay}
              disabled={paying || missingCard}
              className={`w-full py-5 rounded-[20px] font-bold text-[17px] shadow-sm transition-all flex justify-center items-center gap-2
                ${paying ? 'bg-gray-100 text-gray-400' :
                  missingCard ? 'bg-gray-100 text-gray-400' :
                  'bg-brand text-white hover:bg-brand-hover active:scale-95'}`}
            >
              {/* Después de un rechazo el botón decía "Pagar $1.000 e iniciar"
                  igual que antes de intentar, con el mismo tilde de confianza —
                  no había nada que dijera que apretarlo era REINTENTAR sobre la
                  misma tarjeta que MP acaba de rechazar (Mateo, 2026-07-31).
                  Vuelve solo a "Pagar" cuando el intento deja de estar fallado:
                  al cargar otra tarjeta, al elegir otra guardada o al tocar
                  "Probar con otra tarjeta". */}
              {paying
                ? <><CircleNotch className="w-5 h-5 animate-spin" /> Autorizando...</>
                : errorPago
                  ? <><ArrowClockwise className="w-5 h-5" /> Reintentar el pago</>
                  : <><Check className="w-5 h-5" /> {price != null ? `Pagar $${price.toLocaleString('es-AR')} e iniciar` : 'Pagar e iniciar'}</>
              }
            </button>
          )}
        </div>
      </div>

      {/* ─── Exit confirm — the only way out of checkout before payment succeeds ─── */}
      <PatientSheet open={showExitConfirm} onClose={() => setShowExitConfirm(false)} maxWidth="max-w-md">
        <div className="px-6 pt-2 pb-8">
          <h2 className="text-[22px] font-light text-gray-900 mb-2 text-center leading-tight">¿Cancelar el pedido de consulta?</h2>
          <p className="text-gray-500 text-[14px] text-center mb-7 leading-snug">
            Si salís ahora, vamos a tener que conectarte con otro profesional de nuevo y es posible que tengas que esperar.
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => navigate('/paciente/dashboard')}
              className="btn-danger w-full py-4 rounded-3xl font-semibold text-[15px]"
            >
              Sí, cancelar pedido
            </button>
            <button
              onClick={() => setShowExitConfirm(false)}
              className="btn-secondary w-full py-4 rounded-3xl font-semibold text-[15px]"
            >
              Seguir con mi consulta
            </button>
          </div>
        </div>
      </PatientSheet>
    </div>
  )
}
