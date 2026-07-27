import { useState, useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import PatientBottomNav from '../components/patient/PatientBottomNav'
import PatientSheet from '../components/patient/PatientSheet'
import { Bell, X, Lightning } from '@phosphor-icons/react'
import { notificationService } from '../services/notificationService'
import { VERTICALS } from '../lib/verticals'
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

// Shown only on Inicio, directly above the nav — a quick-access explainer for
// on-demand care, distinct from the full "Hablá con un médico ahora" hero
// card further down the page. Toggling doesn't set any real availability
// state (no backend concept for that today) — it just opens the explainer
// sheet; closing the sheet resets the switch.
function ConsultaInmediataBar() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const onDemandVerticals = VERTICALS.filter(v => !v.comingSoon)

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex flex-row items-center justify-between px-5 py-3 bg-brand text-white"
      >
        <span className="font-semibold text-[14px]">Consulta inmediata</span>
        <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${open ? 'bg-white' : 'bg-white/30'}`}>
          <span className={`inline-block h-4 w-4 transform rounded-full bg-brand shadow transition-transform ${open ? 'translate-x-6' : 'translate-x-1'}`} />
        </span>
      </button>

      <PatientSheet open={open} onClose={() => setOpen(false)}>
        <div className="px-6 pt-2 pb-8">
          <div className="w-14 h-14 rounded-2xl bg-brand-muted flex items-center justify-center mb-4">
            <Lightning className="w-7 h-7 text-brand" weight="fill" />
          </div>
          <h3 className="text-[22px] font-light text-text-primary leading-tight">¿Qué es Consulta inmediata?</h3>
          <p className="text-[14px] text-text-secondary mt-2 leading-relaxed">
            Hablá con un médico disponible ahora, sin sacar turno previo. Elegís especialidad,
            te conectamos por videollamada en minutos.
          </p>
          <div className="flex flex-col gap-2 mt-5">
            {onDemandVerticals.map(v => (
              <button
                key={v.id}
                onClick={() => { setOpen(false); navigate(`/paciente/ondemand/${v.id}`) }}
                className="w-full flex items-center gap-3 py-3.5 px-4 rounded-2xl bg-bg-secondary border border-border-default hover:border-brand/40 active:scale-[0.98] transition-all text-left"
              >
                <v.icon className="w-[18px] h-[18px]" style={{ color: v.color }} />
                <span className="font-semibold text-[14px] text-text-primary">{v.nombre}</span>
              </button>
            ))}
          </div>
        </div>
      </PatientSheet>
    </>
  )
}

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
  const isInicio = pathname.startsWith('/paciente/dashboard')

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

      {/* Bottom navigation — full-bleed, no padding/rounding/shadow. "Consulta
          inmediata" sits flush above it (zero gap), Inicio only. */}
      {!hideNav && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border-default">
          {isInicio && <ConsultaInmediataBar />}
          <PatientBottomNav />
        </div>
      )}
    </div>
  )
}
