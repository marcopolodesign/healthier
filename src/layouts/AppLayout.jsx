import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import ProfessionalBottomNav from '../components/professional/ProfessionalBottomNav'
import AICompanion from '../components/professional/AICompanion'

const HIDE_PROF_NAV_PREFIXES = ['/profesional/videollamada', '/profesional/consulta']

export default function AppLayout({ profile, profSpecialty, onOpenSidecart }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [companionOpen, setCompanionOpen] = useState(false)
  const { pathname } = useLocation()

  const isProfessional = profile?.role === 'professional'
  const hideProfNav = HIDE_PROF_NAV_PREFIXES.some(p => pathname.startsWith(p))
  const showProfNav = isProfessional && !hideProfNav

  return (
    <div className="min-h-screen bg-bg-primary flex">
      <Sidebar
        role={profile?.role}
        profile={profile}
        profSpecialty={profSpecialty}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        onLogoClick={onOpenSidecart}
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
            <Header profile={profile} onMenuToggle={() => setMobileOpen(true)} onLogoClick={onOpenSidecart} />
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
