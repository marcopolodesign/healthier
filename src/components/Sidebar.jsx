import { NavLink, useNavigate } from 'react-router-dom'
import { Home, Search, Calendar, FileText, User, Users, ClipboardList, BarChart2, ShieldCheck, Settings, Zap, MapPin } from 'lucide-react'
import { authService } from '../services/authService'
import { toast } from './Toast'

const NAV_BY_ROLE = {
  patient: [
    { to: '/paciente/dashboard',     icon: Home,                label: 'Inicio' },
    { to: '/paciente/buscar',        icon: Search,              label: 'Buscar profesionales' },
    { to: '/paciente/consultas',     icon: Calendar,            label: 'Mis consultas' },
    { to: '/paciente/documentos',    icon: FileText,            label: 'Mis documentos' },
    { to: '/paciente/perfil',        icon: User,                label: 'Mi perfil' },
  ],
  professional: [
    { to: '/profesional/dashboard',  icon: Home,       label: 'Inicio' },
    { to: '/profesional/agenda',     icon: Calendar,   label: 'Mi agenda' },
    { to: '/profesional/perfil',     icon: User,       label: 'Mi perfil' },
  ],
  admin: [
    { to: '/admin/profesionales',    icon: ShieldCheck,   label: 'Verificación' },
    { to: '/admin/usuarios',         icon: Users,         label: 'Usuarios' },
    { to: '/admin/consultas',        icon: ClipboardList, label: 'Consultas' },
  ],
  super_admin: [
    { to: '/super-admin/dashboard',  icon: BarChart2,    label: 'Dashboard' },
    { to: '/super-admin/admins',     icon: ShieldCheck,  label: 'Admins' },
    { to: '/admin/profesionales',    icon: Users,        label: 'Verificación' },
    { to: '/admin/usuarios',         icon: Users,        label: 'Usuarios' },
    { to: '/super-admin/zonas',      icon: MapPin,       label: 'Zonas' },
    { to: '/super-admin/settings',   icon: Settings,     label: 'Configuración' },
  ],
}

export default function Sidebar({ role, mobileOpen, onClose, onLogoClick }) {
  const navigate = useNavigate()
  const items = NAV_BY_ROLE[role] || []

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
        fixed top-0 left-0 h-full min-h-screen w-64 bg-white border-r border-border-default z-30
        flex flex-col transition-transform duration-200
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:relative lg:translate-x-0
      `}>
        {/* Logo */}
        <button
          onClick={onLogoClick}
          className="flex items-center gap-2 px-4 py-5 border-b border-border-default w-full hover:bg-bg-surface transition-colors"
        >
          <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <span className="font-bold text-lg text-text-primary" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Healthier
          </span>
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
              <item.icon className="h-5 w-5 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Logout */}
        <div className="px-3 py-4 border-t border-border-default">
          <button
            onClick={handleLogout}
            className="nav-item-inactive w-full text-left text-error hover:bg-red-50 hover:text-error"
          >
            <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Cerrar sesión
          </button>
        </div>
      </aside>
    </>
  )
}
