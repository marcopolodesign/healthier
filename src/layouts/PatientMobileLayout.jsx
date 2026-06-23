import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import PatientBottomNav from '../components/patient/PatientBottomNav'
import { Plus } from '@phosphor-icons/react'

const HIDE_NAV_PREFIXES = ['/paciente/sos', '/paciente/ondemand', '/paciente/videollamada', '/paciente/reservar', '/paciente/sala-espera', '/paciente/consulta/review', '/paciente/urgente']

export default function PatientMobileLayout({ profile }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const hideNav = HIDE_NAV_PREFIXES.some(p => pathname.startsWith(p))

  return (
    <div className="h-dvh bg-bg-primary relative overflow-hidden">
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

      {/* Floating new-consultation FAB — navigates to the booking wizard */}
      {!hideNav && (
        <button
          onClick={() => navigate('/paciente/reservar')}
          aria-label="Nueva consulta"
          className="fixed bottom-[80px] right-4 z-[60] w-14 h-14 rounded-full bg-brand shadow-[0_4px_16px_rgba(124,179,139,0.45)] flex items-center justify-center active:scale-95 transition-transform"
        >
          <Plus className="w-6 h-6 text-white" weight="bold" />
        </button>
      )}
    </div>
  )
}
