import { Outlet, Link } from 'react-router-dom'
import { CompanyLogo } from '../components/common/CompanyLogo'

export default function AuthLayout() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-brand/5 via-bg-primary to-brand/10 flex flex-col">
      {/* Header */}
      <nav className="px-6 py-4">
        <Link to="/" className="w-fit block hover:opacity-70 transition-opacity">
          <CompanyLogo size="sm" />
        </Link>
      </nav>

      {/* Card */}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <Outlet />
        </div>
      </div>

      <footer className="text-center pb-6 text-sm text-text-tertiary">
        © {new Date().getFullYear()} Healthier. Todos los derechos reservados.
      </footer>
    </div>
  )
}
