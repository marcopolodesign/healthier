import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  ChartBar, CurrencyDollar, ShieldCheck, Users, DotsThree, X,
  Siren, UserCirclePlus, MapPin, Stethoscope, Eye, Gear, SignOut, ShieldWarning, Path,
} from '@phosphor-icons/react'
import { authService } from '../../services/authService'
import { toast } from '../Toast'

// Nav de super admin en mobile. Hasta ahora el único acceso era la hamburguesa
// del header: en un teléfono eso deja Pagos —lo que más se mira— a dos toques y
// escondido. Mismo patrón que el nav de profesional: 4 tabs + "Más".
const MAIN_TABS = [
  { id: 'dashboard',     path: '/super-admin/dashboard',     icon: ChartBar,       label: 'Inicio' },
  { id: 'pagos',         path: '/super-admin/pagos',         icon: CurrencyDollar, label: 'Pagos' },
  { id: 'profesionales', path: '/super-admin/profesionales', query: '?filter=verificados', icon: ShieldCheck, label: 'Verificados' },
  { id: 'usuarios',      path: '/super-admin/usuarios',      icon: Users,          label: 'Usuarios' },
]

// Agrupado igual que el sidebar de desktop: Consultas+Emergencias juntos,
// Usuarios+Profesionales+Prospectos juntos, Zonas/Verticales/Admins dentro de Configuración.
const MORE_GROUPS = [
  {
    title: 'Consultas y emergencias',
    links: [
      { path: '/super-admin/emergencias', icon: Siren, label: 'Emergencias', sub: 'S.O.S en curso' },
    ],
  },
  {
    title: 'Pacientes',
    links: [
      { path: '/super-admin/usuarios/prospects', icon: UserCirclePlus, label: 'Prospectos', sub: 'Pacientes a recuperar' },
    ],
  },
  {
    title: 'Profesionales',
    links: [
      { path: '/super-admin/profesionales/prospects',         icon: UserCirclePlus, label: 'Prospectos',              sub: 'Empezaron el registro y no lo terminaron' },
      { path: '/super-admin/profesionales/recorrido',         icon: Path,           label: 'Recorrido',               sub: 'Dónde se frenaron y cuándo retomaron' },
      { path: '/super-admin/profesionales?filter=pendientes', icon: ShieldWarning,  label: 'Pendientes verificación', sub: 'Esperando revisión' },
    ],
  },
  {
    title: 'Otros',
    links: [
      { path: '/super-admin/auditoria', icon: Eye, label: 'Auditoría HC', sub: 'Accesos a historias clínicas' },
    ],
  },
  {
    title: 'Configuración',
    links: [
      { path: '/super-admin/settings',    icon: Gear,        label: 'General',    sub: 'Comisiones y ventanas' },
      { path: '/super-admin/zonas',       icon: MapPin,      label: 'Zonas',      sub: 'Cobertura' },
      { path: '/super-admin/verticales',  icon: Stethoscope, label: 'Verticales', sub: 'Precios y disponibilidad' },
      { path: '/super-admin/admins',      icon: ShieldCheck, label: 'Admins',     sub: 'Equipo interno' },
    ],
  },
]

export default function SuperAdminBottomNav({ className = '' }) {
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const [open, setOpen] = useState(false)

  // `/super-admin/usuarios/prospects` no debe marcar activo el tab Usuarios:
  // se compara la ruta exacta salvo para las que tienen subrutas propias.
  // "Verificados" y "Pendientes verificación" comparten pathname (sólo las
  // distingue `?filter=`) — comparar también el query evita que el tab quede
  // resaltado estando en la otra sección.
  const activeId = MAIN_TABS.find(t => pathname === t.path && search === (t.query || ''))?.id

  const irA = (path) => {
    setOpen(false)
    navigate(path)
  }

  const cerrarSesion = async () => {
    setOpen(false)
    await authService.logout()
    toast.success('Sesión cerrada')
    navigate('/login')
  }

  return (
    <>
      <nav className={`flex items-center justify-between ${className}`}>
        {MAIN_TABS.map(tab => {
          const active = tab.id === activeId
          return (
            <button
              key={tab.id}
              onClick={() => navigate(tab.path + (tab.query || ''))}
              className={`flex flex-col items-center gap-1 transition-all duration-200 px-2 ${active ? 'text-brand' : 'text-gray-400 hover:text-gray-500'}`}
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

        <button
          onClick={() => setOpen(true)}
          className="flex flex-col items-center gap-1 px-2 text-gray-400 hover:text-gray-500 transition-colors"
          aria-label="Más secciones"
        >
          <DotsThree className="h-[22px] w-[22px]" weight="bold" />
          <span className="text-[10px] font-medium tracking-wide">Más</span>
        </button>
      </nav>

      {open && createPortal(
        <>
          <button
            aria-label="Cerrar"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm"
          />
          <div className="fixed bottom-0 left-0 right-0 z-[100]">
            <div className="bg-bg-primary rounded-t-3xl px-5 pt-3 pb-8 max-h-[80dvh] overflow-y-auto">
              <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-text-primary">Más secciones</p>
                <button
                  onClick={() => setOpen(false)}
                  className="w-8 h-8 rounded-full bg-bg-secondary flex items-center justify-center hover:bg-gray-200 transition-colors"
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4 text-text-secondary" />
                </button>
              </div>

              {MORE_GROUPS.map(group => (
                <div key={group.title} className="mb-2">
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                    {group.title}
                  </p>
                  {group.links.map(link => (
                    <button
                      key={link.path}
                      onClick={() => irA(link.path)}
                      className="flex items-center gap-4 w-full px-3 py-3.5 rounded-2xl text-left hover:bg-white/60 active:bg-white/80 transition-colors"
                    >
                      <div className="w-10 h-10 rounded-full bg-brand-muted flex items-center justify-center shrink-0">
                        <link.icon className="h-5 w-5 text-brand" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-primary">{link.label}</p>
                        <p className="text-xs text-text-secondary">{link.sub}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ))}

              <button
                onClick={cerrarSesion}
                className="flex items-center gap-4 w-full px-3 py-3.5 rounded-2xl text-left hover:bg-white/60 transition-colors mt-1"
              >
                <div className="w-10 h-10 rounded-full bg-danger-muted flex items-center justify-center shrink-0">
                  <SignOut className="h-5 w-5 text-danger" />
                </div>
                <p className="text-sm font-medium text-error">Cerrar sesión</p>
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
