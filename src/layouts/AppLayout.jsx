import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import ProfessionalBottomNav from '../components/professional/ProfessionalBottomNav'
import SuperAdminBottomNav from '../components/super-admin/SuperAdminBottomNav'
import AICompanion from '../components/professional/AICompanion'
import { supabase } from '../lib/supabase'
import { consultationsService, fueAgendadaPorElProfesional } from '../services/consultationsService'
import { useOnDemandPresence } from '../hooks/useOnDemandPresence'
import { professionalService } from '../services/professionalService'
import { notificationService } from '../services/notificationService'
import { toast } from '../components/Toast'
import { Bell, X } from '@phosphor-icons/react'

const HIDE_PROF_NAV_PREFIXES = ['/profesional/videollamada', '/profesional/consulta']

export default function AppLayout({ profile, profSpecialty }) {
  // Disponibilidad on-demand: late mientras el profesional tiene la app abierta
  // y el switch encendido. Va en el layout y no en una pantalla suelta para que
  // siga vivo mientras navega por su panel, no solo en el dashboard.
  const [onDemandEnabled, setOnDemandEnabled] = useState(false)
  useOnDemandPresence(onDemandEnabled)

  useEffect(() => {
    if (profile?.role !== 'professional' || !profile?.id) { setOnDemandEnabled(false); return }
    professionalService.getByUserId(profile.id)
      .then(p => setOnDemandEnabled(Boolean(p?.isOnDemand)))
      .catch(() => setOnDemandEnabled(false))
  }, [profile?.id, profile?.role])
  const [mobileOpen, setMobileOpen] = useState(false)
  const [companionOpen, setCompanionOpen] = useState(false)
  const [showPushBanner, setShowPushBanner] = useState(false)
  // Permiso denegado a nivel browser: no se puede pedir de nuevo por código,
  // hay que decirle cómo reactivarlo a mano.
  const [pushBlocked, setPushBlocked] = useState(false)
  const [subscribing, setSubscribing] = useState(false)
  const { pathname } = useLocation()

  // Banner de opt-in de push para profesionales.
  //
  // Se gatea por si hay una suscripción REAL, no por `Notification.permission`.
  // Gatear por el permiso era una trampa de una sola dirección: `subscribe()`
  // pide el permiso antes de crear la suscripción, así que cuando la VAPID key
  // faltaba en producción (hasta el 2026-07-27) el browser quedaba en `granted`
  // con la tabla vacía — y el banner, que solo aparecía en `default`, no volvía
  // a mostrarse nunca. Resultado: `push_subscriptions` con 0 filas y nadie
  // pudiendo arreglarlo desde la UI.
  useEffect(() => {
    if (profile?.role !== 'professional' || !profile?.id) return
    let cancelled = false
    notificationService.status(profile.id).then(async st => {
      if (cancelled || st === 'ok' || st === 'unsupported') return
      if (st === 'blocked') { setPushBlocked(true); return }
      // Permiso ya concedido pero sin suscripción: se recupera solo, sin
      // volver a molestar con el prompt.
      if (Notification.permission === 'granted') {
        const ok = await notificationService.ensureSubscribed(profile.id)
        if (ok || cancelled) return
      }
      if (!sessionStorage.getItem('prof-push-dismissed')) setShowPushBanner(true)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [profile?.role, profile?.id])

  const handleEnablePush = async () => {
    if (!profile?.id) return
    setSubscribing(true)
    try {
      await notificationService.subscribe(profile.id)
      setShowPushBanner(false)
      toast.success('Notificaciones activadas — te avisaremos cuando lleguen reservas.')
    } catch {
      toast.error('No se pudo activar las notificaciones.')
    } finally {
      setSubscribing(false)
    }
  }

  const dismissPushBanner = () => {
    sessionStorage.setItem('prof-push-dismissed', '1')
    setShowPushBanner(false)
  }

  const isProfessional = profile?.role === 'professional'
  const hideProfNav = HIDE_PROF_NAV_PREFIXES.some(p => pathname.startsWith(p))
  const showProfNav = isProfessional && !hideProfNav
  // El super admin sólo tenía la hamburguesa del header: en un teléfono eso
  // deja Pagos a dos toques y escondido (Mateo, 2026-08-05).
  const showSuperAdminNav = profile?.role === 'super_admin'
  const showBottomNav = showProfNav || showSuperAdminNav

  // Global booking notification — fires on any professional page when a new consultation arrives
  useEffect(() => {
    if (!isProfessional || !profile?.id) return
    const channel = supabase
      .channel(`global-bookings-${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'consultations', filter: `professional_id=eq.${profile.id}` },
        async (payload) => {
          // No avisar de un turno que agendó el propio profesional: hasta ahora
          // reagendar o cargar un seguimiento le devolvía "Nueva reserva de …"
          // como si lo hubiera reservado el paciente.
          if (fueAgendadaPorElProfesional(payload.new.id)) return
          const updated = await consultationsService.getByProfessional(profile.id)
          const newCons = updated.find(c => c.id === payload.new.id)
          const name = newCons?.profiles?.fullName || 'Nuevo paciente'
          const time = newCons?.scheduledAt
            ? new Date(newCons.scheduledAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
            : null
          toast.success(time ? `Nueva reserva de ${name} — ${time}` : `Nueva reserva de ${name}`)
        }
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [isProfessional, profile?.id])

  return (
    <div className="min-h-screen bg-bg-primary flex">
      <Sidebar
        role={profile?.role}
        profile={profile}
        profSpecialty={profSpecialty}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        companionOpen={companionOpen}
        onOpenCompanion={() => setCompanionOpen(true)}
      />
      {/* WRAPPER: right of fixed menu, owns the 12px gutter + viewport height */}
      <div className="flex-1 flex flex-row min-w-0 lg:ml-[calc(16rem+0.75rem)] lg:h-screen lg:p-3">
        {isProfessional && (
          <AICompanion open={companionOpen} onClose={() => setCompanionOpen(false)} profile={profile} profSpecialty={profSpecialty} />
        )}

        {/* CONTENT PANEL: card on desktop, full-bleed on mobile */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden lg:rounded-2xl lg:bg-bg-surface lg:border lg:border-border-default lg:shadow-[4px_4px_32px_rgba(0,0,0,0.10)]">
          {!isProfessional && (
            <Header profile={profile} onMenuToggle={() => setMobileOpen(true)} />
          )}

          {/* Permiso denegado a nivel browser: no se puede volver a pedir por
              código, así que lo único útil es decirle dónde reactivarlo. Sin
              esto, un médico que apretó "Bloquear" una vez queda inalcanzable
              por push para siempre y sin enterarse. */}
          {pushBlocked && (
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-50 border-b border-amber-200">
              <div className="flex items-center gap-2 text-sm text-amber-800">
                <Bell size={15} className="text-amber-600 flex-shrink-0" weight="fill" />
                <span>
                  Tenés las notificaciones bloqueadas en este navegador, así que no vas a
                  recibir avisos de consultas inmediatas. Habilitalas desde el candado
                  junto a la dirección del sitio.
                </span>
              </div>
              <button onClick={() => setPushBlocked(false)} className="text-amber-700 hover:text-amber-900 flex-shrink-0">
                <X size={14} />
              </button>
            </div>
          )}

          {/* Push opt-in banner for professionals */}
          {showPushBanner && (
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-brand/10 border-b border-brand/20">
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <Bell size={15} className="text-brand flex-shrink-0" weight="fill" />
                <span>Activá las notificaciones para recibir alertas de nuevas reservas en tiempo real.</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={handleEnablePush}
                  disabled={subscribing}
                  className="text-xs font-medium text-brand hover:underline disabled:opacity-50"
                >
                  {subscribing ? 'Activando…' : 'Activar'}
                </button>
                <button onClick={dismissPushBanner} className="text-text-tertiary hover:text-text-secondary">
                  <X size={14} />
                </button>
              </div>
            </div>
          )}

          <main className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden ${showBottomNav ? 'pb-28 lg:pb-0' : ''}`}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      {/* Mobile bottom nav — professional only */}
      {/* Nav de profesional en mobile: barra full-bleed pegada abajo, igual que
          la de paciente (`PatientMobileLayout`). Antes era una píldora flotante
          con márgenes, radio y sombra: comía ancho, tapaba contenido y no
          coincidía con el resto de la app (Mateo, 2026-08-05). El padding
          interno lo pone el `className` del nav, como hace PatientBottomNav. */}
      {showBottomNav && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border-default lg:hidden">
          {showProfNav ? (
            <ProfessionalBottomNav
              profile={profile}
              profSpecialty={profSpecialty}
              className="px-8 pt-3.5 pb-6"
            />
          ) : (
            <SuperAdminBottomNav className="px-5 pt-3.5 pb-6" />
          )}
        </div>
      )}
    </div>
  )
}
