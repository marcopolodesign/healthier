import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, VideoCamera, MapPin, CircleNotch, Check, CreditCard, CheckCircle } from '@phosphor-icons/react'
import SavedCardSelector from '../../components/payment/SavedCardSelector'
import { mpService } from '../../services/mpService'
import { consultationsService } from '../../services/consultationsService'
import { toast } from '../../components/Toast'

export default function PaymentPage({ profile }) {
  const navigate  = useNavigate()
  const location  = useLocation()
  const state     = location.state ?? {}

  const {
    professionalId,
    professionalName = 'Profesional',
    professionalAvatar,
    specialty,
    verticalId,
    modality = 'virtual',
    price,
    scheduledAt,
  } = state

  const [selectedCardId, setSelectedCardId] = useState(null)
  const [paying, setPaying]                 = useState(false)
  const [paid, setPaid]                     = useState(false)
  const [advancingDemo, setAdvancingDemo]   = useState(false)
  const [publicKey, setPublicKey]           = useState(null)
  const [configLoading, setConfigLoading]   = useState(true)

  const isDemoMode = !configLoading && !publicKey

  useEffect(() => {
    mpService.getPaymentPlatformConfig().then(({ data }) => {
      setPublicKey(data?.publicKey ?? null)
      setConfigLoading(false)
    })
  }, [])

  useEffect(() => {
    if (isDemoMode) setSelectedCardId('__demo__')
  }, [isDemoMode])

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
      })
      navigate(`/paciente/turno-confirmado/${created.id}`)
    } catch (err) {
      toast.error(err?.message || 'Error al confirmar el turno')
    } finally {
      setAdvancingDemo(false)
    }
  }

  const handlePay = async () => {
    if (paying || paid) return
    if (!profile?.id || !professionalId) {
      toast.error('Faltan datos para procesar el pago')
      return
    }

    if (isDemoMode) {
      setPaying(true)
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
        })
        navigate(`/paciente/turno-confirmado/${created.id}`)
      } catch (err) {
        toast.error(err?.message || 'Error al confirmar el turno')
      } finally {
        setPaying(false)
      }
      return
    }

    if (!selectedCardId) return
    setPaying(true)
    try {
      // 1. Create consultation record
      const consultation = await consultationsService.create({
        patientId:      profile.id,
        professionalId,
        vertical:       verticalId,
        modality:       modality === 'virtual' ? 'video' : 'presencial',
        status:         'pending',
        paymentStatus:  'pending_payment',
        priceAtBooking: price ?? null,
        scheduledAt:    scheduledAt ?? new Date().toISOString(),
      })

      // 2. Charge via Edge Function
      const { data: paymentData, error: payErr } = await mpService.createPayment({
        consultationId: consultation.id,
        amount:         price ?? 0,
        currency:       'ARS',
        cardId:         selectedCardId,
        professionalId,
        description:    `Consulta ${specialty ?? verticalId} — Healthier`,
      })
      if (payErr) throw new Error(payErr)

      if (paymentData?.status === 'approved') {
        navigate(`/paciente/turno-confirmado/${consultation.id}`)
      } else {
        toast.error('El pago no pudo procesarse. Intentá con otra tarjeta.')
      }
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
          ) : (
            <SavedCardSelector
              selectedCardId={selectedCardId}
              onCardSelected={setSelectedCardId}
              publicKey={publicKey}
              payerEmail={profile?.email ?? ''}
            />
          )}
          {price != null && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-default">
              <span className="text-[13px] font-semibold text-text-secondary">A pagar hoy</span>
              <span className="text-[24px] font-black text-text-primary">${price.toLocaleString('es-AR')}</span>
            </div>
          )}
        </div>

        {/* CTA */}
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
          {paid    && <Check className="w-5 h-5" weight="bold" />}
          {paid ? '¡Turno Confirmado!' : paying ? 'Procesando...' : 'Confirmar y Pagar'}
        </button>

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
