import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, VideoCamera, Clock, CircleNotch, Check, ShieldCheck, CreditCard, Warning,
  ArrowClockwise, UserCircle, User, CaretDown,
} from '@phosphor-icons/react'
import { toast } from '../../components/Toast'
import { professionalService } from '../../services/professionalService'
import { mpService } from '../../services/mpService'
import { consultationsService } from '../../services/consultationsService'
import { ondemandService, BUSQUEDA_MAX_MS } from '../../services/ondemandService'
import PatientSheet from '../../components/patient/PatientSheet'
import SavedCardSelector from '../../components/payment/SavedCardSelector'
import MercadoPagoMark from '../../components/icons/MercadoPagoMark'
import { explicarPagoMP, explicarErrorDePago } from '../../lib/mercadoPago'
import { useVerticales } from '../../hooks/useVerticales'
import { useEspecialidades } from '../../hooks/useEspecialidades'
import { useGrupoFamiliar } from '../../hooks/useGrupoFamiliar'
import { puedeBonificarTeleclinica } from '../../lib/featureFlags'
import { track, getPaymentMethod, buildConsultaItem } from '../../utils/analytics'

/*
 * Teleclínica — consulta inmediata por DESPACHO (Mateo, 2026-10-07; migración 191).
 *
 * El orden para el paciente es:
 *   1. checkout   — elige o carga la tarjeta (con CVV) y toca "Pagar". La
 *                   tarjeta se tokeniza acá y el token queda guardado del lado
 *                   del servidor. Todavía no se reserva nada.
 *   2. buscando   — "Buscando un médico disponible", sin nombre ni foto. El
 *                   pedido les suena a todos los elegibles a la vez.
 *   3. asignado   — "Te atiende la Dra. X", con foto, "Ver perfil" y el botón
 *                   para entrar. La reserva en la tarjeta ya se hizo, contra la
 *                   cuenta de Mercado Pago de quien aceptó.
 *
 * Desvíos:
 *   · sin_respuesta  — nadie aceptó a tiempo. No se cobró nada. Puede seguir
 *                      buscando (hasta 20 min) o irse.
 *   · pago_rechazado — un médico ya aceptó pero la tarjeta no pasó: se le pide
 *                      otra en el momento, sobre la misma consulta.
 *
 * Reemplaza al modelo del pool (el paciente veía a un profesional elegido al
 * azar ANTES de pagar y esperaba a ese). `?pro=` (llamar a un médico puntual)
 * ya no aplica: el pedido le suena a todos los que pueden atender.
 */

const BUSQUEDA_SEGUNDOS_INICIAL = 4 * 60

function formatCountdown(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function OnDemand({ profile }) {
  const { vertical: verticalId } = useParams()
  const [searchParams] = useSearchParams()
  const { familiares } = useGrupoFamiliar(profile?.id)
  const [paraId, setParaId] = useState(() => searchParams.get('para'))
  const nombreFamiliar = f => f.familiar?.fullName || f.fullName || 'Tu familiar'
  const familiarElegido = paraId && paraId !== profile?.id ? familiares.find(f => f.familiarId === paraId) : null
  const etiquetaParaQuien = familiarElegido ? `Para ${nombreFamiliar(familiarElegido)}` : 'Para mí'
  const navigate = useNavigate()
  const { verticalesById, cargando: cargandoVerticales } = useVerticales()
  const { porSlug } = useEspecialidades()
  const vertical = verticalesById[verticalId]
  const cardSelectorRef = useRef(null)

  // 'cargando' → 'checkout' → 'buscando' → 'asignado'
  //                         ↘ 'no_match'  ↘ 'sin_respuesta' | 'pago_rechazado'
  const [phase, setPhase] = useState('cargando')
  const [pedido, setPedido] = useState(null)
  const [pro, setPro] = useState(null)

  const [publicKey, setPublicKey] = useState(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [selectedCardId, setSelectedCardId] = useState(null)
  const [addCardMode, setAddCardMode] = useState(false)
  const [errorPago, setErrorPago] = useState(null)
  const [paying, setPaying] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(BUSQUEDA_SEGUNDOS_INICIAL)
  const [ocupado, setOcupado] = useState(false)
  const [showExitConfirm, setShowExitConfirm] = useState(false)

  const isDemoMode = !configLoading && !publicKey
  // Interruptor de bonificación: sólo se ve en la cuenta de Mateo, y el
  // servidor vuelve a chequear la cuenta antes de bonificar.
  const puedeBonificar = puedeBonificarTeleclinica(profile)
  const [bonificar, setBonificar] = useState(false)
  const paymentExempt = Boolean(profile?.paymentExempt) || (puedeBonificar && bonificar)
  const missingCard = !paymentExempt && !selectedCardId
  const IconComp = vertical?.icon
  const price = vertical?.onDemandPrice ?? null
  const proName = pro?.profiles?.fullName || 'Tu profesional'
  const proAvatar = pro?.profiles?.avatarUrl || null
  const proSpecialty = pro ? (porSlug[pro.specialty] || vertical?.nombre) : vertical?.nombre

  useEffect(() => {
    if (cargandoVerticales) return
    if (!vertical || vertical.comingSoon) navigate('/paciente/dashboard')
  }, [vertical, cargandoVerticales, navigate])

  const consultaItem = () => buildConsultaItem({
    id: `consulta_${vertical.id}`, name: `Consulta inmediata — Tele-${vertical.nombre}`, category: 'ondemand', price,
  })

  // ── Qué pantalla corresponde a un pedido ─────────────────────────────────────
  // Un solo lugar que traduce el estado del pedido a la fase, para que el
  // Realtime, el poll de respaldo y la rehidratación digan siempre lo mismo.
  const aplicarPedido = useCallback(async (p) => {
    if (!p) return
    setPedido(p)
    if (p.status === 'pending') {
      const vence = new Date(p.expiresAt).getTime()
      if (vence > Date.now()) { setPhase('buscando'); return }
      setPhase('sin_respuesta'); return
    }
    if (p.status === 'expired') { setPhase('sin_respuesta'); return }
    if (p.status === 'cancelled') { navigate('/paciente/dashboard'); return }
    if (p.status === 'accepted') {
      if (p.acceptedBy) {
        const quien = await professionalService.getByUserId(p.acceptedBy).catch(() => null)
        if (quien) setPro(quien)
      }
      if (p.estadoPago === 'rechazado') { setPhase('pago_rechazado'); return }
      if (p.estadoPago === 'autorizado' || p.estadoPago === 'sin_pago') { setPhase('asignado'); return }
      // `pendiente` con el pedido ya aceptado: el servidor está creando la
      // reserva en este instante. Se sigue mostrando "buscando" un segundo más.
      setPhase('buscando')
    }
  }, [navigate])

  // ── Carga: config de MP + rehidratar un pedido vivo ──────────────────────────
  useEffect(() => {
    if (cargandoVerticales || !vertical || vertical.comingSoon || !profile?.id) return
    let cancelado = false
    mpService.getPaymentPlatformConfig().then(({ data }) => {
      if (!cancelado) { setPublicKey(data?.publicKey ?? null); setConfigLoading(false) }
    })
    ondemandService.getMiPedidoVivo(profile.id, verticalId)
      .then(p => { if (cancelado) return; if (p) aplicarPedido(p); else setPhase('checkout') })
      .catch(() => { if (!cancelado) setPhase('checkout') })
    return () => { cancelado = true }
  }, [cargandoVerticales, vertical, verticalId, profile?.id, aplicarPedido])

  // ── En vivo: Realtime sobre el pedido + un poll de respaldo ──────────────────
  const pedidoId = pedido?.id
  useEffect(() => {
    if (!pedidoId || !['buscando', 'pago_rechazado'].includes(phase)) return
    const releer = () => ondemandService.getPedido(pedidoId).then(aplicarPedido).catch(() => {})
    const desuscribir = ondemandService.suscribir('paciente', `id=eq.${pedidoId}`, () => releer())
    const iv = setInterval(releer, 5000)
    return () => { desuscribir(); clearInterval(iv) }
  }, [pedidoId, phase, aplicarPedido])

  // ── Cuenta regresiva de la búsqueda, contra el vencimiento absoluto ─────────
  useEffect(() => {
    if (phase !== 'buscando' || !pedido?.expiresAt) return
    const vence = new Date(pedido.expiresAt).getTime()
    const tick = () => {
      const restante = Math.max(0, Math.round((vence - Date.now()) / 1000))
      setSecondsLeft(restante)
      if (restante === 0 && pedido.status === 'pending') setPhase('sin_respuesta')
    }
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [phase, pedido?.expiresAt, pedido?.status])

  // ── "Pagar" — deja el token y arranca la búsqueda ───────────────────────────
  const pedir = async (pago) => {
    const res = await ondemandService.pedir({ vertical: verticalId, paraId: paraId && paraId !== profile.id ? paraId : null, pago, bonificar: puedeBonificar && bonificar })
    if (res?.sinProfesionales) { setPhase('no_match'); return }
    track('ondemand_requested', { value: price, currency: 'ARS', flow: 'paciente' })
    const p = await ondemandService.getPedido(res.requestId)
    await aplicarPedido(p ?? { id: res.requestId, status: 'pending', expiresAt: res.expiresAt })
  }

  const conPago = async (obtenerCharge) => {
    if (paying) return
    setPaying(true)
    setErrorPago(null)
    track('begin_checkout', { value: price, currency: 'ARS', items: consultaItem(), flow: 'paciente' })
    try {
      const charge = await obtenerCharge()
      if (charge) track('add_payment_info', { payment_type: getPaymentMethod(charge), value: price, currency: 'ARS', flow: 'paciente' })
      await pedir(charge ? { ...charge, deviceId: window.MP_DEVICE_SESSION_ID || null } : null)
    } catch (err) {
      setErrorPago(err?.message ? explicarErrorDePago(err.message) : { motivo: 'No pudimos iniciar la búsqueda.', accion: 'Revisá los datos y volvé a intentar.', reintentable: true })
    } finally {
      setPaying(false)
    }
  }

  const handlePay = () => {
    if (addCardMode) return
    if (paymentExempt) return conPago(async () => null)
    if (!selectedCardId) return
    return conPago(() => cardSelectorRef.current?.getSavedCardCharge())
  }
  const handleNewCardCharge = (chargeInfo) => conPago(async () => chargeInfo)

  // ── Cancelar la búsqueda — nadie aceptó todavía, no se cobró nada ───────────
  const cancelarBusqueda = async () => {
    if (ocupado || !pedido) return
    setOcupado(true)
    try {
      const r = await ondemandService.cancelar(pedido.id)
      if (r?.cancelado === false) {
        // Justo lo aceptaron: se muestra quién, en vez de cancelar a ciegas.
        await aplicarPedido(await ondemandService.getPedido(pedido.id))
        return
      }
      toast.info('Cancelaste la búsqueda. No te cobramos nada.')
      navigate('/paciente/dashboard')
    } catch (err) {
      toast.error(err?.message || 'No pudimos cancelar. Probá de nuevo.')
    } finally {
      setOcupado(false)
    }
  }

  const seguirBuscando = async () => {
    if (ocupado || !pedido) return
    setOcupado(true)
    try {
      const r = await ondemandService.extender(pedido.id)
      if (r?.sinToken) { setPedido(null); setPhase('checkout'); return }
      await aplicarPedido({ ...pedido, status: 'pending', expiresAt: r.expiresAt })
    } catch (err) {
      toast.info(err?.message || 'No pudimos seguir buscando.')
      setPedido(null)
      setPhase('checkout')
    } finally {
      setOcupado(false)
    }
  }

  // ── Ya asignado: cancelar la consulta libera la reserva ─────────────────────
  const cancelarConsulta = async () => {
    if (ocupado) return
    setOcupado(true)
    if (pedido?.consultationId) {
      // Con reserva hecha, mp-capture la suelta y cancela la consulta. Sin
      // reserva (bonificada, o la tarjeta se rechazó) no hay nada que soltar:
      // se cancela la consulta directo, para que el médico no siga esperando.
      const { error } = await mpService.cancelAuthorization(pedido.consultationId)
      if (error) {
        await consultationsService.cancel(pedido.consultationId, profile.id, 'El paciente canceló la consulta inmediata')
          .catch(err => console.error('[OnDemand] no se pudo cancelar la consulta:', err))
      }
    }
    toast.info('No se te cobró nada — la reserva en tu tarjeta se libera sola.')
    navigate('/paciente/dashboard')
  }

  // ── La tarjeta se rechazó después de que alguien aceptó: otra tarjeta ───────
  const pagarDeNuevo = async (obtenerCharge) => {
    if (paying || !pedido?.consultationId) return
    setPaying(true)
    setErrorPago(null)
    try {
      const charge = await obtenerCharge()
      const { data, error } = await mpService.createPayment({
        consultationId: pedido.consultationId,
        ...charge,
        authorizeOnly: true,
        description: `Consulta inmediata — Tele-${vertical.nombre}`,
      })
      if (error && !data) throw new Error(error)
      if (data?.status === 'authorized' || data?.status === 'approved') {
        track('purchase', { transaction_id: pedido.consultationId, value: price, currency: 'ARS', payment_method: getPaymentMethod(charge), items: consultaItem(), flow: 'paciente' })
        setPhase('asignado')
      } else {
        setErrorPago(data?.statusDetail || !error
          ? explicarPagoMP({ status: data?.status, statusDetail: data?.statusDetail })
          : explicarErrorDePago(error))
      }
    } catch (err) {
      setErrorPago(err?.message ? explicarErrorDePago(err.message) : { motivo: 'No pudimos procesar el pago.', accion: 'Revisá los datos y volvé a intentar.', reintentable: true })
    } finally {
      setPaying(false)
    }
  }

  if (cargandoVerticales || !vertical || vertical.comingSoon) return null

  const pantallaCentrada = (children) => (
    <div className="absolute inset-0 bg-white z-[100] overflow-y-auto animate-fade-in">
      <div className="min-h-full flex flex-col items-center justify-center p-6 max-w-md mx-auto">{children}</div>
    </div>
  )

  if (!price && !paymentExempt) {
    return pantallaCentrada(<>
      <h2 className="text-[22px] font-light text-gray-900 mb-2 text-center">No disponible por ahora</h2>
      <p className="text-gray-500 text-[15px] text-center mb-8">{vertical.nombre} todavía no tiene un precio de consulta inmediata configurado.</p>
      <button onClick={() => navigate('/paciente/dashboard')} className="btn-primary px-8 py-3">Volver al inicio</button>
    </>)
  }

  if (phase === 'cargando') {
    return pantallaCentrada(<CircleNotch className="w-8 h-8 text-brand animate-spin" />)
  }

  if (phase === 'no_match') {
    return pantallaCentrada(<>
      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
        {IconComp && <IconComp className="w-8 h-8 text-gray-400" />}
      </div>
      <h2 className="text-[22px] font-light text-gray-900 mb-2 text-center">Sin disponibilidad</h2>
      <p className="text-gray-500 text-[15px] text-center mb-8">No hay profesionales de {vertical.nombre} disponibles ahora. No te cobramos nada.</p>
      <button onClick={() => navigate('/paciente/dashboard')} className="btn-primary px-8 py-3">Volver al inicio</button>
    </>)
  }

  // ── Buscando — sin nombre ni foto ─────────────────────────────────────────
  if (phase === 'buscando') {
    return pantallaCentrada(<>
      <div className="relative w-40 h-40 flex items-center justify-center mb-8">
        <div className="absolute inset-0 border-2 border-brand/20 rounded-full animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" />
        <div className="w-20 h-20 rounded-full bg-brand-muted flex items-center justify-center z-10">
          {IconComp && <IconComp className="w-8 h-8 text-brand" />}
        </div>
      </div>
      <h2 className="text-[26px] font-light text-gray-900 mb-2 text-center leading-tight" data-testid="ondemand-buscando">Buscando un médico disponible</h2>
      <p className="text-gray-500 text-[15px] text-center mb-6">Les avisamos a los profesionales de {vertical.nombre} que están conectados. El primero que acepte te atiende.</p>
      <div className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-full px-4 py-2 mb-6">
        <Clock className="w-4 h-4 text-gray-500" />
        <span className="font-mono tabular-nums text-[15px] text-gray-900">{formatCountdown(secondsLeft)}</span>
      </div>
      <div className="flex items-start gap-3 p-4 bg-brand-muted/30 rounded-[20px] border border-brand/20 mb-6 w-full">
        <ShieldCheck className="w-5 h-5 text-brand shrink-0 mt-0.5" weight="fill" />
        <p className="text-[13px] text-gray-600 leading-snug">Todavía no te cobramos nada. Si nadie acepta, no se cobra.</p>
      </div>
      <button onClick={cancelarBusqueda} disabled={ocupado} className="text-gray-500 font-semibold text-[15px] py-2 disabled:opacity-50">
        {ocupado ? 'Cancelando…' : 'Cancelar'}
      </button>
    </>)
  }

  // ── Nadie aceptó a tiempo ─────────────────────────────────────────────────
  if (phase === 'sin_respuesta') {
    const puedeSeguir = pedido && Date.now() < new Date(pedido.createdAt ?? Date.now()).getTime() + BUSQUEDA_MAX_MS
    return pantallaCentrada(<>
      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
        <Clock className="w-8 h-8 text-gray-400" />
      </div>
      <h2 className="text-[22px] font-light text-gray-900 mb-2 text-center">Nadie pudo atenderte todavía</h2>
      <p className="text-gray-500 text-[15px] text-center mb-8">No te cobramos nada. Podés seguir buscando unos minutos más o volver más tarde.</p>
      {puedeSeguir && (
        <button onClick={seguirBuscando} disabled={ocupado} className="btn-primary px-8 py-3 mb-3 flex items-center gap-2 disabled:opacity-50">
          {ocupado && <CircleNotch className="w-4 h-4 animate-spin" />} Seguir buscando
        </button>
      )}
      <button onClick={() => navigate('/paciente/dashboard')} className="text-gray-500 font-semibold text-[15px] py-2">Volver al inicio</button>
    </>)
  }

  // ── Te atiende X ──────────────────────────────────────────────────────────
  if (phase === 'asignado') {
    return (
      <div className="absolute inset-0 bg-bg-primary z-[100] flex flex-col items-center justify-between p-6 animate-fade-in overflow-y-auto">
        <div className="absolute top-0 left-0 w-full h-1/2 bg-brand-muted/30 rounded-b-[100px]" />
        <div className="flex flex-col items-center relative z-10 w-full max-w-md mx-auto mt-10">
          <div className="bg-emerald-50 text-emerald-700 px-4 py-1.5 rounded-full text-[11px] font-semibold tracking-widest uppercase mb-6 flex items-center gap-2 border border-emerald-100">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" /> Profesional asignado
          </div>
          <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-white shadow-lg mb-6 bg-gray-100 flex items-center justify-center">
            {proAvatar
              ? <img src={proAvatar} alt={proName} className="w-full h-full object-cover" />
              : <span className="text-4xl text-gray-400">{proName.replace(/^(Dra?\.|Lic\.)\s*/i, '')[0]}</span>}
          </div>
          <p className="text-gray-500 text-[15px] mb-1">Te atiende</p>
          <h2 className="text-[30px] font-light text-gray-900 leading-tight mb-2 text-center" data-testid="ondemand-te-atiende">{proName}</h2>
          <p className="text-gray-500 text-[14px] mb-4 text-center uppercase tracking-wider">{proSpecialty}</p>
          {pro?.userId && (
            <button
              onClick={() => navigate(`/paciente/profesional/${pro.userId}?desde=teleclinica`)}
              className="flex items-center gap-2 text-brand font-semibold text-[15px] underline underline-offset-4"
            >
              <UserCircle className="w-5 h-5" /> Ver perfil
            </button>
          )}
        </div>
        <div className="w-full max-w-md mx-auto bg-white rounded-[32px] p-6 shadow-[0_0_40px_rgba(0,0,0,0.06)] border border-gray-100 relative z-10 mt-8">
          <p className="text-[13px] text-gray-500 leading-snug mb-5">
            Antes de entrar te hacemos unas preguntas rápidas para que {proName} tenga todo a mano al empezar. El pago se hace efectivo cuando termina la consulta.
          </p>
          <button
            data-testid="enter-call-btn"
            onClick={() => navigate(`/paciente/sala-espera/${pedido.consultationId}`)}
            className="w-full bg-brand text-white py-4 rounded-[20px] font-semibold text-[17px] hover:bg-brand-hover active:scale-95 transition-all flex justify-center items-center gap-3 mb-3"
          >
            <VideoCamera className="w-5 h-5" /> Entrar a la consulta
          </button>
          <button onClick={cancelarConsulta} disabled={ocupado} className="w-full bg-gray-50 text-gray-500 py-3.5 rounded-[16px] font-semibold text-[15px] hover:bg-gray-100 disabled:opacity-50">
            {ocupado ? 'Cancelando…' : 'Cancelar'}
          </button>
        </div>
      </div>
    )
  }

  // ── Checkout (y "tu tarjeta fue rechazada" después de aceptar) ──────────────
  const rechazado = phase === 'pago_rechazado'
  const explicacionRechazo = rechazado && !errorPago
    ? (pedido?.pagoDetalle ? explicarErrorDePago(pedido.pagoDetalle) : explicarPagoMP({ status: 'rejected' }))
    : null
  const alPagar = rechazado
    ? () => pagarDeNuevo(() => cardSelectorRef.current?.getSavedCardCharge())
    : handlePay
  const alPagarNueva = rechazado ? (charge) => pagarDeNuevo(async () => charge) : handleNewCardCharge
  const mostrarExento = paymentExempt && !rechazado

  return (
    <div className="absolute inset-0 bg-bg-primary z-[100] flex flex-col animate-fade-in">
      <div className="flex items-center gap-3 px-4 pt-6 pb-4 sm:px-6 sm:pt-8 flex-shrink-0">
        <button
          onClick={() => (rechazado ? setShowExitConfirm(true) : navigate('/paciente/dashboard'))}
          className="w-11 h-11 bg-white border border-gray-100 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50 shrink-0"
        >
          <ArrowLeft className="h-5 w-5 text-gray-900" />
        </button>
        <div className="w-10 h-10 rounded-xl bg-brand-muted flex items-center justify-center shrink-0">
          {IconComp && <IconComp className="h-5 w-5 text-brand" />}
        </div>
        <h1 className="text-[20px] sm:text-[22px] font-light tracking-tight text-gray-900 leading-none">Tele-{vertical.nombre}</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-10">
        <div className="w-full sm:max-w-lg mx-auto">
          {/* Para quién va primero, como un menú: "Para mí ⌄" (Mateo, 2026-10-09). */}
          {familiares.length > 0 && !rechazado && (
            <label className="relative mb-4 flex items-center gap-3 px-4 py-3 rounded-2xl border border-gray-200 bg-white cursor-pointer">
              <User className="w-5 h-5 text-brand shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-[10px] font-semibold text-gray-400 uppercase tracking-widest">La consulta es</span>
                <span className="block text-[15px] font-semibold text-gray-900 truncate">{etiquetaParaQuien}</span>
              </span>
              <CaretDown className="w-4 h-4 text-gray-500 shrink-0" />
              <select
                aria-label="¿Para quién es la consulta?"
                value={paraId || profile?.id || ''}
                onChange={e => setParaId(e.target.value === profile?.id ? null : e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer"
              >
                <option value={profile?.id}>Para mí</option>
                {familiares.map(f => (
                  <option key={f.familiarId} value={f.familiarId}>
                    {nombreFamiliar(f)}{f.relationship ? ` · ${f.relationship}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          {puedeBonificar && !rechazado && (
            <label className="mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border border-dashed border-brand/40 bg-brand-muted/30 cursor-pointer">
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-gray-900">Bonificar esta consulta</span>
                <span className="block text-[12px] text-gray-500">Sólo lo ve tu cuenta. Para recorrer el flujo sin pagar.</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                data-testid="ondemand-bonificar"
                checked={bonificar}
                onChange={e => { setBonificar(e.target.checked); setErrorPago(null) }}
                className="switch-bonificar"
              />
            </label>
          )}

          {rechazado ? (
            <div className="mb-4 p-4 rounded-[24px] border border-danger/30 bg-danger/5 flex items-start gap-3" role="alert">
              <Warning className="w-5 h-5 text-danger shrink-0 mt-0.5" weight="fill" />
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-gray-900 leading-snug">{proName} ya aceptó, pero tu tarjeta fue rechazada</p>
                <p className="text-[13px] text-gray-600 leading-snug mt-1">
                  {(explicacionRechazo?.motivo ?? 'Mercado Pago no autorizó el pago.')} Elegí otra tarjeta para seguir — te está esperando.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4 mb-4 p-4 bg-[#F8FAFC] rounded-[24px] border border-gray-200">
              <div className="w-14 h-14 rounded-full shrink-0 bg-white border border-gray-100 flex items-center justify-center">
                <VideoCamera className="w-6 h-6 text-brand" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[16px] text-gray-900">Consulta inmediata por video</p>
                <p className="text-[13px] text-gray-500">Con el primer profesional de {vertical.nombre} disponible</p>
              </div>
              <p className="text-[22px] text-gray-900 shrink-0">
                {mostrarExento ? 'Bonificada' : `$${price.toLocaleString('es-AR')}`}
              </p>
            </div>
          )}

          <div className="mb-4">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Método de pago</p>
            {mostrarExento ? (
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-brand/30 bg-brand-muted">
                <ShieldCheck size={18} weight="fill" className="text-brand" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-gray-900">Consulta bonificada</p>
                  <p className="text-[11px] text-gray-400">Sin cargo para tu cuenta</p>
                </div>
              </div>
            ) : isDemoMode ? (
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-amber-200 bg-amber-50">
                <CreditCard size={18} weight="fill" className="text-amber-600" />
                <p className="text-[13px] text-gray-900">El pago con tarjeta no está disponible en este momento.</p>
              </div>
            ) : (
              <SavedCardSelector
                ref={cardSelectorRef}
                selectedCardId={selectedCardId}
                onCardSelected={id => { setErrorPago(null); setSelectedCardId(id) }}
                publicKey={publicKey}
                payerEmail={profile?.email ?? ''}
                amount={price ?? undefined}
                disabled={paying}
                onNewCardCharge={alPagarNueva}
                onAddCardModeChange={next => { if (next) setErrorPago(null); setAddCardMode(next) }}
              />
            )}
          </div>

          {errorPago && (
            <div className="mb-4 p-4 rounded-[20px] border border-danger/30 bg-danger/5" role="alert">
              <div className="flex items-start gap-3">
                <Warning className="w-5 h-5 text-danger shrink-0 mt-0.5" weight="fill" />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-gray-900 leading-snug">{errorPago.motivo}</p>
                  {errorPago.accion && <p className="text-[13px] text-gray-600 leading-snug mt-1">{errorPago.accion}</p>}
                  {errorPago.codigo && <span className="text-[11px] text-gray-400 font-mono">{errorPago.codigo}</span>}
                </div>
              </div>
            </div>
          )}

          {!mostrarExento && (
            <div className="flex items-start gap-3 mb-3 p-4 bg-brand-muted/30 rounded-[20px] border border-brand/20">
              <ShieldCheck className="w-5 h-5 text-brand shrink-0 mt-0.5" weight="fill" />
              <p className="text-[13px] text-gray-600 leading-snug">
                {rechazado
                  ? 'Reservamos el monto en tu tarjeta y se cobra cuando termina la consulta.'
                  : 'No te cobramos nada hasta que un profesional acepte. Ahí reservamos el monto y se cobra cuando termina la consulta. Si nadie acepta, no se cobra.'}
              </p>
            </div>
          )}

          {!mostrarExento && !isDemoMode && (
            <div className="flex items-start gap-3 mb-6 p-4 bg-amber-50 rounded-[20px] border border-amber-200">
              <MercadoPagoMark className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-[13px] text-amber-700 leading-snug">Compra protegida y solo válida con tarjeta de crédito a través de Mercado Pago.</p>
            </div>
          )}

          {!addCardMode && (
            <button
              data-testid="ondemand-pagar"
              onClick={alPagar}
              disabled={paying || (missingCard && !mostrarExento) || (isDemoMode && !mostrarExento)}
              className={`w-full py-5 rounded-[20px] font-semibold text-[17px] transition-all flex justify-center items-center gap-2
                ${paying || (missingCard && !mostrarExento) ? 'bg-gray-100 text-gray-400' : 'bg-brand text-white hover:bg-brand-hover active:scale-95'}`}
            >
              {paying
                ? <><CircleNotch className="w-5 h-5 animate-spin" /> {rechazado ? 'Autorizando…' : 'Procesando…'}</>
                : errorPago
                  ? <><ArrowClockwise className="w-5 h-5" /> Reintentar</>
                  : mostrarExento
                    ? <><Check className="w-5 h-5" /> Pedir consulta</>
                    : <><Check className="w-5 h-5" /> {rechazado ? 'Pagar con esta tarjeta' : `Pagar $${price.toLocaleString('es-AR')}`}</>}
            </button>
          )}
        </div>
      </div>

      <PatientSheet open={showExitConfirm} onClose={() => setShowExitConfirm(false)} maxWidth="max-w-md">
        <div className="px-6 pt-2 pb-8">
          <h2 className="text-[22px] font-light text-gray-900 mb-2 text-center leading-tight">¿Cancelar la consulta?</h2>
          <p className="text-gray-500 text-[14px] text-center mb-7 leading-snug">
            {proName} ya aceptó y te está esperando. Si salís ahora no se te cobra nada.
          </p>
          <div className="flex flex-col gap-3">
            <button onClick={cancelarConsulta} className="btn-danger w-full py-4 rounded-3xl font-semibold text-[15px]">Sí, cancelar</button>
            <button onClick={() => setShowExitConfirm(false)} className="btn-secondary w-full py-4 rounded-3xl font-semibold text-[15px]">Seguir con mi consulta</button>
          </div>
        </div>
      </PatientSheet>
    </div>
  )
}
