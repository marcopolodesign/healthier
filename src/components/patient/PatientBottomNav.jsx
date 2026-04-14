import { useNavigate, useLocation } from 'react-router-dom'
import { Home, Calendar, FolderOpen, User } from 'lucide-react'

export const PATIENT_TABS = [
  { id: 'home',     path: '/paciente/dashboard', icon: Home },
  { id: 'activity', path: '/paciente/consultas',  icon: Calendar },
  { id: 'boveda',   path: '/paciente/documentos', icon: FolderOpen },
  { id: 'profile',  path: '/paciente/perfil',     icon: User, isProfile: true },
]

export default function PatientBottomNav({ className = '' }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const activeId = PATIENT_TABS.find(t => pathname.startsWith(t.path))?.id ?? 'home'

  return (
    <nav className={`flex justify-between items-center ${className}`}>
      {PATIENT_TABS.map(tab => {
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
    </nav>
  )
}
