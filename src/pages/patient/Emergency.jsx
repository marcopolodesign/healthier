import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Warning, Clock, Ambulance, CircleNotch, Check, Phone, ShieldCheck, Siren, User } from '@phosphor-icons/react';
import { emergencyService } from '../../services/emergencyService'
import InteractiveMap from '../../components/patient/InteractiveMap'
import { toast } from '../../components/Toast'

export default function Emergency({ profile }) {
  const navigate = useNavigate()
  const [phase, setPhase] = useState('payment') // payment | searching | matched
  const [paymentStatus, setPaymentStatus] = useState('idle')
  const [eta, setEta] = useState(4)
  const [unit, setUnit] = useState(null)

  // Count down ETA once matched
  useEffect(() => {
    if (phase !== 'matched') return
    const t = setInterval(() => setEta(p => Math.max(0, p - 1)), 8000)
    return () => clearInterval(t)
  }, [phase])

  const handlePay = async () => {
    setPaymentStatus('processing')
    try {
      await emergencyService.processPayment(50)
      setPaymentStatus('success')
      setTimeout(() => {
        setPhase('searching')
        emergencyService.findUnit(null).then(u => {
          setUnit(u)
          setPhase('matched')
        })
      }, 1500)
    } catch {
      setPaymentStatus('idle')
      toast.error('Error al procesar el pago')
    }
  }

  if (phase === 'matched') {
    return (
      <div className="absolute inset-0 flex flex-col z-[100]">
        <InteractiveMap appState="emergency_matched" sheetState="collapsed" verticales={[]} onMarkerClick={() => {}} userLocation={null} />
        <div className="absolute inset-0 z-[100] flex flex-col justify-end sm:justify-start pointer-events-none animate-fade-in">
          <div className="w-full sm:w-[380px] bg-white rounded-t-[40px] sm:rounded-[28px] p-8 flex flex-col shadow-[0_-15px_40px_rgba(0,0,0,0.2)] sm:shadow-[0_8px_40px_rgba(0,0,0,0.15)] border-t sm:border border-gray-100 pointer-events-auto animate-slide-up-spring sm:absolute sm:left-4 sm:bottom-4">
            <div className="w-14 h-1.5 bg-gray-200 rounded-full mx-auto mb-6 sm:hidden" />
            <div className="bg-red-50 text-red-600 px-4 py-2 rounded-full text-[12px] font-black tracking-widest uppercase mb-4 inline-flex items-center gap-2 self-start border border-red-100">
              <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" /> UNIDAD EN CAMINO
            </div>
            <div className="flex justify-between items-end mb-6">
              <div>
                <h2 className="text-[34px] font-black text-gray-900 leading-none mb-1">Tu ubicación</h2>
                <p className="text-gray-500 font-medium text-[16px]">Ambulancia UTIM prioritaria</p>
              </div>
              <div className="text-right">
                <p className="font-black text-[42px] text-red-600 leading-none drop-shadow-sm">0{eta}<span className="text-[20px]">m</span></p>
              </div>
            </div>
            <div className="bg-bg-primary rounded-[24px] p-5 mb-6 border border-gray-100 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-white rounded-[16px] flex items-center justify-center border border-gray-200 shadow-sm relative">
                  <User className="w-6 h-6 text-gray-400" />
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-brand rounded-full border-2 border-white flex items-center justify-center">
                    <ShieldCheck className="w-3 h-3 text-white" />
                  </div>
                </div>
                <div>
                  <h4 className="font-black text-[18px] text-gray-900 leading-tight">{unit?.unit ?? 'Móvil 42'}</h4>
                  <p className="text-gray-500 text-[14px] font-medium mt-0.5">Paramédico: {unit?.paramedic ?? 'Juan Pérez'}</p>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <button className="w-full bg-black text-white py-5 rounded-[24px] font-black text-[18px] shadow-[0_10px_30px_rgba(0,0,0,0.2)] flex justify-center items-center gap-3 hover:bg-gray-900 active:scale-95 transition-transform">
                <Phone className="h-6 w-6" /> Llamar al Móvil
              </button>
              <button onClick={() => navigate('/paciente/dashboard')} className="w-full py-4 rounded-[20px] font-bold text-red-500 hover:bg-red-50 transition-colors">
                Cancelar S.O.S
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'searching') {
    return (
      <div className="absolute inset-0 flex flex-col z-[100]">
        <InteractiveMap appState="emergency_searching" sheetState="collapsed" verticales={[]} onMarkerClick={() => {}} userLocation={null} />
        <div className="absolute inset-0 z-[90] flex flex-col justify-between pointer-events-none animate-fade-in">
          <div className="pt-24 px-8 text-center max-w-md mx-auto w-full">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-white rounded-full mb-4 relative shadow-md border border-red-100">
              <div className="absolute inset-0 border-2 border-red-500 rounded-full animate-ping opacity-50" />
              <Siren className="w-8 h-8 text-red-600 animate-pulse" />
            </div>
            <h2 className="text-[32px] font-black text-gray-900 leading-none mb-2">Rastreando GPS</h2>
            <p className="text-red-600 font-bold text-[15px] uppercase tracking-widest animate-pulse">Ubicando unidades móviles...</p>
          </div>
          <div className="p-8 pb-12 bg-gradient-to-t from-white via-white/95 to-transparent pointer-events-auto max-w-md mx-auto w-full">
            <button onClick={() => navigate('/paciente/dashboard')} className="w-full py-4 rounded-[20px] font-bold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 shadow-sm transition-colors">
              Cancelar S.O.S
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Payment screen
  return (
    <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex flex-col justify-end sm:items-center sm:justify-center animate-fade-in">
      <div className="absolute top-4 left-4 sm:top-6 sm:left-6 z-[60]">
        <button onClick={() => navigate('/paciente/dashboard')} className="w-12 h-12 bg-white rounded-full flex items-center justify-center hover:bg-gray-50 shadow-sm">
          <ArrowLeft className="h-6 w-6 text-gray-900" />
        </button>
      </div>
      <div className="w-full sm:max-w-lg bg-white rounded-t-[40px] sm:rounded-[28px] shadow-[0_-20px_50px_rgba(0,0,0,0.2)] sm:shadow-2xl pb-10 pt-4 animate-slide-up-spring relative overflow-hidden border-t sm:border border-gray-100">
        <div className="absolute top-0 right-0 w-48 h-48 bg-red-500/5 rounded-bl-[100%] pointer-events-none" />
        <div className="p-8 relative z-10">
          <div className="w-14 h-1.5 bg-gray-200 rounded-full mx-auto mb-8 sm:hidden" />
          <div className="flex items-center gap-4 mb-8">
            <div className="w-16 h-16 rounded-[20px] bg-red-50 flex items-center justify-center border border-red-100 shadow-sm">
              <Warning className="h-8 w-8 text-red-600 animate-pulse" />
            </div>
            <div>
              <h2 className="text-[32px] font-black tracking-tight leading-none mb-1 text-gray-900">Alerta S.O.S</h2>
              <p className="text-gray-500 font-bold text-[15px] uppercase tracking-wider">Despacho Crítico</p>
            </div>
          </div>
          <div className="relative border-2 border-red-100 rounded-[28px] p-6 bg-white overflow-hidden shadow-sm mb-8">
            <div className="absolute top-0 right-0 bg-red-600 text-white text-[10px] font-black px-4 py-2 rounded-bl-[20px] tracking-widest">UTIM ASIGNADA</div>
            <div className="flex justify-between items-center mt-2">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center relative">
                  <div className="absolute inset-0 border border-red-500 rounded-full animate-ping opacity-30" />
                  <Ambulance className="h-7 w-7 text-red-600 relative z-10" />
                </div>
                <div>
                  <h4 className="font-black text-[20px] text-gray-900 leading-tight">Ambulancia</h4>
                  <p className="text-[14px] text-red-500 font-bold flex items-center gap-1 mt-0.5">
                    <Clock className="h-4 w-4" /> Llegada: 4 - 8 min
                  </p>
                </div>
              </div>
              <p className="font-black text-[28px] text-gray-900">$50</p>
            </div>
          </div>
          <div className="mb-8 px-2">
            <h4 className="text-[12px] font-bold text-gray-400 uppercase tracking-widest mb-3">Método Autorizado</h4>
            <div className="flex items-center justify-between bg-gray-50 p-4 rounded-[20px] border border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-12 h-7 rounded bg-[#1A1F71] flex items-center justify-center text-[10px] text-white font-black tracking-widest">VISA</div>
                <span className="font-bold text-[16px] text-gray-800">•••• 4242</span>
              </div>
            </div>
          </div>
          <button
            onClick={handlePay}
            disabled={paymentStatus !== 'idle'}
            className={`w-full py-5 rounded-[24px] font-black text-[18px] transition-all flex justify-center items-center gap-3 tracking-wide
              ${paymentStatus === 'success' ? 'bg-emerald-500 text-white scale-[1.02] shadow-[0_15px_40px_rgba(16,185,129,0.3)]' :
                paymentStatus === 'processing' ? 'bg-gray-200 text-gray-500' :
                'bg-red-600 text-white shadow-[0_8px_25px_rgba(220,38,38,0.3)] hover:bg-red-700 active:scale-95'}`}
          >
            {paymentStatus === 'processing' ? <><CircleNotch className="w-6 h-6 animate-spin" /> Procesando Pago...</>
             : paymentStatus === 'success' ? <><Check className="w-7 h-7 animate-bounce" /> ¡Unidad Despachada!</>
             : <>DESPACHAR AHORA ($50)</>}
          </button>
        </div>
      </div>
    </div>
  )
}
