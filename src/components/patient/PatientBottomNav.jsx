import { useNavigate, useLocation } from 'react-router-dom'
import { House, Calendar, FolderOpen, User, Plus } from '@phosphor-icons/react'

const TABS = [
  { id: 'home',   path: '/paciente/dashboard',  icon: House,       label: 'Inicio'  },
  { id: 'agenda', path: '/paciente/consultas',   icon: Calendar,    label: 'Agenda'  },
  { id: 'boveda', path: '/paciente/documentos',  icon: FolderOpen,  label: 'Bóveda'  },
  { id: 'perfil', path: '/paciente/perfil',      icon: User,        label: 'Perfil'  },
]

export default function PatientBottomNav({ className = '' }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const activeId = TABS.find(t => pathname.startsWith(t.path))?.id

  return (
    <nav className={`flex items-center justify-between ${className}`}>
      {TABS.map(tab => {
        const active = tab.id === activeId
        return (
          <button
            key={tab.id}
            onClick={() => navigate(tab.path)}
            className={`flex flex-col items-center gap-1 transition-all duration-200 px-3 ${active ? 'text-brand' : 'text-gray-400 hover:text-gray-500'}`}
          >
            <tab.icon
              className={`h-[22px] w-[22px] transition-transform duration-200 ${active ? 'scale-110' : ''}`}
              weight={active ? 'fill' : 'regular'}
            />
            <span className={`text-[10px] font-medium tracking-wide ${active ? 'text-brand' : 'text-gray-400'}`}>
              {tab.label}
            </span>
          </button>
        )
      })}

      {/* + booking pill — matches mobile */}
      <button
        onClick={() => navigate('/paciente/consultas')}
        className="flex flex-col items-center gap-1 px-3"
        aria-label="Nueva consulta"
      >
        <div className="w-9 h-9 rounded-full bg-brand flex items-center justify-center shadow-[0_4px_12px_rgba(176,90,54,0.35)] transition-transform duration-200 active:scale-95">
          <Plus className="h-[18px] w-[18px] text-white" weight="bold" />
        </div>
        <span className="text-[10px] font-medium text-gray-400 tracking-wide">Nuevo</span>
      </button>
    </nav>
  )
}
