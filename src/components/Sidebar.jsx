import { NavLink, useNavigate } from 'react-router-dom'
import { House, MagnifyingGlass, Calendar, FileText, User, Users, ClipboardText, ChartBar, ShieldCheck, Gear, MapPin, ForkKnife, UserCircle, ClockCounterClockwise, TrendUp, Sparkle } from '@phosphor-icons/react';
import { authService } from '../services/authService'
import { toast } from './Toast'
import { CompanyLogo } from './common/CompanyLogo'

const PROFILE_ROUTES = {
  professional: '/profesional/perfil',
  patient: '/paciente/perfil',
}

const NAV_BY_ROLE = {
  patient: [
    { to: '/paciente/dashboard',     icon: House,                label: 'Inicio' },
    { to: '/paciente/buscar',        icon: MagnifyingGlass,              label: 'Buscar profesionales' },
    { to: '/paciente/consultas',     icon: Calendar,            label: 'Mis consultas' },
    { to: '/paciente/documentos',    icon: FileText,            label: 'Mis documentos' },
    { to: '/paciente/perfil',        icon: User,                label: 'Mi perfil' },
  ],
  professional: [
    { to: '/profesional/dashboard',  icon: House,       label: 'Inicio' },
    { to: '/profesional/agenda',     icon: Calendar,   label: 'Mi agenda' },
    { to: '/profesional/pacientes',  icon: Users,      label: 'Pacientes' },
    { to: '/profesional/historial',  icon: ClockCounterClockwise,    label: 'Historial' },
    { to: '/profesional/ganancias',  icon: TrendUp,  label: 'Ganancias' },
    { to: '/profesional/nutriplan',  icon: ForkKnife,       label: 'NutriPlan Pro', specialty: 'nutricion' },
  ],
  admin: [
    { to: '/admin/profesionales',    icon: ShieldCheck,   label: 'Verificación' },
    { to: '/admin/usuarios',         icon: Users,         label: 'Usuarios' },
    { to: '/admin/consultas',        icon: ClipboardText, label: 'Consultas' },
  ],
  super_admin: [
    { to: '/super-admin/dashboard',  icon: ChartBar,    label: 'Dashboard' },
    { to: '/super-admin/admins',     icon: ShieldCheck,  label: 'Admins' },
    { to: '/admin/profesionales',    icon: Users,        label: 'Verificación' },
    { to: '/admin/usuarios',         icon: Users,        label: 'Usuarios' },
    { to: '/super-admin/zonas',      icon: MapPin,       label: 'Zonas' },
    { to: '/super-admin/settings',   icon: Gear,     label: 'Configuración' },
  ],
}

export default function Sidebar({ role, profile, profSpecialty, mobileOpen, onClose, onLogoClick, companionOpen, onOpenCompanion }) {
  const navigate = useNavigate()
  const allItems = NAV_BY_ROLE[role] || []
  const items = allItems.filter(item => !item.specialty || item.specialty === profSpecialty)

  const handleLogout = async () => {
    await authService.logout()
    toast.success('Sesión cerrada')
    navigate('/login')
  }

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={onClose} />
      )}

      <aside className={`
        fixed top-0 left-0 h-screen w-64 bg-white border border-border-default z-30
        flex flex-col transition-transform duration-200
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:top-3 lg:left-3 lg:bottom-3 lg:h-auto lg:translate-x-0 lg:rounded-2xl lg:overflow-hidden lg:shadow-[4px_4px_32px_rgba(0,0,0,0.10)]
      `}>
        {/* Logo */}
        <button
          onClick={onLogoClick}
          className="flex items-center px-4 py-5 border-b border-border-default w-full hover:bg-bg-surface transition-colors"
        >
          <CompanyLogo size="sm" />
        </button>

        {/* Nav items */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {items.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) => isActive ? 'nav-item-active' : 'nav-item-inactive'}
            >
              <item.icon className="h-[22px] w-[22px] shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Healthy IA */}
        {role === 'professional' && onOpenCompanion && (
          <div className="px-3 py-3">
            <button
              onClick={() => { onOpenCompanion(); onClose?.() }}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl w-full transition-all duration-200 ${
                companionOpen
                  ? 'bg-brand text-white shadow-sm'
                  : 'text-brand border border-brand/25 bg-brand-muted hover:bg-brand hover:text-white'
              }`}
            >
              <Sparkle className="h-[22px] w-[22px] shrink-0" weight={companionOpen ? 'fill' : 'duotone'} />
              <span className="text-sm font-medium">Healthy</span>
              {!companionOpen && (
                <span className="ml-auto text-[10px] bg-white/60 text-brand rounded-full px-1.5 py-0.5 font-semibold tracking-wide">BETA</span>
              )}
            </button>
          </div>
        )}

        {/* Bottom action */}
        <div className="px-3 py-4 border-t border-border-default">
          {PROFILE_ROUTES[role] ? (
            <NavLink
              to={PROFILE_ROUTES[role]}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg w-full transition-colors ${
                  isActive ? 'bg-brand-muted text-brand' : 'text-text-secondary hover:bg-bg-surface hover:text-text-primary'
                }`
              }
            >
              {profile?.avatarUrl ? (
                <img src={profile.avatarUrl} alt={profile.fullName} className="h-8 w-8 rounded-full object-cover shrink-0" />
              ) : (
                <UserCircle className="h-8 w-8 text-text-tertiary shrink-0" />
              )}
              <div className="text-left min-w-0">
                <p className="text-sm font-medium text-text-primary leading-tight truncate">{profile?.fullName || 'Mi perfil'}</p>
                <p className="text-xs text-text-secondary leading-tight">Ver perfil</p>
              </div>
            </NavLink>
          ) : (
            <button
              onClick={handleLogout}
              className="nav-item-inactive w-full text-left text-error hover:bg-red-50 hover:text-error"
            >
              <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Cerrar sesión
            </button>
          )}
        </div>
      </aside>
    </>
  )
}
