import { Outlet } from 'react-router-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { Home, Calendar, FolderOpen, User } from 'lucide-react'

// Phone-frame shell + bottom nav for the patient mobile experience.
// Professional/admin/super-admin still use AppLayout (desktop sidebar).
export default function PatientMobileLayout({ profile }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const tabs = [
    { id: 'home',     path: '/paciente/dashboard', icon: Home },
    { id: 'activity', path: '/paciente/consultas',  icon: Calendar },
    { id: 'boveda',   path: '/paciente/documentos', icon: FolderOpen },
    { id: 'profile',  path: '/paciente/perfil',     icon: User, isProfile: true },
  ]

  const activeId = tabs.find(t => pathname.startsWith(t.path))?.id ?? 'home'

  // Hide bottom nav on sub-flows (SOS, on-demand, video call)
  const hideNav = ['/paciente/sos', '/paciente/ondemand', '/paciente/videollamada'].some(p =>
    pathname.startsWith(p)
  )

  return (
    <div className="min-h-screen bg-[#E5E5EA] flex items-center justify-center font-sans p-4 sm:p-8">
      <div className="w-full max-w-[430px] h-[932px] bg-[#F8FAFC] rounded-[3.5rem] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.3)] overflow-hidden relative border-[14px] border-[#1C1C1E] flex flex-col select-none">

        {/* Dynamic Island */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-[124px] h-[36px] bg-black rounded-full z-[200] flex items-center justify-end px-2">
          <div className="w-3 h-3 rounded-full bg-[#111] border border-[#2a2a2c]" />
        </div>

        {/* Page content */}
        <div className="flex-1 relative overflow-hidden">
          <Outlet />
        </div>

        {/* Bottom navigation */}
        {!hideNav && (
          <div className="absolute bottom-6 w-full px-6 z-50">
            <div className="bg-white/90 backdrop-blur-[20px] border border-white shadow-[0_8px_30px_rgba(0,0,0,0.08)] rounded-[28px] px-6 py-4 flex justify-between items-center">
              {tabs.map(tab => {
                const active = tab.id === activeId
                return (
                  <button
                    key={tab.id}
                    onClick={() => navigate(tab.path)}
                    className={`flex flex-col items-center gap-1.5 transition-all duration-300 ${active ? 'text-brand scale-110' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    {tab.isProfile ? (
                      <div className={`w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center ${active ? 'ring-2 ring-brand ring-offset-2' : ''}`}>
                        <tab.icon className="h-4 w-4 text-gray-600" strokeWidth={2.5} />
                      </div>
                    ) : (
                      <tab.icon className="h-6 w-6" strokeWidth={active ? 2.5 : 2} />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
