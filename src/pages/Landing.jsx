import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck, Star, MagnifyingGlass, Calendar, Heart,
  ArrowRight, Stethoscope, Brain, Baby, Lightning,
  ClipboardText, ChartLine, Pill, Robot, CheckCircle,
  Barbell, Users, CurrencyDollar, DeviceMobile, ChatText,
} from '@phosphor-icons/react'
import { CompanyLogo } from '../components/common/CompanyLogo'
import { captureUtms } from '../lib/utms'

// Specialty cards — forhers category grid style (tall gradient cards)
const SPECIALTIES = [
  { icon: Stethoscope,   label: 'Medicina General', from: 'from-brand/20',          to: 'to-brand/45' },
  { icon: Brain,         label: 'Psicología',       from: 'from-brand-tertiary/20', to: 'to-brand-tertiary/45' },
  { icon: ClipboardText, label: 'Nutrición',        from: 'from-amber-100',         to: 'to-amber-200' },
  { icon: Baby,          label: 'Pediatría',        from: 'from-sky-100',           to: 'to-sky-200' },
  { icon: Lightning,     label: 'Urgencias',        from: 'from-accent/20',         to: 'to-accent/45' },
  { icon: Barbell,       label: 'Entrenamiento',    from: 'from-emerald-100',       to: 'to-emerald-200' },
]

// Feature cards with gradient fills (forhers card style)
const FEATURES = [
  {
    icon: ClipboardText,
    title: 'Historia Clínica digital',
    desc: 'Cada consulta queda registrada en tu bóveda personal. Condiciones, medicamentos, alergias — siempre disponibles.',
    tag: 'Ley 26.529',
    from: 'from-brand/8', to: 'to-brand/20',
  },
  {
    icon: ChartLine,
    title: 'Análisis inteligentes',
    desc: 'Subí tus resultados de laboratorio y la IA te explica qué significan, con tendencias en el tiempo.',
    tag: 'Biovisor',
    from: 'from-brand-tertiary/8', to: 'to-brand-tertiary/20',
  },
  {
    icon: Pill,
    title: 'Receta electrónica',
    desc: 'Tu médico emite la receta al terminar la consulta. La descargás al instante, sin papeles.',
    tag: 'Válida en todo el país',
    from: 'from-amber-50', to: 'to-amber-100',
  },
  {
    icon: Robot,
    title: 'IA que conoce tu salud',
    desc: 'Consultá entre turnos. La IA tiene acceso a tu historia clínica para darte respuestas contextualizadas.',
    tag: 'Healthy IA',
    from: 'from-accent/8', to: 'to-accent/20',
  },
]

const STEPS = [
  { num: '01', icon: MagnifyingGlass, title: 'Elegís tu especialidad',     desc: 'Filtrá por tipo de consulta, disponibilidad inmediata o próximos turnos.' },
  { num: '02', icon: Calendar,        title: 'Agendás o consultás ahora',  desc: 'Reservá en el horario que te convenga, o iniciá una consulta al instante.' },
  { num: '03', icon: Heart,           title: 'Tu salud, en un solo lugar', desc: 'Historia clínica, recetas y análisis guardados en tu cuenta, para siempre.' },
]

const PRO_BENEFITS = [
  { icon: Calendar,       text: 'Agenda integrada y configurable' },
  { icon: Lightning,      text: 'Consultas on-demand e inmediatas' },
  { icon: ClipboardText,  text: 'Historia clínica digital compartida' },
  { icon: CurrencyDollar, text: 'Cobros seguros vía MercadoPago' },
  { icon: Users,          text: 'Crecé tu base de pacientes' },
  { icon: DeviceMobile,   text: 'App y web — desde cualquier dispositivo' },
]

// forhers dr-quote style — large gradient card with testimonial
function QuoteCard() {
  return (
    <div className="relative bg-gradient-to-br from-brand/50 to-brand rounded-3xl p-8 sm:p-12 overflow-hidden">
      <div className="absolute -top-16 -right-16 w-64 h-64 bg-white/5 rounded-full" />
      <div className="absolute -bottom-12 -left-12 w-48 h-48 bg-white/5 rounded-full" />
      <div className="relative">
        <div className="w-14 h-14 rounded-2xl bg-white/20 border border-white/30 flex items-center justify-center mb-6">
          <ChatText className="h-7 w-7 text-white" />
        </div>
        <p className="text-white/40 text-5xl font-bold leading-none mb-2 select-none">"</p>
        <blockquote className="text-white text-xl sm:text-2xl font-medium leading-relaxed mb-8 -mt-4">
          Empecé a usar Healthier para una consulta rápida y terminé usando el Biovisor para entender mis análisis de rutina. Tener todo en un solo lugar cambió cómo cuido mi salud.
        </blockquote>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-white/30 to-white/10 border border-white/30" />
          <div>
            <p className="text-white font-semibold text-sm">Valentina R.</p>
            <p className="text-white/60 text-xs">Paciente · Buenos Aires</p>
          </div>
          <div className="ml-auto flex gap-0.5">
            {[...Array(5)].map((_, i) => (
              <Star key={i} weight="fill" className="h-3.5 w-3.5 text-white/70" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// Hero right — gradient card (forhers "built for you" card translated to our system)
function HeroCard() {
  return (
    <div className="relative">
      <div className="absolute -inset-6 bg-brand/8 rounded-[2.5rem]" />
      <div className="relative bg-gradient-to-b from-brand/15 to-brand/35 rounded-3xl overflow-hidden border border-brand/20">
        {/* Header bar */}
        <div className="bg-white/90 backdrop-blur-sm p-5 flex items-center gap-3 border-b border-border-default/40">
          <div className="w-10 h-10 rounded-full bg-brand/15 flex items-center justify-center">
            <Stethoscope className="h-5 w-5 text-brand" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-text-primary text-sm">Dra. Laura Méndez</p>
            <p className="text-xs text-brand">Medicina General</p>
          </div>
          <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full font-medium border border-emerald-100">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            Online
          </span>
        </div>

        {/* Gradient body */}
        <div className="p-6 space-y-4">
          <div className="flex gap-2 flex-wrap">
            {['HTA controlada', 'Sin alergias conocidas', '3 consultas este año'].map(tag => (
              <span key={tag} className="text-xs bg-white/60 text-text-primary px-2.5 py-1 rounded-full border border-white/80">{tag}</span>
            ))}
          </div>

          <div className="bg-white/55 backdrop-blur-sm rounded-2xl p-4 flex items-center justify-between border border-white/70">
            <div>
              <p className="text-xs text-text-secondary mb-0.5">Próxima consulta</p>
              <p className="text-sm font-semibold text-text-primary">Mañana, 10:30 AM</p>
            </div>
            <span className="text-xs bg-white text-brand border border-brand/20 px-3 py-1.5 rounded-xl font-medium shadow-sm">
              Ver sala
            </span>
          </div>

          <div className="bg-white/55 backdrop-blur-sm rounded-2xl p-4 border border-white/70">
            <p className="text-xs text-text-secondary mb-2.5">Historial reciente</p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full bg-brand shrink-0" />
                <span className="text-xs text-text-primary">Análisis de rutina — hace 2 semanas</span>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full bg-brand/40 shrink-0" />
                <span className="text-xs text-text-secondary">Presión arterial: normal</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {[...Array(5)].map((_, i) => (
              <Star key={i} weight="fill" className="h-3.5 w-3.5 text-yellow-500" />
            ))}
            <span className="text-xs text-text-secondary ml-1">4.9 · 127 reseñas</span>
          </div>
        </div>
      </div>

      {/* Floating badge */}
      <div className="absolute -bottom-4 -left-4 bg-white rounded-xl shadow-lg px-4 py-2.5 flex items-center gap-2 border border-border-default">
        <ShieldCheck className="h-4 w-4 text-brand" weight="fill" />
        <span className="text-xs font-medium text-text-primary">Profesional verificado</span>
      </div>
    </div>
  )
}

export default function Landing() {
  useEffect(() => { captureUtms() }, [])

  return (
    <div className="min-h-screen bg-bg-primary">

      {/* ── Navbar ── */}
      <nav className="fixed top-0 inset-x-0 z-40 bg-bg-primary/95 backdrop-blur border-b border-border-default">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <CompanyLogo size="sm" />
          <div className="flex items-center gap-3">
            <Link to="/login" className="btn-secondary text-sm hidden sm:inline-flex">Iniciar sesión</Link>
            <Link to="/registro" className="btn-accent text-sm">Reservar consulta</Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="pt-28 pb-24 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <div>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-6">
                Plataforma de salud · Buenos Aires
              </span>
              <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] font-bold text-text-primary leading-[1.08] mb-6">
                Tu historial.<br />
                Tus médicos.<br />
                <span className="text-brand">Tu salud.</span>
              </h1>
              <p className="text-lg text-text-secondary mb-8 max-w-lg leading-relaxed">
                Consultá con profesionales verificados por videollamada, guardá tu historia clínica digital y recibí recetas electrónicas — todo desde donde estés.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 mb-10">
                <Link to="/registro" className="btn-accent text-base px-7 py-3 rounded-xl inline-flex items-center justify-center gap-2">
                  Buscar un profesional
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link to="/registro?tipo=profesional" className="btn-secondary text-base px-7 py-3 rounded-xl text-center">
                  ¿Sos profesional? Sumate
                </Link>
              </div>

              <div className="flex flex-wrap gap-5 text-sm text-text-secondary">
                <div className="flex items-center gap-1.5">
                  <div className="flex -space-x-1.5">
                    {['bg-brand', 'bg-brand-tertiary', 'bg-accent', 'bg-amber-400'].map((c, i) => (
                      <div key={i} className={`w-6 h-6 rounded-full ${c} border-2 border-bg-primary`} />
                    ))}
                  </div>
                  <span>+500 profesionales</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400" />
                  <span>4.9 de satisfacción</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-brand" weight="fill" />
                  <span>Matrícula verificada</span>
                </div>
              </div>
            </div>

            <div className="hidden lg:block">
              <HeroCard />
            </div>
          </div>
        </div>
      </section>

      {/* ── Especialidades — forhers category grid (tall gradient cards) ── */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-end justify-between mb-10">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold text-text-primary mb-2">Especialidades disponibles</h2>
              <p className="text-text-secondary">Médicos, psicólogos, nutricionistas y más</p>
            </div>
            <Link to="/registro" className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:text-brand-hover transition-colors">
              Ver todas <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {SPECIALTIES.map(s => (
              <Link
                key={s.label}
                to="/registro"
                className={`flex flex-col items-start justify-between p-4 rounded-2xl bg-gradient-to-b ${s.from} ${s.to} hover:opacity-90 transition-opacity min-h-[150px] border border-black/5`}
              >
                <div className="w-10 h-10 rounded-xl bg-white/50 backdrop-blur-sm border border-white/70 flex items-center justify-center">
                  <s.icon className="h-5 w-5 text-text-primary" />
                </div>
                <span className="text-xs font-semibold text-text-primary leading-snug">{s.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Más que un turno — gradient feature cards ── */}
      <section className="py-20 px-4 bg-bg-primary">
        <div className="max-w-6xl mx-auto">
          <div className="mb-14">
            <span className="text-sm font-semibold text-accent uppercase tracking-widest mb-3 block">Más que un turno</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-text-primary mb-3">
              Una plataforma de salud completa
            </h2>
            <p className="text-text-secondary max-w-xl leading-relaxed">
              Healthier no es solo para pedir turnos. Es tu sistema de salud digital.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {FEATURES.map(f => (
              <div
                key={f.title}
                className={`bg-gradient-to-br ${f.from} ${f.to} rounded-2xl p-6 border border-black/5 hover:shadow-md transition-all`}
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-white/70 backdrop-blur-sm border border-white/80 flex items-center justify-center shrink-0 shadow-sm">
                    <f.icon className="h-6 w-6 text-brand" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <h3 className="font-semibold text-text-primary">{f.title}</h3>
                      <span className="text-xs text-brand bg-white/70 border border-brand/15 px-2 py-0.5 rounded-full font-medium">{f.tag}</span>
                    </div>
                    <p className="text-sm text-text-secondary leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats + Quote card (forhers dr-quote style) ── */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
            {[
              { number: '+500', label: 'Profesionales verificados', sub: 'con matrícula activa en Argentina' },
              { number: '4.9',  label: 'Satisfacción promedio',     sub: 'de 5 en reseñas de consultas' },
              { number: '<24h', label: 'Tiempo de respuesta',       sub: 'promedio para consultas programadas' },
            ].map(stat => (
              <div key={stat.number} className="bg-bg-primary rounded-2xl p-6 text-center border border-border-default">
                <div className="text-4xl font-bold text-brand mb-1">{stat.number}</div>
                <div className="font-semibold text-text-primary mb-1 text-sm">{stat.label}</div>
                <div className="text-xs text-text-secondary">{stat.sub}</div>
              </div>
            ))}
          </div>

          <QuoteCard />
        </div>
      </section>

      {/* ── Cómo funciona ── */}
      <section className="py-20 px-4 bg-bg-primary">
        <div className="max-w-5xl mx-auto">
          <div className="mb-14">
            <h2 className="text-3xl font-bold text-text-primary mb-3">¿Cómo funciona?</h2>
            <p className="text-text-secondary">Tres pasos para cuidar tu salud</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {STEPS.map(step => (
              <div key={step.num}>
                <div className="text-6xl font-bold text-brand/10 mb-4 leading-none select-none">{step.num}</div>
                <div className="w-14 h-14 rounded-2xl bg-white border border-border-default shadow-sm flex items-center justify-center mb-4">
                  <step.icon className="h-7 w-7 text-brand" />
                </div>
                <h3 className="font-semibold text-text-primary mb-2 text-lg">{step.title}</h3>
                <p className="text-sm text-text-secondary leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Para profesionales — forhers full-bleed dark green section style ── */}
      <section className="py-24 px-4 bg-gradient-to-br from-brand to-brand-hover">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <span className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4 block">Para profesionales</span>
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-5 leading-tight">
                Hacé crecer tu práctica con Healthier
              </h2>
              <p className="text-white/75 mb-5 leading-relaxed">
                Gestioná tu agenda, ofrecé consultas inmediatas y construí tu reputación online. Con historia clínica integrada, recetas digitales y pagos automáticos.
              </p>
              <p className="text-white/55 mb-8 leading-relaxed text-sm">
                Más de 500 profesionales ya atienden en Healthier. Tu matrícula se verifica antes de publicar tu perfil.
              </p>
              <Link
                to="/registro?tipo=profesional"
                className="bg-white text-brand font-semibold px-7 py-3 rounded-xl hover:bg-gray-50 transition-colors inline-flex items-center gap-2"
              >
                Sumá tu práctica
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
              <div className="space-y-3.5">
                {PRO_BENEFITS.map(b => (
                  <div key={b.text} className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-white/15 border border-white/25 flex items-center justify-center shrink-0">
                      <b.icon className="h-4 w-4 text-white" />
                    </div>
                    <span className="text-sm text-white/90 flex-1">{b.text}</span>
                    <CheckCircle className="h-4 w-4 text-white/40 shrink-0" weight="fill" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA final ── */}
      <section className="py-20 px-4 bg-bg-primary">
        <div className="max-w-3xl mx-auto text-center">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-5">
            Empezá hoy · Es gratis
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-text-primary mb-4">
            Tu salud, cuando la necesitás
          </h2>
          <p className="text-text-secondary text-lg mb-10 max-w-xl mx-auto leading-relaxed">
            Registrate gratis y accedé a médicos verificados, historia clínica digital y herramientas de salud inteligentes.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/registro"
              className="btn-accent text-base px-8 py-3.5 rounded-xl inline-flex items-center justify-center gap-2"
            >
              Crear cuenta gratis
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/login"
              className="btn-secondary text-base px-8 py-3.5 rounded-xl text-center"
            >
              Ya tengo cuenta
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-midnight text-gray-400 py-10 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 mb-8">
            <CompanyLogo size="sm" inverted />
            <div className="flex flex-wrap gap-6 text-sm">
              <Link to="/terminos" className="hover:text-white transition-colors">Términos y condiciones</Link>
              <Link to="/login" className="hover:text-white transition-colors">Iniciar sesión</Link>
              <Link to="/registro?tipo=profesional" className="hover:text-white transition-colors">Profesionales</Link>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <p>© {new Date().getFullYear()} Healthier. Todos los derechos reservados. Buenos Aires, Argentina.</p>
            <p className="text-gray-600">Ley 26.529 · Ley 27.553 · Ley 25.326</p>
          </div>
        </div>
      </footer>

    </div>
  )
}
