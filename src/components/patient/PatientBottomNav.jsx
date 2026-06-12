import { useNavigate, useLocation } from 'react-router-dom'
import { House, Calendar, FolderOpen, User } from '@phosphor-icons/react'

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

    </nav>
  )
}
