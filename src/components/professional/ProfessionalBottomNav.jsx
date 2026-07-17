import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  House, Calendar, Users, Plus, X,
  ClockCounterClockwise, TrendUp, ForkKnife, User, SignOut, Question,
} from '@phosphor-icons/react'
import { authService } from '../../services/authService'
import { toast } from '../Toast'

const MAIN_TABS = [
  { id: 'dashboard', path: '/profesional/dashboard', icon: House,     label: 'Inicio' },
  { id: 'agenda',    path: '/profesional/agenda',    icon: Calendar,  label: 'Agenda' },
  { id: 'pacientes', path: '/profesional/pacientes', icon: Users,     label: 'Pacientes' },
]

export default function ProfessionalBottomNav({ profile, profSpecialty, className = '' }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)

  const activeId = MAIN_TABS.find(t => pathname.startsWith(t.path))?.id

  const handleNav = (path) => {
    setOpen(false)
    navigate(path)
  }

  const handleLogout = async () => {
    setOpen(false)
    await authService.logout()
    toast.success('Sesión cerrada')
    navigate('/login')
  }

  const modalLinks = [
    { path: '/profesional/historial',  icon: ClockCounterClockwise, label: 'Historial',   sub: 'Consultas anteriores' },
    { path: '/profesional/ganancias',  icon: TrendUp,               label: 'Ganancias',   sub: 'Resumen de ingresos' },
    ...(profSpecialty === 'nutricion' ? [
      { path: '/profesional/nutriplan', icon: ForkKnife, label: 'NutriPlan Pro', sub: 'Planes nutricionales' },
    ] : []),
    { path: '/profesional/ayuda', icon: Question, label: 'Centro de ayuda', sub: 'FAQ y contacto' },
  ]

  return (
    <>
      {/* Bottom nav bar */}
      <nav className={`flex items-center justify-between ${className}`}>
        {MAIN_TABS.map(tab => {
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

        {/* Plus button */}
        <button
          onClick={() => setOpen(true)}
          className="flex flex-col items-center gap-1 px-3"
        >
          <div className="w-9 h-9 rounded-full bg-brand flex items-center justify-center shadow-[0_4px_12px_rgba(176,90,54,0.35)] transition-transform duration-200 active:scale-95">
            <Plus className="h-[18px] w-[18px] text-white" weight="bold" />
          </div>
          <span className="text-[10px] font-medium text-gray-400 tracking-wide">Más</span>
        </button>
      </nav>

      {/* Modal portal */}
      {open && createPortal(
        <>
          <div
            className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="fixed bottom-0 left-0 right-0 z-[100]">
            <div className="bg-[#fef9ef] px-5 pt-4 pb-10 shadow-[0_-8px_40px_rgba(0,0,0,0.15)]">
              <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />

              <div className="flex items-center justify-between mb-5">
                <span className="text-base font-semibold text-text-primary">Menú</span>
                <button
                  onClick={() => setOpen(false)}
                  className="w-8 h-8 rounded-full bg-bg-secondary flex items-center justify-center hover:bg-gray-200 transition-colors"
                >
                  <X className="h-4 w-4 text-text-secondary" />
                </button>
              </div>

              {/* User card */}
              {profile && (
                <button
                  onClick={() => handleNav('/profesional/perfil')}
                  className="flex items-center gap-3 w-full mb-5 p-3 rounded-2xl bg-white/70 border border-white hover:bg-white transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-brand-muted flex items-center justify-center shrink-0 overflow-hidden">
                    {profile.avatarUrl
                      ? <img src={profile.avatarUrl} alt={profile.fullName} className="w-10 h-10 object-cover" />
                      : <User className="h-5 w-5 text-brand" />
                    }
                  </div>
                  <div className="text-left min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{profile.fullName || 'Profesional'}</p>
                    <p className="text-xs text-text-secondary">Ver mi perfil</p>
                  </div>
                </button>
              )}

              <div className="space-y-1 mb-4">
                {modalLinks.map(link => (
                  <button
                    key={link.label}
                    onClick={() => handleNav(link.path)}
                    className="flex items-center gap-4 w-full px-3 py-3.5 rounded-2xl text-left hover:bg-white/60 active:bg-white/80 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-xl bg-white border border-white/80 shadow-sm flex items-center justify-center shrink-0">
                      <link.icon className="h-5 w-5 text-text-secondary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-text-primary">{link.label}</p>
                      <p className="text-xs text-text-tertiary">{link.sub}</p>
                    </div>
                  </button>
                ))}
              </div>

              <div className="border-t border-border-default my-3" />

              <button
                onClick={handleLogout}
                className="flex items-center gap-4 w-full px-3 py-3.5 rounded-2xl text-left hover:bg-red-50 active:bg-red-100 transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center shrink-0">
                  <SignOut className="h-5 w-5 text-error" />
                </div>
                <div>
                  <p className="text-sm font-medium text-error">Cerrar sesión</p>
                  <p className="text-xs text-red-400">Salir de tu cuenta</p>
                </div>
              </button>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}
