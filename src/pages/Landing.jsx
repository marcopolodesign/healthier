import { Link } from 'react-router-dom'
import {
  BoltIcon, HeartIcon, ShieldCheckIcon, ClockIcon,
  StarIcon, MagnifyingGlassIcon, CalendarDaysIcon, CheckCircleIcon,
  DevicePhoneMobileIcon, CurrencyDollarIcon, UserGroupIcon,
} from '@heroicons/react/24/outline'

const SPECIALTIES = [
  { icon: '🩺', label: 'Medicina General', desc: 'Consultas médicas generales y diagnóstico' },
  { icon: '🥗', label: 'Nutrición',         desc: 'Planes alimentarios y hábitos saludables' },
  { icon: '🧠', label: 'Psicología',        desc: 'Salud mental y bienestar emocional' },
  { icon: '💪', label: 'Entrenamiento',     desc: 'Acondicionamiento físico personalizado' },
]

const STEPS = [
  { num: 1, icon: MagnifyingGlassIcon, title: 'Encontrá tu especialista', desc: 'Buscá por especialidad y filtrá por disponibilidad inmediata o agenda futura.' },
  { num: 2, icon: CalendarDaysIcon,    title: 'Agendá o consultá ahora',   desc: 'Reservá un turno en el horario que más te convenga, o iniciá una consulta al instante.' },
  { num: 3, icon: HeartIcon,           title: 'Seguimiento de tu salud',   desc: 'Accedé al historial de consultas, documentos y recetas en un solo lugar.' },
]

const PRO_BENEFITS = [
  { icon: CalendarDaysIcon,   text: 'Agenda propia integrada con Calendly' },
  { icon: BoltIcon,           text: 'Modo consulta inmediata (on-demand)' },
  { icon: UserGroupIcon,      text: 'Crecé tu base de pacientes' },
  { icon: CurrencyDollarIcon, text: 'Sin comisiones abusivas' },
  { icon: DevicePhoneMobileIcon, text: 'Acceso desde cualquier dispositivo' },
  { icon: ShieldCheckIcon,    text: 'Perfil verificado y confiable' },
]

export default function Landing() {
  return (
    <div className="min-h-screen bg-white">
      {/* ── Navbar ── */}
      <nav className="fixed top-0 inset-x-0 z-40 bg-white/80 backdrop-blur border-b border-border-default">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center">
              <BoltIcon className="h-5 w-5 text-white" />
            </div>
            <span className="font-bold text-xl text-text-primary" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              Healthier
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="btn-secondary text-sm hidden sm:inline-flex">Iniciar sesión</Link>
            <Link to="/registro" className="btn-primary text-sm">Registrarse</Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="pt-32 pb-20 px-4 text-center bg-gradient-to-b from-brand/5 via-white to-white">
        <div className="max-w-3xl mx-auto">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-brand bg-brand-muted px-3 py-1 rounded-full mb-6">
            <ShieldCheckIcon className="h-4 w-4" />
            Profesionales verificados · Buenos Aires
          </span>
          <h1
            className="text-4xl sm:text-5xl lg:text-6xl font-bold text-text-primary mb-6 leading-tight"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Tu salud,{' '}
            <span className="text-brand">cuando la necesitás</span>
          </h1>
          <p className="text-lg sm:text-xl text-text-secondary mb-10 max-w-2xl mx-auto">
            Consultas médicas online con profesionales verificados.
            Agendadas o ahora mismo, desde donde estés.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/registro" className="btn-accent text-base px-8 py-3 rounded-lg">
              Buscar un profesional
            </Link>
            <Link to="/registro?tipo=profesional" className="btn-secondary text-base px-8 py-3 rounded-lg">
              ¿Sos profesional? Sumate
            </Link>
          </div>

          {/* Social proof */}
          <div className="flex items-center justify-center gap-6 mt-12 text-sm text-text-secondary">
            <div className="flex items-center gap-1.5">
              <div className="flex -space-x-2">
                {['bg-teal-400', 'bg-blue-400', 'bg-purple-400', 'bg-orange-400'].map((c, i) => (
                  <div key={i} className={`w-7 h-7 rounded-full ${c} border-2 border-white`} />
                ))}
              </div>
              <span>+500 profesionales</span>
            </div>
            <div className="flex items-center gap-1">
              <StarIcon className="h-4 w-4 text-yellow-400 fill-yellow-400" />
              <span>4.9/5 de satisfacción</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Especialidades ── */}
      <section className="py-20 px-4 bg-bg-primary">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-text-primary mb-3" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              Especialidades disponibles
            </h2>
            <p className="text-text-secondary">Encontrá el especialista que necesitás</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {SPECIALTIES.map(s => (
              <div key={s.label} className="card-hover text-center group">
                <div className="text-4xl mb-3">{s.icon}</div>
                <h3 className="font-semibold text-text-primary mb-1">{s.label}</h3>
                <p className="text-sm text-text-secondary">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Cómo funciona ── */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-text-primary mb-3" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              ¿Cómo funciona?
            </h2>
            <p className="text-text-secondary">En 3 simples pasos</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {STEPS.map(step => (
              <div key={step.num} className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-brand-muted flex items-center justify-center mx-auto mb-4 relative">
                  <step.icon className="h-7 w-7 text-brand" />
                  <span className="absolute -top-2 -right-2 w-6 h-6 bg-brand text-white text-xs font-bold rounded-full flex items-center justify-center">
                    {step.num}
                  </span>
                </div>
                <h3 className="font-semibold text-text-primary mb-2">{step.title}</h3>
                <p className="text-sm text-text-secondary">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Para profesionales ── */}
      <section className="py-20 px-4 bg-gradient-to-br from-brand/5 to-accent/5">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <span className="text-sm font-medium text-brand">Para profesionales</span>
              <h2 className="text-3xl font-bold text-text-primary mt-2 mb-4" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                Hacé crecer tu práctica con Healthier
              </h2>
              <p className="text-text-secondary mb-8">
                Conectate con pacientes que necesitan tus servicios. Gestioná tu agenda, ofrecé consultas inmediatas y construí tu reputación online.
              </p>
              <div className="space-y-3">
                {PRO_BENEFITS.map(b => (
                  <div key={b.text} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-brand-muted flex items-center justify-center shrink-0">
                      <b.icon className="h-4 w-4 text-brand" />
                    </div>
                    <span className="text-sm text-text-primary">{b.text}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card shadow-lg">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-brand-muted flex items-center justify-center">
                  <UserGroupIcon className="h-6 w-6 text-brand" />
                </div>
                <div>
                  <p className="font-semibold text-text-primary">Dr. Martín García</p>
                  <p className="text-sm text-brand">Medicina General</p>
                </div>
              </div>
              <div className="flex items-center gap-1 mb-3">
                {[...Array(5)].map((_, i) => (
                  <StarIcon key={i} className="h-4 w-4 text-yellow-400 fill-yellow-400" />
                ))}
                <span className="text-sm text-text-secondary ml-1">5.0 (48 reseñas)</span>
              </div>
              <p className="text-sm text-text-secondary mb-4">
                "Healthier me permitió llegar a muchos más pacientes y gestionar mi agenda de forma simple."
              </p>
              <div className="flex gap-2">
                {['Verificado', 'On-demand', '+100 consultas'].map(tag => (
                  <span key={tag} className="text-xs bg-brand-muted text-brand px-2 py-1 rounded-full">{tag}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA final ── */}
      <section className="py-20 px-4 bg-brand text-white text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-4" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Empezá hoy
          </h2>
          <p className="text-brand-muted mb-8 text-lg" style={{ color: 'rgba(255,255,255,0.8)' }}>
            Registrate gratis y accedé a cientos de profesionales verificados.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/registro"
              className="bg-white text-brand font-semibold px-8 py-3 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Crear cuenta gratis
            </Link>
            <Link
              to="/login"
              className="border border-white/50 text-white font-semibold px-8 py-3 rounded-lg hover:bg-white/10 transition-colors"
            >
              Ya tengo cuenta
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-gray-900 text-gray-400 py-8 px-4 text-center text-sm">
        <div className="flex items-center justify-center gap-2 mb-3">
          <div className="w-6 h-6 bg-brand rounded flex items-center justify-center">
            <BoltIcon className="h-4 w-4 text-white" />
          </div>
          <span className="font-semibold text-white">Healthier</span>
        </div>
        <p>© {new Date().getFullYear()} Healthier. Todos los derechos reservados.</p>
        <p className="mt-1">Buenos Aires, Argentina</p>
      </footer>
    </div>
  )
}
