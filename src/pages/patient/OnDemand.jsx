import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, VideoCamera, Clock, CircleNotch, Check, ShieldCheck, CreditCard,
} from '@phosphor-icons/react'
import { toast } from '../../components/Toast'
import { professionalService } from '../../services/professionalService'
import { consultationsService } from '../../services/consultationsService'
import { mpService } from '../../services/mpService'
import SavedCardSelector from '../../components/payment/SavedCardSelector'
import { VERTICALS_BY_ID, SPECIALTY_LABELS, VERTICAL_SPECIALTIES } from '../../lib/verticals'
import { track, getPaymentMethod, buildConsultaItem } from '../../utils/analytics'

// Real 10:00 pre-authorization window (spec Sección D1.3/D1.4) — mirrors the
// mp-capture `sweep` cron's own 10-minute cutoff, which is the server-side
// backstop if this client-side timer is lost (tab closed, app killed, etc).
const AUTH_WINDOW_SECONDS = 10 * 60

function formatCountdown(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function OnDemand({ profile }) {
  const { vertical: verticalId } = useParams()
  const navigate = useNavigate()
  const vertical = VERTICALS_BY_ID[verticalId]
  const cardSelectorRef = useRef(null)
  const countdownRef = useRef(null)

  // phase: 'searching' → 'no_match' | 'checkout' → 'assigned'
  const [phase, setPhase] = useState('searching')
  const [matchedPro, setMatchedPro] = useState(null)
  const [consultationId, setConsultationId] = useState(null)

  // Real MP checkout — same saved-card / new-card patterns as PaymentPage,
  // but always authorizeOnly (pre-auth hold) and credit-card only, no credits.
  const [publicKey, setPublicKey] = useState(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [selectedCardId, setSelectedCardId] = useState(null)
  const [addCardMode, setAddCardMode] = useState(false)
  const [paying, setPaying] = useState(false)

  // Post-authorization countdown + cancel
  const [secondsLeft, setSecondsLeft] = useState(AUTH_WINDOW_SECONDS)
  const [cancelling, setCancelling] = useState(false)

  const isDemoMode = !configLoading && !publicKey

  const IconComp = vertical?.icon
  const price = matchedPro?.priceVideo ?? matchedPro?.sessionPrice ?? null
  const proName = matchedPro?.profiles?.fullName || 'Profesional'
  const proAvatar = matchedPro?.profiles?.avatarUrl || null
  const proRating = matchedPro?.averageRating ? String(matchedPro.averageRating) : '—'
  const proSpecialty = matchedPro ? (SPECIALTY_LABELS[matchedPro.specialty] || vertical?.nombre) : vertical?.nombre

  // ── Guard — unknown/coming-soon vertical redirects home. Runs as an effect
  // (not a conditional early-return before hooks) so every hook below is
  // still called on every render, per the rules of hooks. ──────────────────
  useEffect(() => {
    if (!vertical || vertical.comingSoon) navigate('/paciente/dashboard')
  }, [vertical, navigate])

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
      status:         'confirmed',
      isOnDemand:     true,
      priceAtBooking: price,
      scheduledAt:    new Date().toISOString(),
    })
    setConsultationId(created.id)
    return created.id
  }

  // ── Authorization succeeded → notify the professional, show the real countdown ─
  const handleAuthorized = async (id) => {
    setSecondsLeft(AUTH_WINDOW_SECONDS)
    setPhase('assigned')
    try {
      await consultationsService.notifyOnDemandAuthorized(id, matchedPro?.userId)
    } catch { /* notification is best-effort, never blocks the flow */ }
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

  // ── 10:00 window elapsed with nobody joining — same release, different copy ──
  const handleTimeout = async () => {
    if (consultationId) {
      const { error } = await mpService.cancelAuthorization(consultationId)
      if (error) console.error('[OnDemand] timeout cancel-auth failed:', error)
    }
    toast.info('El profesional no se conectó a tiempo. No se te cobró nada.')
    navigate('/paciente/dashboard')
  }

  // `id` is threaded through explicitly (never read back from `consultationId`
  // state) because `ensureConsultation()`'s `setConsultationId` call hasn't
  // committed yet within the same handler execution — reading the state var
  // right after awaiting it would race and still see the pre-creation `null`.
  const consultaItem = () => buildConsultaItem({
    id: `consulta_${vertical.id}`, name: `Consulta inmediata — Tele-${vertical.nombre}`, category: 'ondemand', price,
  })

  const finishPayment = async ({ data, error }, id, paymentMethod = 'saved_card') => {
    if (error) throw new Error(error)
    if (data?.status === 'authorized' || data?.status === 'approved' || data?.approved) {
      track('purchase', {
        transaction_id: id, value: price, currency: 'ARS',
        payment_method: paymentMethod, items: consultaItem(),
      })
      await handleAuthorized(id)
    } else {
      track('payment_error', { error_type: 'declined', value: price, currency: 'ARS' })
      toast.error('No pudimos autorizar el pago. Probá con otra tarjeta.')
    }
  }

  // ── "Pagar e iniciar consulta" — demo bypass or a previously-saved card ───────
  const handlePay = async () => {
    if (paying || addCardMode || !matchedPro) return
    if (!profile?.id) { toast.error('Faltan datos para continuar'); return }

    track('begin_checkout', { value: price, currency: 'ARS', items: consultaItem() })

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
      track('add_payment_info', { payment_type: paymentType, value: price, currency: 'ARS' })
      const result = await mpService.createPayment({
        consultationId: id,
        ...chargeInfo,
        authorizeOnly: true,
        description: `Consulta inmediata — Tele-${vertical.nombre}`,
      })
      await finishPayment(result, id, paymentType)
    } catch (err) {
      toast.error(err?.message || 'Error al procesar el pago')
    } finally {
      setPaying(false)
    }
  }

  // ── "Pagar con una tarjeta nueva" Brick's own submit button ───────────────────
  const handleNewCardCharge = async (chargeInfo) => {
    const paymentType = getPaymentMethod(chargeInfo)
    track('begin_checkout', { value: price, currency: 'ARS', items: consultaItem() })
    track('add_payment_info', { payment_type: paymentType, value: price, currency: 'ARS' })

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
      toast.error(err?.message || 'Error al procesar el pago')
    } finally {
      setPaying(false)
    }
  }

  // ── Step 1: match a real, payable professional — real price required ─────────
  useEffect(() => {
    if (!vertical || vertical.comingSoon) return
    let cancelled = false

    mpService.getPaymentPlatformConfig().then(({ data }) => {
      if (!cancelled) { setPublicKey(data?.publicKey ?? null); setConfigLoading(false) }
    })

    const slugs = VERTICAL_SPECIALTIES[verticalId] || []
    const primarySlug = slugs[0]
    const fetchPros = primarySlug
      ? professionalService.search({ specialty: primarySlug, onDemand: true })
          .catch(() => professionalService.search({ specialty: primarySlug }))
      : Promise.resolve([])

    Promise.all([new Promise(r => setTimeout(r, 2200)), fetchPros]).then(([, prosRaw]) => {
      if (cancelled) return
      // Only match professionals who can receive paid bookings AND have a
      // real price configured (spec D1.1 — no more hardcoded $15).
      const payable = (prosRaw ?? []).filter(p => p.mpConnected !== false && (p.priceVideo ?? p.sessionPrice))
      const pro = payable[0] ?? null
      setMatchedPro(pro)
      setPhase(pro ? 'checkout' : 'no_match')
    })

    return () => { cancelled = true }
  }, [vertical, verticalId])

  // ── Step 4: real 10:00 countdown once authorized — auto cancel-auth at zero ──
  useEffect(() => {
    if (phase !== 'assigned') return
    countdownRef.current = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          clearInterval(countdownRef.current)
          handleTimeout()
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(countdownRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  if (!vertical || vertical.comingSoon) return null

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
              <h4 className="font-bold text-gray-900 text-[15px] mb-1">El profesional te está esperando</h4>
              <p className="text-gray-500 text-[13px] leading-snug">Uníte antes de que se acabe el tiempo o la reserva se libera sola.</p>
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
            <VideoCamera className="w-5 h-5" /> Entrar a la Llamada
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
  return (
    <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex flex-col justify-end sm:items-center sm:justify-center animate-fade-in">
      <div className="absolute top-4 left-4 sm:top-6 sm:left-6 z-[60]">
        <button onClick={() => navigate('/paciente/dashboard')} className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center hover:bg-gray-50">
          <ArrowLeft className="h-6 w-6 text-gray-900" />
        </button>
      </div>
      <div className="w-full sm:max-w-lg bg-white rounded-t-[40px] sm:rounded-[28px] shadow-[0_-20px_50px_rgba(0,0,0,0.2)] sm:shadow-2xl pb-10 p-6 animate-slide-up-spring border-t sm:border border-gray-100 sm:max-h-[85vh] sm:overflow-y-auto">
        <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6 sm:hidden" />
        <div className="px-2">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm" style={{ backgroundColor: vertical.bg }}>
              <IconComp className="h-7 w-7" style={{ color: vertical.color }} />
            </div>
            <div>
              <h2 className="text-[28px] font-black tracking-tight text-gray-900 leading-none mb-1">Tele-{vertical.nombre}</h2>
              <p className="text-gray-500 font-medium text-[15px]">Expertos verificados en línea</p>
            </div>
          </div>

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
                {proSpecialty} · <Clock className="h-3.5 w-3.5" /> Espera: {vertical.eta}
              </p>
            </div>
            <p className="font-black text-[22px] text-gray-900 shrink-0">
              {price != null ? `$${price.toLocaleString('es-AR')}` : '—'}
            </p>
          </div>

          {/* Pre-auth explanation — no charge until the consultation ends */}
          <div className="flex items-start gap-3 mb-3 p-4 bg-brand-muted/30 rounded-[20px] border border-brand/20">
            <ShieldCheck className="w-5 h-5 text-brand shrink-0 mt-0.5" weight="fill" />
            <p className="text-[13px] text-gray-600 leading-snug">
              Se hace una <strong className="text-gray-900">reserva</strong> en tu tarjeta — solo se cobra cuando termina la consulta. Si el profesional no se conecta o cancelás antes, no se te cobra nada.
            </p>
          </div>

          {/* Credit-card-only notice (spec: v1 solo tarjeta de crédito) */}
          {!isDemoMode && (
            <div className="flex items-start gap-3 mb-6 p-4 bg-amber-50 rounded-[20px] border border-amber-200">
              <CreditCard className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" weight="fill" />
              <p className="text-[13px] text-amber-700 leading-snug">
                Las consultas inmediatas se pagan solo con <strong>tarjeta de crédito</strong> (no débito, no cuenta de Mercado Pago).
              </p>
            </div>
          )}

          {/* Método de pago */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Método de Pago</p>
              {isDemoMode && (
                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wide">DEMO</span>
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
            ) : (
              <SavedCardSelector
                ref={cardSelectorRef}
                selectedCardId={selectedCardId}
                onCardSelected={setSelectedCardId}
                publicKey={publicKey}
                payerEmail={profile?.email ?? ''}
                amount={price ?? undefined}
                disabled={paying}
                onNewCardCharge={handleNewCardCharge}
                onAddCardModeChange={setAddCardMode}
              />
            )}
          </div>

          {/* CTA — hidden while the "new card" Brick's own submit button is active */}
          {!addCardMode && (
            <button
              onClick={handlePay}
              disabled={paying || (!isDemoMode && !selectedCardId)}
              className={`w-full py-5 rounded-[20px] font-bold text-[17px] shadow-sm transition-all flex justify-center items-center gap-2
                ${paying ? 'bg-gray-100 text-gray-400' :
                  (!isDemoMode && !selectedCardId) ? 'bg-gray-100 text-gray-400' :
                  'bg-brand text-white hover:bg-brand-hover active:scale-95'}`}
            >
              {paying
                ? <><CircleNotch className="w-5 h-5 animate-spin" /> Autorizando...</>
                : <><Check className="w-5 h-5" /> {price != null ? `Pagar $${price.toLocaleString('es-AR')} e iniciar` : 'Pagar e iniciar'}</>
              }
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
