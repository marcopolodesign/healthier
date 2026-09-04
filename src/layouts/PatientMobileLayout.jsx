import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import PatientBottomNav from '../components/patient/PatientBottomNav'
import { Bell, X } from '@phosphor-icons/react'
import { notificationService } from '../services/notificationService'
import { track } from '../utils/analytics'
import { PharmacyCartProvider } from '../context/PharmacyCartContext'
import PharmacyCartSheet from '../components/patient/PharmacyCartSheet'

const HIDE_NAV_PREFIXES = ['/paciente/sos', '/paciente/ondemand', '/paciente/videollamada', '/paciente/reservar', '/paciente/sala-espera', '/paciente/consulta/review', '/paciente/fastpass', '/paciente/camino']

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
    if (match) track('section_view', { section: match[1], app_path: pathname, flow: 'paciente' })
  }, [pathname])

  async function enablePush() {
    setShowPushBanner(false)
    await notificationService.subscribe(profile.id)
  }

  const hideNav = HIDE_NAV_PREFIXES.some(p => pathname.startsWith(p))

  return (
    <PharmacyCartProvider profile={profile}>
    <div className="h-dvh bg-bg-primary relative overflow-hidden overscroll-none">
      {/* Push notification opt-in banner.
          No se muestra en las pantallas a pantalla completa (las mismas que
          esconden el nav): se monta `absolute top-0 z-[70]` y les tapa el
          botón de volver — el del mapa del camino al consultorio quedaba
          literalmente abajo del banner. */}
      {showPushBanner && !hideNav && (
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

      {/* Navegación.
          En mobile: barra full-bleed pegada abajo (sin cambios).
          En desktop (lg+): una barra de tabs de teléfono estirada a 1440px deja
          los 4 íconos separados por cientos de píxeles y se lee como un error.
          Pasa a ser una píldora flotante centrada, con el mismo vidrio
          esmerilado que ya usan el panel flotante del mapa y el pill de
          ubicación. Flota bien sobre el mapa del Dashboard, que es la única
          pantalla de paciente que ya tenía rama de escritorio. */}
      {!hideNav && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border-default
                        lg:left-1/2 lg:right-auto lg:-translate-x-1/2 lg:bottom-6
                        lg:w-auto lg:rounded-full lg:border lg:border-white/80
                        lg:bg-white/90 lg:backdrop-blur-[20px]
                        lg:shadow-[0_8px_30px_rgba(0,0,0,0.1)]">
          <PatientBottomNav className="lg:gap-4 lg:px-4 lg:pt-3 lg:pb-3" />
        </div>
      )}

      {/* El carrito de farmacia sigue al paciente por toda la app: si agregó
          algo y se fue a mirar sus turnos, la píldora sigue ahí. */}
      <PharmacyCartSheet navVisible={!hideNav} />
    </div>
    </PharmacyCartProvider>
  )
}
