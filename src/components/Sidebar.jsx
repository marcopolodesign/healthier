import { useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { House, MagnifyingGlass, Calendar, FileText, User, Users, ClipboardText, ChartBar, ShieldCheck, Gear, MapPin, ForkKnife, UserCircle, ClockCounterClockwise, TrendUp, Sparkle, UserCirclePlus, Question, CurrencyDollar, Eye, Stethoscope, Siren, CalendarCheck, Funnel, CaretDown, ShieldWarning, Path, ShareNetwork, ShoppingBag } from '@phosphor-icons/react';
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
    { to: '/profesional/dashboard',      icon: House,                label: 'Inicio' },
    { to: '/profesional/agenda',         icon: Calendar,             label: 'Mi agenda' },
    { to: '/profesional/pacientes',      icon: Users,                label: 'Pacientes' },
    { to: '/profesional/historial',      icon: ClockCounterClockwise, label: 'Historial' },
    { to: '/profesional/ganancias',      icon: TrendUp,              label: 'Ganancias' },
    { to: '/profesional/configuracion',  icon: Gear,                 label: 'Configuración' },
    { to: '/profesional/nutriplan',      icon: ForkKnife,            label: 'NutriPlan Pro', specialty: 'nutricion' },
    { to: '/profesional/ayuda',          icon: Question,             label: 'Centro de ayuda' },
  ],
  admin: [
    { to: '/admin/profesionales',    icon: ShieldCheck,   label: 'Verificación' },
    { to: '/admin/usuarios',         icon: Users,         label: 'Usuarios' },
    { to: '/admin/consultas',        icon: ClipboardText, label: 'Consultas' },
  ],
  super_admin: [
    { to: '/super-admin/dashboard',              icon: ChartBar,        label: 'Dashboard' },
    { to: '/super-admin/pagos',                  icon: CurrencyDollar,  label: 'Pagos' },
    {
      group: 'consultas', label: 'Consultas', icon: CalendarCheck,
      items: [
        { to: '/super-admin/consultas',    icon: CalendarCheck, label: 'Consultas' },
        { to: '/super-admin/emergencias',  icon: Siren,         label: 'Emergencias' },
      ],
    },
    {
      group: 'pacientes', label: 'Pacientes', icon: Users,
      items: [
        { to: '/super-admin/usuarios/prospects',       icon: UserCirclePlus, label: 'Prospectos' },
        { to: '/super-admin/usuarios',                 icon: Users,          label: 'Pacientes' },
      ],
    },
    {
      group: 'profesionales', label: 'Profesionales', icon: ShieldCheck,
      items: [
        { to: '/super-admin/profesionales/prospects',            icon: Funnel,         label: 'Prospectos' },
        { to: '/super-admin/profesionales/recorrido',            icon: Path,           label: 'Recorrido' },
        { to: '/super-admin/profesionales?filter=pendientes',    icon: ShieldWarning,  label: 'Pendientes verificación' },
        { to: '/super-admin/profesionales?filter=verificados',   icon: ShieldCheck,    label: 'Verificados' },
        { to: '/super-admin/profesionales/referidos',            icon: ShareNetwork,   label: 'Referidos' },
      ],
    },
    { to: '/super-admin/auditoria',              icon: Eye,             label: 'Auditoría HC' },
    {
      group: 'configuracion', label: 'Configuración', icon: Gear,
      items: [
        { to: '/super-admin/settings',      icon: Gear,         label: 'General' },
        { to: '/super-admin/zonas',         icon: MapPin,       label: 'Zonas' },
        { to: '/super-admin/verticales',    icon: Stethoscope,  label: 'Verticales' },
        { to: '/super-admin/admins',        icon: ShieldCheck,  label: 'Admins' },
      ],
    },
    // Farmacia (rama feature/farmacia-medicamentos, mergeada a staging el
    // 2026-08-26 — todavía no a main/producción, ver CLAUDE.md).
    { to: '/super-admin/farmacia',                icon: ShoppingBag,    label: 'Farmacia' },
  ],
  pharmacy_admin: [
    { to: '/farmacia/pedidos',        icon: ClipboardText, label: 'Pedidos' },
    { to: '/farmacia/catalogo',       icon: ShoppingBag,   label: 'Catálogo' },
    { to: '/farmacia/configuracion',  icon: Gear,          label: 'Configuración' },
  ],
  pharmacy_operator: [
    { to: '/farmacia/pedidos', icon: ClipboardText, label: 'Pedidos' },
  ],
  pharmacy_readonly: [
    { to: '/farmacia/pedidos', icon: ClipboardText, label: 'Pedidos' },
  ],
}

export default function Sidebar({ role, profile, profSpecialty, mobileOpen, onClose, companionOpen, onOpenCompanion }) {
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const allItems = NAV_BY_ROLE[role] || []
  const items = allItems.filter(item => !item.specialty || item.specialty === profSpecialty)

  // Grupos colapsables (Configuración, Consultas+Emergencias, Pacientes,
  // Profesionales): abiertos por default si la ruta activa está adentro, si
  // no arrancan cerrados.
  const [openGroups, setOpenGroups] = useState(() => {
    const initial = {}
    for (const item of items) {
      if (item.group) initial[item.group] = item.items.some(sub => pathname === sub.to.split('?')[0])
    }
    return initial
  })
  const toggleGroup = (group) => setOpenGroups(prev => ({ ...prev, [group]: !prev[group] }))

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
        <div className="flex items-center px-4 py-5 border-b border-border-default w-full">
          <CompanyLogo size="sm" />
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {items.map(item => {
            if (item.group) {
              const isOpen = openGroups[item.group]
              const hasActiveChild = item.items.some(sub => pathname === sub.to.split('?')[0])
              return (
                <div key={item.group}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(item.group)}
                    className={`${hasActiveChild ? 'nav-pill-active' : 'nav-pill-inactive'} w-full justify-between`}
                  >
                    <span className="flex items-center gap-3">
                      <item.icon className="h-[22px] w-[22px] shrink-0" />
                      {item.label}
                    </span>
                    <CaretDown className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOpen && (
                    <div className="ml-4 pl-3 border-l border-border-default space-y-1 mt-1 mb-1">
                      {item.items.map(sub => {
                        // NavLink's isActive de react-router sólo compara pathname,
                        // ignora el query string — "Profesionales" y "Pendientes
                        // verificación" comparten la misma ruta (`?filter=` es lo
                        // único que las distingue) y quedaban las dos resaltadas
                        // a la vez. Match exacto de pathname + search en su lugar.
                        const [subPath, subQuery] = sub.to.split('?')
                        const subActive = pathname === subPath && search === (subQuery ? `?${subQuery}` : '')
                        return (
                          <NavLink
                            key={sub.to}
                            to={sub.to}
                            onClick={onClose}
                            className={`${subActive ? 'nav-pill-active' : 'nav-pill-inactive'} text-sm`}
                          >
                            <sub.icon className="h-[18px] w-[18px] shrink-0" />
                            {sub.label}
                          </NavLink>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            }
            return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) => isActive ? 'nav-pill-active' : 'nav-pill-inactive'}
            >
              <item.icon className="h-[22px] w-[22px] shrink-0" />
              {item.label}
            </NavLink>
            )
          })}
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
        <div className="px-3 py-4 border-t border-border-default space-y-1">
          {PROFILE_ROUTES[role] && (
            <NavLink
              to={PROFILE_ROUTES[role]}
              onClick={onClose}
              className={({ isActive }) => isActive ? 'nav-pill-active' : 'nav-pill-inactive'}
            >
              {profile?.avatarUrl ? (
                <img src={profile.avatarUrl} alt={profile.fullName} className="h-8 w-8 rounded-full object-cover shrink-0" />
              ) : (
                <UserCircle className="h-8 w-8 text-text-tertiary shrink-0" />
              )}
              <div className="text-left min-w-0">
                <p className="text-sm font-medium text-text-primary leading-tight truncate">{profile?.fullName || 'Mi perfil'}</p>
              </div>
            </NavLink>
          )}
          <button
            onClick={handleLogout}
            className="nav-pill-inactive w-full text-left text-error hover:bg-red-50 hover:text-error"
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
