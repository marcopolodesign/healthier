import { Link } from 'react-router-dom'
import { CompanyLogo } from '../common/CompanyLogo'

// Shared footer for all landing pages — forhers-style: dark olive, links row,
// giant wordmark bleeding off the bottom edge.
export function LandingFooter() {
  return (
    <footer className="bg-[#1E2619] text-white/50 pt-14 px-4 sm:px-6 overflow-hidden">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-6 mb-14">
          <div className="flex flex-wrap gap-x-7 gap-y-2 text-sm">
            <Link to="/terminos" className="hover:text-white transition-colors">Términos y condiciones</Link>
            <Link to="/login" className="hover:text-white transition-colors">Iniciar sesión</Link>
            <Link to="/landing/profesionales" className="hover:text-white transition-colors">Profesionales</Link>
          </div>
          <div className="text-xs text-white/30 sm:text-right leading-relaxed">
            <p>© {new Date().getFullYear()} Healthier · Buenos Aires, Argentina</p>
            <p>Ley 26.529 · Ley 27.553 · Ley 25.326</p>
          </div>
        </div>
        <div className="translate-y-[22%]">
          <CompanyLogo inverted className="w-full h-auto opacity-[0.14]" />
        </div>
      </div>
    </footer>
  )
}
