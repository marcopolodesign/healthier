import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck, Star, MagnifyingGlass, Calendar, Heart,
  ArrowRight, Stethoscope, Brain, Baby, Lightning,
  ClipboardText, ChartLine, Pill, Robot, CheckCircle,
  Barbell, Users, CurrencyDollar, DeviceMobile,
} from '@phosphor-icons/react'
import { CompanyLogo } from '../components/common/CompanyLogo'
import { captureUtms } from '../lib/utms'

const SPECIALTIES = [
  { icon: Stethoscope,   label: 'Medicina General', color: 'text-brand bg-brand-muted' },
  { icon: Brain,         label: 'Psicología',       color: 'text-violet-600 bg-violet-50' },
  { icon: ClipboardText, label: 'Nutrición',        color: 'text-amber-600 bg-amber-50' },
  { icon: Baby,          label: 'Pediatría',        color: 'text-sky-600 bg-sky-50' },
  { icon: Lightning,     label: 'Urgencias',        color: 'text-accent bg-accent/10' },
  { icon: Barbell,       label: 'Entrenamiento',    color: 'text-emerald-600 bg-emerald-50' },
]

const FEATURES = [
  {
    icon: ClipboardText,
    title: 'Historia Clínica digital',
    desc: 'Cada consulta queda registrada en tu bóveda personal. Condiciones, medicamentos, alergias — siempre disponibles.',
    tag: 'Ley 26.529',
  },
  {
    icon: ChartLine,
    title: 'Análisis inteligentes',
    desc: 'Subí tus resultados de laboratorio y la IA te explica qué significan, con tendencias en el tiempo.',
    tag: 'Biovisor',
  },
  {
    icon: Pill,
    title: 'Receta electrónica',
    desc: 'Tu médico emite la receta al terminar la consulta. La descargás al instante, sin papeles.',
    tag: 'Válida en todo el país',
  },
  {
    icon: Robot,
    title: 'IA que conoce tu salud',
    desc: 'Consultá entre turnos. La IA tiene acceso a tu historia clínica para darte respuestas contextualizadas.',
    tag: 'Healthy IA',
  },
]

const STEPS = [
  { num: '01', icon: MagnifyingGlass, title: 'Elegís tu especialidad',     desc: 'Filtrá por tipo de consulta, disponibilidad inmediata o próximos turnos.' },
  { num: '02', icon: Calendar,        title: 'Agendás o consultás ahora',  desc: 'Reservá en el horario que te convenga, o iniciá una consulta al instante.' },
  { num: '03', icon: Heart,           title: 'Tu salud, en un solo lugar', desc: 'Historia clínica, recetas y análisis guardados en tu cuenta, para siempre.' },
]

const PRO_BENEFITS = [
  { icon: Calendar,      text: 'Agenda integrada y configurable' },
  { icon: Lightning,     text: 'Consultas on-demand e inmediatas' },
  { icon: ClipboardText, text: 'Historia clínica digital compartida' },
  { icon: CurrencyDollar, text: 'Cobros seguros vía MercadoPago' },
  { icon: Users,         text: 'Crecé tu base de pacientes' },
  { icon: DeviceMobile,  text: 'App y web — desde cualquier dispositivo' },
]

function HeroCard() {
  return (
    <div className="relative">
      <div className="absolute -inset-4 bg-brand/8 rounded-3xl" />
      <div className="relative bg-white rounded-2xl shadow-xl p-6 space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-border-default">
          <div className="w-10 h-10 rounded-full bg-brand-muted flex items-center justify-center">
            <Stethoscope className="h-5 w-5 text-brand" />
          </div>
          <div>
            <p className="font-semibold text-text-primary text-sm">Dra. Laura Méndez</p>
            <p className="text-xs text-brand">Medicina General · Disponible ahora</p>
          </div>
          <div className="ml-auto">
            <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full font-medium">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              Online
            </span>
          </div>
        </div>

        <div className="space-y-2.5">
          <div className="bg-bg-primary rounded-xl p-3 text-xs text-text-secondary">
            Historia clínica actualizada · 3 consultas este año
          </div>
          <div className="flex gap-2">
            {['HTA controlada', 'Sin alergias conocidas'].map(tag => (
              <span key={tag} className="text-xs bg-brand-muted text-brand px-2 py-1 rounded-full">{tag}</span>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between bg-bg-primary rounded-xl p-3">
          <div>
            <p className="text-xs text-text-secondary">Próxima consulta</p>
            <p className="text-sm font-medium text-text-primary">Mañana, 10:30 AM</p>
          </div>
          <span className="text-xs bg-white border border-brand text-brand px-3 py-1.5 rounded-lg font-medium">
            Ver sala
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-text-secondary">
          {[...Array(5)].map((_, i) => (
            <Star key={i} className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400" />
          ))}
          <span>4.9 · 127 reseñas</span>
        </div>
      </div>

      <div className="absolute -bottom-4 -left-4 bg-white rounded-xl shadow-lg px-4 py-2.5 flex items-center gap-2">
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
      <nav className="fixed top-0 inset-x-0 z-40 bg-bg-primary/90 backdrop-blur border-b border-border-default">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <CompanyLogo size="sm" />
          <div className="flex items-center gap-3">
            <Link to="/login" className="btn-secondary text-sm hidden sm:inline-flex">Iniciar sesión</Link>
            <Link to="/registro" className="btn-accent text-sm">Reservar consulta</Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="pt-28 pb-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-widest text-text-secondary uppercase mb-6">
                Plataforma de salud · Buenos Aires
              </span>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-text-primary leading-[1.1] mb-6">
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

              <div className="flex flex-wrap gap-4 text-sm text-text-secondary">
                <div className="flex items-center gap-1.5">
                  <div className="flex -space-x-1.5">
                    {['bg-teal-400', 'bg-blue-400', 'bg-violet-400', 'bg-amber-400'].map((c, i) => (
                      <div key={i} className={`w-6 h-6 rounded-full ${c} border-2 border-bg-primary`} />
                    ))}
                  </div>
                  <span>+500 profesionales</span>
                </div>
                <div className="flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400" />
                  <span>4.9 de satisfacción</span>
                </div>
                <div className="flex items-center gap-1">
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

      {/* ── Especialidades ── */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold text-text-primary mb-2">Especialidades disponibles</h2>
            <p className="text-text-secondary">Médicos, psicólogos, nutricionistas y más</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {SPECIALTIES.map(s => (
              <Link
                key={s.label}
                to="/registro"
                className="flex flex-col items-center gap-2.5 p-4 rounded-2xl bg-bg-primary hover:bg-brand-muted/50 border border-border-default hover:border-brand/30 transition-all"
              >
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${s.color}`}>
                  <s.icon className="h-5 w-5" />
                </div>
                <span className="text-xs font-medium text-text-primary text-center leading-snug">{s.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Más que un turno ── */}
      <section className="py-20 px-4 bg-bg-primary">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <span className="text-sm font-semibold text-accent uppercase tracking-widest mb-3 block">Más que un turno</span>
            <h2 className="text-3xl sm:text-4xl font-bold text-text-primary mb-3">
              Una plataforma de salud completa
            </h2>
            <p className="text-text-secondary max-w-xl mx-auto">
              Healthier no es solo para pedir turnos. Es tu sistema de salud digital.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {FEATURES.map(f => (
              <div
                key={f.title}
                className="bg-white rounded-2xl p-6 border border-border-default hover:border-brand/30 hover:shadow-md transition-all"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-brand-muted flex items-center justify-center shrink-0">
                    <f.icon className="h-6 w-6 text-brand" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <h3 className="font-semibold text-text-primary">{f.title}</h3>
                      <span className="text-xs text-brand bg-brand-muted px-2 py-0.5 rounded-full font-medium">{f.tag}</span>
                    </div>
                    <p className="text-sm text-text-secondary leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Cómo funciona ── */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-text-primary mb-3">¿Cómo funciona?</h2>
            <p className="text-text-secondary">Tres pasos para cuidar tu salud</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {STEPS.map(step => (
              <div key={step.num}>
                <div className="text-5xl font-bold text-brand/10 mb-4 leading-none">{step.num}</div>
                <div className="w-14 h-14 rounded-2xl bg-brand-muted flex items-center justify-center mb-4">
                  <step.icon className="h-7 w-7 text-brand" />
                </div>
                <h3 className="font-semibold text-text-primary mb-2 text-lg">{step.title}</h3>
                <p className="text-sm text-text-secondary leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats + testimonial ── */}
      <section className="py-20 px-4 bg-bg-primary">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            {[
              { number: '+500', label: 'Profesionales verificados', sub: 'con matrícula activa en Argentina' },
              { number: '4.9',  label: 'Satisfacción promedio',     sub: 'de 5 en reseñas de consultas' },
              { number: '3',    label: 'Especialidades urgentes',   sub: 'disponibles ahora mismo' },
            ].map(stat => (
              <div key={stat.number} className="bg-white rounded-2xl p-6 border border-border-default text-center">
                <div className="text-4xl font-bold text-brand mb-1">{stat.number}</div>
                <div className="font-semibold text-text-primary mb-1">{stat.label}</div>
                <div className="text-sm text-text-secondary">{stat.sub}</div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl p-8 border border-border-default">
            <div className="flex items-center gap-1 mb-4">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="h-4 w-4 text-yellow-400 fill-yellow-400" />
              ))}
            </div>
            <blockquote className="text-text-primary text-lg leading-relaxed mb-6">
              "Empecé a usar Healthier para una consulta rápida y terminé usando el Biovisor para entender mis análisis de rutina. Tener todo en un solo lugar cambió cómo cuido mi salud."
            </blockquote>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-400 to-blue-400" />
              <div>
                <p className="font-semibold text-text-primary text-sm">Valentina R.</p>
                <p className="text-xs text-text-secondary">Paciente · Buenos Aires</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Para profesionales ── */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="bg-bg-primary rounded-2xl p-8 border border-border-default">
              <div className="space-y-4">
                {PRO_BENEFITS.map(b => (
                  <div key={b.text} className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-white border border-border-default flex items-center justify-center shrink-0">
                      <b.icon className="h-4 w-4 text-brand" />
                    </div>
                    <span className="text-sm text-text-primary">{b.text}</span>
                    <CheckCircle className="h-4 w-4 text-brand ml-auto shrink-0" weight="fill" />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <span className="text-sm font-semibold text-brand uppercase tracking-widest mb-3 block">Para profesionales</span>
              <h2 className="text-3xl sm:text-4xl font-bold text-text-primary mb-4 leading-tight">
                Hacé crecer tu práctica con Healthier
              </h2>
              <p className="text-text-secondary mb-6 leading-relaxed">
                Gestioná tu agenda, ofrecé consultas inmediatas y construí tu reputación online. Con historia clínica integrada, recetas digitales y pagos automáticos.
              </p>
              <p className="text-text-secondary mb-8 leading-relaxed">
                Más de 500 profesionales ya atienden en Healthier. Tu matrícula se verifica antes de publicar tu perfil.
              </p>
              <Link
                to="/registro?tipo=profesional"
                className="btn-primary text-base px-7 py-3 rounded-xl inline-flex items-center gap-2"
              >
                Sumá tu práctica
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA final ── */}
      <section className="py-20 px-4 bg-brand">
        <div className="max-w-3xl mx-auto text-center">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-widest text-white/70 uppercase mb-5">
            Empezá hoy · Es gratis
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Tu salud, cuando la necesitás
          </h2>
          <p className="text-white/75 text-lg mb-10 max-w-xl mx-auto leading-relaxed">
            Registrate gratis y accedé a médicos verificados, historia clínica digital y herramientas de salud inteligentes.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to="/registro"
              className="bg-white text-brand font-semibold px-8 py-3.5 rounded-xl hover:bg-gray-50 transition-colors inline-flex items-center justify-center gap-2"
            >
              Crear cuenta gratis
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/login"
              className="border border-white/30 text-white font-semibold px-8 py-3.5 rounded-xl hover:bg-white/10 transition-colors text-center"
            >
              Ya tengo cuenta
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-gray-900 text-gray-400 py-10 px-4">
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
