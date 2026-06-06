import { useState, useEffect } from 'react'
import { CreditCard, Receipt, Ambulance, FileText, DownloadSimple, CircleNotch } from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'
import { emergencyService } from '../../services/emergencyService'

const TRIAGE_COLORS = { ROJO: '#F43F5E', AMARILLO: '#F59E0B', VERDE: '#10B981' }

export default function PatientComprobantes({ profile }) {
  const [comprobantes, setComprobantes] = useState([])
  const [tarjetas, setTarjetas] = useState([])
  const [emergencies, setEmergencies] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.id) return
    Promise.all([
      supabase.from('comprobantes').select('*').eq('paciente_id', profile.id).order('created_at', { ascending: false }),
      supabase.from('tarjetas').select('*').eq('paciente_id', profile.id),
      emergencyService.getByPatient(profile.id),
    ]).then(([comp, tars, emgs]) => {
      setComprobantes(comp.data ?? [])
      setTarjetas(tars.data ?? [])
      setEmergencies(emgs.filter(e => !['cancelled', 'pending'].includes(e.status)))
    }).catch(() => {}).finally(() => setLoading(false))
  }, [profile?.id])

  if (loading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-bg-primary">
        <CircleNotch className="w-7 h-7 text-brand animate-spin" />
      </div>
    )
  }

  return (
    <div className="absolute inset-0 bg-bg-primary pt-6 sm:pt-8 pb-32 px-5 overflow-y-auto scrollbar-hide animate-fade-in">
      <div className="max-w-lg mx-auto">
        <div className="mb-8 mt-4">
          <h1 className="text-[32px] font-black text-gray-900 tracking-tight leading-none">Comprobantes</h1>
          <p className="text-gray-500 font-medium text-[15px] mt-2">Historial de pagos</p>
        </div>

        {/* Payment methods */}
        <div className="bg-bg-secondary rounded-[24px] border border-border-default p-5 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="w-[18px] h-[18px] text-brand" />
            <h2 className="font-bold text-[15px] text-gray-900">Métodos de pago</h2>
          </div>
          {tarjetas.length === 0 ? (
            <p className="text-sm text-gray-400">Sin tarjetas guardadas</p>
          ) : (
            <div className="space-y-3">
              {tarjetas.map(t => (
                <div key={t.id} className="flex items-center gap-4">
                  <div className={`px-2 py-1 rounded-md text-[10px] font-black text-white shrink-0 ${t.marca === 'VISA' ? 'bg-[#1A1F71]' : t.marca === 'Mastercard' ? 'bg-[#252525]' : 'bg-[#006FCF]'}`}>
                    {t.marca}
                  </div>
                  <div>
                    <p className="font-semibold text-[14px] text-gray-900">{t.numero}</p>
                    <p className="text-[12px] text-gray-500">Vence {t.vencimiento}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Emergency receipts */}
        {emergencies.map(emg => {
          const triageColor = TRIAGE_COLORS[emg.triage_code] ?? '#F43F5E'
          const fecha = new Date(emg.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
          return (
            <div key={emg.id} className="rounded-[24px] border mb-4 overflow-hidden" style={{ borderColor: triageColor + '40' }}>
              <div className="p-4 flex items-start gap-4" style={{ backgroundColor: triageColor + '06' }}>
                <div className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0" style={{ backgroundColor: triageColor + '18' }}>
                  <Ambulance className="w-5 h-5" style={{ color: triageColor }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[14px] text-gray-900">Emergencia S.O.S · {emg.triage_code}</p>
                  <p className="text-[12px] text-gray-500 mt-0.5">{fecha} · {emg.dispatch_code ?? '—'}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-black text-[16px] text-gray-900">$45.00</p>
                  <div className="mt-1 px-2 py-0.5 rounded-md text-[10px] font-black text-white" style={{ backgroundColor: triageColor }}>
                    {emg.status === 'completed' ? 'Completado' : 'En curso'}
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {/* Regular receipts */}
        {comprobantes.length === 0 && emergencies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Receipt className="w-14 h-14 text-gray-200" />
            <p className="text-[15px] text-gray-400 font-medium">No hay comprobantes aún.</p>
          </div>
        ) : (
          comprobantes.map(comp => (
            <div key={comp.id} className="bg-bg-secondary rounded-[24px] border border-border-default mb-4 overflow-hidden">
              <div className="p-4 flex items-start gap-4">
                <div className="w-11 h-11 rounded-[14px] bg-brand-muted flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-brand" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[14px] text-gray-900 line-clamp-2">{comp.concepto}</p>
                  <p className="text-[12px] text-gray-500 mt-0.5">{comp.fecha} · •••• {comp.tarjeta}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-black text-[16px] text-gray-900">{comp.monto}</p>
                  <div className="mt-1 px-2 py-0.5 rounded-md bg-emerald-50 text-[10px] font-black text-emerald-600">
                    {comp.estado}
                  </div>
                </div>
              </div>
              <div className="h-px bg-border-default" />
              <button className="w-full flex items-center justify-center gap-2 py-3 text-brand text-[13px] font-semibold hover:bg-bg-primary transition-colors">
                <DownloadSimple className="w-4 h-4" />
                Descargar PDF
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
