import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import PatientBottomNav from '../components/patient/PatientBottomNav'
import { Bell, X } from '@phosphor-icons/react'
import { notificationService } from '../services/notificationService'
import { track } from '../utils/analytics'

const HIDE_NAV_PREFIXES = ['/paciente/sos', '/paciente/ondemand', '/paciente/videollamada', '/paciente/reservar', '/paciente/sala-espera', '/paciente/consulta/review', '/paciente/fastpass']

// SPA client-side navigation doesn't trigger GTM page views on its own —
// fire section_view manually for the 5 sections in Henry's (Hyppo) tracking
// spec. Deliberately NOT derived from PatientBottomNav's TABS: that array is
// nav-display config (drives which tab is highlighted) and no longer has an
// 'ia' entry since the IA shortcut was removed from the bottom nav
// (2026-07-27) — but /paciente/ia is still a real, reachable route and still
// one of the 5 sections the tracking spec wants measured, so it stays listed
// here even though it has no nav tab. Keep section names in sync with
// Henry's spec ('dashboard', not TABS' internal id 'home') if either list changes.
const SECTION_BY_PREFIX = [
  ['/paciente/dashboard', 'dashboard'],
  ['/paciente/consultas', 'agenda'],
  ['/paciente/ia', 'ia'],
  ['/paciente/documentos', 'boveda'],
  ['/paciente/perfil', 'perfil'],
]


export default function PatientMobileLayout({ profile }) {
  const { pathname } = useLocation()
  const [showPushBanner, setShowPushBanner] = useState(false)

  useEffect(() => {
    if (!profile?.id || !notificationService.isSupported()) return
    if (Notification.permission === 'default' && !sessionStorage.getItem('push-dismissed')) {
      setShowPushBanner(true)
    }
  }, [profile?.id])

  useEffect(() => {
    const match = SECTION_BY_PREFIX.find(([prefix]) => pathname.startsWith(prefix))
    if (match) track('section_view', { section: match[1], page_path: pathname })
  }, [pathname])

  async function enablePush() {
    setShowPushBanner(false)
    await notificationService.subscribe(profile.id)
  }

  const hideNav = HIDE_NAV_PREFIXES.some(p => pathname.startsWith(p))

  return (
    <div className="h-dvh bg-bg-primary relative overflow-hidden overscroll-none">
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

      {/* Bottom navigation — full-bleed white bar */}
      {!hideNav && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border-default">
          <PatientBottomNav />
        </div>
      )}
    </div>
  )
}
