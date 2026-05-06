import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Menu, UserCircle, ChevronDown, Zap } from 'lucide-react'
import { authService } from '../services/authService'
import { toast } from './Toast'

export default function Header({ profile, onMenuToggle, onLogoClick }) {
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const navigate = useNavigate()

  const handleLogout = async () => {
    await authService.logout()
    toast.success('Sesión cerrada correctamente')
    navigate('/login')
  }

  const ROLE_LABELS = {
    patient: 'Paciente',
    professional: 'Profesional',
    admin: 'Administrador',
    super_admin: 'Super Admin',
  }

  return (
    <header className="h-14 bg-white border-b border-border-default flex items-center justify-between px-4 shrink-0">
      {/* Mobile hamburger */}
      <button onClick={onMenuToggle} className="lg:hidden p-1 text-text-secondary hover:text-text-primary">
        <Menu className="h-6 w-6" />
      </button>

      {/* Mobile logo */}
      <button onClick={onLogoClick} className="flex items-center gap-1.5 hover:opacity-80 transition-opacity">
        <div className="w-6 h-6 bg-brand rounded flex items-center justify-center">
          <Zap className="h-4 w-4 text-white" />
        </div>
        <span className="font-bold text-text-primary text-sm">Healthier</span>
      </button>


      {/* User menu */}
      <div className="relative">
        <button
          onClick={() => setUserMenuOpen(!userMenuOpen)}
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-surface transition-colors"
        >
          {profile?.avatarUrl ? (
            <img src={profile.avatarUrl} alt={profile.fullName} className="h-7 w-7 rounded-full object-cover" />
          ) : (
            <UserCircle className="h-7 w-7 text-text-tertiary" />
          )}
          <div className="hidden sm:block text-left">
            <p className="text-sm font-medium text-text-primary leading-tight">{profile?.fullName || 'Usuario'}</p>
            <p className="text-xs text-text-secondary leading-tight">{ROLE_LABELS[profile?.role] || ''}</p>
          </div>
          <ChevronDown className="h-4 w-4 text-text-tertiary" />
        </button>

        {userMenuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
            <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg border border-border-default shadow-lg z-20 py-1">
              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-2 text-sm text-error hover:bg-red-50 transition-colors"
              >
                Cerrar sesión
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
