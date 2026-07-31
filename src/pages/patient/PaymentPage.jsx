import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, VideoCamera, MapPin, CircleNotch, Check, CreditCard, CheckCircle, Sparkle } from '@phosphor-icons/react'
import SavedCardSelector from '../../components/payment/SavedCardSelector'
import { mpService } from '../../services/mpService'
import { consultationsService } from '../../services/consultationsService'
import { toast } from '../../components/Toast'
import { track, getPaymentMethod, buildConsultaItem } from '../../utils/analytics'

export default function PaymentPage({ profile }) {
  const navigate  = useNavigate()
  const location  = useLocation()
  const state     = location.state ?? {}
  const cardSelectorRef = useRef(null)

  const {
    professionalId,
    professionalName = 'Profesional',
    professionalAvatar,
    specialty,
    verticalId,
    modality = 'virtual',
    price,
    scheduledAt,
    // Veterinaria: se cargan en un paso propio del wizard. Si no se persisten
    // acá se pierden, porque esta pantalla es la que crea la consulta.
    petName,
    petSpecies,
    // Sólo llegan desde `/paciente/agendar/:id` (reserva arrancada en el perfil
    // del profesional). El wizard de `ReservarConsulta` no los pide y viajan
    // undefined — misma razón que la mascota: si no se persisten acá se pierden.
    consultationTypeId,
    obraSocialName,
    affiliateNumber,
  } = state

  const [selectedCardId, setSelectedCardId] = useState(null)
  const [paying, setPaying]                 = useState(false)
  const [paid, setPaid]                     = useState(false)
  const [advancingDemo, setAdvancingDemo]   = useState(false)
  const [publicKey, setPublicKey]           = useState(null)
  const [configLoading, setConfigLoading]   = useState(true)
  const [consultationId, setConsultationId] = useState(null)
  const [addCardMode, setAddCardMode]       = useState(false)

  // Healthy Credits (spec Sección D7)
  const [creditBalance, setCreditBalance] = useState(0)
  const [useCredits, setUseCredits]       = useState(true)

  const isDemoMode = !configLoading && !publicKey

  useEffect(() => {
    mpService.getPaymentPlatformConfig().then(({ data }) => {
      setPublicKey(data?.publicKey ?? null)
      setConfigLoading(false)
    })
    mpService.getCreditBalance().then(({ data }) => setCreditBalance(data || 0))
  }, [])

  useEffect(() => {
    if (isDemoMode) setSelectedCardId('__demo__')
  }, [isDemoMode])

  const creditsApplied = (!isDemoMode && useCredits) ? Math.min(creditBalance, price ?? 0) : 0
  const chargeAmount   = Math.max(0, (price ?? 0) - creditsApplied)

  const description = `Consulta ${specialty ?? verticalId ?? ''} — Healthier`.trim()
  const consultaItemId = `consulta_${verticalId ?? specialty ?? 'general'}`
  const consultaItem = (itemPrice) => buildConsultaItem({ id: consultaItemId, name: description, category: 'consulta', price: itemPrice })

  // Fire begin_checkout once, as soon as we land on this page with a known
  // price — this is the booking-funnel entry point (spec Sección — GA4
  // e-commerce). Guarded by a ref so it never re-fires on later re-renders
  // (e.g. when credits/chargeAmount recompute).
  const beginCheckoutFired = useRef(false)
  useEffect(() => {
    if (price == null || beginCheckoutFired.current) return
    beginCheckoutFired.current = true
    track('begin_checkout', { value: price, currency: 'ARS', items: consultaItem(price) })
  }, [price]) // eslint-disable-line react-hooks/exhaustive-deps

  // Creates the consultation row exactly once (DB write before payment
  // confirmation UI — State Resilience convention) and caches its id so the
  // multiple payment sub-flows (saved card, new card, credits-only) can all
  // reuse the same booking.
  const ensureConsultation = async () => {
    if (consultationId) return consultationId
    const created = await consultationsService.create({
      patientId:      profile.id,
      professionalId,
      vertical:       verticalId,
      modality:       modality === 'virtual' ? 'video' : 'presencial',
      status:         'pending',
      paymentStatus:  'pending_payment',
      priceAtBooking: price ?? null,
      scheduledAt:    scheduledAt ?? new Date().toISOString(),
      petName:        petName ?? null,
      petSpecies:     petSpecies ?? null,
      consultationTypeId: consultationTypeId ?? null,
      obraSocialName:     obraSocialName ?? null,
      affiliateNumber:    affiliateNumber ?? null,
    })
    setConsultationId(created.id)
    return created.id
  }

  const handlePaymentResult = (data, id, paymentMethod = 'saved_card') => {
    const status = data?.status
    if (data?.approved || status === 'paid' || status === 'approved') {
      track('purchase', {
        transaction_id: id, value: chargeAmount, currency: 'ARS',
        payment_method: paymentMethod, items: consultaItem(chargeAmount),
      })
      setPaid(true)
      setTimeout(() => navigate(`/paciente/turno-confirmado/${id}`), 600)
    } else if (status === 'in_process' || status === 'pending') {
      toast.info('Tu pago está siendo procesado. Te avisaremos cuando se confirme.')
      navigate(`/paciente/turno-confirmado/${id}`)
    } else {
      track('payment_error', { error_type: 'declined', value: chargeAmount, currency: 'ARS' })
      toast.error('El pago no pudo procesarse. Intentá con otra tarjeta.')
    }
  }

  const handleDemoAdvance = async () => {
    if (advancingDemo) return
    if (!profile?.id || !professionalId) {
      toast.error('Faltan datos para continuar')
      return
    }
    setAdvancingDemo(true)
    try {
      const created = await consultationsService.create({
        patientId:      profile.id,
        professionalId,
        vertical:       verticalId,
        modality:       modality === 'virtual' ? 'video' : 'presencial',
        status:         'confirmed',
        paymentStatus:  'demo',
        priceAtBooking: price ?? null,
        scheduledAt:    scheduledAt ?? new Date().toISOString(),
        petName:        petName ?? null,
        petSpecies:     petSpecies ?? null,
        consultationTypeId: consultationTypeId ?? null,
        obraSocialName:     obraSocialName ?? null,
        affiliateNumber:    affiliateNumber ?? null,
      })
      navigate(`/paciente/turno-confirmado/${created.id}`)
    } catch (err) {
      toast.error(err?.message || 'Error al confirmar el turno')
    } finally {
      setAdvancingDemo(false)
    }
  }

  // Triggered by the page's own "Confirmar y Pagar" button — covers the
  // demo bypass, a fully-credits payment, and a previously-saved card
  // (which needs CVV re-tokenization via the SavedCardSelector ref).
  const handlePay = async () => {
    if (paying || paid || addCardMode) return
    if (!profile?.id || !professionalId) {
      toast.error('Faltan datos para procesar el pago')
      return
    }

    if (isDemoMode) {
      await handleDemoAdvance()
      return
    }

    if (chargeAmount > 0 && !selectedCardId) return
    setPaying(true)
    try {
      const id = await ensureConsultation()

      if (chargeAmount === 0) {
        const { data, error } = await mpService.createPayment({ consultationId: id, useCredits: true, description })
        if (error) throw new Error(error)
        handlePaymentResult(data, id, 'credits')
        return
      }

      const chargeInfo = await cardSelectorRef.current?.getSavedCardCharge()
      const paymentType = getPaymentMethod(chargeInfo)
      track('add_payment_info', { payment_type: paymentType, value: chargeAmount, currency: 'ARS' })
      const { data, error } = await mpService.createPayment({ consultationId: id, ...chargeInfo, useCredits, description })
      if (error) throw new Error(error)
      handlePaymentResult(data, id, paymentType)
    } catch (err) {
      toast.error(err?.message || 'Error al procesar el pago')
    } finally {
      setPaying(false)
    }
  }

  // Triggered by the "add new card" Brick's own submit button — the token
  // is single-use and charged directly (not saved first, see MPCardHolder).
  const handleNewCardCharge = async (chargeInfo) => {
    const paymentType = getPaymentMethod(chargeInfo)
    track('add_payment_info', { payment_type: paymentType, value: chargeAmount, currency: 'ARS' })
    setPaying(true)
    try {
      const id = await ensureConsultation()
      const { data, error } = await mpService.createPayment({ consultationId: id, ...chargeInfo, useCredits, description })
      if (error) throw new Error(error)
      handlePaymentResult(data, id, paymentType)
    } catch (err) {
      toast.error(err?.message || 'Error al procesar el pago')
    } finally {
      setPaying(false)
    }
  }

  if (!professionalId) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-bg-primary">
        <p className="text-text-tertiary text-[14px]">No hay datos de consulta. <button onClick={() => navigate(-1)} className="text-brand underline">Volver</button></p>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 overflow-y-auto bg-bg-primary">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-bg-primary/95 backdrop-blur-sm border-b border-border-default">
        <div className="flex items-center gap-3 px-4 py-4 max-w-lg mx-auto">
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-full bg-bg-secondary border border-border-default flex items-center justify-center flex-shrink-0 hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-text-primary" />
          </button>
          <h2 className="flex-1 text-center font-bold text-lg text-text-primary">
            Confirmar Pago
          </h2>
          <div className="w-9" />
        </div>
      </div>

      <div className="px-4 py-6 pb-32 max-w-lg mx-auto space-y-4">

        {/* Resumen */}
        <div className="bg-bg-secondary rounded-2xl border border-border-default p-4">
          <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest mb-3">Resumen</p>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full overflow-hidden flex-shrink-0 bg-brand/10 flex items-center justify-center">
              {professionalAvatar
                ? <img src={professionalAvatar} alt={professionalName} className="w-full h-full object-cover" />
                : <span className="text-[18px] font-bold text-brand">{professionalName.charAt(0)}</span>
              }
            </div>
            <div>
              <p className="font-bold text-[15px] text-text-primary">{professionalName}</p>
              {specialty && <p className="text-[13px] text-text-secondary">{specialty}</p>}
            </div>
          </div>
          <div className="space-y-2">
            <div className="bg-white rounded-xl px-3 py-2.5 flex items-center gap-2 border border-border-default">
              {modality === 'virtual'
                ? <VideoCamera className="w-4 h-4 text-brand" />
                : <MapPin className="w-4 h-4 text-emerald-600" />
              }
              <span className="text-[13px] font-semibold text-text-primary">
                {modality === 'virtual' ? 'Videoconsulta' : 'Presencial'}
              </span>
            </div>
            {price != null && (
              <div className="bg-white rounded-xl px-3 py-2.5 flex items-center justify-between border border-border-default">
                <span className="text-[13px] text-text-secondary">Precio</span>
                <span className="text-[15px] font-bold text-text-primary">${price.toLocaleString('es-AR')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Healthy Credits */}
        {!isDemoMode && creditBalance > 0 && (
          <div className="bg-white rounded-2xl border border-brand/25 p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-brand-muted flex items-center justify-center shrink-0">
              <Sparkle className="w-4 h-4 text-brand" weight="fill" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-text-primary">
                Healthy Credits: ${creditBalance.toLocaleString('es-AR')}
              </p>
              <label className="flex items-center gap-2 mt-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useCredits}
                  onChange={e => setUseCredits(e.target.checked)}
                  className="h-4 w-4 accent-brand"
                />
                <span className="text-[13px] text-text-secondary">Usar mis créditos en este pago</span>
              </label>
            </div>
          </div>
        )}

        {/* Método de pago */}
        <div className="bg-white rounded-2xl border border-border-default p-4">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest">Método de Pago</p>
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
                <p className="text-[13px] font-semibold text-text-primary">Pago de demostración</p>
                <p className="text-[11px] text-text-tertiary">Sin cargo real</p>
              </div>
              <CheckCircle size={20} weight="fill" className="text-brand shrink-0" />
            </div>
          ) : chargeAmount === 0 ? (
            <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-brand/30 bg-brand-muted">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-white">
                <Sparkle size={18} weight="fill" className="text-brand" />
              </div>
              <p className="text-[13px] font-semibold text-text-primary flex-1">Se cubre por completo con tus Healthy Credits</p>
            </div>
          ) : (
            <SavedCardSelector
              ref={cardSelectorRef}
              selectedCardId={selectedCardId}
              onCardSelected={setSelectedCardId}
              publicKey={publicKey}
              payerEmail={profile?.email ?? ''}
              amount={chargeAmount}
              disabled={paying || paid}
              onNewCardCharge={handleNewCardCharge}
              onAddCardModeChange={setAddCardMode}
            />
          )}
          {price != null && (
            <div className="mt-4 pt-4 border-t border-border-default space-y-1.5">
              {creditsApplied > 0 && (
                <>
                  <div className="flex items-center justify-between text-[13px] text-text-secondary">
                    <span>Precio</span>
                    <span>${price.toLocaleString('es-AR')}</span>
                  </div>
                  <div className="flex items-center justify-between text-[13px] text-brand font-semibold">
                    <span>Créditos aplicados</span>
                    <span>-${creditsApplied.toLocaleString('es-AR')}</span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-text-secondary">A pagar hoy</span>
                <span className="text-[24px] font-black text-text-primary">${chargeAmount.toLocaleString('es-AR')}</span>
              </div>
            </div>
          )}
        </div>

        {/* CTA — hidden while the "new card" Brick's own submit button is active */}
        {!addCardMode && (
          <button
            onClick={handlePay}
            disabled={paying || paid || (!isDemoMode && chargeAmount > 0 && !selectedCardId)}
            className={[
              'w-full py-5 rounded-full font-bold text-[16px] flex items-center justify-center gap-3 transition-all',
              paid
                ? 'bg-emerald-500 text-white scale-[1.02]'
                : (paying || (chargeAmount > 0 && !selectedCardId))
                  ? 'bg-bg-secondary text-text-tertiary cursor-not-allowed'
                  : 'bg-brand text-white hover:bg-brand-hover active:scale-[0.99]',
            ].join(' ')}
          >
            {paying && <CircleNotch className="w-5 h-5 animate-spin" />}
            {paid    && <Check className="w-5 h-5" weight="bold" />}
            {paid ? '¡Turno Confirmado!' : paying ? 'Procesando...' : 'Confirmar y Pagar'}
          </button>
        )}

        {/* Demo bypass */}
        <button
          onClick={handleDemoAdvance}
          disabled={advancingDemo || paid}
          className="w-full py-3 rounded-full font-semibold text-[13px] text-text-tertiary border border-border-default bg-transparent hover:bg-bg-secondary transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {advancingDemo && <CircleNotch className="w-4 h-4 animate-spin" />}
          Avanzar (demo)
        </button>

      </div>
    </div>
  )
}
