import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, CircleNotch, Check, CheckCircle, ArrowClockwise } from '@phosphor-icons/react'
import SavedCardSelector from '../../components/payment/SavedCardSelector'
import { medicationOrdersService } from '../../services/medicationOrdersService'
import { mpService } from '../../services/mpService'
import { toast } from '../../components/Toast'

function fmtPrice(price) {
  return `$${Number(price).toLocaleString('es-AR')}`
}

export default function PharmacyPayment({ profile }) {
  const navigate = useNavigate()
  const location = useLocation()
  const orderId = location.state?.orderId
  const cardSelectorRef = useRef(null)

  const [order, setOrder] = useState(null)
  const [selectedCardId, setSelectedCardId] = useState(null)
  const [publicKey, setPublicKey] = useState(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [addCardMode, setAddCardMode] = useState(false)
  const [paying, setPaying] = useState(false)
  const [paid, setPaid] = useState(false)
  const [intentoFallido, setIntentoFallido] = useState(false)

  const isDemoMode = !configLoading && !publicKey
  const amount = order?.total ?? 0
  const description = 'Pedido de medicamentos — Healthier'

  useEffect(() => {
    mpService.getPaymentPlatformConfig().then(({ data }) => {
      setPublicKey(data?.publicKey ?? null)
      setConfigLoading(false)
    })
  }, [])

  useEffect(() => { if (isDemoMode) setSelectedCardId('__demo__') }, [isDemoMode])

  useEffect(() => {
    if (!orderId) return
    medicationOrdersService.getById(orderId).then(setOrder).catch(err => toast.error(err?.message || 'Error al cargar el pedido'))
  }, [orderId])

  const handlePaymentResult = (data) => {
    const status = data?.status
    if (data?.approved || status === 'paid' || status === 'approved') {
      setPaid(true)
      setTimeout(() => navigate('/paciente/farmacia', { state: { orderConfirmed: true } }), 800)
    } else if (status === 'in_process' || status === 'pending') {
      toast.info('Tu pago está siendo procesado. Te avisaremos cuando se confirme.')
      navigate('/paciente/farmacia')
    } else {
      setIntentoFallido(true)
      toast.error('El pago no pudo procesarse. Intentá con otra tarjeta.')
    }
  }

  const chargeWith = async (chargeInfo) => {
    setPaying(true)
    setIntentoFallido(false)
    try {
      const { data, error } = await mpService.createPayment({ orderId, ...chargeInfo, description })
      if (error) throw new Error(error)
      handlePaymentResult(data)
    } catch (err) {
      setIntentoFallido(true)
      toast.error(err?.message || 'Error al procesar el pago')
    } finally {
      setPaying(false)
    }
  }

  const handlePay = async () => {
    if (paying || paid || addCardMode) return
    if (isDemoMode) {
      // Demo/sin MP configurado: no hay cobro real posible.
      toast.error('Mercado Pago no está configurado en este ambiente')
      return
    }
    if (!selectedCardId) return
    const chargeInfo = await cardSelectorRef.current?.getSavedCardCharge()
    await chargeWith(chargeInfo)
  }

  if (!orderId || !order) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-bg-primary">
        {orderId ? <div className="h-8 w-8"><CircleNotch className="w-8 h-8 animate-spin text-brand" /></div> : (
          <p className="text-text-tertiary text-[14px]">No hay un pedido para pagar. <button onClick={() => navigate('/paciente/farmacia')} className="text-brand underline">Volver</button></p>
        )}
      </div>
    )
  }

  return (
    <div className="absolute inset-0 overflow-y-auto bg-bg-primary">
      <div className="sticky top-0 z-20 bg-bg-primary/95 backdrop-blur-sm border-b border-border-default">
        <div className="flex items-center gap-3 px-4 py-4 max-w-lg mx-auto">
          <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-bg-secondary border border-border-default flex items-center justify-center flex-shrink-0 hover:bg-gray-100 transition-colors">
            <ArrowLeft className="w-5 h-5 text-text-primary" />
          </button>
          <h2 className="flex-1 text-center font-bold text-lg text-text-primary">Confirmar Pago</h2>
          <div className="w-9" />
        </div>
      </div>

      <div className="px-4 py-6 pb-32 max-w-lg mx-auto space-y-4">
        <div className="bg-bg-secondary rounded-2xl border border-border-default p-4">
          <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest mb-3">Resumen</p>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-text-secondary">{(order.items ?? []).length} medicamento{(order.items ?? []).length !== 1 ? 's' : ''}</span>
            <span className="text-[20px] font-black text-text-primary">{fmtPrice(amount)}</span>
          </div>

          {!isDemoMode && (
            <SavedCardSelector
              ref={cardSelectorRef}
              selectedCardId={selectedCardId}
              onCardSelected={id => { setIntentoFallido(false); setSelectedCardId(id) }}
              publicKey={publicKey}
              payerEmail={profile?.email ?? ''}
              amount={amount}
              disabled={paying || paid}
              onNewCardCharge={chargeWith}
              onAddCardModeChange={next => { if (next) setIntentoFallido(false); setAddCardMode(next) }}
            />
          )}
        </div>

        {!addCardMode && (
          <button
            onClick={handlePay}
            disabled={paying || paid || (!isDemoMode && !selectedCardId)}
            className={[
              'w-full py-5 rounded-full font-bold text-[16px] flex items-center justify-center gap-3 transition-all',
              paid
                ? 'bg-emerald-500 text-white scale-[1.02]'
                : (paying || !selectedCardId)
                  ? 'bg-bg-secondary text-text-tertiary cursor-not-allowed'
                  : 'bg-brand text-white hover:bg-brand-hover active:scale-[0.99]',
            ].join(' ')}
          >
            {paying && <CircleNotch className="w-5 h-5 animate-spin" />}
            {paid && <Check className="w-5 h-5" weight="bold" />}
            {!paid && !paying && intentoFallido && <ArrowClockwise className="w-5 h-5" />}
            {paid ? <><CheckCircle className="w-5 h-5" /> ¡Pedido confirmado!</> : paying ? 'Procesando...' : intentoFallido ? 'Reintentar el pago' : 'Confirmar y Pagar'}
          </button>
        )}
      </div>
    </div>
  )
}
