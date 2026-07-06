import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import PatientBottomNav from '../components/patient/PatientBottomNav'
import { Bell, X } from '@phosphor-icons/react'
import { notificationService } from '../services/notificationService'

const HIDE_NAV_PREFIXES = ['/paciente/sos', '/paciente/ondemand', '/paciente/videollamada', '/paciente/reservar', '/paciente/sala-espera', '/paciente/consulta/review', '/paciente/urgente']

export default function PatientMobileLayout({ profile }) {
  const { pathname } = useLocation()
  const [showPushBanner, setShowPushBanner] = useState(false)

  useEffect(() => {
    if (!profile?.id || !notificationService.isSupported()) return
    if (Notification.permission === 'default' && !sessionStorage.getItem('push-dismissed')) {
      setShowPushBanner(true)
    }
  }, [profile?.id])

  async function enablePush() {
    setShowPushBanner(false)
    await notificationService.subscribe(profile.id)
  }

  const hideNav = HIDE_NAV_PREFIXES.some(p => pathname.startsWith(p))

  return (
    <div className="h-dvh bg-bg-primary relative overflow-hidden">
      {/* Push notification opt-in banner */}
      {showPushBanner && (
        <div className="absolute top-0 left-0 right-0 z-[70] bg-brand text-white flex items-center gap-3 px-4 py-3 shadow-lg">
          <Bell size={18} className="shrink-0" />
          <p className="flex-1 text-sm font-medium">Activá notificaciones para recibir confirmaciones de turnos</p>
          <button onClick={enablePush} className="text-xs font-semibold bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-full transition-colors whitespace-nowrap">Activar</button>
          <button onClick={() => { setShowPushBanner(false); sessionStorage.setItem('push-dismissed', '1') }} className="p-1 hover:bg-white/20 rounded-full transition-colors">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Page content */}
      <div className="absolute inset-0">
        <Outlet />
      </div>

      {/* Bottom navigation */}
      {!hideNav && (
        <div className="fixed bottom-0 left-0 w-full z-50 bg-white/90 backdrop-blur-[20px] border-t border-gray-200 px-6 py-4">
          <PatientBottomNav />
        </div>
      )}
    </div>
  )
}
