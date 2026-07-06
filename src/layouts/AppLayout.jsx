import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import ProfessionalBottomNav from '../components/professional/ProfessionalBottomNav'
import AICompanion from '../components/professional/AICompanion'
import { supabase } from '../lib/supabase'
import { consultationsService } from '../services/consultationsService'
import { notificationService } from '../services/notificationService'
import { toast } from '../components/Toast'
import { Bell, X } from '@phosphor-icons/react'

const HIDE_PROF_NAV_PREFIXES = ['/profesional/videollamada', '/profesional/consulta']

export default function AppLayout({ profile, profSpecialty }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [companionOpen, setCompanionOpen] = useState(false)
  const [showPushBanner, setShowPushBanner] = useState(false)
  const [subscribing, setSubscribing] = useState(false)
  const { pathname } = useLocation()

  // Show push opt-in banner for professionals whose notifications aren't yet enabled
  useEffect(() => {
    if (profile?.role !== 'professional') return
    if (!notificationService.isSupported()) return
    if (Notification.permission !== 'default') return
    if (sessionStorage.getItem('prof-push-dismissed')) return
    setShowPushBanner(true)
  }, [profile?.role])

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

  // Global booking notification — fires on any professional page when a new consultation arrives
  useEffect(() => {
    if (!isProfessional || !profile?.id) return
    const channel = supabase
      .channel(`global-bookings-${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'consultations', filter: `professional_id=eq.${profile.id}` },
        async (payload) => {
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

          <main className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden ${showProfNav ? 'pb-28 lg:pb-0' : ''}`}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      {/* Mobile bottom nav — professional only */}
      {showProfNav && (
        <div className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-4 sm:px-8 sm:pb-6 lg:hidden">
          <div className="bg-white/90 backdrop-blur-[20px] border border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.1)] rounded-[28px] px-6 py-4 max-w-lg mx-auto">
            <ProfessionalBottomNav profile={profile} profSpecialty={profSpecialty} />
          </div>
        </div>
      )}
    </div>
  )
}
