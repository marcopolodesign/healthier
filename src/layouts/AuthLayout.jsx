import { Outlet, Link } from 'react-router-dom'
import { BoltIcon } from '@heroicons/react/24/outline'

export default function AuthLayout() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-brand/5 via-white to-accent/5 flex flex-col">
      {/* Header */}
      <nav className="px-6 py-4">
        <Link to="/" className="flex items-center gap-2 w-fit">
          <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center">
            <BoltIcon className="h-5 w-5 text-white" />
          </div>
          <span className="font-bold text-xl text-text-primary" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Healthier
          </span>
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
