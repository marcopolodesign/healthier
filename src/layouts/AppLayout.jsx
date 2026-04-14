import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'

export default function AppLayout({ profile, onOpenSidecart }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="min-h-screen bg-bg-primary flex">
      <Sidebar
        role={profile?.role}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        onLogoClick={onOpenSidecart}
      />
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden lg:ml-0">
        <Header profile={profile} onMenuToggle={() => setMobileOpen(true)} onLogoClick={onOpenSidecart} />
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
