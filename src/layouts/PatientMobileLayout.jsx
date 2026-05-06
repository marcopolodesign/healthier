import { Outlet, useLocation } from 'react-router-dom'
import PatientBottomNav from '../components/patient/PatientBottomNav'

const HIDE_NAV_PREFIXES = ['/paciente/sos', '/paciente/ondemand']

export default function PatientMobileLayout({ profile }) {
  const { pathname } = useLocation()

  const hideNav = HIDE_NAV_PREFIXES.some(p => pathname.startsWith(p))

  // On desktop the Dashboard renders the nav inside its floating panel — hide the
  // layout-level nav there so it doesn't appear twice.
  const hideNavOnDesktop = pathname === '/paciente/dashboard'

  return (
    <div className="h-dvh bg-bg-primary relative overflow-hidden">
      {/* Page content */}
      <div className="absolute inset-0">
        <Outlet />
      </div>

      {/* Bottom navigation */}
      {!hideNav && (
        <div className={`absolute bottom-0 left-0 right-0 z-50 px-4 pb-4 sm:px-8 sm:pb-6 ${hideNavOnDesktop ? 'sm:hidden' : ''}`}>
          <div className="bg-white/90 backdrop-blur-[20px] border border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.1)] rounded-[28px] px-6 py-4 max-w-lg mx-auto">
            <PatientBottomNav />
          </div>
        </div>
      )}
    </div>
  )
}
