import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, VideoCamera, Clock, CircleNotch, Check } from '@phosphor-icons/react';
import { toast } from '../../components/Toast'
import { professionalService } from '../../services/professionalService'
import { consultationsService } from '../../services/consultationsService'
import { VERTICALS_BY_ID, SPECIALTY_LABELS, VERTICAL_SPECIALTIES } from '../../lib/verticals'

export default function OnDemand({ profile }) {
  const { vertical: verticalId } = useParams()
  const navigate = useNavigate()
  const vertical = VERTICALS_BY_ID[verticalId]

  const [paymentStatus, setPaymentStatus] = useState('idle')
  const [searching, setSearching] = useState(false)
  const [matched, setMatched] = useState(false)
  const [matchedPro, setMatchedPro] = useState(null)
  const [consultationId, setConsultationId] = useState(null)

  if (!vertical || vertical.comingSoon) {
    navigate('/paciente/dashboard')
    return null
  }

  const handlePay = () => {
    setPaymentStatus('processing')
    setTimeout(() => {
      setPaymentStatus('success')
      setTimeout(() => {
        setPaymentStatus('idle')
        setSearching(true)
        // Fetch a real pro for this vertical during the search animation
        const slugs = VERTICAL_SPECIALTIES[verticalId] || []
        const primarySlug = slugs[0]
        const fetchPro = primarySlug
          ? professionalService.search({ specialty: primarySlug, onDemand: true })
              .catch(() => professionalService.search({ specialty: primarySlug }))
          : Promise.resolve([])
        Promise.all([
          new Promise(r => setTimeout(r, 3500)),
          fetchPro,
        ]).then(async ([, pros]) => {
          const pro = pros[0] ?? null
          if (pro && profile?.id) {
            try {
              const cons = await consultationsService.create({
                patientId: profile.id,
                professionalId: pro.userId,
                scheduledAt: new Date().toISOString(),
                modality: 'video',
                status: 'confirmed',
                priceAtBooking: 15,
              })
              setConsultationId(cons.id)
            } catch (err) {
              console.error('[OnDemand] consultation create failed:', err)
              toast.error('Error al crear la consulta. Intentá de nuevo.')
            }
          }
          setMatchedPro(pro)
          setSearching(false)
          setMatched(true)
        })
      }, 1000)
    }, 1500)
  }

  const IconComp = vertical.icon

  if (matched) {
    if (!matchedPro) {
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

    const proName    = matchedPro.profiles?.fullName || 'Profesional'
    const proAvatar  = matchedPro.profiles?.avatarUrl || null
    const proRating  = matchedPro.averageRating ? String(matchedPro.averageRating) : '—'
    const proSpecialty = SPECIALTY_LABELS[matchedPro.specialty] || vertical.nombre

    return (
      <div className="absolute inset-0 bg-bg-primary z-[100] flex flex-col items-center justify-between p-6 animate-fade-in overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1/2 bg-brand-muted/30 rounded-b-[100px]" />
        <div className="w-full max-w-md mx-auto flex justify-end pt-8 relative z-10">
          <button onClick={() => navigate('/paciente/dashboard')} className="w-10 h-10 bg-white border border-gray-100 rounded-full flex items-center justify-center shadow-sm text-gray-500 hover:bg-gray-50">✕</button>
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
          <div className="flex items-start gap-4 mb-6 p-4 bg-brand-muted/40 rounded-[20px] border border-brand/20">
            <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm">
              <VideoCamera className="w-5 h-5 text-brand" />
            </div>
            <div>
              <h4 className="font-bold text-gray-900 text-[15px] mb-1">Sala Segura Creada</h4>
              <p className="text-gray-500 text-[13px] leading-snug">El profesional te está esperando. Tenés 3 min para unirte.</p>
            </div>
          </div>
          <button
            data-testid="enter-call-btn"
            onClick={() => navigate(consultationId ? `/paciente/sala-espera/${consultationId}` : '/paciente/videollamada/1')}
            className="w-full bg-brand text-white py-4 rounded-[20px] font-bold text-[17px] shadow-md hover:bg-brand-hover active:scale-95 transition-all flex justify-center items-center gap-3 mb-4"
          >
            Entrar a la Llamada
          </button>
          <button onClick={() => navigate('/paciente/dashboard')} className="w-full bg-gray-50 text-gray-500 py-3.5 rounded-[16px] font-bold text-[15px] flex justify-center items-center hover:bg-gray-100">
            Cancelar Consulta
          </button>
        </div>
      </div>
    )
  }

  if (searching) {
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

  // Payment screen
  return (
    <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex flex-col justify-end sm:items-center sm:justify-center animate-fade-in">
      <div className="absolute top-4 left-4 sm:top-6 sm:left-6 z-[60]">
        <button onClick={() => navigate('/paciente/dashboard')} className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center hover:bg-gray-50">
          <ArrowLeft className="h-6 w-6 text-gray-900" />
        </button>
      </div>
      <div className="w-full sm:max-w-lg bg-white rounded-t-[40px] sm:rounded-[28px] shadow-[0_-20px_50px_rgba(0,0,0,0.2)] sm:shadow-2xl pb-10 p-6 animate-slide-up-spring border-t sm:border border-gray-100">
        <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6 sm:hidden" />
        <div className="px-2">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm" style={{ backgroundColor: vertical.bg }}>
              <IconComp className="h-7 w-7" style={{ color: vertical.color }} />
            </div>
            <div>
              <h2 className="text-[28px] font-black tracking-tight text-gray-900 leading-none mb-1">Tele-{vertical.nombre}</h2>
              <p className="text-gray-500 font-medium text-[15px]">Expertos verificados en línea</p>
            </div>
          </div>

          <div className="space-y-4 mb-6">
            <div className="relative border border-gray-200 rounded-[24px] p-5 bg-[#F8FAFC] overflow-hidden">
              <div className="absolute top-0 right-0 bg-gray-900 text-white text-[10px] font-bold px-3 py-1.5 rounded-bl-[16px]">INMEDIATO</div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm border border-gray-100">
                    <VideoCamera className="h-6 w-6 text-gray-900" />
                  </div>
                  <div>
                    <h4 className="font-bold text-[18px] text-gray-900">Consulta en Vivo</h4>
                    <p className="text-[14px] text-gray-500 flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" /> Espera: {vertical.eta}
                    </p>
                  </div>
                </div>
                <p className="font-black text-[22px] text-gray-900">$15</p>
              </div>
            </div>
          </div>

          <button
            onClick={handlePay}
            disabled={paymentStatus !== 'idle'}
            className={`w-full py-5 rounded-[20px] font-bold text-[17px] shadow-sm transition-all flex justify-center items-center gap-2
              ${paymentStatus === 'success' ? 'bg-emerald-500 text-white' :
                paymentStatus === 'processing' ? 'bg-gray-100 text-gray-400' :
                'bg-brand text-white hover:bg-brand-hover active:scale-95'}`}
          >
            {paymentStatus === 'processing' ? <><CircleNotch className="w-5 h-5 animate-spin" /> Autorizando...</>
             : paymentStatus === 'success' ? <><Check className="w-6 h-6 animate-bounce" /> ¡Pago Exitoso!</>
             : <>Pagar $15 e Iniciar</>}
          </button>
        </div>
      </div>
    </div>
  )
}
